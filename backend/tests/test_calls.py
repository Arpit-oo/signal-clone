from uuid import uuid4

from tests.conftest import direct_chat, recv_until


def invite(ws, cid, *, kind="voice"):
    call_id = str(uuid4())
    ws.send_json(
        {
            "type": "call.invite",
            "data": {
                "call_id": call_id,
                "conversation_id": cid,
                "kind": kind,
                "offer": {"type": "offer", "sdp": "v=0\r\n"},
            },
        }
    )
    return call_id


def frame(ws, type_, call_id, **data):
    ws.send_json({"type": type_, "data": {"call_id": call_id, **data}})


def test_call_signaling_and_hangup(alice, bob):
    cid = direct_chat(alice, bob)
    with alice.ws() as a, bob.ws() as b:
        call_id = invite(a, cid, kind="video")
        assert recv_until(a, "call.ringing")["call_id"] == call_id
        incoming = recv_until(b, "call.incoming")
        assert incoming["caller"]["id"] == alice.id
        assert incoming["kind"] == "video"
        frame(b, "call.accept", call_id)
        assert recv_until(a, "call.accepted")["call_id"] == call_id
        assert recv_until(b, "call.accepted")["call_id"] == call_id
        answer = {"type": "answer", "sdp": "v=0\r\nanswer"}
        frame(b, "call.signal", call_id, description=answer)
        assert recv_until(a, "call.signal")["description"] == answer
        candidate = {"candidate": "candidate:host", "sdpMid": "0", "sdpMLineIndex": 0}
        frame(a, "call.signal", call_id, candidate=candidate)
        assert recv_until(b, "call.signal")["candidate"] == candidate
        frame(a, "call.connected", call_id)
        frame(b, "call.end", call_id)
        assert recv_until(a, "call.ended")["reason"] == "hangup"
        assert recv_until(b, "call.ended")["reason"] == "hangup"


def test_calls_reject_outsiders_and_socket_hijacks(alice, bob, carol):
    cid = direct_chat(alice, bob)
    with alice.ws() as a, bob.ws() as b, carol.ws() as c, alice.ws() as other:
        call_id = invite(a, cid)
        recv_until(a, "call.ringing")
        recv_until(b, "call.incoming")
        for socket in (c, other):
            for event in ("call.accept", "call.signal", "call.end"):
                frame(socket, event, call_id, candidate={"candidate": "bad"})
                assert "another session" in recv_until(socket, "error")["detail"]
        frame(b, "call.end", call_id, reason="declined")
        assert recv_until(a, "call.ended")["reason"] == "declined"


def test_only_first_callee_tab_can_accept(alice, bob):
    cid = direct_chat(alice, bob)
    with alice.ws() as a, bob.ws() as b, bob.ws() as other:
        call_id = invite(a, cid)
        recv_until(a, "call.ringing")
        recv_until(b, "call.incoming")
        recv_until(other, "call.incoming")
        frame(b, "call.accept", call_id)
        recv_until(b, "call.accepted")
        assert recv_until(other, "call.dismissed")["call_id"] == call_id
        frame(other, "call.accept", call_id)
        assert "another session" in recv_until(other, "error")["detail"]
        frame(other, "call.signal", call_id, candidate={"candidate": "bad"})
        assert "another session" in recv_until(other, "error")["detail"]


def test_call_owner_disconnect_ends_call_even_when_another_tab_is_online(alice, bob):
    cid = direct_chat(alice, bob)
    with bob.ws() as b, alice.ws() as other:
        with alice.ws() as a:
            call_id = invite(a, cid)
            recv_until(a, "call.ringing")
            recv_until(b, "call.incoming")
            frame(b, "call.accept", call_id)
            recv_until(b, "call.accepted")
        assert recv_until(b, "call.ended")["reason"] == "disconnected"
        other.send_json({"type": "ping", "data": {}})
        recv_until(other, "pong")


def test_offline_busy_blocked_and_group_calls_are_rejected(alice, bob, carol):
    cid = direct_chat(alice, bob)
    other_cid = direct_chat(carol, bob)
    gid = alice.post(
        "/api/conversations", json={"type": "group", "name": "Team", "member_ids": [bob.id]}
    ).json()["id"]
    with alice.ws() as a:
        invite(a, cid)
        assert "offline" in recv_until(a, "error")["detail"]
        with bob.ws() as b, carol.ws() as c:
            invite(c, cid)
            assert recv_until(c, "error")
            invite(a, gid)
            assert "one-to-one" in recv_until(a, "error")["detail"]
            call_id = invite(a, cid)
            recv_until(a, "call.ringing")
            recv_until(b, "call.incoming")
            invite(c, other_cid)
            assert "already in a call" in recv_until(c, "error")["detail"]
            frame(b, "call.end", call_id, reason="declined")
            recv_until(a, "call.ended")
            assert alice.put(f"/api/blocks/{bob.id}").status_code == 200
            invite(a, cid)
            assert "can't message" in recv_until(a, "error")["detail"]


def test_unanswered_calls_expire_and_release_busy_state(client, alice, bob):
    from app.ws.calls import calls

    cid = direct_chat(alice, bob)
    with alice.ws() as a, bob.ws() as b:
        call_id = invite(a, cid)
        recv_until(a, "call.ringing")
        recv_until(b, "call.incoming")

        async def expire():
            calls.calls[call_id].deadline = 0
            await calls.expire()

        client.portal.call(expire)
        assert recv_until(a, "call.ended")["reason"] == "no_answer"
        recv_until(b, "call.ended")
        invite(a, cid)
        recv_until(a, "call.ringing")
        recv_until(b, "call.incoming")


def test_call_signal_bounds_and_answer_order(alice, bob):
    cid = direct_chat(alice, bob)
    with alice.ws() as a, bob.ws() as b:
        call_id = invite(a, cid)
        recv_until(a, "call.ringing")
        recv_until(b, "call.incoming")
        frame(a, "call.signal", call_id, candidate={"candidate": "early"})
        assert "not been accepted" in recv_until(a, "error")["detail"]
        frame(b, "call.accept", call_id)
        recv_until(a, "call.accepted")
        recv_until(b, "call.accepted")
        frame(a, "call.signal", call_id, description={"type": "answer", "sdp": "bad"})
        assert "Unexpected" in recv_until(a, "error")["detail"]
        frame(b, "call.signal", call_id, candidate={"candidate": "x" * 5000})
        assert recv_until(b, "error")
        b.send_json({"type": "ping", "data": {}})
        recv_until(b, "pong")
