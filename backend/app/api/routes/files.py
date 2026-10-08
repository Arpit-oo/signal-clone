from fastapi import APIRouter, Form, UploadFile
from fastapi.responses import FileResponse

from app.api.deps import DB, CurrentUser, MediaUser
from app.core.errors import not_found
from app.schemas.message import AttachmentOut
from app.services import attachments as att_svc
from app.services import storage
from app.services.messages_present import present_attachment

router = APIRouter(tags=["files"])


@router.post("/attachments", response_model=AttachmentOut, status_code=201)
async def upload_attachment(
    file: UploadFile,
    me: CurrentUser,
    db: DB,
    voice: bool = Form(False),
    duration_ms: int | None = Form(None),
):
    att = await att_svc.upload(db, me, file, voice=voice, duration_ms=duration_ms)
    return present_attachment(att)


@router.get("/attachments/{attachment_id}/file")
async def download_attachment(
    attachment_id: int, me: MediaUser, db: DB, download: bool = False
) -> FileResponse:
    att = await att_svc.get_for_viewer(db, me, attachment_id)
    path = storage.path_for(att.storage_key)
    if not path.exists():
        raise not_found("File")
    return FileResponse(
        path,
        media_type=att.mime_type,
        filename=att.file_name,
        content_disposition_type="attachment" if download else "inline",
        headers={"Cache-Control": "private, max-age=31536000, immutable"},
    )


@router.get("/media/{key:path}")
async def media(key: str) -> FileResponse:
    """Profile and group avatars. Public, like Signal profile photos shared with contacts."""
    if not key.startswith("avatars/"):
        raise not_found("File")
    path = storage.path_for(key)
    if not path.exists():
        raise not_found("File")
    return FileResponse(path, headers={"Cache-Control": "public, max-age=31536000, immutable"})
