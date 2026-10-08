"""Turning Message rows into API payloads, including per-viewer delivery status."""

from collections import defaultdict
from collections.abc import Sequence

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models import Attachment, Message, MessageReceipt, User
from app.schemas.message import (
    AttachmentOut,
    MessageOut,
    MessageStatus,
    ReactionOut,
    ReplyPreview,
)
from app.services.visibility import visible_messages

MESSAGE_LOAD_OPTIONS = (
    selectinload(Message.attachments),
    selectinload(Message.reactions),
    selectinload(Message.mentions),
    selectinload(Message.reply_to).selectinload(Message.attachments),
)


def attachment_url(att: Attachment) -> str:
    return f"/api/attachments/{att.id}/file"


def present_attachment(att: Attachment) -> AttachmentOut:
    out = AttachmentOut.model_validate(att)
    out.url = attachment_url(att)
    return out


def _reply_preview(msg: Message | None) -> ReplyPreview | None:
    if msg is None:
        return None
    return ReplyPreview(
        id=msg.id,
        sender_id=msg.sender_id,
        body="" if msg.deleted_at else msg.body,
        attachment_kind=msg.attachments[0].kind if msg.attachments and not msg.deleted_at else None,
        is_deleted=msg.deleted_at is not None,
    )


def present_message(
    msg: Message, status: MessageStatus | None = None, *, reply_visible: bool = True
) -> MessageOut:
    deleted = msg.deleted_at is not None
    return MessageOut(
        id=msg.id,
        conversation_id=msg.conversation_id,
        sender_id=msg.sender_id,
        client_id=msg.client_id,
        type=msg.type,
        body="" if deleted else msg.body,
        meta=msg.meta,
        reply_to=None if deleted or not reply_visible else _reply_preview(msg.reply_to),
        is_forwarded=msg.is_forwarded,
        created_at=msg.created_at,
        edited_at=msg.edited_at,
        is_deleted=deleted,
        expires_in_seconds=msg.expires_in_seconds,
        expires_at=msg.expires_at,
        attachments=[] if deleted else [present_attachment(a) for a in msg.attachments],
        reactions=[]
        if deleted
        else [ReactionOut(user_id=r.user_id, emoji=r.emoji) for r in msg.reactions],
        mentions=[m.user_id for m in msg.mentions],
        status=status,
    )


async def statuses_for(
    db: AsyncSession, viewer: User, message_ids: Sequence[int]
) -> dict[int, MessageStatus]:
    """Aggregate receipts into sent/delivered/read for messages the viewer sent.

    A message is delivered/read only once every recipient has delivered/read it. Read
    receipts are mutual in Signal: they count only if both sides have them enabled.
    """
    if not message_ids:
        return {}
    rows = await db.execute(
        select(
            MessageReceipt.message_id,
            MessageReceipt.delivered_at,
            MessageReceipt.read_at,
            User.read_receipts_enabled,
        )
        .join(User, User.id == MessageReceipt.user_id)
        .where(MessageReceipt.message_id.in_(message_ids))
    )
    counts: dict[int, list[int]] = defaultdict(lambda: [0, 0, 0])  # total, delivered, read
    for message_id, delivered_at, read_at, recipient_receipts in rows:
        c = counts[message_id]
        c[0] += 1
        c[1] += delivered_at is not None or read_at is not None
        c[2] += read_at is not None and recipient_receipts and viewer.read_receipts_enabled
    result: dict[int, MessageStatus] = {}
    for mid in message_ids:
        total, delivered, read = counts.get(mid, (0, 0, 0))
        if total == 0:
            # Note to Self or a group where everyone else left: nothing to wait for.
            result[mid] = "sent"
        elif read == total:
            result[mid] = "read"
        elif delivered == total:
            result[mid] = "delivered"
        else:
            result[mid] = "sent"
    return result


async def present_messages(
    db: AsyncSession, viewer: User, messages: Sequence[Message]
) -> list[MessageOut]:
    own = [m.id for m in messages if m.sender_id == viewer.id and m.type == "text"]
    statuses = await statuses_for(db, viewer, own)
    replies = {m.reply_to_id for m in messages if m.reply_to_id is not None}
    visible_replies = (
        set(
            await db.scalars(
                visible_messages(viewer.id)
                .where(Message.id.in_(replies))
                .with_only_columns(Message.id)
            )
        )
        if replies
        else set()
    )
    return [
        present_message(m, statuses.get(m.id), reply_visible=m.reply_to_id in visible_replies)
        for m in messages
    ]


async def load_messages(db: AsyncSession, ids: Sequence[int]) -> list[Message]:
    if not ids:
        return []
    rows = await db.scalars(
        select(Message)
        .where(Message.id.in_(ids))
        .options(*MESSAGE_LOAD_OPTIONS)
        .order_by(Message.id)
        .execution_options(populate_existing=True)
    )
    return list(rows)


async def load_message(db: AsyncSession, message_id: int) -> Message | None:
    found = await load_messages(db, [message_id])
    return found[0] if found else None
