"""Typing indicators with a server-side timeout.

Clients send typing.start every few seconds while typing and typing.stop when done. If a
client vanishes mid-typing, the sweeper clears it after `typing_ttl_seconds`.
"""

import time

from app.core.config import get_settings

settings = get_settings()


class TypingRegistry:
    def __init__(self) -> None:
        # (conversation_id, user_id) -> monotonic expiry time
        self._expires: dict[tuple[int, int], float] = {}

    def start(self, conversation_id: int, user_id: int) -> bool:
        """Record typing. Returns True if this is a new typing session (worth broadcasting)."""
        key = (conversation_id, user_id)
        is_new = key not in self._expires
        self._expires[key] = time.monotonic() + settings.typing_ttl_seconds
        return is_new

    def stop(self, conversation_id: int, user_id: int) -> bool:
        return self._expires.pop((conversation_id, user_id), None) is not None

    def stop_all_for(self, user_id: int) -> list[int]:
        keys = [k for k in self._expires if k[1] == user_id]
        for k in keys:
            del self._expires[k]
        return [conv_id for conv_id, _ in keys]

    def pop_expired(self) -> list[tuple[int, int]]:
        now = time.monotonic()
        expired = [k for k, t in self._expires.items() if t <= now]
        for k in expired:
            del self._expires[k]
        return expired


typing_registry = TypingRegistry()
