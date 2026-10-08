from tests.conftest import direct_chat, send


def test_direct_chat_is_unique_per_pair(alice, bob):
    first = alice.post("/api/conversations", json={"type": "direct", "member_ids": [bob.id]})
    assert first.status_code == 201
    again = bob.post("/api/conversations", json={"type": "direct", "member_ids": [alice.id]})
    assert again.status_code == 200
    assert again.json()["id"] == first.json()["id"]
    assert again.json()["name"] == "Alice"
    assert again.json()["peer"]["id"] == alice.id


def test_note_to_self_can_be_reopened_after_deleting_chat(alice):
    note = next(c for c in alice.get("/api/conversations").json() if c["type"] == "note_to_self")
    send(alice, note["id"], "old note")
    alice.delete(f"/api/conversations/{note['id']}")
    assert not alice.get("/api/conversations").json()
    reopened = alice.post("/api/conversations", json={"type": "direct", "member_ids": [alice.id]})
    assert reopened.status_code == 200
    assert reopened.json()["id"] == note["id"]
    assert [c["id"] for c in alice.get("/api/conversations").json()] == [note["id"]]
    assert alice.get(f"/api/conversations/{note['id']}/messages").json()["items"] == []


def test_list_sorted_by_activity_with_unread_and_preview(alice, bob, carol):
    with_bob = direct_chat(alice, bob)
    with_carol = direct_chat(alice, carol)
    send(bob, with_bob, "older")
    send(carol, with_carol, "newer one")
    send(carol, with_carol, "newest")

    convs = alice.get("/api/conversations").json()
    ids = [c["id"] for c in convs]
    assert ids.index(with_carol) < ids.index(with_bob)
    carol_chat = next(c for c in convs if c["id"] == with_carol)
    assert carol_chat["unread_count"] == 2
    assert carol_chat["last_message"]["body"] == "newest"

    last_id = carol_chat["last_message"]["id"]
    assert (
        alice.post(f"/api/conversations/{with_carol}/read", json={"up_to_id": last_id}).status_code
        == 204
    )
    carol_chat = next(c for c in alice.get("/api/conversations").json() if c["id"] == with_carol)
    assert carol_chat["unread_count"] == 0


def test_settings_pin_archive_mute_mark_unread(alice, bob):
    cid = direct_chat(alice, bob)
    res = alice.patch(
        f"/api/conversations/{cid}/settings",
        json={"is_pinned": True, "mute_seconds": 3600, "marked_unread": True},
    )
    body = res.json()
    assert body["is_pinned"] and body["muted_until"] and body["marked_unread"]
    # Bob's view is unaffected.
    bob_view = next(c for c in bob.get("/api/conversations").json() if c["id"] == cid)
    assert not bob_view["is_pinned"] and bob_view["muted_until"] is None

    body = alice.patch(f"/api/conversations/{cid}/settings", json={"is_archived": True}).json()
    assert body["is_archived"] and not body["is_pinned"]


def test_new_message_unarchives(alice, bob):
    cid = direct_chat(alice, bob)
    alice.patch(f"/api/conversations/{cid}/settings", json={"is_archived": True})
    send(bob, cid, "ping")
    view = next(c for c in alice.get("/api/conversations").json() if c["id"] == cid)
    assert view["is_archived"] is False


def test_delete_chat_hides_history_until_new_message(alice, bob):
    cid = direct_chat(alice, bob)
    send(bob, cid, "secret")
    assert alice.delete(f"/api/conversations/{cid}").status_code == 204
    assert cid not in [c["id"] for c in alice.get("/api/conversations").json()]
    send(bob, cid, "hello again")
    assert cid in [c["id"] for c in alice.get("/api/conversations").json()]
    bodies = [m["body"] for m in alice.get(f"/api/conversations/{cid}/messages").json()["items"]]
    assert bodies == ["hello again"]


def test_group_admin_controls(alice, bob, carol):
    res = alice.post(
        "/api/conversations", json={"type": "group", "name": "Hikers", "member_ids": [bob.id]}
    )
    assert res.status_code == 201
    gid = res.json()["id"]
    assert res.json()["my_role"] == "admin"

    # Members can't manage membership.
    assert (
        bob.post(f"/api/conversations/{gid}/members", json={"user_ids": [carol.id]}).status_code
        == 403
    )
    assert bob.delete(f"/api/conversations/{gid}/members/{alice.id}").status_code == 403

    detail = alice.post(f"/api/conversations/{gid}/members", json={"user_ids": [carol.id]}).json()
    assert {m["user"]["id"] for m in detail["members"]} == {alice.id, bob.id, carol.id}

    detail = alice.patch(
        f"/api/conversations/{gid}/members/{bob.id}", json={"role": "admin"}
    ).json()
    assert next(m for m in detail["members"] if m["user"]["id"] == bob.id)["role"] == "admin"

    detail = bob.delete(f"/api/conversations/{gid}/members/{carol.id}").json()
    assert carol.id not in {m["user"]["id"] for m in detail["members"]}
    # Carol keeps the chat (and its history) but can no longer post.
    carol_view = carol.get(f"/api/conversations/{gid}").json()
    assert carol_view["is_member"] is False
    res = carol.post(
        f"/api/conversations/{gid}/messages",
        json={"client_id": "carol-after-removal", "body": "hi"},
    )
    assert res.status_code == 403

    events = [
        m["meta"]["event"] for m in alice.get(f"/api/conversations/{gid}/messages").json()["items"]
    ]
    assert events == ["group_created", "members_added", "role_changed", "member_removed"]


def test_last_admin_leaving_promotes_someone(alice, bob):
    gid = alice.post(
        "/api/conversations", json={"type": "group", "name": "G", "member_ids": [bob.id]}
    ).json()["id"]
    assert alice.post(f"/api/conversations/{gid}/leave").status_code == 200
    assert bob.get(f"/api/conversations/{gid}").json()["my_role"] == "admin"


def test_new_members_do_not_see_earlier_history(alice, bob, carol):
    gid = alice.post(
        "/api/conversations", json={"type": "group", "name": "G", "member_ids": [bob.id]}
    ).json()["id"]
    send(alice, gid, "before carol")
    alice.post(f"/api/conversations/{gid}/members", json={"user_ids": [carol.id]})
    send(alice, gid, "after carol")
    bodies = [
        m["body"]
        for m in carol.get(f"/api/conversations/{gid}/messages").json()["items"]
        if m["type"] == "text"
    ]
    assert bodies == ["after carol"]


def test_non_member_cannot_read(alice, bob, carol):
    cid = direct_chat(alice, bob)
    assert carol.get(f"/api/conversations/{cid}/messages").status_code == 404
    assert carol.get(f"/api/conversations/{cid}").status_code == 404


def test_group_requires_name(alice, bob):
    res = alice.post(
        "/api/conversations", json={"type": "group", "name": " ", "member_ids": [bob.id]}
    )
    assert res.status_code == 400


def test_group_update_validates_name_and_avatar_color(alice, bob):
    gid = alice.post(
        "/api/conversations", json={"type": "group", "name": "Crew", "member_ids": [bob.id]}
    ).json()["id"]
    assert alice.patch(f"/api/conversations/{gid}", json={"name": " "}).status_code == 422
    assert (
        alice.patch(f"/api/conversations/{gid}", json={"avatar_color": "unknown"}).status_code
        == 422
    )
    assert alice.get(f"/api/conversations/{gid}").json()["name"] == "Crew"


def test_member_add_rejects_unknown_users_without_partial_changes(alice, bob, carol):
    gid = alice.post(
        "/api/conversations", json={"type": "group", "name": "Crew", "member_ids": [bob.id]}
    ).json()["id"]
    res = alice.post(f"/api/conversations/{gid}/members", json={"user_ids": [carol.id, 999999]})
    assert res.status_code == 400
    assert {m["user"]["id"] for m in alice.get(f"/api/conversations/{gid}").json()["members"]} == {
        alice.id,
        bob.id,
    }
