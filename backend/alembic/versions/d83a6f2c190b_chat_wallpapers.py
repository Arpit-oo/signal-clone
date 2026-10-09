"""Private per-member chat wallpapers and Priya's Indian demo identity."""

import sqlalchemy as sa
from alembic import op

revision = "d83a6f2c190b"
down_revision = "c72f5a9d103e"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("conversation_members", sa.Column("wallpaper", sa.String(512), nullable=True))
    # Update only the original seeded identity, never an independently created profile.
    op.execute(
        sa.text(
            "UPDATE users SET phone='+919876540102' "
            "WHERE phone='+15550000002' AND username='priya' "
            "AND NOT EXISTS (SELECT 1 FROM users WHERE phone='+919876540102')"
        )
    )


def downgrade() -> None:
    op.drop_column("conversation_members", "wallpaper")
