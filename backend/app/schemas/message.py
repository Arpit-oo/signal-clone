from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

MessageStatus = Literal["sent", "delivered", "read"]


class AttachmentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    kind: str
    file_name: str
    mime_type: str
    size_bytes: int
    width: int | None
    height: int | None
    duration_ms: int | None
    url: str = ""


class ReactionOut(BaseModel):
    user_id: int
    emoji: str


class ReplyPreview(BaseModel):
    id: int
    sender_id: int | None
    body: str
    attachment_kind: str | None = None
    is_deleted: bool = False


class MessageOut(BaseModel):
    id: int
    conversation_id: int
    sender_id: int | None
    client_id: str | None
    type: str
    body: str
    meta: dict[str, Any] | None
    reply_to: ReplyPreview | None = None
    is_forwarded: bool
    created_at: datetime
    edited_at: datetime | None
    is_deleted: bool
    expires_in_seconds: int | None
    expires_at: datetime | None
    attachments: list[AttachmentOut] = []
    reactions: list[ReactionOut] = []
    mentions: list[int] = []
    # Delivery status from the sender's point of view; None for messages the viewer received.
    status: MessageStatus | None = None


class MessagePage(BaseModel):
    items: list[MessageOut]
    has_more_before: bool
    has_more_after: bool = False


class MessageSend(BaseModel):
    client_id: str = Field(min_length=8, max_length=64)
    body: str = Field("", max_length=8000)
    reply_to_id: int | None = None
    attachment_ids: list[int] = Field(default_factory=list, max_length=32)
    mentions: list[int] = Field(default_factory=list, max_length=64)


class MessageEdit(BaseModel):
    body: str = Field(min_length=1, max_length=8000)


class ReactionSet(BaseModel):
    emoji: str = Field(min_length=1, max_length=16)


class ForwardRequest(BaseModel):
    conversation_ids: list[int] = Field(min_length=1, max_length=20)
    # Optional note sent after the forwarded message, like Signal's forward sheet.
    note: str | None = Field(None, max_length=8000)


class ReadRequest(BaseModel):
    up_to_id: int = Field(ge=1)


class RecipientStatus(BaseModel):
    user_id: int
    delivered_at: datetime | None
    read_at: datetime | None


class MessageInfo(BaseModel):
    message: MessageOut
    recipients: list[RecipientStatus]
