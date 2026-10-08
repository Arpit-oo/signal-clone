"""Protect reusable direct chats and Note to Self against concurrent creation.

Revision ID: 81fb290de613
Revises: 30b3daecbcab
"""

import sqlalchemy as sa
from alembic import op

revision = "81fb290de613"
down_revision = "30b3daecbcab"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("conversations", sa.Column("identity_key", sa.String(64), nullable=True))
    # Canonical keys depend on every member, including hidden conversations. Leave
    # malformed legacy records untouched rather than infer a different membership.
    op.execute(
        sa.text("""
        UPDATE conversations
        SET identity_key = (
            SELECT CASE
                WHEN conversations.type = 'direct' AND COUNT(*) = 2
                    THEN 'direct:' || MIN(user_id) || ':' || MAX(user_id)
                WHEN conversations.type = 'note_to_self' AND COUNT(*) = 1
                    THEN 'self:' || MIN(user_id)
            END
            FROM conversation_members
            WHERE conversation_id = conversations.id
        )
        WHERE type IN ('direct', 'note_to_self')
    """)
    )
    # Existing duplicates keep their IDs, messages, receipts, and per-user settings.
    # Only the oldest conversation becomes the reusable destination for new requests.
    op.execute(
        sa.text("""
        UPDATE conversations
        SET identity_key = NULL
        WHERE identity_key IS NOT NULL AND EXISTS (
            SELECT 1 FROM conversations AS earlier
            WHERE earlier.identity_key = conversations.identity_key
                AND earlier.id < conversations.id
        )
    """)
    )
    op.create_index("ix_conversations_identity_key", "conversations", ["identity_key"], unique=True)


def downgrade() -> None:
    op.drop_index("ix_conversations_identity_key", table_name="conversations")
    with op.batch_alter_table("conversations") as batch_op:
        batch_op.drop_column("identity_key")
