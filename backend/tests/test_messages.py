import io
import time

from PIL import Image

from tests.conftest import direct_chat, send


def test_pagination_cursor(alice, bob):
    cid = direct_chat(alice, bob)
    ids = [send(alice, cid, f"m{i}")["id"] for i in range(7)]

    page = alice.get(f"/api/conversations/{cid}/messages", params={"limit": 3}).json()
    assert [m["body"] for m in page["items"]] == ["m4", "m5", "m6"]
    assert page["has_more_before"] is True

    page = alice.get(
        f"/api/conversations/{cid}/messages", params={"limit": 3, "before": page["items"][0]["id"]}
    ).json()
    assert [m["body"] for m in page["items"]] == ["m1", "m2", "m3"]

    around = alice.get(
        f"/api/conversations/{cid}/messages", params={"limit": 4, "around": ids[3]}
    ).json()
    assert [m["body"] for m in around["items"]] == ["m2", "m3", "m4", "m5"]
    assert around["has_more_before"] and around["has_more_after"]


def test_client_id_makes_send_idempotent(alice, bob):
    cid = direct_chat(alice, bob)
    body = {"client_id": "retry-me-123", "body": "once"}
    first = alice.post(f"/api/conversations/{cid}/messages", json=body).json()
    second = alice.post(f"/api/conversations/{cid}/messages", json=body).json()
    assert first["id"] == second["id"]
    assert len(alice.get(f"/api/conversations/{cid}/messages").json()["items"]) == 1


def test_status_progression_via_receipts(alice, bob, client):
    cid = direct_chat(alice, bob)
    msg = send(alice, cid, "hi")
    assert msg["status"] == "sent"

    with bob.ws() as ws:  # connecting flushes pending deliveries
        ws.send_json({"type": "ping"})
        assert ws.receive_json()["type"] in ("pong", "presence")
    items = alice.get(f"/api/conversations/{cid}/messages").json()["items"]
    assert items[0]["status"] == "delivered"

    bob.post(f"/api/conversations/{cid}/read", json={"up_to_id": msg["id"]})
    items = alice.get(f"/api/conversations/{cid}/messages").json()["items"]
    assert items[0]["status"] == "read"


def test_read_receipts_disabled_hides_read_state(alice, bob):
    bob.patch("/api/me", json={"read_receipts_enabled": False})
    cid = direct_chat(alice, bob)
    msg = send(alice, cid, "hi")
    bob.post(f"/api/conversations/{cid}/read", json={"up_to_id": msg["id"]})
    items = alice.get(f"/api/conversations/{cid}/messages").json()["items"]
    assert items[0]["status"] == "delivered"


def test_reply_edit_delete(alice, bob):
    cid = direct_chat(alice, bob)
    original = send(bob, cid, "question?")
    reply = send(alice, cid, "answer", reply_to_id=original["id"])
    assert reply["reply_to"]["body"] == "question?"

    assert bob.patch(f"/api/messages/{reply['id']}", json={"body": "nope"}).status_code == 403
    edited = alice.patch(f"/api/messages/{reply['id']}", json={"body": "better answer"}).json()
    assert edited["body"] == "better answer" and edited["edited_at"]

    assert (
        bob.delete(f"/api/messages/{reply['id']}", params={"scope": "everyone"}).status_code == 403
    )
    assert (
        alice.delete(f"/api/messages/{reply['id']}", params={"scope": "everyone"}).status_code
        == 204
    )
    bob_items = bob.get(f"/api/conversations/{cid}/messages").json()["items"]
    gone = next(m for m in bob_items if m["id"] == reply["id"])
    assert gone["is_deleted"] and gone["body"] == ""

    assert bob.delete(f"/api/messages/{original['id']}", params={"scope": "me"}).status_code == 204
    bob_ids = [m["id"] for m in bob.get(f"/api/conversations/{cid}/messages").json()["items"]]
    alice_ids = [m["id"] for m in alice.get(f"/api/conversations/{cid}/messages").json()["items"]]
    assert original["id"] not in bob_ids and original["id"] in alice_ids


def test_reactions_one_per_user(alice, bob):
    cid = direct_chat(alice, bob)
    msg = send(alice, cid, "nice")
    bob.put(f"/api/messages/{msg['id']}/reaction", json={"emoji": "👍"})
    bob.put(f"/api/messages/{msg['id']}/reaction", json={"emoji": "❤️"})
    alice.put(f"/api/messages/{msg['id']}/reaction", json={"emoji": "😂"})
    reactions = alice.get(f"/api/conversations/{cid}/messages").json()["items"][0]["reactions"]
    assert sorted((r["user_id"], r["emoji"]) for r in reactions) == sorted(
        [(bob.id, "❤️"), (alice.id, "😂")]
    )
    bob.delete(f"/api/messages/{msg['id']}/reaction")
    reactions = alice.get(f"/api/conversations/{cid}/messages").json()["items"][0]["reactions"]
    assert [r["user_id"] for r in reactions] == [alice.id]


def _png() -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (40, 20), (200, 10, 10)).save(buf, "PNG")
    return buf.getvalue()


def test_attachment_upload_send_and_access_control(alice, bob, carol):
    cid = direct_chat(alice, bob)
    up = alice.post("/api/attachments", files={"file": ("red.png", _png(), "image/png")})
    assert up.status_code == 201
    att = up.json()
    assert (att["kind"], att["width"], att["height"]) == ("image", 40, 20)

    msg = send(alice, cid, "", attachment_ids=[att["id"]])
    assert msg["attachments"][0]["id"] == att["id"]
    # Can't reuse an attachment that was already sent.
    res = alice.post(
        f"/api/conversations/{cid}/messages",
        json={"client_id": "reuse-attachment", "attachment_ids": [att["id"]]},
    )
    assert res.status_code == 400

    assert bob.get(att["url"]).status_code == 200
    assert bob.client.get(att["url"], params={"token": bob.token}).status_code == 200
    assert carol.get(att["url"]).status_code == 404


def test_forward(alice, bob, carol):
    with_bob = direct_chat(alice, bob)
    with_carol = direct_chat(alice, carol)
    msg = send(bob, with_bob, "pass this on")
    res = alice.post(
        f"/api/messages/{msg['id']}/forward", json={"conversation_ids": [with_carol], "note": "fyi"}
    )
    assert res.status_code == 201
    items = carol.get(f"/api/conversations/{with_carol}/messages").json()["items"]
    assert [(m["body"], m["is_forwarded"]) for m in items] == [
        ("pass this on", True),
        ("fyi", False),
    ]


def test_message_search(alice, bob, carol):
    cid = direct_chat(alice, bob)
    send(bob, cid, "Let's grab pizza tonight")
    send(bob, cid, "or tacos")
    other = direct_chat(bob, carol)
    send(carol, other, "pizza is overrated")
    results = alice.get("/api/search", params={"q": "pizza"}).json()
    assert [m["body"] for m in results["messages"]] == ["Let's grab pizza tonight"]


def test_disappearing_messages_expire_after_read(alice, bob):
    cid = direct_chat(alice, bob)
    alice.patch(f"/api/conversations/{cid}", json={"disappearing_seconds": 1})
    msg = send(alice, cid, "self destruct")
    assert msg["expires_in_seconds"] == 1 and msg["expires_at"] is None
    bob.post(f"/api/conversations/{cid}/read", json={"up_to_id": msg["id"]})
    time.sleep(1.6)
    bodies = [m["body"] for m in alice.get(f"/api/conversations/{cid}/messages").json()["items"]]
    assert "self destruct" not in bodies


def test_blocked_user_cannot_message(alice, bob):
    cid = direct_chat(alice, bob)
    assert bob.put(f"/api/blocks/{alice.id}").status_code == 200
    res = alice.post(
        f"/api/conversations/{cid}/messages", json={"client_id": "blocked-1", "body": "hi"}
    )
    assert res.status_code == 403
    bob.delete(f"/api/blocks/{alice.id}")
    send(alice, cid, "hi again")
