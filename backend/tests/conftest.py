import asyncio
import os
import tempfile
from collections.abc import Iterator
from pathlib import Path

import pytest

# Point the app at a throwaway database before anything imports the settings.
_tmp = Path(tempfile.mkdtemp(prefix="signal-test-"))
os.environ["DATABASE_URL"] = f"sqlite+aiosqlite:///{(_tmp / 'test.db').as_posix()}"
os.environ["UPLOAD_DIR"] = str(_tmp / "uploads")
os.environ["DB_NULL_POOL"] = "true"
os.environ["EXPIRY_SWEEP_SECONDS"] = "0.2"
os.environ["TYPING_TTL_SECONDS"] = "1"

from fastapi.testclient import TestClient  # noqa: E402

from app.db.base import Base  # noqa: E402
from app.db.session import engine  # noqa: E402
from app.main import app  # noqa: E402


async def _reset_schema() -> None:
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)


@pytest.fixture
def client() -> Iterator[TestClient]:
    asyncio.run(_reset_schema())
    with TestClient(app) as c:
        yield c


class Account:
    """A logged-in test user with helpers for REST calls."""

    def __init__(self, client: TestClient, phone: str, name: str) -> None:
        self.client = client
        res = client.post("/api/auth/verify", json={"phone": phone, "code": "123456"})
        assert res.status_code == 200, res.text
        self.token = res.json()["token"]
        self.headers = {"Authorization": f"Bearer {self.token}"}
        me = client.patch("/api/me", json={"display_name": name}, headers=self.headers).json()
        self.id: int = me["id"]
        self.phone = phone

    def get(self, url: str, **kw):
        return self.client.get(url, headers=self.headers, **kw)

    def post(self, url: str, **kw):
        return self.client.post(url, headers=self.headers, **kw)

    def patch(self, url: str, **kw):
        return self.client.patch(url, headers=self.headers, **kw)

    def put(self, url: str, **kw):
        return self.client.put(url, headers=self.headers, **kw)

    def delete(self, url: str, **kw):
        return self.client.delete(url, headers=self.headers, **kw)

    def ws(self):
        return self.client.websocket_connect(f"/ws?token={self.token}")


@pytest.fixture
def make_account(client: TestClient):
    counter = iter(range(1, 1000))

    def _make(name: str) -> Account:
        return Account(client, f"+1555123{next(counter):04d}", name)

    return _make


@pytest.fixture
def alice(make_account) -> Account:
    return make_account("Alice")


@pytest.fixture
def bob(make_account) -> Account:
    return make_account("Bob")


@pytest.fixture
def carol(make_account) -> Account:
    return make_account("Carol")


def direct_chat(a: Account, b: Account) -> int:
    res = a.post("/api/conversations", json={"type": "direct", "member_ids": [b.id]})
    assert res.status_code in (200, 201), res.text
    return res.json()["id"]


def send(a: Account, conversation_id: int, body: str, **extra) -> dict:
    import uuid

    res = a.post(
        f"/api/conversations/{conversation_id}/messages",
        json={"client_id": uuid.uuid4().hex, "body": body, **extra},
    )
    assert res.status_code == 201, res.text
    return res.json()


def recv_until(ws, type_: str, limit: int = 20) -> dict:
    """Read frames until one of the given type arrives (skipping presence noise etc.)."""
    for _ in range(limit):
        frame = ws.receive_json()
        if frame["type"] == type_:
            return frame["data"]
    raise AssertionError(f"no {type_} event within {limit} frames")
