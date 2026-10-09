import asyncio
import contextlib
import logging
from collections import defaultdict

from app.core.config import get_settings
from app.db.session import SessionLocal
from app.services import conversations as conv_svc
from app.services import messages as msg_svc
from app.services import stories as story_svc
from app.ws.calls import calls
from app.ws.manager import manager
from app.ws.router import broadcast_typing
from app.ws.typing import typing_registry

log = logging.getLogger(__name__)
settings = get_settings()


async def sweep_once() -> None:
    await calls.expire()
    for conversation_id, user_id in typing_registry.pop_expired():
        await broadcast_typing(conversation_id, user_id, False)

    async with SessionLocal() as db:
        await story_svc.purge_expired(db)
        expired = await msg_svc.purge_expired(db)
        by_conv: dict[int, list[int]] = defaultdict(list)
        for message_id, conversation_id in expired:
            by_conv[conversation_id].append(message_id)
        for conversation_id, ids in by_conv.items():
            await manager.send_to_users(
                await conv_svc.active_member_ids(db, conversation_id),
                "message.expired",
                {"conversation_id": conversation_id, "message_ids": ids},
            )


async def run_sweeper(stopped: asyncio.Event) -> None:
    """Finish an in-flight DB sweep before shutdown; never abandon SQLite workers."""
    while not stopped.is_set():
        try:
            await sweep_once()
        except asyncio.CancelledError:
            raise
        except Exception:
            log.exception("sweeper failed")
        with contextlib.suppress(TimeoutError):
            await asyncio.wait_for(stopped.wait(), timeout=settings.expiry_sweep_seconds)
