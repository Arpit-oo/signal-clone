from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, PositiveInt, field_validator

from app.schemas.user import UserOut


class StoryCreate(BaseModel):
    body: str = Field("", max_length=2000)
    color: str = Field("#3B45FD", min_length=7, max_length=7, pattern=r"^#[0-9A-Fa-f]{6}$")
    recipient_ids: list[PositiveInt] = Field(min_length=1, max_length=1000)

    @field_validator("body")
    @classmethod
    def _strip_body(cls, value: str) -> str:
        return value.strip()


class StoryMedia(BaseModel):
    url: str
    mime_type: str
    size_bytes: int
    width: int | None = None
    height: int | None = None


class StoryOut(BaseModel):
    id: int
    author: UserOut
    kind: Literal["text", "image", "video"]
    body: str
    color: str
    media: StoryMedia | None = None
    created_at: datetime
    expires_at: datetime
    is_own: bool
    viewed_at: datetime | None = None
    view_count: int | None = None
    recipient_ids: list[int] | None = None


class StoryViewer(BaseModel):
    user: UserOut
    viewed_at: datetime
