import os
import subprocess
import sys

from app.core.config import BASE_DIR


def test_legacy_duplicates_merge_without_losing_history_or_reusing_session_ids(tmp_path):
    database = tmp_path / "legacy.db"
    script = r"""
from datetime import timedelta
from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.engine import make_url
from app.core.config import get_settings
from app.core.security import create_access_token
from app.db.base import utcnow
from app.models import (
    User, Contact, Block, Conversation, ConversationMember, Message, MessageReceipt,
    Attachment, Reaction, MessageHidden, MessageMention, Story, StoryRecipient, StoryView,
)

config = Config('alembic.ini')
command.upgrade(config, 'b38d41ac975e')
engine = create_engine(make_url(get_settings().database_url).set(drivername='sqlite'))
now = utcnow()
earlier = now - timedelta(minutes=1)
with engine.begin() as db:
    def add(model, **data):
        db.execute(model.__table__.insert().values(**data))
    add(User, id=1, phone='+919877032297', display_name='Canonical profile', username='original')
    add(User, id=2, phone='+15551230000', display_name='Peer')
    add(User, id=3, phone='+9877032297', display_name='Duplicate profile')
    for cid, kind, identity, people in [
        (1, 'direct', 'direct:1:2', [1, 2]), (2, 'direct', 'direct:2:3', [2, 3]),
        (3, 'note_to_self', 'self:1', [1]), (4, 'note_to_self', 'self:3', [3]),
        (5, 'direct', 'direct:1:3', [1, 3]), (6, 'group', None, [1, 2, 3]),
    ]:
        add(Conversation, id=cid, type=kind, identity_key=identity,
            name='Group' if kind == 'group' else None, created_by=3)
        for person in people:
            add(ConversationMember, conversation_id=cid, user_id=person,
                role='admin' if person == 3 or kind == 'note_to_self' else 'member')
        add(Message, id=cid, conversation_id=cid, sender_id=2 if cid == 6 else 3,
            client_id=f'legacy-{cid}', body=f'Preserved message {cid}',
            meta={'event': 'members_added', 'targets': [3]} if cid == 6 else None)
    add(Contact, owner_id=2, contact_id=1, nickname='Original nickname')
    add(Contact, owner_id=2, contact_id=3, nickname='Duplicate nickname')
    add(Contact, owner_id=3, contact_id=2)
    add(Block, blocker_id=2, blocked_id=1)
    add(Block, blocker_id=2, blocked_id=3)
    add(MessageReceipt, message_id=6, user_id=1, delivered_at=earlier)
    add(MessageReceipt, message_id=6, user_id=3, delivered_at=now, read_at=now)
    add(MessageReceipt, message_id=5, user_id=1, delivered_at=now)
    add(MessageHidden, message_id=2, user_id=3)
    add(MessageMention, message_id=6, user_id=3)
    add(Reaction, message_id=1, user_id=1, emoji='👍', created_at=earlier)
    add(Reaction, message_id=1, user_id=3, emoji='❤️', created_at=now)
    add(Attachment, id=1, message_id=2, uploader_id=3, kind='file', file_name='kept.txt',
        mime_type='text/plain', size_bytes=4, storage_key='kept-file')
    add(Story, id=1, author_id=2, kind='text', body='Peer story', color='#3769ec',
        created_at=now, expires_at=now+timedelta(days=1))
    add(Story, id=2, author_id=3, kind='text', body='Preserved author', color='#3769ec',
        created_at=now, expires_at=now+timedelta(days=1))
    for person in [1, 3]:
        add(StoryRecipient, story_id=1, user_id=person)
        add(StoryView, story_id=1, user_id=person, viewed_at=earlier if person == 1 else now)
    add(StoryRecipient, story_id=2, user_id=2)

retired_token = create_access_token(3)
command.upgrade(config, 'head')
command.upgrade(config, 'head')  # A restart must leave the repair stable.
with engine.connect() as db:
    assert db.exec_driver_sql('PRAGMA integrity_check').scalar_one() == 'ok'
    assert db.exec_driver_sql('PRAGMA foreign_key_check').all() == []
    assert db.execute(select(User.id, User.phone, User.display_name).order_by(User.id)).all() == [
        (1, '+919877032297', 'Canonical profile'), (2, '+15551230000', 'Peer')]
    messages = db.execute(select(
        Message.id, Message.body, Message.conversation_id, Message.sender_id,
    ).order_by(Message.id)).all()
    assert len(messages) == 6
    assert [row.body for row in messages] == [f'Preserved message {cid}' for cid in range(1, 7)]
    assert [row.conversation_id for row in messages] == [1, 1, 3, 3, 3, 6]
    assert [row.sender_id for row in messages] == [1, 1, 1, 1, 1, 2]
    contacts = db.execute(select(Contact.owner_id, Contact.contact_id, Contact.nickname)
        .order_by(Contact.owner_id)).all()
    assert contacts == [(1, 2, None), (2, 1, 'Original nickname')]
    assert db.execute(select(Block.blocker_id, Block.blocked_id)).all() == [(2, 1)]
    group = db.execute(select(ConversationMember.role).where(
        ConversationMember.conversation_id == 6, ConversationMember.user_id == 1,
    )).scalar_one()
    assert group == 'admin'
    assert db.execute(select(Message.meta).where(Message.id == 6)).scalar_one()['targets'] == [1]
    receipt = db.execute(select(MessageReceipt).where(
        MessageReceipt.message_id == 6)).mappings().one()
    assert receipt['user_id'] == 1 and receipt['read_at'] == now
    assert receipt['delivered_at'] == earlier
    assert db.execute(select(MessageReceipt).where(MessageReceipt.message_id == 5)).all() == []
    assert db.execute(select(MessageHidden.user_id)).scalar_one() == 1
    assert db.execute(select(MessageMention.user_id)).scalar_one() == 1
    assert db.execute(select(Reaction.user_id, Reaction.emoji)).one() == (1, '❤️')
    assert db.execute(select(Attachment.uploader_id, Attachment.message_id,
        Attachment.storage_key)).one() == (1, 2, 'kept-file')
    assert db.execute(select(Story.author_id).where(Story.id == 2)).scalar_one() == 1
    assert db.execute(select(StoryView.user_id, StoryView.viewed_at)).one() == (1, earlier)

from app.main import app
with TestClient(app) as client:
    login = client.post('/api/auth/verify', json={'phone': '9877032297', 'code': '123456'})
    assert login.status_code == 200 and login.json()['user']['id'] == 1
    assert login.json()['is_new'] is False
    fresh = client.post('/api/auth/verify', json={'phone': '+15552223333', 'code': '123456'})
    assert fresh.status_code == 200 and fresh.json()['user']['id'] > 3
    assert client.get('/api/me', headers={
        'Authorization': 'Bearer '+retired_token}).status_code == 401
print('legacy phone repair passed')
"""
    result = subprocess.run(
        [sys.executable, "-c", script],
        cwd=BASE_DIR,
        env={
            **os.environ,
            "DATABASE_URL": f"sqlite+aiosqlite:///{database.as_posix()}",
            "UPLOAD_DIR": str(tmp_path / "uploads"),
            "AUTO_MIGRATE_ON_STARTUP": "true",
            "SEED_ON_STARTUP": "false",
        },
        capture_output=True,
        text=True,
        encoding="utf-8",
        timeout=40,
    )
    assert result.returncode == 0, result.stdout + result.stderr
    assert "legacy phone repair passed" in result.stdout
