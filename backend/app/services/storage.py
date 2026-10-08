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


def _is_story_video(data: bytes, mime: str) -> bool:
    if mime == "video/webm":
        header = data[:4096]
        return (
            data.startswith(b"\x1a\x45\xdf\xa3")
            and b"\x42\x82\x84webm" in header
            and b"\x18\x53\x80\x67" in header
        )
    # Validate MP4 container bounds and its declared brands. Decoding/transcoding
    # video is handled by the browser; QuickTime, SVG, HTML, and generic files
    # are never served through the protected story media endpoint.
    offset = 0
    boxes: set[bytes] = set()
    while offset < len(data):
        if len(data) - offset < 8:
            return False
        size = int.from_bytes(data[offset : offset + 4], "big")
        kind = data[offset + 4 : offset + 8]
        header_size = 8
        if size == 1:
            if len(data) - offset < 16:
                return False
            size = int.from_bytes(data[offset + 8 : offset + 16], "big")
            header_size = 16
        elif size == 0:
            size = len(data) - offset
        if size < header_size or offset + size > len(data):
            return False
        if offset == 0:
            if kind != b"ftyp" or size < header_size + 8:
                return False
            brands = data[header_size : header_size + 4] + data[header_size + 8 : size]
            supported = {b"isom", b"iso2", b"mp41", b"mp42", b"avc1", b"M4V ", b"dash"}
            if not any(brands[i : i + 4] in supported for i in range(0, len(brands), 4)):
                return False
        boxes.add(kind)
        offset += size
    return {b"ftyp", b"moov", b"mdat"} <= boxes


async def save_story_media(file: UploadFile) -> StoredFile:
    """Validate a bounded raster image or MP4/WebM container in private storage."""
    mime = (file.content_type or "").lower().split(";", 1)[0].strip()
    images = {
        "image/jpeg": ("JPEG", ".jpg"),
        "image/png": ("PNG", ".png"),
        "image/webp": ("WEBP", ".webp"),
        "image/gif": ("GIF", ".gif"),
    }
    videos = {"video/mp4": ".mp4", "video/webm": ".webm"}
    if mime not in images and mime not in videos:
        raise bad_request("Stories support JPEG, PNG, WebP, GIF, MP4, and WebM files")
    data = await _read_limited(file, settings.max_upload_bytes)
    width = height = None
    if mime in images:
        format_, ext = images[mime]
        try:
            with Image.open(io.BytesIO(data)) as img:
                if img.format != format_ or img.width * img.height > 25_000_000:
                    raise ValueError("Invalid image format or dimensions")
                img.verify()
            with Image.open(io.BytesIO(data)) as img:
                img.load()
                width, height = ImageOps.exif_transpose(img).size
        except Exception as exc:
            raise bad_request("Could not read that image or its type does not match") from exc
    else:
        ext = videos[mime]
        if not _is_story_video(data, mime):
            raise bad_request("Could not read that video container")
    key = _write("stories", ext, data)
    return StoredFile(key=key, size=len(data), mime_type=mime, width=width, height=height)


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
