from tests.conftest import direct_chat, recv_until, send


def test_message_delivery_receipts_and_typing_over_websocket(alice, bob):
    cid = direct_chat(alice, bob)
    with alice.ws() as a, bob.ws() as b:
        recv_until(a, "presence")  # alice sees bob come online

        a.send_json({"type": "typing.start", "data": {"conversation_id": cid}})
        typing = recv_until(b, "typing")
        assert typing == {"conversation_id": cid, "user_id": alice.id, "is_typing": True}

        a.send_json(
            {
                "type": "message.send",
                "data": {"conversation_id": cid, "client_id": "ws-msg-0001", "body": "hello bob"},
            }
        )
        ack = recv_until(a, "message.new")
        assert ack["client_id"] == "ws-msg-0001" and ack["status"] == "sent"

        # Sending clears the typing indicator, then the message arrives.
        assert recv_until(b, "typing")["is_typing"] is False
        incoming = recv_until(b, "message.new")
        assert incoming["body"] == "hello bob" and incoming["status"] is None

        b.send_json({"type": "receipt.delivered", "data": {"message_ids": [incoming["id"]]}})
        update = recv_until(a, "receipt.updated")
        assert update == [{"message_id": ack["id"], "conversation_id": cid, "status": "delivered"}]

        b.send_json(
            {"type": "receipt.read", "data": {"conversation_id": cid, "up_to_id": incoming["id"]}}
        )
        assert recv_until(a, "receipt.updated")[0]["status"] == "read"


def test_typing_times_out_on_server(alice, bob):
    cid = direct_chat(alice, bob)
    with alice.ws() as a, bob.ws() as b:
        a.send_json({"type": "typing.start", "data": {"conversation_id": cid}})
        assert recv_until(b, "typing")["is_typing"] is True
        # TYPING_TTL_SECONDS=1 in tests; the sweeper sends the stop.
        assert recv_until(b, "typing")["is_typing"] is False


def test_presence_and_last_seen(alice, bob):
    direct_chat(alice, bob)
    with alice.ws() as a:
        with bob.ws():
            assert recv_until(a, "presence") == {
                "user_id": bob.id,
                "online": True,
                "last_seen_at": None,
            }
        offline = recv_until(a, "presence")
        assert offline["online"] is False and offline["last_seen_at"]
    assert alice.get(f"/api/users/{bob.id}").json()["last_seen_at"]


def test_errors_are_reported_without_dropping_socket(alice, bob, carol):
    cid = direct_chat(alice, bob)
    with carol.ws() as c:
        c.send_json(
            {
                "type": "message.send",
                "data": {"conversation_id": cid, "client_id": "intruder-1", "body": "x"},
            }
        )
        err = recv_until(c, "error")
        assert err["detail"] == "Conversation not found"
        assert err["ref"]["client_id"] == "intruder-1"
        c.send_json({"type": "ping"})
        assert recv_until(c, "pong") is None


def test_malformed_frames_do_not_drop_socket(alice):
    with alice.ws() as ws:
        ws.send_text("{")
        assert recv_until(ws, "error")["detail"]
        ws.send_json(["receipt.read"])
        assert "object" in recv_until(ws, "error")["detail"]
        ws.send_json({"type": "receipt.delivered", "data": [1, 2]})
        assert "object" in recv_until(ws, "error")["detail"]
        ws.send_json({"type": "ping"})
        assert recv_until(ws, "pong") is None


def test_read_with_receipts_disabled_still_notifies_sender_of_delivery(alice, bob):
    cid = direct_chat(alice, bob)
    bob.patch("/api/me", json={"read_receipts_enabled": False})
    with alice.ws() as ws:
        msg = send(alice, cid, "received over REST")
        recv_until(ws, "message.new")
        bob.post(f"/api/conversations/{cid}/read", json={"up_to_id": msg["id"]})
        ws.send_json({"type": "ping"})
        frame = ws.receive_json()
        assert frame["type"] == "receipt.updated"
        assert frame["data"][0]["status"] == "delivered"


def test_blocking_also_blocks_direct_typing_events(alice, bob):
    cid = direct_chat(alice, bob)
    with alice.ws() as a, bob.ws() as b:
        a.send_json({"type": "ping"})
        recv_until(a, "pong")
        b.send_json({"type": "ping"})
        recv_until(b, "pong")
        bob.put(f"/api/blocks/{alice.id}")
        a.send_json({"type": "typing.start", "data": {"conversation_id": cid}})
        a.send_json({"type": "ping"})
        recv_until(a, "pong")
        b.send_json({"type": "ping"})
        assert b.receive_json()["type"] == "pong"


def test_new_group_member_cannot_receive_old_messages_or_reply_previews(alice, bob, carol):
    gid = alice.post(
        "/api/conversations", json={"type": "group", "name": "Private", "member_ids": [bob.id]}
    ).json()["id"]
    original = send(alice, gid, "before Carol joined")
    alice.post(f"/api/conversations/{gid}/members", json={"user_ids": [carol.id]})
    with carol.ws() as ws:
        alice.patch(f"/api/messages/{original['id']}", json={"body": "still private"})
        ws.send_json({"type": "ping"})
        assert ws.receive_json()["type"] == "pong"
        reply = send(alice, gid, "after Carol joined", reply_to_id=original["id"])
        assert reply["reply_to"]["body"] == "still private"
        incoming = recv_until(ws, "message.new")
        assert incoming["body"] == "after Carol joined"
        assert incoming["reply_to"] is None
    items = carol.get(f"/api/conversations/{gid}/messages").json()["items"]
    assert items[-1]["reply_to"] is None


def test_group_changes_are_pushed(alice, bob, carol):
    gid = alice.post(
        "/api/conversations", json={"type": "group", "name": "Crew", "member_ids": [bob.id]}
    ).json()["id"]
    with bob.ws() as b, carol.ws() as c:
        alice.post(f"/api/conversations/{gid}/members", json={"user_ids": [carol.id]})
        notice = recv_until(b, "message.new")
        assert notice["meta"] == {"event": "members_added", "targets": [carol.id]}
        conv = recv_until(c, "conversation.updated")
        assert conv["id"] == gid and conv["member_count"] == 3

        alice.patch(f"/api/conversations/{gid}", json={"name": "Crew 2"})
        assert recv_until(b, "message.new")["meta"]["event"] == "name_changed"
        assert recv_until(b, "conversation.updated")["name"] == "Crew 2"


def test_rejects_bad_token(client):
    import pytest
    from starlette.websockets import WebSocketDisconnect

    with pytest.raises(WebSocketDisconnect), client.websocket_connect("/ws?token=bad") as ws:
        ws.receive_json()
