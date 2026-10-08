from datetime import datetime

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    Integer,
    String,
    Text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, UTCDateTime


class Story(Base):
    __tablename__ = "stories"
    __table_args__ = (
        CheckConstraint("kind IN ('text', 'image', 'video')", name="kind"),
        Index("ix_stories_expires_at", "expires_at"),
        Index("ix_stories_author_id_created_at", "author_id", "created_at"),
        {"sqlite_autoincrement": True},
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    author_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    kind: Mapped[str] = mapped_column(String(8))
    body: Mapped[str] = mapped_column(Text)
    color: Mapped[str] = mapped_column(String(7))
    storage_key: Mapped[str | None] = mapped_column(String(255))
    mime_type: Mapped[str | None] = mapped_column(String(127))
    size_bytes: Mapped[int | None] = mapped_column(BigInteger)
    width: Mapped[int | None] = mapped_column(Integer)
    height: Mapped[int | None] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime)
    expires_at: Mapped[datetime] = mapped_column(UTCDateTime)

    recipients: Mapped[list["StoryRecipient"]] = relationship(cascade="all, delete-orphan")


class StoryRecipient(Base):
    __tablename__ = "story_recipients"
    __table_args__ = (Index("ix_story_recipients_user_id", "user_id"),)

    story_id: Mapped[int] = mapped_column(
        ForeignKey("stories.id", ondelete="CASCADE"), primary_key=True
    )
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )


class StoryView(Base):
    __tablename__ = "story_views"
    __table_args__ = (
        ForeignKeyConstraint(
            ["story_id", "user_id"],
            ["story_recipients.story_id", "story_recipients.user_id"],
            ondelete="CASCADE",
        ),
    )

    story_id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(Integer, primary_key=True)
    viewed_at: Mapped[datetime] = mapped_column(UTCDateTime)
