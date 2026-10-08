from tests.conftest import direct_chat, send


def test_search_matches_contact_nicknames_and_chat_usernames(alice, bob, carol):
    bob.patch("/api/me", json={"username": "robert_chat"})
    cid = direct_chat(alice, bob)
    alice.post("/api/contacts", json={"user_id": bob.id, "nickname": "Work buddy"})
    alice.post("/api/contacts", json={"user_id": carol.id, "nickname": "Climbing friend"})
    for q in ("@robert_chat", "buddy", "Bob"):
        result = alice.get("/api/search", params={"q": q}).json()
        assert [c["id"] for c in result["conversations"]] == [cid]
        assert not result["contacts"]
    assert [p["id"] for p in alice.get("/api/users/search", params={"q": "Climbing"}).json()] == [
        carol.id
    ]
    assert [
        p["id"] for p in alice.get("/api/search", params={"q": "friend"}).json()["contacts"]
    ] == [carol.id]
    assert bob.get("/api/users/search", params={"q": "Climbing"}).json() == []


def test_search_treats_sql_wildcards_as_literal_text(alice, bob):
    cid = direct_chat(alice, bob)
    send(bob, cid, "50% off")
    send(bob, cid, "ordinary offer")
    messages = alice.get("/api/search", params={"q": "% off"}).json()["messages"]
    assert [m["body"] for m in messages] == ["50% off"]
    assert alice.get("/api/users/search", params={"q": "_"}).json() == []
