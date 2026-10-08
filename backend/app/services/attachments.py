from fastapi import UploadFile
from sqlalchemy import and_, exists, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import not_found
from app.models import Attachment, ConversationMember, Message, User
from app.services import storage


def _kind_for(mime: str, voice: bool) -> str:
    if voice:
        return "voice"
    for prefix in ("image", "video", "audio"):
        if mime.startswith(f"{prefix}/"):
            return prefix
    return "file"


async def upload(
    db: AsyncSession,
    me: User,
    file: UploadFile,
    *,
    voice: bool = False,
    duration_ms: int | None = None,
) -> Attachment:
    stored = await storage.save_upload(file)
    att = Attachment(
        uploader_id=me.id,
        kind=_kind_for(stored.mime_type, voice),
        file_name=(file.filename or "file")[:255],
        mime_type=stored.mime_type,
        size_bytes=stored.size,
        width=stored.width,
        height=stored.height,
        duration_ms=duration_ms,
        storage_key=stored.key,
    )
    db.add(att)
    await db.commit()
    await db.refresh(att)
    return att


async def get_for_viewer(db: AsyncSession, viewer: User, attachment_id: int) -> Attachment:
    """The uploader, or any member who could see the message, may download a file."""
    att = await db.get(Attachment, attachment_id)
    if att is None:
        raise not_found("Attachment")
    if att.uploader_id == viewer.id:
        return att
    if att.message_id is not None:
        allowed = await db.scalar(
            select(
                exists().where(
                    and_(
                        Message.id == att.message_id,
                        ConversationMember.conversation_id == Message.conversation_id,
                        ConversationMember.user_id == viewer.id,
                    )
                )
            )
        )
        if allowed:
            return att
    raise not_found("Attachment")
