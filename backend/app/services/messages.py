import secrets
from collections import defaultdict
from datetime import timedelta

from sqlalchemy import delete, func, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.errors import bad_request, forbidden, not_found
from app.db.base import utcnow
from app.models import (
    Attachment,
    Conversation,
    ConversationMember,
    Message,
    MessageHidden,
    MessageMention,
    MessageReceipt,
    Reaction,
    User,
)
from app.schemas.message import (
    MessageInfo,
    MessageOut,
    MessagePage,
    MessageSend,
    MessageStatus,
    ReactionOut,
    RecipientStatus,
)
from app.services import conversations as conv_svc
from app.services import storage
from app.services import users as users_svc
from app.services.messages_present import (
    MESSAGE_LOAD_OPTIONS,
    load_message,
    load_messages,
    present_message,
    present_messages,
    statuses_for,
)
from app.services.visibility import visible_messages, visible_to, visible_viewers
from app.ws.manager import manager

settings = get_settings()


# --- reading -------------------------------------------------------------------------------


async def list_messages(
    db: AsyncSession,
    viewer: User,
    conversation_id: int,
    *,
    before: int | None = None,
    after: int | None = None,
    around: int | None = None,
    limit: int = 50,
) -> MessagePage:
    await conv_svc.get_membership(db, conversation_id, viewer.id, require_active=False)
    base = visible_messages(viewer.id).where(Message.conversation_id == conversation_id)

    async def fetch(query, n):
        return list((await db.scalars(query.options(*MESSAGE_LOAD_OPTIONS).limit(n))).all())

    if around is not None:
        older = await fetch(base.where(Message.id <= around).order_by(Message.id.desc()), limit + 1)
        newer = await fetch(base.where(Message.id > around).order_by(Message.id), limit + 1)
        older_count = min(len(older), (limit + 1) // 2)
        newer_count = min(len(newer), limit - older_count)
        # Fill the window from the other side when the anchor is near either end.
        older_count = min(len(older), limit - newer_count)
        has_before = len(older) > older_count
        has_after = len(newer) > newer_count
        rows = list(reversed(older[:older_count])) + newer[:newer_count]
    elif after is not None:
        newer = await fetch(base.where(Message.id > after).order_by(Message.id), limit + 1)
        has_after = len(newer) > limit
        rows = newer[:limit]
        has_before = (
            after > 0
            and (
                await db.scalar(
                    base.where(Message.id <= after).with_only_columns(Message.id).limit(1)
                )
            )
            is not None
        )
    else:
        query = base.order_by(Message.id.desc())
        if before is not None:
            query = query.where(Message.id < before)
        older = await fetch(query, limit + 1)
        has_before = len(older) > limit
        rows = list(reversed(older[:limit]))
        has_after = False

    return MessagePage(
        items=await present_messages(db, viewer, rows),
        has_more_before=has_before,
        has_more_after=has_after,
    )


async def search_messages(
    db: AsyncSession, viewer: User, q: str, conversation_id: int | None = None, limit: int = 50
) -> list[MessageOut]:
    q = q.strip()
    if len(q) < 2:
        return []
    query = visible_messages(viewer.id).where(
        Message.type == "text",
        Message.deleted_at.is_(None),
        Message.body.icontains(q, autoescape=True),
    )
    if conversation_id is not None:
        query = query.where(Message.conversation_id == conversation_id)
    rows = (
        await db.scalars(
            query.options(*MESSAGE_LOAD_OPTIONS).order_by(Message.id.desc()).limit(limit)
        )
    ).all()
    return await present_messages(db, viewer, rows)


async def get_visible_message(db: AsyncSession, viewer: User, message_id: int) -> Message:
    msg = await db.scalar(
        visible_messages(viewer.id).where(Message.id == message_id).options(*MESSAGE_LOAD_OPTIONS)
    )
    if msg is None:
        raise not_found("Message")
    return msg


async def message_info(db: AsyncSession, viewer: User, message_id: int) -> MessageInfo:
    msg = await get_visible_message(db, viewer, message_id)
    if msg.sender_id != viewer.id:
        raise forbidden("Only the sender can see delivery details")
    rows = await db.execute(
        select(MessageReceipt, User.read_receipts_enabled)
        .join(User, User.id == MessageReceipt.user_id)
        .where(MessageReceipt.message_id == message_id)
        .order_by(MessageReceipt.read_at.desc().nulls_last(), MessageReceipt.delivered_at)
    )
    recipients = [
        RecipientStatus(
            user_id=r.user_id,
            delivered_at=r.delivered_at or r.read_at,
            read_at=r.read_at if receipts_on and viewer.read_receipts_enabled else None,
        )
        for r, receipts_on in rows
    ]
    return MessageInfo(
        message=(await present_messages(db, viewer, [msg]))[0], recipients=recipients
    )


# --- sending -------------------------------------------------------------------------------


async def check_can_send(db: AsyncSession, sender: User, conv: Conversation) -> None:
    if conv.type == "direct":
        others = [uid for uid in await conv_svc.active_member_ids(db, conv.id) if uid != sender.id]
        if others and await users_svc.is_blocked_between(db, sender.id, others[0]):
            raise forbidden("You can't message this person")


async def _retry_message(
    db: AsyncSession, sender_id: int, conversation_id: int, client_id: str
) -> Message | None:
    existing = await db.scalar(select(Message).where(Message.client_id == client_id))
    if existing is None:
        return None
    if existing.sender_id != sender_id or existing.conversation_id != conversation_id:
        raise bad_request("Duplicate client id")
    visible = await db.scalar(
        visible_messages(sender_id).where(Message.id == existing.id).with_only_columns(Message.id)
    )
    if visible is None:
        raise not_found("Message")
    return existing


async def create_message(
    db: AsyncSession,
    sender: User,
    conversation_id: int,
    data: MessageSend,
    *,
    is_forwarded: bool = False,
) -> tuple[Message, bool]:
    """Persist a message. Returns (message, created); resends with a known client_id are no-ops."""
    sender_id = sender.id
    existing = await _retry_message(db, sender_id, conversation_id, data.client_id)
    if existing is not None:
        return existing, False

    member = await conv_svc.get_membership(db, conversation_id, sender.id)
    conv = member.conversation
    await check_can_send(db, sender, conv)

    body = data.body.strip()
    attachments: list[Attachment] = []
    if data.attachment_ids:
        attachments = list(
            await db.scalars(
                select(Attachment).where(
                    Attachment.id.in_(data.attachment_ids),
                    Attachment.uploader_id == sender.id,
                    Attachment.message_id.is_(None),
                )
            )
        )
        if len(attachments) != len(set(data.attachment_ids)):
            existing = await _retry_message(db, sender_id, conversation_id, data.client_id)
            if existing is not None:
                return existing, False
            raise bad_request("Some attachments are missing or already sent")
    if not body and not attachments:
        raise bad_request("Message is empty")

    if data.reply_to_id is not None:
        reply_conv = await db.scalar(
            visible_messages(sender.id)
            .where(Message.id == data.reply_to_id)
            .with_only_columns(Message.conversation_id)
        )
        if reply_conv != conversation_id:
            raise bad_request("Can only reply to messages in the same chat")

    now = utcnow()
    recipients = [
        uid for uid in await conv_svc.active_member_ids(db, conversation_id) if uid != sender.id
    ]
    msg = Message(
        conversation_id=conversation_id,
        sender_id=sender.id,
        client_id=data.client_id,
        type="text",
        body=body,
        reply_to_id=data.reply_to_id,
        is_forwarded=is_forwarded,
        created_at=now,
        expires_in_seconds=conv.disappearing_seconds,
        # Note to Self has no reader to start the timer, so it starts at send.
        expires_at=(
            now + timedelta(seconds=conv.disappearing_seconds)
            if conv.disappearing_seconds and not recipients
            else None
        ),
    )
    db.add(msg)
    try:
        await db.flush()
    except IntegrityError:
        # Another tab can persist the same client ID after our initial lookup. Resolve the
        # unique constraint race to the same acknowledgement as a later retry.
        await db.rollback()
        existing = await _retry_message(db, sender_id, conversation_id, data.client_id)
        if existing is None:
            raise
        await db.refresh(sender)
        return existing, False

    if attachments:
        claimed = await db.execute(
            update(Attachment)
            .where(
                Attachment.id.in_([att.id for att in attachments]),
                Attachment.uploader_id == sender_id,
                Attachment.message_id.is_(None),
            )
            .values(message_id=msg.id)
            .execution_options(synchronize_session=False)
        )
        if claimed.rowcount != len(attachments):
            await db.rollback()
            raise bad_request("Some attachments are missing or already sent")
    db.add_all(MessageReceipt(message_id=msg.id, user_id=uid) for uid in recipients)
    mention_ids = set(data.mentions) & set(recipients)
    db.add_all(MessageMention(message_id=msg.id, user_id=uid) for uid in mention_ids)

    conv.last_activity_at = now
    member.last_read_message_id = msg.id
    member.marked_unread = False
    # A new message brings a deleted or archived chat back for everyone (Signal unarchives
    # unless the chat is muted).
    await db.execute(
        update(ConversationMember)
        .where(
            ConversationMember.conversation_id == conversation_id,
            ConversationMember.left_at.is_(None),
        )
        .values(is_hidden=False)
    )
    await db.execute(
        update(ConversationMember)
        .where(
            ConversationMember.conversation_id == conversation_id,
            ConversationMember.left_at.is_(None),
            ConversationMember.is_archived.is_(True),
            or_(ConversationMember.muted_until.is_(None), ConversationMember.muted_until < now),
        )
        .values(is_archived=False)
    )
    await db.commit()
    return msg, True


async def broadcast_new_message(db: AsyncSession, msg: Message) -> MessageOut:
    """Push a new message to every active member. Returns the sender's view (status=sent)."""
    loaded = await load_message(db, msg.id)
    assert loaded is not None
    member_ids = await conv_svc.active_member_ids(db, msg.conversation_id)
    await _broadcast_visible_message(db, loaded, member_ids, "message.new", "sent")
    sender = await db.get(User, msg.sender_id)
    sender_view = (await present_messages(db, sender, [loaded]))[0]
    sender_view.status = "sent"
    return sender_view


async def _broadcast_visible_message(
    db: AsyncSession,
    msg: Message,
    member_ids: list[int],
    event: str,
    sender_status: MessageStatus | None,
) -> None:
    viewers = await visible_viewers(db, msg.id, member_ids)
    reply_viewers = (
        await visible_viewers(db, msg.reply_to_id, member_ids) if msg.reply_to_id else set()
    )
    for show_reply in (False, True):
        recipients = [
            uid for uid in viewers if uid != msg.sender_id and (uid in reply_viewers) == show_reply
        ]
        if recipients:
            await manager.send_to_users(
                recipients,
                event,
                present_message(msg, reply_visible=show_reply).model_dump(mode="json"),
            )
    if msg.sender_id is not None and msg.sender_id in viewers:
        await manager.send_to_user(
            msg.sender_id,
            event,
            present_message(
                msg, sender_status, reply_visible=msg.sender_id in reply_viewers
            ).model_dump(mode="json"),
        )


async def forward_message(
    db: AsyncSession, me: User, message_id: int, conversation_ids: list[int], note: str | None
) -> list[Message]:
    source = await get_visible_message(db, me, message_id)
    if source.deleted_at or source.type != "text":
        raise bad_request("This message can't be forwarded")
    destinations = list(dict.fromkeys(conversation_ids))
    # Validate all targets before creating anything, so an inaccessible target cannot leave
    # earlier chats with partially forwarded messages and no WebSocket notification.
    for conv_id in destinations:
        member = await conv_svc.get_membership(db, conv_id, me.id)
        await check_can_send(db, me, member.conversation)
    created: list[Message] = []
    for conv_id in destinations:
        copies = [
            Attachment(
                uploader_id=me.id,
                kind=a.kind,
                file_name=a.file_name,
                mime_type=a.mime_type,
                size_bytes=a.size_bytes,
                width=a.width,
                height=a.height,
                duration_ms=a.duration_ms,
                storage_key=a.storage_key,
            )
            for a in source.attachments
        ]
        db.add_all(copies)
        await db.flush()
        msg, _ = await create_message(
            db,
            me,
            conv_id,
            MessageSend(
                client_id=f"fwd-{secrets.token_hex(12)}",
                body=source.body,
                attachment_ids=[c.id for c in copies],
            ),
            is_forwarded=True,
        )
        created.append(msg)
        if note and note.strip():
            extra, _ = await create_message(
                db, me, conv_id, MessageSend(client_id=f"fwd-{secrets.token_hex(12)}", body=note)
            )
            created.append(extra)
    return created


# --- editing -------------------------------------------------------------------------------


async def _own_recent_message(db: AsyncSession, me: User, message_id: int, action: str) -> Message:
    msg = await get_visible_message(db, me, message_id)
    if msg.sender_id != me.id or msg.type != "text":
        raise forbidden(f"You can only {action} your own messages")
    if msg.deleted_at is not None:
        raise bad_request("This message was deleted")
    if utcnow() - msg.created_at > timedelta(seconds=settings.edit_window_seconds):
        raise bad_request(f"Messages can only be {action}ed within 24 hours")
    return msg


async def edit_message(db: AsyncSession, me: User, message_id: int, body: str) -> Message:
    msg = await _own_recent_message(db, me, message_id, "edit")
    if not body.strip():
        raise bad_request("Message is empty")
    msg.body = body.strip()
    msg.edited_at = utcnow()
    await db.commit()
    return msg


async def delete_for_everyone(db: AsyncSession, me: User, message_id: int) -> Message:
    msg = await _own_recent_message(db, me, message_id, "delete")
    msg.deleted_at = utcnow()
    msg.body = ""
    keys = [a.storage_key for a in msg.attachments]
    await db.execute(delete(Attachment).where(Attachment.message_id == msg.id))
    await db.execute(delete(Reaction).where(Reaction.message_id == msg.id))
    await db.commit()
    await _delete_orphan_files(db, keys)
    return msg


async def _delete_orphan_files(db: AsyncSession, keys: list[str]) -> None:
    for key in keys:
        still_used = await db.scalar(select(Attachment.id).where(Attachment.storage_key == key))
        if still_used is None:
            storage.delete_key(key)


async def delete_for_me(db: AsyncSession, me: User, message_id: int) -> Message:
    msg = await get_visible_message(db, me, message_id)
    db.add(MessageHidden(message_id=msg.id, user_id=me.id))
    await db.commit()
    return msg


async def broadcast_message_update(db: AsyncSession, message_id: int) -> None:
    msg = await load_message(db, message_id)
    if msg is None:
        return
    member_ids = await conv_svc.active_member_ids(db, msg.conversation_id)
    sender = await db.get(User, msg.sender_id) if msg.sender_id else None
    status = (await statuses_for(db, sender, [msg.id])).get(msg.id) if sender else None
    await _broadcast_visible_message(db, msg, member_ids, "message.updated", status)


# --- reactions -----------------------------------------------------------------------------


async def set_reaction(db: AsyncSession, me: User, message_id: int, emoji: str | None) -> Message:
    msg = await get_visible_message(db, me, message_id)
    await conv_svc.get_membership(db, msg.conversation_id, me.id)
    if msg.deleted_at is not None or msg.type != "text":
        raise bad_request("Can't react to this message")
    existing = await db.get(Reaction, (msg.id, me.id))
    if emoji is None:
        if existing:
            await db.delete(existing)
    elif existing:
        existing.emoji = emoji
        existing.created_at = utcnow()
    else:
        db.add(Reaction(message_id=msg.id, user_id=me.id, emoji=emoji))
    await db.commit()
    return msg


async def broadcast_reactions(db: AsyncSession, message_id: int, conversation_id: int) -> None:
    rows = await db.scalars(
        select(Reaction).where(Reaction.message_id == message_id).order_by(Reaction.created_at)
    )
    payload = {
        "message_id": message_id,
        "conversation_id": conversation_id,
        "reactions": [ReactionOut(user_id=r.user_id, emoji=r.emoji).model_dump() for r in rows],
    }
    await manager.send_to_users(
        await visible_viewers(
            db, message_id, await conv_svc.active_member_ids(db, conversation_id)
        ),
        "reaction.updated",
        payload,
    )


# --- receipts ------------------------------------------------------------------------------


async def _notify_senders(db: AsyncSession, message_ids: set[int]) -> None:
    """Tell each sender the new aggregate status of their messages."""
    if not message_ids:
        return
    rows = await db.execute(
        select(Message.id, Message.sender_id, Message.conversation_id).where(
            Message.id.in_(message_ids)
        )
    )
    by_sender: dict[int, list[tuple[int, int]]] = defaultdict(list)
    for mid, sender_id, conv_id in rows:
        if sender_id is not None and manager.is_online(sender_id):
            by_sender[sender_id].append((mid, conv_id))
    for sender_id, items in by_sender.items():
        sender = await db.get(User, sender_id)
        statuses = await statuses_for(db, sender, [mid for mid, _ in items])
        await manager.send_to_user(
            sender_id,
            "receipt.updated",
            [
                {"message_id": mid, "conversation_id": cid, "status": statuses[mid]}
                for mid, cid in items
            ],
        )


async def mark_delivered(db: AsyncSession, me: User, message_ids: list[int]) -> None:
    """Acknowledge only the visible messages explicitly received by `me`."""
    if not message_ids:
        return
    query = (
        select(MessageReceipt.message_id)
        .join(Message, Message.id == MessageReceipt.message_id)
        .join(ConversationMember, ConversationMember.conversation_id == Message.conversation_id)
        .where(
            MessageReceipt.user_id == me.id,
            MessageReceipt.delivered_at.is_(None),
            MessageReceipt.message_id.in_(message_ids),
            *visible_to(me.id),
        )
    )
    pending = set(await db.scalars(query))
    if not pending:
        return
    await db.execute(
        update(MessageReceipt)
        .where(
            MessageReceipt.user_id == me.id,
            MessageReceipt.message_id.in_(pending),
            MessageReceipt.delivered_at.is_(None),
        )
        .values(delivered_at=utcnow())
    )
    await db.commit()
    await _notify_senders(db, pending)


async def mark_read(db: AsyncSession, me: User, conversation_id: int, up_to_id: int) -> None:
    member = await conv_svc.get_membership(db, conversation_id, me.id, require_active=False)
    # The cursor must identify a visible message in this chat. A future or foreign ID would
    # otherwise mark later arrivals as already read indefinitely.
    target = await db.scalar(
        visible_messages(me.id)
        .where(Message.conversation_id == conversation_id, Message.id == up_to_id)
        .with_only_columns(Message.id)
    )
    if target is None:
        raise not_found("Message")
    now = utcnow()
    if member.last_read_message_id is None or up_to_id > member.last_read_message_id:
        member.last_read_message_id = up_to_id
    member.marked_unread = False

    pending = list(
        await db.scalars(
            select(MessageReceipt.message_id)
            .join(Message, Message.id == MessageReceipt.message_id)
            .join(ConversationMember, ConversationMember.conversation_id == Message.conversation_id)
            .where(
                MessageReceipt.user_id == me.id,
                MessageReceipt.read_at.is_(None),
                Message.conversation_id == conversation_id,
                Message.id <= up_to_id,
                *visible_to(me.id),
            )
        )
    )
    if pending:
        await db.execute(
            update(MessageReceipt)
            .where(MessageReceipt.user_id == me.id, MessageReceipt.message_id.in_(pending))
            .values(read_at=now, delivered_at=func.coalesce(MessageReceipt.delivered_at, now))
        )
        # Disappearing timers start on first read.
        timed = list(
            await db.scalars(
                select(Message).where(
                    Message.id.in_(pending),
                    Message.expires_in_seconds.is_not(None),
                    Message.expires_at.is_(None),
                )
            )
        )
        for msg in timed:
            msg.expires_at = now + timedelta(seconds=msg.expires_in_seconds)
        # The sender's own copy of their messages shares the row, so their timer starts too.
    await db.commit()

    # Keep the reader's other tabs/devices in sync.
    await manager.send_to_user(
        me.id,
        "conversation.read",
        {"conversation_id": conversation_id, "last_read_message_id": member.last_read_message_id},
    )
    if pending:
        timed_payload = [
            {"id": m.id, "conversation_id": conversation_id, "expires_at": m.expires_at.isoformat()}
            for m in timed
        ]
        if timed_payload:
            await manager.send_to_users(
                await conv_svc.active_member_ids(db, conversation_id),
                "message.timer_started",
                timed_payload,
            )
        # Reading still establishes delivery when read receipts are disabled. The aggregate
        # status serializer enforces the mutual read-receipt preference.
        await _notify_senders(db, set(pending))


# --- disappearing messages -----------------------------------------------------------------


async def purge_expired(db: AsyncSession) -> list[tuple[int, int]]:
    """Hard-delete expired messages. Returns (message_id, conversation_id) pairs."""
    now = utcnow()
    rows = (
        await db.execute(
            select(Message.id, Message.conversation_id).where(
                Message.expires_at.is_not(None), Message.expires_at <= now
            )
        )
    ).all()
    if not rows:
        return []
    ids = [mid for mid, _ in rows]
    keys = list(
        await db.scalars(select(Attachment.storage_key).where(Attachment.message_id.in_(ids)))
    )
    # Receipts, reactions and attachment rows cascade; replies to these get reply_to_id NULL.
    await db.execute(delete(Message).where(Message.id.in_(ids)))
    await db.commit()
    await _delete_orphan_files(db, keys)
    return [(mid, cid) for mid, cid in rows]


async def reload_for_viewer(
    db: AsyncSession, viewer: User, message_ids: list[int]
) -> list[MessageOut]:
    return await present_messages(db, viewer, await load_messages(db, message_ids))
