"""Fill missing demo profile photos without replacing uploaded avatars."""

import sqlalchemy as sa
from alembic import op

revision = "e94b2d8a106c"
down_revision = "d83a6f2c190b"
branch_labels = None
depends_on = None

# Frozen demo identities: only these phone/username pairs receive bundled photos.
PROFILES = {
    "alex": "+15550000001",
    "priya": "+919876540102",
    "marcus": "+15550000003",
    "sofia": "+15550000004",
    "liam": "+15550000005",
    "aisha": "+15550000006",
    "daniel": "+15550000007",
    "emma": "+15550000008",
    "rahul": "+15550000009",
}


def upgrade() -> None:
    for username, phone in PROFILES.items():
        op.execute(
            sa.text(
                "UPDATE users SET avatar_url=:url "
                "WHERE phone=:phone AND username=:username AND avatar_url IS NULL"
            ).bindparams(
                url=f"/api/demo-avatars/{username}-v1.jpg", phone=phone, username=username
            )
        )


def downgrade() -> None:
    for username, phone in PROFILES.items():
        op.execute(
            sa.text(
                "UPDATE users SET avatar_url=NULL "
                "WHERE phone=:phone AND username=:username AND avatar_url=:url"
            ).bindparams(
                url=f"/api/demo-avatars/{username}-v1.jpg", phone=phone, username=username
            )
        )
