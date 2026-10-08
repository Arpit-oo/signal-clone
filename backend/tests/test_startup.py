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
