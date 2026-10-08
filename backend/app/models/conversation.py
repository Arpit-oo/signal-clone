from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, CheckConstraint, ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, UTCDateTime, utcnow

if TYPE_CHECKING:
    from app.models.user import User

CONVERSATION_TYPES = ("direct", "group", "note_to_self")
MEMBER_ROLES = ("admin", "member")


def direct_identity_key(a: int, b: int) -> str:
    return f"direct:{min(a, b)}:{max(a, b)}"


def note_identity_key(user_id: int) -> str:
    return f"self:{user_id}"


class Conversation(Base):
    __tablename__ = "conversations"
    __table_args__ = (
        CheckConstraint(f"type IN {CONVERSATION_TYPES}", name="type"),
        Index("ix_conversations_last_activity_at", "last_activity_at"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    type: Mapped[str] = mapped_column(String(16))
    # One reusable chat for each direct pair or self. Groups and preserved legacy
    # duplicates have no key; their history and membership settings stay intact.
    identity_key: Mapped[str | None] = mapped_column(String(64), unique=True, index=True)
    # Group-only fields; direct chats take their name/avatar from the other member.
    name: Mapped[str | None] = mapped_column(String(64))
    description: Mapped[str | None] = mapped_column(Text)
    avatar_url: Mapped[str | None] = mapped_column(String(255))
    avatar_color: Mapped[str] = mapped_column(String(8), default="A100")
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    disappearing_seconds: Mapped[int | None] = mapped_column(Integer)
    last_activity_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)

    members: Mapped[list["ConversationMember"]] = relationship(
        back_populates="conversation", cascade="all, delete-orphan"
    )


class ConversationMember(Base):
    __tablename__ = "conversation_members"
    __table_args__ = (
        CheckConstraint(f"role IN {MEMBER_ROLES}", name="role"),
        Index("ix_conversation_members_user_id", "user_id"),
    )

    conversation_id: Mapped[int] = mapped_column(
        ForeignKey("conversations.id", ondelete="CASCADE"), primary_key=True
    )
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    role: Mapped[str] = mapped_column(String(8), default="member")
    joined_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    # Set when a member leaves or is removed; the row stays so history keeps its sender.
    left_at: Mapped[datetime | None] = mapped_column(UTCDateTime)

    # Per-member view state.
    last_read_message_id: Mapped[int | None] = mapped_column(Integer)
    is_pinned: Mapped[bool] = mapped_column(Boolean, default=False)
    pinned_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    is_archived: Mapped[bool] = mapped_column(Boolean, default=False)
    muted_until: Mapped[datetime | None] = mapped_column(UTCDateTime)
    marked_unread: Mapped[bool] = mapped_column(Boolean, default=False)
    # "Delete chat" hides messages up to this point for this member only.
    cleared_before_id: Mapped[int | None] = mapped_column(Integer)
    is_hidden: Mapped[bool] = mapped_column(Boolean, default=False)

    conversation: Mapped[Conversation] = relationship(back_populates="members")
    user: Mapped["User"] = relationship()

    @property
    def is_active(self) -> bool:
        return self.left_at is None
