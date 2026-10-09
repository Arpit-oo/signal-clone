import asyncio
import logging
from collections import defaultdict
from collections.abc import Iterable
from typing import Any

from fastapi import WebSocket

log = logging.getLogger(__name__)


class ConnectionManager:
    """Tracks open sockets per user. One user can have several (tabs, devices)."""

    def __init__(self) -> None:
        self._sockets: dict[int, set[WebSocket]] = defaultdict(set)
        self._lock = asyncio.Lock()

    async def send_socket(self, ws: WebSocket, type_: str, data: Any) -> None:
        await self._safe_send(ws, {"type": type_, "data": data})

    async def connect(self, user_id: int, ws: WebSocket) -> bool:
        """Register a socket. Returns True if this is the user's first open socket."""
        async with self._lock:
            first = not self._sockets[user_id]
            self._sockets[user_id].add(ws)
            return first

    async def disconnect(self, user_id: int, ws: WebSocket) -> bool:
        """Drop a socket. Returns True if the user has no sockets left (went offline)."""
        async with self._lock:
            sockets = self._sockets.get(user_id)
            if not sockets:
                return False
            sockets.discard(ws)
            if sockets:
                return False
            del self._sockets[user_id]
            return True

    def is_online(self, user_id: int) -> bool:
        return bool(self._sockets.get(user_id))

    def online_ids(self, user_ids: Iterable[int]) -> set[int]:
        return {uid for uid in user_ids if self.is_online(uid)}

    async def send_to_user(self, user_id: int, type_: str, data: Any) -> None:
        await self.send_to_users([user_id], type_, data)

    async def send_to_users(
        self, user_ids: Iterable[int], type_: str, data: Any, exclude: WebSocket | None = None
    ) -> None:
        message = {"type": type_, "data": data}
        targets = [
            ws
            for uid in set(user_ids)
            for ws in list(self._sockets.get(uid, ()))
            if ws is not exclude
        ]
        if targets:
            await asyncio.gather(*(self._safe_send(ws, message) for ws in targets))

    async def _safe_send(self, ws: WebSocket, message: dict) -> None:
        try:
            await ws.send_json(message)
        except Exception:  # socket closed mid-send; its receive loop will clean it up
            log.debug("dropping message to closed socket")


manager = ConnectionManager()
