"""Consolidate legacy phone spellings without losing message history.

Revision ID: c72f5a9d103e
Revises: b38d41ac975e
"""

import re

import phonenumbers
import sqlalchemy as sa
from alembic import op

revision = "c72f5a9d103e"
down_revision = "b38d41ac975e"
branch_labels = None
depends_on = None


def _canonical_phone(raw):
    # Frozen migration rules: valid international numbers retain their country.
    digits = re.sub(r"[\s\-().]", "", raw)
    try:
        number = phonenumbers.parse(digits, None if digits.startswith("+") else "IN")
        international = phonenumbers.format_number(number, phonenumbers.PhoneNumberFormat.E164)
        if re.fullmatch(r"\+[6-9][0-9]{9}", international) and not phonenumbers.is_valid_number(number):
            national = phonenumbers.parse(international[1:], "IN")
            if phonenumbers.is_valid_number(national):
                number = national
        if phonenumbers.is_possible_number(number):
            return phonenumbers.format_number(number, phonenumbers.PhoneNumberFormat.E164)
    except phonenumbers.NumberParseException:
        pass
    return raw  # Do not guess a different owner for an unrecognizable legacy number.


def _extreme(a, b, latest=False):
    values = [value for value in (a, b) if value is not None]
    return (max(values) if latest else min(values)) if values else None


def _combine(name, target, source):
    result = dict(target)
    if name == "conversation_members":
        result["role"] = "admin" if "admin" in (target["role"], source["role"]) else "member"
        result["left_at"] = (
            _extreme(target["left_at"], source["left_at"])
            if target["left_at"] is not None and source["left_at"] is not None
            else None
        )
        result["joined_at"] = _extreme(target["joined_at"], source["joined_at"])
        result["last_read_message_id"] = _extreme(
            target["last_read_message_id"], source["last_read_message_id"], latest=True
        )
        for key in ("is_pinned", "marked_unread"):
            result[key] = target[key] or source[key]
        for key in ("is_archived", "is_hidden"):
            result[key] = target[key] and source[key]
        result["pinned_at"] = _extreme(target["pinned_at"], source["pinned_at"])
        # Preserve access to history that was visible from either duplicate account.
        result["cleared_before_id"] = (
            min(target["cleared_before_id"] or 0, source["cleared_before_id"] or 0) or None
        )
    elif name == "message_receipts":
        for key in ("delivered_at", "read_at"):
            result[key] = _extreme(target[key], source[key])
    elif name == "story_views":
        result["viewed_at"] = _extreme(target["viewed_at"], source["viewed_at"])
    elif name == "reactions" and source["created_at"] > target["created_at"]:
        result.update(emoji=source["emoji"], created_at=source["created_at"])
    elif name == "contacts" and not result["nickname"]:
        result["nickname"] = source["nickname"]
    return result


def _key(table, row):
    return sa.and_(*(column == row[column.name] for column in table.primary_key.columns))


def _rewrite(db, table, condition, columns, old, new, *, remove_old=True):
    """Move scalar references and fold composite-key collisions before removing old rows."""
    for original in db.execute(sa.select(table).where(condition)).mappings().all():
        updated = dict(original)
        for column in columns:
            if updated[column] == old:
                updated[column] = new
        if all(updated[column.name] == original[column.name] for column in table.primary_key):
            db.execute(table.update().where(_key(table, original)).values(updated))
            continue
        is_self = (table.name == "contacts" and updated["owner_id"] == updated["contact_id"]) or (
            table.name == "blocks" and updated["blocker_id"] == updated["blocked_id"]
        )
        if not is_self:
            existing = db.execute(sa.select(table).where(_key(table, updated))).mappings().first()
            if existing:
                updated = _combine(table.name, existing, updated)
                db.execute(table.update().where(_key(table, updated)).values(updated))
            else:
                db.execute(table.insert().values(updated))
        if remove_old:
            db.execute(table.delete().where(_key(table, original)))


def _merge_chats(db, tables, merged_users):
    conversations = tables["conversations"]
    members = tables["conversation_members"]
    messages = tables["messages"]
    affected = sa.select(members.c.conversation_id).where(members.c.user_id.in_(merged_users))
    chats = (
        db.execute(
            sa.select(conversations)
            .where(conversations.c.id.in_(affected), conversations.c.type != "group")
            .order_by(conversations.c.id)
        )
        .mappings()
        .all()
    )
    # Release old identity keys before assigning keys for the surviving members.
    db.execute(
        conversations.update()
        .where(conversations.c.id.in_([chat["id"] for chat in chats]))
        .values(identity_key=None)
    )
    destinations = {}
    for chat in chats:
        if chat["type"] == "group":
            continue
        ids = sorted(
            db.scalars(sa.select(members.c.user_id).where(members.c.conversation_id == chat["id"]))
        )
        if len(ids) == 1:
            identity = f"self:{ids[0]}"
            kind = "note_to_self"
        elif len(ids) == 2 and chat["type"] == "direct":
            identity = f"direct:{ids[0]}:{ids[1]}"
            kind = "direct"
        else:
            continue
        destination = destinations.get(identity)
        if destination is None:
            destinations[identity] = chat["id"]
            db.execute(
                conversations.update()
                .where(conversations.c.id == chat["id"])
                .values(type=kind, identity_key=identity)
            )
            if kind == "note_to_self":
                db.execute(
                    members.update()
                    .where(members.c.conversation_id == chat["id"])
                    .values(role="admin")
                )
            continue
        db.execute(
            messages.update()
            .where(messages.c.conversation_id == chat["id"])
            .values(conversation_id=destination)
        )
        _rewrite(
            db,
            members,
            members.c.conversation_id == chat["id"],
            ["conversation_id"],
            chat["id"],
            destination,
        )
        target = (
            db.execute(sa.select(conversations).where(conversations.c.id == destination))
            .mappings()
            .one()
        )
        db.execute(
            conversations.update()
            .where(conversations.c.id == destination)
            .values(
                last_activity_at=_extreme(
                    target["last_activity_at"], chat["last_activity_at"], latest=True
                )
            )
        )
        db.execute(conversations.delete().where(conversations.c.id == chat["id"]))


def upgrade():
    db = op.get_bind()
    # Migration connections have FK enforcement off during SQLite table rebuilds.
    # Rebuild before consolidation so sqlite_sequence retains even the IDs removed
    # below. A token for a retired ID can never authenticate a future new account.
    with op.batch_alter_table(
        "users", recreate="always", table_kwargs={"sqlite_autoincrement": True}
    ):
        pass
    metadata = sa.MetaData()
    metadata.reflect(bind=db)
    tables = metadata.tables
    users = tables["users"]
    groups = {}
    for user in db.execute(sa.select(users).order_by(users.c.id)).mappings():
        groups.setdefault(_canonical_phone(user["phone"]), []).append(dict(user))
    merged_users = set()
    for phone, accounts in groups.items():
        # Prefer the account already using the correct international spelling.
        accounts.sort(key=lambda account: (account["phone"] != phone, account["id"]))
        survivor = accounts[0]
        for duplicate in accounts[1:]:
            old, new = duplicate["id"], survivor["id"]
            # Story views depend on composite recipient keys: create the new
            # recipient before moving views, then remove the old recipient.
            recipients, views = tables["story_recipients"], tables["story_views"]
            _rewrite(
                db, recipients, recipients.c.user_id == old, ["user_id"], old, new, remove_old=False
            )
            _rewrite(db, views, views.c.user_id == old, ["user_id"], old, new)
            for table in tables.values():
                if table.name == "users":
                    continue
                columns = sorted(
                    {fk.parent.name for fk in table.foreign_keys if fk.column.table.name == "users"}
                )
                if columns:
                    _rewrite(
                        db,
                        table,
                        sa.or_(*(table.c[column] == old for column in columns)),
                        columns,
                        old,
                        new,
                    )
            messages = tables["messages"]
            for message in (
                db.execute(
                    sa.select(messages.c.id, messages.c.meta).where(messages.c.meta.is_not(None))
                )
                .mappings()
                .all()
            ):
                payload = message["meta"]
                if isinstance(payload, dict) and old in (payload.get("targets") or []):
                    payload = {
                        **payload,
                        "targets": list(
                            dict.fromkeys(
                                new if target == old else target for target in payload["targets"]
                            )
                        ),
                    }
                    db.execute(
                        messages.update().where(messages.c.id == message["id"]).values(meta=payload)
                    )
            db.execute(users.delete().where(users.c.id == old))
            # Keep the canonical profile, filling only fields it never set.
            for field in ("display_name", "username", "about", "about_emoji", "avatar_url"):
                if not survivor[field] and duplicate[field]:
                    survivor[field] = duplicate[field]
            survivor["last_seen_at"] = _extreme(
                survivor["last_seen_at"], duplicate["last_seen_at"], latest=True
            )
            merged_users.add(new)
        db.execute(
            users.update().where(users.c.id == survivor["id"]).values({**survivor, "phone": phone})
        )
    if merged_users:
        _merge_chats(db, tables, merged_users)
        receipts, messages = tables["message_receipts"], tables["messages"]
        # A direct chat between duplicate identities becomes Note to Self.
        # Receipts still belong to other people, never to the message's sender.
        db.execute(
            receipts.delete().where(
                sa.exists(
                    sa.select(messages.c.id).where(
                        messages.c.id == receipts.c.message_id,
                        messages.c.sender_id == receipts.c.user_id,
                    )
                )
            )
        )
    if db.exec_driver_sql("PRAGMA foreign_key_check").first() is not None:
        raise RuntimeError("Phone identity repair left an invalid database reference")


def downgrade():
    # This repairs data without changing the schema. Separate identities cannot
    # be reconstructed from merged history; restore a pre-migration backup if needed.
    pass
