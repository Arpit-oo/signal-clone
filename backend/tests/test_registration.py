import asyncio
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Conversation, User
from tests.conftest import Account, direct_chat, send


def _synchronize_commits(monkeypatch, phase_for, count):
    """Force requests to finish their availability checks before any insert wins."""
    original_commit = AsyncSession.commit
    phases = {}

    async def commit(db):
        phase = phase_for(db)
        if phase is not None:
            state = phases.setdefault(phase, [0, asyncio.Event()])
            state[0] += 1
            if state[0] >= count:
                state[1].set()
            await asyncio.wait_for(state[1].wait(), timeout=5)
        return await original_commit(db)

    monkeypatch.setattr(AsyncSession, "commit", commit)


def test_fresh_accounts_onboard_discover_and_exchange_messages(client):
    phone = "+91 (98765) 43210"
    requested = client.post("/api/auth/request-otp", json={"phone": phone})
    assert requested.status_code == 200
    assert requested.json() == {"phone": "+919876543210", "dev_code": "123456"}
    login = client.post("/api/auth/verify", json={"phone": phone, "code": "123456"})
    assert login.status_code == 200
    assert login.json()["is_new"] is True
    headers = {"Authorization": f"Bearer {login.json()['token']}"}
    assert client.get("/api/contacts", headers=headers).json() == []
    assert client.get("/api/users/search", params={"q": "Alex"}, headers=headers).json() == []
    initial = client.get("/api/conversations", headers=headers).json()
    assert [c["type"] for c in initial] == ["note_to_self"]

    # Interrupted onboarding returns to profile setup without creating another account/chat.
    retry = client.post("/api/auth/verify", json={"phone": "919876543210", "code": "123456"}).json()
    assert retry["user"]["id"] == login.json()["user"]["id"]
    assert retry["is_new"] is True
    profile = client.patch(
        "/api/me",
        headers=headers,
        json={"display_name": "  Piyush  ", "username": "  Piyush_India  ", "about": "Hello"},
    )
    assert profile.status_code == 200
    assert profile.json()["display_name"] == "Piyush"
    assert profile.json()["username"] == "piyush_india"
    piyush = Account(client, "+919876543210", "Piyush")
    jane = Account(client, "+44 (7700) 900-123", "Jane")
    raj = Account(client, "+91 98765 43211", "Raj")

    for lookup in ({"phone": phone}, {"username": " @PIYUSH_INDIA "}):
        found = jane.get("/api/users/lookup", params=lookup)
        assert found.status_code == 200, found.text
        assert found.json()["id"] == piyush.id
    assert jane.get("/api/users/search", params={"q": "98765 43210"}).json()[0]["id"] == piyush.id
    contact = jane.post("/api/contacts", json={"username": "@piyush_india", "nickname": "Friend"})
    assert contact.status_code == 201, contact.text
    assert jane.get("/api/contacts").json()[0]["nickname"] == "Friend"
    assert piyush.get("/api/contacts").json() == []

    cid = direct_chat(jane, piyush)
    incoming = send(jane, cid, "Hello from a fresh account")
    view = piyush.get(f"/api/conversations/{cid}").json()
    assert view["unread_count"] == 1
    assert (
        piyush.post(f"/api/conversations/{cid}/read", json={"up_to_id": incoming["id"]}).status_code
        == 204
    )
    history = jane.get(f"/api/conversations/{cid}/messages").json()["items"]
    assert history[0]["status"] == "read"
    send(piyush, cid, "Hello back")
    assert [m["body"] for m in jane.get(f"/api/conversations/{cid}/messages").json()["items"]] == [
        "Hello from a fresh account",
        "Hello back",
    ]

    group = piyush.post(
        "/api/conversations", json={"type": "group", "name": "Friends", "member_ids": [jane.id]}
    )
    assert group.status_code == 201, group.text
    gid = group.json()["id"]
    assert (
        piyush.post(f"/api/conversations/{gid}/members", json={"user_ids": [raj.id]}).status_code
        == 200
    )
    send(raj, gid, "New member joined")
    assert (
        jane.get(f"/api/conversations/{gid}/messages").json()["items"][-1]["body"]
        == "New member joined"
    )
    assert piyush.delete(f"/api/conversations/{gid}/members/{raj.id}").status_code == 200
    assert (
        raj.post(
            f"/api/conversations/{gid}/messages",
            json={"client_id": "removed-member", "body": "No access"},
        ).status_code
        == 403
    )

    returning = client.post("/api/auth/verify", json={"phone": phone, "code": "123456"}).json()
    assert returning["is_new"] is False
    assert returning["user"]["id"] == piyush.id
    assert (
        len([c for c in piyush.get("/api/conversations").json() if c["type"] == "note_to_self"])
        == 1
    )


def test_simultaneous_registration_reuses_one_account_and_note(client, monkeypatch):
    variants = [
        "+919876543210",
        "+91 (98765) 43210",
        "91-98765-43210",
        " +919876543210 ",
        "9876543210",
        "+9876543210",
        "0091 98765 43210",
    ]
    barrier = Barrier(len(variants))

    def phase_for(db):
        if any(isinstance(row, User) for row in db.new):
            return "account"
        if any(isinstance(row, Conversation) for row in db.new):
            return "note"
        return None

    _synchronize_commits(monkeypatch, phase_for, len(variants))

    def verify(phone):
        barrier.wait(timeout=5)
        return client.post("/api/auth/verify", json={"phone": phone, "code": "123456"})

    with ThreadPoolExecutor(max_workers=len(variants)) as pool:
        results = list(pool.map(verify, variants))
    assert [r.status_code for r in results] == [200] * len(variants)
    assert len({r.json()["user"]["id"] for r in results}) == 1
    for result in results:
        assert result.json()["is_new"] is True
        headers = {"Authorization": f"Bearer {result.json()['token']}"}
        conversations = client.get("/api/conversations", headers=headers).json()
        assert [c["type"] for c in conversations] == ["note_to_self"]


def test_phone_spellings_reopen_the_existing_profile_and_history(client):
    account = Account(client, "+919877032297", "Original profile")
    note = account.get("/api/conversations").json()[0]["id"]
    saved = send(account, note, "Keep my history when I verify again")
    for phone in (
        "9877032297",
        "+9877032297",
        "+91 (98770) 32297",
        "919877032297",
        "00919877032297",
    ):
        requested = client.post("/api/auth/request-otp", json={"phone": phone})
        assert requested.status_code == 200, requested.text
        assert requested.json()["phone"] == "+919877032297"
        auth = client.post("/api/auth/verify", json={"phone": phone, "code": "123456"})
        assert auth.status_code == 200, auth.text
        assert auth.json()["user"]["id"] == account.id
        assert auth.json()["user"]["display_name"] == "Original profile"
        assert auth.json()["is_new"] is False
        headers = {"Authorization": f"Bearer {auth.json()['token']}"}
        conversations = client.get("/api/conversations", headers=headers).json()
        assert [conversation["id"] for conversation in conversations] == [note]
        messages = client.get(f"/api/conversations/{note}/messages", headers=headers).json()[
            "items"
        ]
        assert [message["id"] for message in messages] == [saved["id"]]


@pytest.mark.parametrize(
    "phone,country,expected",
    [
        ("5552223333", "+1", "+15552223333"),
        ("07700 900123", "+44", "+447700900123"),
        ("+15552223333", "+91", "+15552223333"),
    ],
)
def test_selected_country_and_explicit_international_numbers(client, phone, country, expected):
    response = client.post("/api/auth/request-otp", json={"phone": phone, "country_code": country})
    assert response.status_code == 200, response.text
    assert response.json()["phone"] == expected


@pytest.mark.parametrize(
    "phone,country",
    [
        ("123", "+91"),
        ("9877032297999", "+91"),
        ("9877032297", "+999"),
        ("9877032297", "abc"),
        ("+12345678901234", "+1"),
    ],
)
def test_impossible_phone_lengths_and_country_codes_are_rejected(client, phone, country):
    response = client.post("/api/auth/request-otp", json={"phone": phone, "country_code": country})
    assert response.status_code == 422


def test_simultaneous_direct_requests_from_both_members_reuse_one_chat(alice, bob, monkeypatch):
    barrier = Barrier(4)
    _synchronize_commits(
        monkeypatch,
        lambda db: "direct" if any(isinstance(row, Conversation) for row in db.new) else None,
        4,
    )

    def create(index):
        requester, peer = (alice, bob) if index % 2 else (bob, alice)
        barrier.wait(timeout=5)
        return requester.post(
            "/api/conversations", json={"type": "direct", "member_ids": [peer.id]}
        )

    with ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(create, range(4)))
    assert sorted(r.status_code for r in results) == [200, 200, 200, 201]
    assert len({r.json()["id"] for r in results}) == 1
    for account in (alice, bob):
        assert (
            len([c for c in account.get("/api/conversations").json() if c["type"] == "direct"]) == 1
        )


def test_simultaneous_username_claim_returns_conflict(alice, bob, monkeypatch):
    barrier = Barrier(2)
    _synchronize_commits(
        monkeypatch,
        lambda db: "username" if any(isinstance(row, User) for row in db.dirty) else None,
        2,
    )

    def claim(account):
        barrier.wait(timeout=5)
        return account.patch("/api/me", json={"username": "new_username", "about": "Claimed"})

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(claim, (alice, bob)))
    assert sorted(r.status_code for r in results) == [200, 409]
    profiles = [account.get("/api/me").json() for account in (alice, bob)]
    assert len([p for p in profiles if p["username"] == "new_username"]) == 1
    assert next(p for p in profiles if p["username"] is None)["about"] == ""


@pytest.mark.parametrize("phone", ["+1٥٥٥٢٢٢٣٣٣٣", "+9198765432100a", "+0123456789"])
def test_phone_rejects_invalid_or_non_ascii_number(client, phone):
    assert client.post("/api/auth/request-otp", json={"phone": phone}).status_code == 422
