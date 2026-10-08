import pytest

from tests.conftest import direct_chat, recv_until, send


def _ack(account, message_ids, transport):
    if transport == "http":
        result = account.post("/api/messages/delivered", json={"message_ids": message_ids})
        assert result.status_code == 204, result.text
        assert result.content == b""
    else:
        with account.ws() as ws:
            ws.send_json({"type": "receipt.delivered", "data": {"message_ids": message_ids}})
            ws.send_json({"type": "ping"})
            assert recv_until(ws, "pong") is None


def test_opening_and_closing_socket_does_not_acknowledge_offline_messages(alice, bob):
    cid = direct_chat(alice, bob)
    msg = send(alice, cid, "Not downloaded yet")
    with bob.ws() as ws:
        ws.send_json({"type": "ping"})
        recv_until(ws, "pong")
        assert alice.get(f"/api/messages/{msg['id']}/info").json()["message"]["status"] == "sent"
    assert alice.get(f"/api/messages/{msg['id']}/info").json()["message"]["status"] == "sent"


@pytest.mark.parametrize("transport", ["http", "websocket"])
def test_acknowledgement_is_idempotent_and_only_marks_supplied_visible_ids(
    alice, bob, carol, transport
):
    cid = direct_chat(alice, bob)
    first = send(alice, cid, "Fetched from history")
    second = send(alice, cid, "Still pending")
    hidden = send(alice, cid, "Hidden by recipient")
    assert bob.delete(f"/api/messages/{hidden['id']}", params={"scope": "me"}).status_code == 204
    other_cid = direct_chat(alice, carol)
    foreign = send(alice, other_cid, "Another person's message")

    _ack(bob, [], transport)
    assert alice.get(f"/api/messages/{first['id']}/info").json()["message"]["status"] == "sent"
    ids = [first["id"], first["id"], hidden["id"], foreign["id"], 999999]
    _ack(bob, ids, transport)
    info = alice.get(f"/api/messages/{first['id']}/info").json()
    assert info["message"]["status"] == "delivered"
    delivered_at = info["recipients"][0]["delivered_at"]
    assert delivered_at is not None and info["recipients"][0]["read_at"] is None
    _ack(bob, ids, transport)
    assert (
        alice.get(f"/api/messages/{first['id']}/info").json()["recipients"][0]["delivered_at"]
        == delivered_at
    )
    for pending in (second, hidden, foreign):
        assert (
            alice.get(f"/api/messages/{pending['id']}/info").json()["message"]["status"] == "sent"
        )
    assert bob.get(f"/api/conversations/{cid}").json()["unread_count"] == 2


@pytest.mark.parametrize("transport", ["http", "websocket"])
def test_group_acknowledgement_updates_only_the_callers_receipt(alice, bob, carol, transport):
    group = alice.post(
        "/api/conversations",
        json={"type": "group", "name": "Acknowledgements", "member_ids": [bob.id, carol.id]},
    ).json()
    msg = send(alice, group["id"], "For both recipients")
    _ack(alice, [msg["id"]], transport)
    _ack(bob, [msg["id"]], transport)
    info = alice.get(f"/api/messages/{msg['id']}/info").json()
    recipients = {r["user_id"]: r for r in info["recipients"]}
    assert info["message"]["status"] == "sent"
    assert recipients[bob.id]["delivered_at"] is not None
    assert recipients[carol.id]["delivered_at"] is None
    _ack(carol, [msg["id"]], transport)
    assert alice.get(f"/api/messages/{msg['id']}/info").json()["message"]["status"] == "delivered"


def test_http_acknowledgement_notifies_connected_sender(alice, bob):
    cid = direct_chat(alice, bob)
    with alice.ws() as ws:
        msg = send(alice, cid, "Fetched while the recipient's websocket was unavailable")
        recv_until(ws, "message.new")
        _ack(bob, [msg["id"]], "http")
        assert recv_until(ws, "receipt.updated") == [
            {"message_id": msg["id"], "conversation_id": cid, "status": "delivered"}
        ]


def test_http_acknowledgement_requires_login_and_limits_positive_ids(client, alice):
    assert client.post("/api/messages/delivered", json={"message_ids": []}).status_code == 401
    for invalid in (
        {},
        {"message_ids": [0]},
        {"message_ids": [-1]},
        {"message_ids": [1.5]},
        {"message_ids": None},
        {"message_ids": list(range(1, 502))},
    ):
        assert alice.post("/api/messages/delivered", json=invalid).status_code == 422
    _ack(alice, list(range(1, 501)), "http")
