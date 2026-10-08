import contextlib
import io
import mimetypes
import secrets
from dataclasses import dataclass
from pathlib import Path

from fastapi import UploadFile
from PIL import Image, ImageOps

from app.core.config import get_settings
from app.core.errors import bad_request

settings = get_settings()

AVATAR_MAX_PX = 512


@dataclass
class StoredFile:
    key: str
    size: int
    mime_type: str
    width: int | None = None
    height: int | None = None


def _path_for(key: str) -> Path:
    # Keys are generated here and never taken from the client, but guard anyway.
    path = (settings.upload_dir / key).resolve()
    if settings.upload_dir.resolve() not in path.parents:
        raise bad_request("Invalid file key")
    return path


def path_for(key: str) -> Path:
    return _path_for(key)


async def _read_limited(file: UploadFile, limit: int) -> bytes:
    data = await file.read(limit + 1)
    if len(data) > limit:
        raise bad_request(f"File is larger than {limit // (1024 * 1024)} MB")
    if not data:
        raise bad_request("File is empty")
    return data


def _write(subdir: str, ext: str, data: bytes) -> str:
    key = f"{subdir}/{secrets.token_hex(16)}{ext}"
    path = _path_for(key)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    return key


async def save_upload(file: UploadFile, subdir: str = "attachments") -> StoredFile:
    data = await _read_limited(file, settings.max_upload_bytes)
    mime = file.content_type or mimetypes.guess_type(file.filename or "")[0]
    mime = mime or "application/octet-stream"
    ext = Path(file.filename or "").suffix.lower()[:10] or (mimetypes.guess_extension(mime) or "")
    width = height = None
    if mime.startswith("image/") and mime != "image/svg+xml":
        try:
            with Image.open(io.BytesIO(data)) as img:
                width, height = ImageOps.exif_transpose(img).size
        except Exception as exc:
            raise bad_request("Could not read that image") from exc
    key = _write(subdir, ext, data)
    return StoredFile(key=key, size=len(data), mime_type=mime, width=width, height=height)


async def save_avatar(file: UploadFile) -> str:
    """Normalize avatars to a square-ish JPEG no larger than 512px; returns the storage key."""
    data = await _read_limited(file, 10 * 1024 * 1024)
    try:
        with Image.open(io.BytesIO(data)) as img:
            img = ImageOps.exif_transpose(img).convert("RGB")
            img = ImageOps.fit(img, (min(img.size),) * 2)
            img.thumbnail((AVATAR_MAX_PX, AVATAR_MAX_PX))
            buf = io.BytesIO()
            img.save(buf, "JPEG", quality=88)
    except Exception as exc:
        raise bad_request("Could not read that image") from exc
    return _write("avatars", ".jpg", buf.getvalue())


MEDIA_PREFIX = "/api/media/"


def avatar_url(key: str) -> str:
    return f"{MEDIA_PREFIX}{key}"


def key_from_url(url: str | None) -> str | None:
    if url and url.startswith(MEDIA_PREFIX):
        return url.removeprefix(MEDIA_PREFIX)
    return None


def delete_key(key: str | None) -> None:
    if not key:
        return
    with contextlib.suppress(Exception):
        _path_for(key).unlink(missing_ok=True)
