import asyncio
import logging
from collections import defaultdict

from app.core.config import get_settings
from app.db.session import SessionLocal
from app.services import conversations as conv_svc
from app.services import messages as msg_svc
from app.ws.manager import manager
from app.ws.router import broadcast_typing
from app.ws.typing import typing_registry

log = logging.getLogger(__name__)
settings = get_settings()


async def sweep_once() -> None:
    for conversation_id, user_id in typing_registry.pop_expired():
        await broadcast_typing(conversation_id, user_id, False)

    async with SessionLocal() as db:
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


async def run_sweeper() -> None:
    """Expire typing indicators and disappearing messages."""
    while True:
        try:
            await sweep_once()
        except asyncio.CancelledError:
            raise
        except Exception:
            log.exception("sweeper failed")
        await asyncio.sleep(settings.expiry_sweep_seconds)
