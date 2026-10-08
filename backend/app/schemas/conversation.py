from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator

from app.schemas.message import MessageStatus
from app.schemas.user import AVATAR_COLORS, UserOut

# Signal's disappearing-message presets, in seconds.
DISAPPEARING_PRESETS = (30, 300, 3600, 28800, 86400, 604800, 2419200)


class LastMessage(BaseModel):
    id: int
    sender_id: int | None
    type: str
    body: str
    meta: dict | None
    attachment_kind: str | None
    created_at: datetime
    is_deleted: bool
    status: MessageStatus | None


class MemberOut(BaseModel):
    user: UserOut
    role: Literal["admin", "member"]
    joined_at: datetime


class ConversationOut(BaseModel):
    id: int
    type: Literal["direct", "group", "note_to_self"]
    name: str
    description: str | None
    avatar_url: str | None
    avatar_color: str
    peer: UserOut | None = None
    member_count: int
    my_role: Literal["admin", "member"]
    is_member: bool
    disappearing_seconds: int | None
    created_at: datetime
    last_activity_at: datetime
    last_message: LastMessage | None
    unread_count: int
    mention_count: int
    last_read_message_id: int | None
    is_pinned: bool
    is_archived: bool
    muted_until: datetime | None
    marked_unread: bool


class ConversationDetail(ConversationOut):
    members: list[MemberOut]


class ConversationCreate(BaseModel):
    type: Literal["direct", "group"]
    # direct: exactly one user id; group: any number of other members.
    member_ids: list[int] = Field(default_factory=list, max_length=1000)
    name: str | None = Field(None, max_length=64)
    description: str | None = Field(None, max_length=480)
    avatar_color: str | None = None
    disappearing_seconds: int | None = None

    @field_validator("avatar_color")
    @classmethod
    def _color(cls, v: str | None) -> str | None:
        if v is not None and v not in AVATAR_COLORS:
            raise ValueError("Unknown avatar color")
        return v


class ConversationUpdate(BaseModel):
    """Group info edits."""

    name: str | None = Field(None, min_length=1, max_length=64)
    description: str | None = Field(None, max_length=480)
    avatar_color: str | None = None
    disappearing_seconds: int | None = None

    @field_validator("disappearing_seconds")
    @classmethod
    def _timer(cls, v: int | None) -> int | None:
        if v is not None and v <= 0:
            return None
        return v


class ConversationSettings(BaseModel):
    """Per-member view state; only affects the caller."""

    is_pinned: bool | None = None
    is_archived: bool | None = None
    marked_unread: bool | None = None
    # Seconds to mute for; -1 mutes forever, 0 unmutes.
    mute_seconds: int | None = None


class MembersAdd(BaseModel):
    user_ids: list[int] = Field(min_length=1, max_length=1000)


class MemberRoleUpdate(BaseModel):
    role: Literal["admin", "member"]
