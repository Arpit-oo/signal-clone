"""Persistent Stories with a private audience and view receipts.

Revision ID: b38d41ac975e
Revises: 81fb290de613
"""

import sqlalchemy as sa
from alembic import op

from app.db.base import UTCDateTime

revision = "b38d41ac975e"
down_revision = "81fb290de613"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "stories",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("author_id", sa.Integer(), nullable=False),
        sa.Column("kind", sa.String(8), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("color", sa.String(7), nullable=False),
        sa.Column("storage_key", sa.String(255), nullable=True),
        sa.Column("mime_type", sa.String(127), nullable=True),
        sa.Column("size_bytes", sa.BigInteger(), nullable=True),
        sa.Column("width", sa.Integer(), nullable=True),
        sa.Column("height", sa.Integer(), nullable=True),
        sa.Column("created_at", UTCDateTime(), nullable=False),
        sa.Column("expires_at", UTCDateTime(), nullable=False),
        sa.CheckConstraint("kind IN ('text', 'image', 'video')", name=op.f("ck_stories_kind")),
        sa.ForeignKeyConstraint(["author_id"], ["users.id"], ondelete="CASCADE"),
        sqlite_autoincrement=True,
    )
    op.create_index("ix_stories_expires_at", "stories", ["expires_at"])
    op.create_index("ix_stories_author_id_created_at", "stories", ["author_id", "created_at"])
    op.create_table(
        "story_recipients",
        sa.Column("story_id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), primary_key=True),
        sa.ForeignKeyConstraint(["story_id"], ["stories.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
    )
    op.create_index("ix_story_recipients_user_id", "story_recipients", ["user_id"])
    op.create_table(
        "story_views",
        sa.Column("story_id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), primary_key=True),
        sa.Column("viewed_at", UTCDateTime(), nullable=False),
        sa.ForeignKeyConstraint(
            ["story_id", "user_id"],
            ["story_recipients.story_id", "story_recipients.user_id"],
            ondelete="CASCADE",
        ),
    )


def downgrade() -> None:
    op.drop_table("story_views")
    op.drop_index("ix_story_recipients_user_id", table_name="story_recipients")
    op.drop_table("story_recipients")
    op.drop_index("ix_stories_author_id_created_at", table_name="stories")
    op.drop_index("ix_stories_expires_at", table_name="stories")
    op.drop_table("stories")
