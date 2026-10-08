import asyncio
import io
import json
import os
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta
from threading import Barrier

import pytest
from PIL import Image
from sqlalchemy import func, select

from app.core.config import BASE_DIR
from app.db.session import SessionLocal
from app.models import Attachment, Story, StoryRecipient, StoryView
from app.services import storage
from app.ws.background import sweep_once
from tests.conftest import recv_until


def _image():
    buf = io.BytesIO()
    Image.new("RGB", (8, 6), "red").save(buf, "PNG")
    return buf.getvalue()


def _post(author, recipients, body="Hello story", file=None, **extra):
    data = {"body": body, "recipient_ids": json.dumps(recipients), **extra}
    return author.post("/api/stories", data=data, files={"file": file} if file else None)


def test_text_story_selected_audience_and_idempotent_views(alice, bob, carol):
    created = _post(alice, [bob.id, bob.id], "  A private update  ", color="#12abEF")
    assert created.status_code == 201, created.text
    story = created.json()
    sid = story["id"]
    assert story["kind"] == "text" and story["body"] == "A private update"
    assert story["color"] == "#12ABEF" and story["media"] is None
    assert story["is_own"] and story["view_count"] == 0 and story["recipient_ids"] == [bob.id]
    assert datetime.fromisoformat(story["expires_at"]) - datetime.fromisoformat(
        story["created_at"]
    ) == timedelta(hours=24)
    assert alice.get("/api/stories").json()[0]["id"] == sid
    view = bob.get("/api/stories").json()[0]
    assert view["author"]["id"] == alice.id and not view["is_own"]
    assert (
        view["view_count"] is None and view["recipient_ids"] is None and view["viewed_at"] is None
    )
    assert carol.get("/api/stories").json() == []
    assert carol.post(f"/api/stories/{sid}/views").status_code == 404
    assert bob.get(f"/api/stories/{sid}/views").status_code == 403
    assert bob.delete(f"/api/stories/{sid}").status_code == 403
    assert alice.post(f"/api/stories/{sid}/views").status_code == 204
    assert alice.get(f"/api/stories/{sid}/views").json() == []
    assert bob.post(f"/api/stories/{sid}/views").status_code == 204
    seen_at = bob.get("/api/stories").json()[0]["viewed_at"]
    assert seen_at is not None
    assert bob.post(f"/api/stories/{sid}/views").status_code == 204
    assert bob.get("/api/stories").json()[0]["viewed_at"] == seen_at
    viewers = alice.get(f"/api/stories/{sid}/views").json()
    assert len(viewers) == 1 and viewers[0]["user"]["id"] == bob.id
    assert viewers[0]["viewed_at"] == seen_at
    assert alice.get("/api/stories").json()[0]["view_count"] == 1
    assert bob.get(f"/api/stories/{sid}/media").status_code == 404


@pytest.mark.parametrize("blocked_by", ["author", "viewer"])
def test_blocking_in_either_direction_hides_story_and_prevents_new_share(alice, bob, blocked_by):
    sid = _post(alice, [bob.id], file=("photo.png", _image(), "image/png")).json()["id"]
    assert bob.post(f"/api/stories/{sid}/views").status_code == 204
    blocker, target = (alice, bob) if blocked_by == "author" else (bob, alice)
    assert blocker.put(f"/api/blocks/{target.id}").status_code == 200
    assert bob.get("/api/stories").json() == []
    assert bob.get(f"/api/stories/{sid}/media").status_code == 404
    assert bob.post(f"/api/stories/{sid}/views").status_code == 404
    assert alice.get(f"/api/stories/{sid}/views").json() == []
    assert alice.get("/api/stories").json()[0]["view_count"] == 0
    assert _post(alice, [bob.id]).status_code == 400


def test_disabled_receipts_keep_seen_marker_but_hide_identity_count_and_notification(alice, bob):
    sid = _post(alice, [bob.id]).json()["id"]
    bob.patch("/api/me", json={"read_receipts_enabled": False})
    with alice.ws() as ws:
        assert bob.post(f"/api/stories/{sid}/views").status_code == 204
        ws.send_json({"type": "ping"})
        assert ws.receive_json()["type"] == "pong"
    assert bob.get("/api/stories").json()[0]["viewed_at"] is not None
    assert alice.get("/api/stories").json()[0]["view_count"] == 0
    assert alice.get(f"/api/stories/{sid}/views").json() == []
    bob.patch("/api/me", json={"read_receipts_enabled": True})
    assert alice.get("/api/stories").json()[0]["view_count"] == 1
    alice.patch("/api/me", json={"read_receipts_enabled": False})
    assert alice.get("/api/stories").json()[0]["view_count"] is None
    assert alice.get(f"/api/stories/{sid}/views").json() == []


def test_story_media_requires_auth_and_audience_and_delete_cleans_file(alice, bob, carol, client):
    created = _post(alice, [bob.id], file=("misleading.html", _image(), "image/png"))
    assert created.status_code == 201, created.text
    story = created.json()
    assert (
        story["kind"] == "image" and story["media"]["width"] == 8 and story["media"]["height"] == 6
    )
    url = story["media"]["url"]
    assert client.get(url).status_code == 401
    assert carol.get(url).status_code == 404
    assert bob.get(url).content == _image()
    assert client.get(url, params={"token": bob.token}).status_code == 200
    assert bob.get(url).headers["cache-control"] == "private, no-store"
    assert bob.get(url).headers["x-content-type-options"] == "nosniff"

    async def state():
        async with SessionLocal() as db:
            stored = await db.get(Story, story["id"])
            count = await db.scalar(select(func.count()).select_from(Attachment))
            return stored.storage_key, count

    key, attachment_count = asyncio.run(state())
    assert key.startswith("stories/") and attachment_count == 0
    assert storage.path_for(key).is_file()
    assert client.get(f"/api/media/{key}").status_code == 404
    for traversal in (f"avatars%2f..%2f{key}", f"avatars%2f..%5c{key}"):
        assert client.get(f"/api/media/{traversal}").status_code == 404
    assert bob.post(f"/api/stories/{story['id']}/views").status_code == 204
    assert alice.delete(f"/api/stories/{story['id']}").status_code == 204
    assert not storage.path_for(key).exists()
    assert bob.get(url).status_code == 404
    assert bob.get("/api/stories").json() == []

    async def counts():
        async with SessionLocal() as db:
            return [
                await db.scalar(select(func.count()).select_from(model))
                for model in (Story, StoryRecipient, StoryView)
            ]

    assert asyncio.run(counts()) == [0, 0, 0]


def test_expiry_hides_immediately_and_sweeper_removes_rows_and_file(alice, bob, monkeypatch):
    story = _post(alice, [bob.id], file=("photo.png", _image(), "image/png")).json()
    sid = story["id"]
    bob.post(f"/api/stories/{sid}/views")
    from app.services import stories as stories_svc

    async def stored_path():
        async with SessionLocal() as db:
            row = await db.get(Story, sid)
            return storage.path_for(row.storage_key)

    path = asyncio.run(stored_path())
    future = datetime.fromisoformat(story["expires_at"]) + timedelta(seconds=1)
    monkeypatch.setattr(stories_svc, "utcnow", lambda: future)
    assert alice.get("/api/stories").json() == []
    assert bob.get("/api/stories").json() == []
    assert bob.get(story["media"]["url"]).status_code == 404
    assert bob.post(f"/api/stories/{sid}/views").status_code == 404
    assert alice.get(f"/api/stories/{sid}/views").status_code == 404

    async def purge():
        # The running background sweep may already have purged the story after
        # the clock advanced; repeated cleanup must be safe either way.
        await sweep_once()
        async with SessionLocal() as db:
            assert await db.get(Story, sid) is None
            assert await db.scalar(select(func.count()).select_from(StoryView)) == 0
        assert not path.exists()

    asyncio.run(purge())


def test_concurrent_view_receipts_keep_one_original_receipt(alice, bob):
    sid = _post(alice, [bob.id]).json()["id"]
    barrier = Barrier(4)

    def view(_):
        barrier.wait(timeout=5)
        return bob.post(f"/api/stories/{sid}/views")

    with ThreadPoolExecutor(max_workers=4) as pool:
        assert [r.status_code for r in pool.map(view, range(4))] == [204] * 4
    viewers = alice.get(f"/api/stories/{sid}/views").json()
    assert len(viewers) == 1
    assert alice.get("/api/stories").json()[0]["view_count"] == 1


def test_story_events_contain_no_content_or_viewer_identity(alice, bob, carol):
    with alice.ws() as author, bob.ws() as audience, carol.ws() as outsider:
        created = _post(alice, [bob.id], "Private story text").json()
        event = {"story_id": created["id"]}
        assert recv_until(author, "story.changed") == event
        assert recv_until(audience, "story.changed") == event
        outsider.send_json({"type": "ping"})
        assert outsider.receive_json()["type"] == "pong"
        bob.post(f"/api/stories/{created['id']}/views")
        assert recv_until(author, "story.changed") == event
        assert recv_until(audience, "story.changed") == event
        alice.delete(f"/api/stories/{created['id']}")
        assert recv_until(author, "story.changed") == event
        assert recv_until(audience, "story.changed") == event


def test_story_validation_is_atomic_and_does_not_leave_uploads(alice, bob, client):
    assert client.get("/api/stories").status_code == 401
    for audience, body, extra, expected in [
        ([], "Text", {}, 422),
        ([alice.id], "Text", {}, 400),
        ([bob.id, 999999], "Text", {}, 400),
        ([bob.id], "  ", {}, 400),
        ([0], "Text", {}, 422),
        ([bob.id], "Text", {"color": "red"}, 422),
        ([bob.id], "x" * 2001, {}, 422),
    ]:
        assert _post(alice, audience, body, **extra).status_code == expected
    assert (
        alice.post("/api/stories", data={"recipient_ids": "not-json", "body": "Text"}).status_code
        == 400
    )
    assert _post(alice, [999999], file=("photo.png", _image(), "image/png")).status_code == 400
    unfinished = client.post(
        "/api/auth/verify", json={"phone": "+15559990000", "code": "123456"}
    ).json()["user"]["id"]
    assert _post(alice, [unfinished], file=("photo.png", _image(), "image/png")).status_code == 400
    assert alice.get("/api/stories").json() == []


@pytest.mark.parametrize(
    "mime,data",
    [
        ("text/html", b"<html>unsafe</html>"),
        ("image/svg+xml", b"<svg/>"),
        ("image/png", b"not an image"),
        ("image/jpeg", _image()),
        ("video/mp4", b"not a video"),
        ("video/webm", b"not a video"),
        ("video/quicktime", b"not a video"),
        ("image/png", b""),
    ],
)
def test_story_rejects_unverified_or_unsupported_media(alice, bob, mime, data):
    assert _post(alice, [bob.id], file=("file", data, mime)).status_code == 400
    assert alice.get("/api/stories").json() == []


@pytest.mark.parametrize(
    "mime,data",
    [
        (
            "video/mp4",
            b"\x00\x00\x00\x14ftypisom\x00\x00\x00\x00isom"
            b"\x00\x00\x00\x08moov\x00\x00\x00\x0cmdatdata",
        ),
        ("video/webm", b"\x1a\x45\xdf\xa3\x87\x42\x82\x84webm\x18\x53\x80\x67\xffdata"),
    ],
)
def test_supported_video_containers_are_private_and_size_bounded(
    alice, bob, mime, data, monkeypatch
):
    story = _post(alice, [bob.id], "Video caption", file=("clip", data, mime))
    assert story.status_code == 201, story.text
    assert story.json()["kind"] == "video"
    assert bob.get(story.json()["media"]["url"]).content == data
    monkeypatch.setattr(storage.settings, "max_upload_bytes", 10)
    assert _post(alice, [bob.id], file=("clip", data, mime)).status_code == 400


def test_stories_audience_views_and_media_survive_process_restart(tmp_path):
    env = {
        **os.environ,
        "DATABASE_URL": f"sqlite+aiosqlite:///{(tmp_path / 'stories.db').as_posix()}",
        "UPLOAD_DIR": str(tmp_path / "uploads"),
        "AUTO_MIGRATE_ON_STARTUP": "true",
        "SEED_ON_STARTUP": "false",
    }
    setup = """
import io
import json
from PIL import Image
from fastapi.testclient import TestClient
from app.main import app

with TestClient(app) as client:
    def register(phone, name):
        auth = client.post('/api/auth/verify', json={'phone': phone, 'code': '123456'})
        assert auth.status_code == 200, auth.text
        headers = {'Authorization': 'Bearer ' + auth.json()['token']}
        profile = client.patch('/api/me', headers=headers, json={'display_name': name})
        assert profile.status_code == 200, profile.text
        return headers, profile.json()['id']
    alice, alice_id = register('+919876543210', 'Piyush')
    bob, bob_id = register('+447700900123', 'Jane')
    carol, _ = register('+15552223333', 'Carol')
    picture = io.BytesIO()
    Image.new('RGB', (8, 6), 'red').save(picture, 'PNG')
    created = client.post('/api/stories', headers=alice,
        data={'body': 'Saved story', 'recipient_ids': json.dumps([bob_id])},
        files={'file': ('photo.png', picture.getvalue(), 'image/png')})
    assert created.status_code == 201, created.text
    story = created.json()
    seen = client.post(f"/api/stories/{story['id']}/views", headers=bob)
    assert seen.status_code == 204, seen.text
    assert client.get('/api/stories', headers=carol).json() == []
    viewed_at = client.get('/api/stories', headers=bob).json()[0]['viewed_at']
    print(json.dumps({'alice': alice, 'bob': bob, 'carol': carol,
        'bob_id': bob_id, 'story': story, 'viewed_at': viewed_at}))
"""
    first = subprocess.run(
        [sys.executable, "-c", setup],
        cwd=BASE_DIR,
        env=env,
        capture_output=True,
        text=True,
        timeout=30,
        check=False,
    )
    assert first.returncode == 0, first.stderr
    state = json.loads(first.stdout)
    restore = """
import io
import json
import os
from PIL import Image
from fastapi.testclient import TestClient
from app.main import app

state = json.loads(os.environ['TEST_STORY'])
with TestClient(app) as client:
    alice, bob, carol = state['alice'], state['bob'], state['carol']
    story = state['story']
    own = client.get('/api/stories', headers=alice).json()
    assert len(own) == 1 and own[0]['id'] == story['id']
    assert own[0]['body'] == 'Saved story' and own[0]['view_count'] == 1
    assert own[0]['recipient_ids'] == [state['bob_id']]
    assert own[0]['expires_at'] == story['expires_at']
    audience = client.get('/api/stories', headers=bob).json()
    assert len(audience) == 1 and audience[0]['viewed_at'] == state['viewed_at']
    assert client.get('/api/stories', headers=carol).json() == []
    views = client.get(f"/api/stories/{story['id']}/views", headers=alice).json()
    assert len(views) == 1 and views[0]['user']['id'] == state['bob_id']
    assert views[0]['viewed_at'] == state['viewed_at']
    assert client.post(f"/api/stories/{story['id']}/views", headers=bob).status_code == 204
    assert client.get('/api/stories', headers=alice).json()[0]['view_count'] == 1
    media = client.get(story['media']['url'], headers=bob)
    assert media.status_code == 200, media.text
    with Image.open(io.BytesIO(media.content)) as image:
        assert image.size == (8, 6)
    assert client.get(story['media']['url'], headers=carol).status_code == 404
    assert client.delete(f"/api/stories/{story['id']}", headers=alice).status_code == 204
    assert client.get(story['media']['url'], headers=bob).status_code == 404
    print('ok')
"""
    second = subprocess.run(
        [sys.executable, "-c", restore],
        cwd=BASE_DIR,
        env={**env, "TEST_STORY": json.dumps(state)},
        capture_output=True,
        text=True,
        timeout=30,
        check=False,
    )
    assert second.returncode == 0, second.stderr
    assert second.stdout.strip() == "ok"
