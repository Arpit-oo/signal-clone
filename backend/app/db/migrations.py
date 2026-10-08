"""Apply the checked-in schema migrations before the API starts serving requests."""

import asyncio
from pathlib import Path

from alembic.config import Config
from sqlalchemy.engine import make_url

from alembic import command
from app.core.config import BASE_DIR, get_settings


def migrate_database() -> None:
    settings = get_settings()
    url = make_url(settings.database_url)
    if url.get_backend_name() == "sqlite" and url.database and url.database != ":memory:":
        Path(url.database).resolve().parent.mkdir(parents=True, exist_ok=True)

    config = Config(str(BASE_DIR / "alembic.ini"))
    config.set_main_option("script_location", str(BASE_DIR / "alembic"))
    command.upgrade(config, "head")


async def initialize_database() -> None:
    # Alembic's async environment owns its event loop, so run it outside the API loop.
    await asyncio.to_thread(migrate_database)
