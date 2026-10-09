from collections import defaultdict
from collections.abc import Iterable, Sequence
from datetime import timedelta
from typing import Any

from sqlalchemy import and_, exists, func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased, selectinload

from app.core.errors import bad_request, forbidden, not_found
from app.db.base import utcnow
from app.models import (
    Conversation,
    ConversationMember,
    Message,
    MessageMention,
    User,
)
from app.models.conversation import direct_identity_key, note_identity_key
from app.schemas.conversation import (
    ConversationCreate,
    ConversationDetail,
    ConversationOut,
    ConversationSettings,
    ConversationUpdate,
    LastMessage,
    MemberOut,
)
from app.services import users as users_svc
from app.services.messages_present import load_messages, statuses_for
from app.services.visibility import visible_to
from app.ws.manager import manager

NOTE_TO_SELF = "Note to Self"


# --- membership ----------------------------------------------------------------------------


async def get_membership(
    db: AsyncSession, conversation_id: int, user_id: int, *, require_active: bool = True
) -> ConversationMember:
    member = await db.scalar(
        select(ConversationMember)
        .where(
            ConversationMember.conversation_id == conversation_id,
            ConversationMember.user_id == user_id,
        )
        .options(selectinload(ConversationMember.conversation))
    )
    if member is None:
        raise not_found("Conversation")
    if require_active and member.left_at is not None:
        raise forbidden("You are no longer a member of this group")
    return member


async def require_admin(db: AsyncSession, conversation_id: int, user_id: int) -> ConversationMember:
    member = await get_membership(db, conversation_id, user_id)
    if member.conversation.type != "group":
        raise bad_request("Only groups have admins")
    if member.role != "admin":
        raise forbidden("Only group admins can do that")
    return member


async def active_member_ids(db: AsyncSession, conversation_id: int) -> list[int]:
    rows = await db.scalars(
        select(ConversationMember.user_id).where(
            ConversationMember.conversation_id == conversation_id,
            ConversationMember.left_at.is_(None),
        )
    )
    return list(rows)


async def peer_user_ids(db: AsyncSession, user_id: int) -> set[int]:
    """Everyone who shares an active conversation with the user (for presence/profile fan-out)."""
    mine = select(ConversationMember.conversation_id).where(
        ConversationMember.user_id == user_id, ConversationMember.left_at.is_(None)
    )
    rows = await db.scalars(
        select(ConversationMember.user_id)
        .where(
            ConversationMember.conversation_id.in_(mine),
            ConversationMember.left_at.is_(None),
            ConversationMember.user_id != user_id,
        )
        .distinct()
    )
    return set(rows) | await users_svc.contact_user_ids(db, user_id)


# --- creation ------------------------------------------------------------------------------


async def find_direct(db: AsyncSession, a: int, b: int) -> Conversation | None:
    canonical = await db.scalar(
        select(Conversation).where(Conversation.identity_key == direct_identity_key(a, b))
    )
    if canonical is not None:
        return canonical
    m1, m2 = aliased(ConversationMember), aliased(ConversationMember)
    return await db.scalar(
        select(Conversation)
        .join(m1, and_(m1.conversation_id == Conversation.id, m1.user_id == a))
        .join(m2, and_(m2.conversation_id == Conversation.id, m2.user_id == b))
        .where(Conversation.type == "direct")
        .order_by(Conversation.id)
        .limit(1)
    )


async def get_or_create_note_to_self(db: AsyncSession, user: User) -> Conversation:
    user_id = user.id
    identity_key = note_identity_key(user_id)
    conv = await db.scalar(
        select(Conversation)
        .join(ConversationMember)
        .where(Conversation.type == "note_to_self", ConversationMember.user_id == user_id)
        .order_by(Conversation.identity_key.is_(None), Conversation.id)
        .limit(1)
    )
    if conv:
        return conv
    conv = Conversation(
        type="note_to_self",
        identity_key=identity_key,
        created_by=user_id,
        avatar_color=user.avatar_color,
    )
    conv.members.append(ConversationMember(user_id=user_id, role="admin"))
    db.add(conv)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        existing = await db.scalar(
            select(Conversation).where(Conversation.identity_key == identity_key)
        )
        if existing is None:
            raise
        # Rollback expires persistent objects, including the auth response's user.
        await db.refresh(user)
        return existing
    return conv


async def get_or_create_direct(
    db: AsyncSession, me: User, other_id: int
) -> tuple[Conversation, bool]:
    user_id = me.id
    if other_id == user_id:
        conv = await get_or_create_note_to_self(db, me)
        await db.execute(
            update(ConversationMember)
            .where(
                ConversationMember.conversation_id == conv.id, ConversationMember.user_id == me.id
            )
            .values(is_hidden=False)
        )
        await db.commit()
        return conv, False
    other = await db.get(User, other_id)
    if other is None:
        raise not_found("User")
    existing = await find_direct(db, user_id, other_id)
    if existing:
        # Re-opening a chat you deleted brings it back to your list.
        await db.execute(
            update(ConversationMember)
            .where(
                ConversationMember.conversation_id == existing.id,
                ConversationMember.user_id == me.id,
            )
            .values(is_hidden=False)
        )
        await db.commit()
        return existing, False
    conv = Conversation(
        type="direct", identity_key=direct_identity_key(user_id, other_id), created_by=user_id
    )
    conv.members.extend([ConversationMember(user_id=user_id), ConversationMember(user_id=other_id)])
    db.add(conv)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        existing = await find_direct(db, user_id, other_id)
        if existing is None:
            raise
        await db.refresh(me)
        await db.execute(
            update(ConversationMember)
            .where(
                ConversationMember.conversation_id == existing.id,
                ConversationMember.user_id == user_id,
            )
            .values(is_hidden=False)
        )
        await db.commit()
        return existing, False
    return conv, True


async def create_group(db: AsyncSession, me: User, data: ConversationCreate) -> Conversation:
    name = (data.name or "").strip()
    if not name:
        raise bad_request("Groups need a name")
    member_ids = {uid for uid in data.member_ids if uid != me.id}
    if member_ids:
        found = set(await db.scalars(select(User.id).where(User.id.in_(member_ids))))
        if missing := member_ids - found:
            raise bad_request(f"Unknown users: {sorted(missing)}")
    conv = Conversation(
        type="group",
        name=name,
        description=(data.description or "").strip() or None,
        avatar_color=data.avatar_color or me.avatar_color,
        created_by=me.id,
        disappearing_seconds=data.disappearing_seconds or None,
    )
    conv.members.append(ConversationMember(user_id=me.id, role="admin"))
    conv.members.extend(ConversationMember(user_id=uid) for uid in sorted(member_ids))
    db.add(conv)
    await db.flush()
    add_system_message(db, conv, me.id, "group_created", name=name)
    await db.commit()
    return conv


def add_system_message(
    db: AsyncSession, conv: Conversation, actor_id: int, event: str, **meta: Any
) -> Message:
    """Timeline notices like "Alice added Bob". Rendered by the client from `meta`."""
    now = utcnow()
    msg = Message(
        conversation_id=conv.id,
        sender_id=actor_id,
        type="system",
        meta={"event": event, **meta},
        created_at=now,
    )
    conv.last_activity_at = now
    db.add(msg)
    return msg


# --- presentation --------------------------------------------------------------------------


async def present_conversations(
    db: AsyncSession, viewer: User, memberships: Sequence[ConversationMember]
) -> list[ConversationOut]:
    if not memberships:
        return []
    conv_ids = [m.conversation_id for m in memberships]
    cm = ConversationMember

    # Active members per conversation (member counts, direct-chat peers).
    rows = await db.execute(
        select(cm.conversation_id, cm.user_id).where(
            cm.conversation_id.in_(conv_ids), cm.left_at.is_(None)
        )
    )
    members_by_conv: dict[int, list[int]] = defaultdict(list)
    for conv_id, user_id in rows:
        members_by_conv[conv_id].append(user_id)

    # Direct peers keep showing even if they are no longer "active" (never happens for direct
    # chats today, but cheap to be safe).
    peer_ids = {
        uid
        for m in memberships
        if m.conversation.type == "direct"
        for uid in members_by_conv[m.conversation_id]
        if uid != viewer.id
    }
    peers = (await db.scalars(select(User).where(User.id.in_(peer_ids)))).all() if peer_ids else []
    peers_out = {p.id: p for p in await users_svc.present_users(db, viewer.id, peers)}

    visible = visible_to(viewer.id)
    base = (
        select(Message.conversation_id)
        .join(cm, cm.conversation_id == Message.conversation_id)
        .where(Message.conversation_id.in_(conv_ids), *visible)
        .group_by(Message.conversation_id)
    )
    last_ids = dict((await db.execute(base.add_columns(func.max(Message.id)))).all())

    unread_filter = [
        Message.id > func.coalesce(cm.last_read_message_id, 0),
        Message.sender_id != viewer.id,
        Message.type == "text",
        Message.deleted_at.is_(None),
    ]
    unread = dict(
        (await db.execute(base.add_columns(func.count(Message.id)).where(*unread_filter))).all()
    )
    mentions = dict(
        (
            await db.execute(
                base.add_columns(func.count(Message.id)).where(
                    *unread_filter,
                    exists().where(
                        MessageMention.message_id == Message.id,
                        MessageMention.user_id == viewer.id,
                    ),
                )
            )
        ).all()
    )

    last_messages = {m.id: m for m in await load_messages(db, list(last_ids.values()))}
    own_last = [
        m.id for m in last_messages.values() if m.sender_id == viewer.id and m.type == "text"
    ]
    statuses = await statuses_for(db, viewer, own_last)

    out = []
    for m in memberships:
        conv = m.conversation
        peer = None
        if conv.type == "direct":
            peer_id = next((u for u in members_by_conv[conv.id] if u != viewer.id), None)
            peer = peers_out.get(peer_id) if peer_id else None
        if conv.type == "note_to_self":
            name = NOTE_TO_SELF
        elif peer is not None:
            name = peer.nickname or peer.display_name or peer.phone
        else:
            name = conv.name or "Group"

        last = last_messages.get(last_ids.get(conv.id, -1))
        last_out = None
        if last is not None:
            last_out = LastMessage(
                id=last.id,
                sender_id=last.sender_id,
                type=last.type,
                body="" if last.deleted_at else last.body,
                meta=last.meta,
                attachment_kind=(
                    last.attachments[0].kind if last.attachments and not last.deleted_at else None
                ),
                created_at=last.created_at,
                is_deleted=last.deleted_at is not None,
                status=statuses.get(last.id),
            )

        out.append(
            ConversationOut(
                id=conv.id,
                type=conv.type,
                name=name,
                description=conv.description,
                avatar_url=peer.avatar_url if peer else conv.avatar_url,
                avatar_color=peer.avatar_color if peer else conv.avatar_color,
                peer=peer,
                member_count=len(members_by_conv[conv.id]),
                my_role=m.role,
                is_member=m.left_at is None,
                disappearing_seconds=conv.disappearing_seconds,
                created_at=conv.created_at,
                last_activity_at=conv.last_activity_at,
                last_message=last_out,
                unread_count=unread.get(conv.id, 0),
                mention_count=mentions.get(conv.id, 0),
                last_read_message_id=m.last_read_message_id,
                is_pinned=m.is_pinned,
                is_archived=m.is_archived,
                muted_until=m.muted_until,
                marked_unread=m.marked_unread,
                wallpaper=m.wallpaper,
            )
        )
    return out


async def list_conversations(db: AsyncSession, viewer: User) -> list[ConversationOut]:
    memberships = (
        await db.scalars(
            select(ConversationMember)
            .join(Conversation)
            .where(ConversationMember.user_id == viewer.id, ConversationMember.is_hidden.is_(False))
            .options(selectinload(ConversationMember.conversation))
            .order_by(Conversation.last_activity_at.desc())
        )
    ).all()
    return await present_conversations(db, viewer, memberships)


async def conversation_out(db: AsyncSession, viewer: User, conversation_id: int) -> ConversationOut:
    member = await get_membership(db, conversation_id, viewer.id, require_active=False)
    return (await present_conversations(db, viewer, [member]))[0]


async def conversation_detail(
    db: AsyncSession, viewer: User, conversation_id: int
) -> ConversationDetail:
    base = await conversation_out(db, viewer, conversation_id)
    rows = (
        await db.scalars(
            select(ConversationMember)
            .where(
                ConversationMember.conversation_id == conversation_id,
                ConversationMember.left_at.is_(None),
            )
            .options(selectinload(ConversationMember.user))
            .order_by(ConversationMember.joined_at)
        )
    ).all()
    users = await users_svc.present_users(db, viewer.id, [r.user for r in rows])
    members = [
        MemberOut(user=u, role=r.role, joined_at=r.joined_at)
        for r, u in zip(rows, users, strict=True)
    ]
    # Admins first, then you, then alphabetical: the order Signal's member list uses.
    members.sort(
        key=lambda mo: (
            mo.role != "admin",
            mo.user.id != viewer.id,
            (mo.user.nickname or mo.user.display_name).lower(),
        )
    )
    return ConversationDetail(**base.model_dump(), members=members)


# --- broadcasting --------------------------------------------------------------------------


async def broadcast_conversation(
    db: AsyncSession, conversation_id: int, user_ids: Iterable[int] | None = None
) -> None:
    """Send each user their own view of the conversation (names and unread differ per viewer)."""
    if user_ids is None:
        user_ids = await active_member_ids(db, conversation_id)
    for uid in set(user_ids):
        if not manager.is_online(uid):
            continue
        viewer = await db.get(User, uid)
        try:
            payload = await conversation_out(db, viewer, conversation_id)
        except Exception:
            continue
        await manager.send_to_user(uid, "conversation.updated", payload.model_dump(mode="json"))


async def broadcast_system_message(db: AsyncSession, msg: Message) -> None:
    from app.services.messages_present import load_message, present_message

    loaded = await load_message(db, msg.id)
    if loaded is None:
        return
    payload = present_message(loaded).model_dump(mode="json")
    await manager.send_to_users(
        await active_member_ids(db, msg.conversation_id), "message.new", payload
    )


# --- group management ----------------------------------------------------------------------


async def update_group(
    db: AsyncSession, me: User, conversation_id: int, data: ConversationUpdate
) -> list[Message]:
    member = await get_membership(db, conversation_id, me.id)
    conv = member.conversation
    changes = data.model_dump(exclude_unset=True)
    notices: list[Message] = []

    if "disappearing_seconds" in changes:
        seconds = changes.pop("disappearing_seconds")
        if seconds != conv.disappearing_seconds:
            conv.disappearing_seconds = seconds
            notices.append(add_system_message(db, conv, me.id, "timer_changed", seconds=seconds))

    if changes and conv.type != "group":
        raise bad_request("Only group details can be edited")
    if "name" in changes and changes["name"] and changes["name"].strip() != conv.name:
        conv.name = changes["name"].strip()
        notices.append(add_system_message(db, conv, me.id, "name_changed", name=conv.name))
    if "description" in changes:
        desc = (changes["description"] or "").strip() or None
        if desc != conv.description:
            conv.description = desc
            notices.append(add_system_message(db, conv, me.id, "description_changed"))
    if changes.get("avatar_color"):
        conv.avatar_color = changes["avatar_color"]

    await db.commit()
    return notices


async def set_group_avatar(
    db: AsyncSession, me: User, conversation_id: int, avatar_url: str | None
) -> tuple[str | None, Message]:
    member = await get_membership(db, conversation_id, me.id)
    conv = member.conversation
    if conv.type != "group":
        raise bad_request("Only groups have their own avatar")
    old = conv.avatar_url
    conv.avatar_url = avatar_url
    notice = add_system_message(db, conv, me.id, "avatar_changed", removed=avatar_url is None)
    await db.commit()
    return old, notice


async def update_settings(
    db: AsyncSession, me: User, conversation_id: int, data: ConversationSettings
) -> None:
    member = await get_membership(db, conversation_id, me.id, require_active=False)
    previous_wallpaper = member.wallpaper
    if data.is_pinned is not None:
        member.is_pinned = data.is_pinned
        member.pinned_at = utcnow() if data.is_pinned else None
    if data.is_archived is not None:
        member.is_archived = data.is_archived
        if data.is_archived:
            member.is_pinned = False
    if data.marked_unread is not None:
        member.marked_unread = data.marked_unread
    if "wallpaper" in data.model_fields_set:
        member.wallpaper = data.wallpaper
    if data.mute_seconds is not None:
        if data.mute_seconds == 0:
            member.muted_until = None
        elif data.mute_seconds < 0:
            member.muted_until = utcnow() + timedelta(days=365 * 100)
        else:
            member.muted_until = utcnow() + timedelta(seconds=data.mute_seconds)
    await db.commit()
    if (
        "wallpaper" in data.model_fields_set
        and previous_wallpaper
        and previous_wallpaper.startswith("wallpapers/")
    ):
        from app.services import storage

        storage.delete_key(previous_wallpaper)


async def hide_conversation(db: AsyncSession, me: User, conversation_id: int) -> None:
    """Signal's "Delete chat": clears your history and hides it until a new message arrives."""
    member = await get_membership(db, conversation_id, me.id, require_active=False)
    last_id = await db.scalar(
        select(func.max(Message.id)).where(Message.conversation_id == conversation_id)
    )
    member.cleared_before_id = last_id or 0
    member.last_read_message_id = last_id
    member.is_hidden = True
    member.is_pinned = False
    member.marked_unread = False
    await db.commit()


async def add_members(
    db: AsyncSession, me: User, conversation_id: int, user_ids: list[int]
) -> tuple[list[int], Message | None]:
    admin = await require_admin(db, conversation_id, me.id)
    conv = admin.conversation
    existing = {
        m.user_id: m
        for m in await db.scalars(
            select(ConversationMember).where(ConversationMember.conversation_id == conversation_id)
        )
    }
    wanted = set(user_ids) - {me.id}
    valid = set(await db.scalars(select(User.id).where(User.id.in_(wanted))))
    if missing := wanted - valid:
        raise bad_request(f"Unknown users: {sorted(missing)}")
    added: list[int] = []
    now = utcnow()
    for uid in sorted(valid):
        row = existing.get(uid)
        if row is None:
            db.add(ConversationMember(conversation_id=conversation_id, user_id=uid, joined_at=now))
            added.append(uid)
        elif row.left_at is not None:
            row.left_at = None
            row.role = "member"
            row.joined_at = now
            row.is_hidden = False
            added.append(uid)
    if not added:
        return [], None
    notice = add_system_message(db, conv, me.id, "members_added", targets=added)
    await db.commit()
    return added, notice


async def _promote_if_no_admin(db: AsyncSession, conv: Conversation) -> None:
    has_admin = await db.scalar(
        select(ConversationMember.user_id).where(
            ConversationMember.conversation_id == conv.id,
            ConversationMember.left_at.is_(None),
            ConversationMember.role == "admin",
        )
    )
    if has_admin:
        return
    oldest = await db.scalar(
        select(ConversationMember)
        .where(ConversationMember.conversation_id == conv.id, ConversationMember.left_at.is_(None))
        .order_by(ConversationMember.joined_at)
    )
    if oldest:
        oldest.role = "admin"


async def remove_member(db: AsyncSession, me: User, conversation_id: int, user_id: int) -> Message:
    if user_id == me.id:
        raise bad_request("Use leave to remove yourself")
    admin = await require_admin(db, conversation_id, me.id)
    target = await db.get(ConversationMember, (conversation_id, user_id))
    if target is None or target.left_at is not None:
        raise not_found("Member")
    # Write the notice first so the removed member still sees it in their history.
    notice = add_system_message(db, admin.conversation, me.id, "member_removed", targets=[user_id])
    await db.flush()
    target.left_at = utcnow()
    target.role = "member"
    await db.commit()
    return notice


async def leave_group(db: AsyncSession, me: User, conversation_id: int) -> Message:
    member = await get_membership(db, conversation_id, me.id)
    conv = member.conversation
    if conv.type != "group":
        raise bad_request("You can only leave groups")
    notice = add_system_message(db, conv, me.id, "member_left")
    await db.flush()
    member.left_at = utcnow()
    member.role = "member"
    await db.flush()
    await _promote_if_no_admin(db, conv)
    await db.commit()
    return notice


async def set_role(
    db: AsyncSession, me: User, conversation_id: int, user_id: int, role: str
) -> Message:
    admin = await require_admin(db, conversation_id, me.id)
    target = await db.get(ConversationMember, (conversation_id, user_id))
    if target is None or target.left_at is not None:
        raise not_found("Member")
    if user_id == me.id and role == "member":
        other_admin = await db.scalar(
            select(ConversationMember.user_id).where(
                ConversationMember.conversation_id == conversation_id,
                ConversationMember.left_at.is_(None),
                ConversationMember.role == "admin",
                ConversationMember.user_id != me.id,
            )
        )
        if other_admin is None:
            raise bad_request("A group needs at least one admin")
    target.role = role
    notice = add_system_message(
        db, admin.conversation, me.id, "role_changed", targets=[user_id], role=role
    )
    await db.commit()
    return notice
