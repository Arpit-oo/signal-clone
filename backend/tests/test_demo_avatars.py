import hashlib
import io
import os
import subprocess
import sys

from PIL import Image

from app.core.config import BASE_DIR
from app.demo_avatars import AVATAR_KEYS, avatar_url


def test_bundled_demo_portraits_are_public_distinct_and_cached(client):
    portraits = set()
    for key in AVATAR_KEYS:
        response = client.get(avatar_url(key))
        assert response.status_code == 200
        assert response.headers["content-type"] == "image/jpeg"
        assert "immutable" in response.headers["cache-control"]
        with Image.open(io.BytesIO(response.content)) as image:
            assert image.format == "JPEG" and image.size == (512, 512)
        assert len(response.content) < 150_000
        assert client.get(avatar_url(key)).content == response.content
        portraits.add(hashlib.sha256(response.content).hexdigest())
    assert len(portraits) == 9
    for filename in ("unknown-v1", "alex", "alex-v2"):
        assert client.get(f"/api/demo-avatars/{filename}.jpg").status_code == 404


def test_existing_demo_photo_migration_preserves_custom_and_removed_photos(tmp_path):
    database = tmp_path / "demo-portraits.db"
    script = """
from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, select
from sqlalchemy.engine import make_url
from app.core.config import get_settings
from app.models import User
from app.seed import USERS

config = Config('alembic.ini')
command.upgrade(config, 'd83a6f2c190b')
engine = create_engine(make_url(get_settings().database_url).set(drivername='sqlite'))
with engine.begin() as db:
    for key, (phone, name, username, about, color) in USERS.items():
        db.execute(User.__table__.insert().values(
            phone=phone, username=username, display_name=name, about=about,
            avatar_color=color,
            avatar_url='/api/media/avatars/custom.jpg' if key == 'alex' else None,
        ))
    db.execute(User.__table__.insert().values(
        phone='+919877032297', username='arpit', display_name='Arpit',
    ))
command.upgrade(config, 'head')
with engine.begin() as db:
    profiles = dict(db.execute(select(User.username, User.avatar_url)).all())
    assert len(profiles) == 10
    assert profiles['alex'] == '/api/media/avatars/custom.jpg'
    assert profiles['arpit'] is None
    for key in USERS:
        if key != 'alex':
            assert profiles[key] == f'/api/demo-avatars/{key}-v1.jpg'
    db.execute(User.__table__.update().where(User.username == 'priya').values(avatar_url=None))
command.upgrade(config, 'head')
with engine.connect() as db:
    assert db.execute(select(User.avatar_url).where(User.username == 'priya')).scalar_one() is None
    assert db.exec_driver_sql('PRAGMA integrity_check').scalar_one() == 'ok'
    assert db.exec_driver_sql('PRAGMA foreign_key_check').all() == []
print('demo portrait migration passed')
"""
    result = subprocess.run(
        [sys.executable, "-c", script],
        cwd=BASE_DIR,
        env={
            **os.environ,
            "DATABASE_URL": f"sqlite+aiosqlite:///{database.as_posix()}",
            "UPLOAD_DIR": str(tmp_path / "uploads"),
        },
        capture_output=True,
        text=True,
        encoding="utf-8",
        timeout=40,
    )
    assert result.returncode == 0, result.stdout + result.stderr
    assert "demo portrait migration passed" in result.stdout
