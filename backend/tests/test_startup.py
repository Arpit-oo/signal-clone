import json
import os
import subprocess
import sys
from pathlib import Path

import pytest
from sqlalchemy.engine import make_url

from app.core.config import BASE_DIR, Settings


def test_relative_data_paths_resolve_from_backend_directory():
    settings = Settings(
        _env_file=None,
        database_url="sqlite+aiosqlite:///./data/custom.db",
        upload_dir=Path("data/custom-uploads"),
    )
    assert make_url(settings.database_url).database == (BASE_DIR / "data/custom.db").as_posix()
    assert settings.upload_dir == BASE_DIR / "data/custom-uploads"


@pytest.mark.parametrize("relative", [False, True])
def test_fresh_startup_migrates_and_seeds_once(tmp_path, relative):
    database = tmp_path / "nested folder" / "signal.db"
    path = Path(os.path.relpath(database, BASE_DIR)) if relative else database
    env = {
        **os.environ,
        "DATABASE_URL": f"sqlite+aiosqlite:///{path.as_posix()}",
        "UPLOAD_DIR": str(tmp_path / "uploads"),
        "AUTO_MIGRATE_ON_STARTUP": "true",
        "SEED_ON_STARTUP": "true",
    }
    script = """
import json
from fastapi.testclient import TestClient
from app.main import app

with TestClient(app) as client:
    assert client.get('/health').json() == {'status': 'ok'}
    login = client.post('/api/auth/verify', json={'phone': '+15550000001', 'code': '123456'})
    assert login.status_code == 200, login.text
    headers = {'Authorization': 'Bearer ' + login.json()['token']}
    conversations = client.get('/api/conversations', headers=headers)
    assert conversations.status_code == 200, conversations.text
    print(json.dumps({'user': login.json()['user'], 'conversations': conversations.json()}))
"""
    runs = [
        subprocess.run(
            [sys.executable, "-c", script],
            cwd=Path(__file__).resolve().parents[1],
            env=env,
            capture_output=True,
            text=True,
            timeout=30,
            check=False,
        )
        for _ in range(2)
    ]
    for result in runs:
        assert result.returncode == 0, result.stderr
    first, second = [json.loads(result.stdout) for result in runs]
    assert database.exists()
    assert first["user"]["display_name"] == "Alex Rivera"
    assert second["user"]["id"] == first["user"]["id"]
    assert len(first["conversations"]) > 5
    assert [c["id"] for c in second["conversations"]] == [c["id"] for c in first["conversations"]]


def test_new_account_messages_and_private_pins_survive_process_restart(tmp_path):
    database = tmp_path / "fresh accounts.db"
    env = {
        **os.environ,
        "DATABASE_URL": f"sqlite+aiosqlite:///{database.as_posix()}",
        "UPLOAD_DIR": str(tmp_path / "uploads"),
        "AUTO_MIGRATE_ON_STARTUP": "true",
        "SEED_ON_STARTUP": "false",
    }
    setup = """
import json
from fastapi.testclient import TestClient
from app.main import app

with TestClient(app) as client:
    def signup(phone, name):
        auth = client.post('/api/auth/verify', json={'phone': phone, 'code': '123456'})
        assert auth.status_code == 200, auth.text
        headers = {'Authorization': 'Bearer ' + auth.json()['token']}
        profile = client.patch('/api/me', headers=headers, json={'display_name': name})
        assert profile.status_code == 200, profile.text
        return auth.json()['user']['id'], headers

    alice_id, alice = signup('+91 (98765) 43210', 'Piyush')
    bob_id, bob = signup('+44 (7700) 900123', 'Jane')
    assert client.get('/api/contacts', headers=alice).json() == []
    direct = client.post('/api/conversations', headers=alice,
        json={'type': 'direct', 'member_ids': [bob_id]})
    assert direct.status_code == 201, direct.text
    cid = direct.json()['id']
    group = client.post('/api/conversations', headers=alice,
        json={'type': 'group', 'name': 'New friends', 'member_ids': [bob_id]})
    assert group.status_code == 201, group.text
    gid = group.json()['id']
    for conversation_id, headers, client_id, body in [
        (cid, alice, 'persistent-direct', 'Remember this message'),
        (gid, bob, 'persistent-group', 'Group message survives'),
    ]:
        sent = client.post(f'/api/conversations/{conversation_id}/messages', headers=headers,
            json={'client_id': client_id, 'body': body})
        assert sent.status_code == 201, sent.text
    pinned = client.patch(f'/api/conversations/{cid}/settings', headers=alice,
        json={'is_pinned': True})
    assert pinned.status_code == 200 and pinned.json()['is_pinned'], pinned.text
    assert not client.get(f'/api/conversations/{cid}', headers=bob).json()['is_pinned']
    print(json.dumps({'user_id': alice_id, 'direct_id': cid, 'group_id': gid,
        'alice': alice, 'bob': bob}))
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
    # A separate interpreter proves database persistence and use of the original
    # access token, rather than retention in the realtime manager or TestClient.
    restored_env = {**env, "TEST_STATE": json.dumps(state)}
    restore = """
import json
import os
from fastapi.testclient import TestClient
from app.main import app

state = json.loads(os.environ['TEST_STATE'])
with TestClient(app) as client:
    alice, bob = state['alice'], state['bob']
    assert client.get('/api/me', headers=alice).json()['id'] == state['user_id']
    cid, gid = state['direct_id'], state['group_id']
    assert client.get(f'/api/conversations/{cid}', headers=alice).json()['is_pinned']
    assert not client.get(f'/api/conversations/{cid}', headers=bob).json()['is_pinned']
    for conversation_id, body in [(cid, 'Remember this message'), (gid, 'Group message survives')]:
        page = client.get(f'/api/conversations/{conversation_id}/messages', headers=alice)
        assert page.status_code == 200, page.text
        assert page.json()['items'][-1]['body'] == body
    login = client.post('/api/auth/verify', json={'phone': '+919876543210', 'code': '123456'})
    assert login.status_code == 200 and not login.json()['is_new'], login.text
    new_headers = {'Authorization': 'Bearer ' + login.json()['token']}
    assert client.get(f'/api/conversations/{cid}', headers=new_headers).json()['is_pinned']
    all_chats = client.get('/api/conversations', headers=new_headers).json()
    assert len(all_chats) == 3
    assert len([c for c in all_chats if c['type'] == 'note_to_self']) == 1
    print('ok')
"""
    second = subprocess.run(
        [sys.executable, "-c", restore],
        cwd=BASE_DIR,
        env=restored_env,
        capture_output=True,
        text=True,
        timeout=30,
        check=False,
    )
    assert second.returncode == 0, second.stderr
    assert second.stdout.strip() == "ok"


def test_conversation_identity_migration_preserves_legacy_duplicates_and_settings(tmp_path):
    database = tmp_path / "legacy.db"
    env = {
        **os.environ,
        "DATABASE_URL": f"sqlite+aiosqlite:///{database.as_posix()}",
        "UPLOAD_DIR": str(tmp_path / "uploads"),
        "AUTO_MIGRATE_ON_STARTUP": "true",
        "SEED_ON_STARTUP": "false",
    }
    script = """
import json
import sqlite3
from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient
from app.core.config import BASE_DIR, get_settings
from app.core.security import create_access_token
from app.main import app
from sqlalchemy.engine import make_url

config = Config(str(BASE_DIR / 'alembic.ini'))
config.set_main_option('script_location', str(BASE_DIR / 'alembic'))
command.upgrade(config, '30b3daecbcab')
connection = sqlite3.connect(make_url(get_settings().database_url).database)
for user_id, phone, name in [(1, '+919876543210', 'Piyush'), (2, '+447700900123', 'Jane')]:
    connection.execute('''INSERT INTO users
        (id, phone, display_name, about, avatar_color, read_receipts_enabled,
         typing_indicators_enabled, created_at)
        VALUES (?, ?, ?, '', 'A100', 1, 1, '2026-01-01 00:00:00')''', (user_id, phone, name))
for conversation_id, kind in [(10, 'direct'), (11, 'direct'), (12, 'note_to_self'),
                              (13, 'note_to_self'), (14, 'group')]:
    connection.execute('''INSERT INTO conversations
        (id, type, name, avatar_color, created_by, last_activity_at, created_at)
        VALUES (?, ?, 'Existing', 'A100', 1, '2026-01-01 00:00:00', '2026-01-01 00:00:00')''',
        (conversation_id, kind))
    for user_id in ([1] if kind == 'note_to_self' else [1, 2]):
        connection.execute('''INSERT INTO conversation_members
            (conversation_id, user_id, role, joined_at, is_pinned, pinned_at, is_archived,
             marked_unread, is_hidden)
            VALUES (?, ?, 'admin', '2026-01-01 00:00:00', ?, '2026-01-01 00:00:00', 0, 0, 0)''',
            (conversation_id, user_id, int(user_id == 1 and conversation_id == 11)))
    connection.execute('''INSERT INTO messages
        (id, conversation_id, sender_id, type, body, is_forwarded, created_at)
        VALUES (?, ?, 1, 'text', ?, 0, '2026-01-02 00:00:00')''',
        (conversation_id, conversation_id, f'History {conversation_id}'))
connection.commit()
membership_query = 'SELECT * FROM conversation_members ORDER BY conversation_id, user_id'
before = connection.execute(membership_query).fetchall()
connection.close()

with TestClient(app) as client:
    headers = {'Authorization': 'Bearer ' + create_access_token(1)}
    chats = client.get('/api/conversations', headers=headers)
    assert chats.status_code == 200, chats.text
    assert {c['id'] for c in chats.json()} == {10, 11, 12, 13, 14}
    assert client.get('/api/conversations/11', headers=headers).json()['is_pinned']
    for conversation_id in range(10, 15):
        page = client.get(f'/api/conversations/{conversation_id}/messages', headers=headers)
        assert page.json()['items'][0]['body'] == f'History {conversation_id}'
    for other_id, canonical_id in [(2, 10), (1, 12)]:
        reopened = client.post('/api/conversations', headers=headers,
            json={'type': 'direct', 'member_ids': [other_id]})
        assert reopened.status_code == 200, reopened.text
        assert reopened.json()['id'] == canonical_id

connection = sqlite3.connect(make_url(get_settings().database_url).database)
assert connection.execute(membership_query).fetchall() == before
assert connection.execute('SELECT id, identity_key FROM conversations ORDER BY id').fetchall() == [
    (10, 'direct:1:2'), (11, None), (12, 'self:1'), (13, None), (14, None)]
try:
    connection.execute("UPDATE conversations SET identity_key = 'direct:1:2' WHERE id = 11")
except sqlite3.IntegrityError:
    connection.rollback()
else:
    raise AssertionError('Duplicate canonical identity was accepted')
assert not connection.execute('PRAGMA foreign_key_check').fetchall()
assert connection.execute('SELECT COUNT(*) FROM messages').fetchone()[0] == 5
revision = connection.execute('SELECT version_num FROM alembic_version').fetchone()[0]
print(json.dumps({'revision': revision}))
connection.close()
"""
    result = subprocess.run(
        [sys.executable, "-c", script],
        cwd=BASE_DIR,
        env=env,
        capture_output=True,
        text=True,
        timeout=30,
        check=False,
    )
    assert result.returncode == 0, result.stderr
    assert json.loads(result.stdout)["revision"] == "b38d41ac975e"
