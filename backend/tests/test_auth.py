def test_otp_flow_creates_user_and_note_to_self(client):
    res = client.post("/api/auth/request-otp", json={"phone": "+1 (555) 222-3333"})
    assert res.status_code == 200
    assert res.json() == {"phone": "+15552223333", "dev_code": "123456"}

    res = client.post("/api/auth/verify", json={"phone": "+15552223333", "code": "123456"})
    body = res.json()
    assert res.status_code == 200
    assert body["is_new"] is True
    headers = {"Authorization": f"Bearer {body['token']}"}

    convs = client.get("/api/conversations", headers=headers).json()
    assert [c["type"] for c in convs] == ["note_to_self"]
    assert convs[0]["name"] == "Note to Self"


def test_wrong_code_rejected(client):
    res = client.post("/api/auth/verify", json={"phone": "+15552223333", "code": "000000"})
    assert res.status_code == 400


def test_invalid_phone_rejected(client):
    res = client.post("/api/auth/request-otp", json={"phone": "abc"})
    assert res.status_code == 422


def test_returning_user_is_not_new_once_named(client, alice):
    res = client.post("/api/auth/verify", json={"phone": alice.phone, "code": "123456"})
    assert res.json()["is_new"] is False
    assert res.json()["user"]["id"] == alice.id


def test_requires_token(client):
    assert client.get("/api/me").status_code == 401
    bad = {"Authorization": "Bearer nope"}
    assert client.get("/api/me", headers=bad).status_code == 401


def test_profile_update_and_username_uniqueness(alice, bob):
    res = alice.patch("/api/me", json={"username": "Alice_1", "about": "hi"})
    assert res.status_code == 200
    assert res.json()["username"] == "alice_1"
    assert bob.patch("/api/me", json={"username": "alice_1"}).status_code == 409
    assert bob.patch("/api/me", json={"username": "1bad"}).status_code == 422
    assert bob.patch("/api/me", json={"avatar_color": "Z999"}).status_code == 422


def test_required_profile_fields_reject_null_without_changing_profile(alice):
    for field in (
        "display_name",
        "about",
        "avatar_color",
        "read_receipts_enabled",
        "typing_indicators_enabled",
    ):
        assert alice.patch("/api/me", json={field: None}).status_code == 422
    assert alice.get("/api/me").json()["display_name"] == "Alice"
    assert alice.patch("/api/me", json={"username": None, "about_emoji": None}).status_code == 200
