from fastapi import UploadFile
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import not_found
from app.models import Attachment, Message, User
from app.services import storage
from app.services.visibility import visible_messages


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
    """Unsent uploads belong to the uploader; sent files follow message visibility."""
    att = await db.get(Attachment, attachment_id)
    if att is None:
        raise not_found("Attachment")
    if att.message_id is None and att.uploader_id == viewer.id:
        return att
    if att.message_id is not None:
        allowed = await db.scalar(
            visible_messages(viewer.id)
            .where(Message.id == att.message_id, Message.deleted_at.is_(None))
            .with_only_columns(Message.id)
        )
        if allowed:
            return att
    raise not_found("Attachment")
