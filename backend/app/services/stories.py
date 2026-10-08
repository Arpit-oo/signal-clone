from collections import defaultdict
from datetime import timedelta

from fastapi import UploadFile
from sqlalchemy import and_, delete, exists, or_, select
from sqlalchemy.dialects.sqlite import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import bad_request, forbidden, not_found
from app.db.base import utcnow
from app.models import Block, Story, StoryRecipient, StoryView, User
from app.schemas.story import StoryCreate, StoryMedia, StoryOut, StoryViewer
from app.services import storage
from app.services import users as users_svc
from app.ws.manager import manager


def _unblocked(a, b):
    return ~exists().where(
        or_(
            and_(Block.blocker_id == a, Block.blocked_id == b),
            and_(Block.blocker_id == b, Block.blocked_id == a),
        )
    )


async def get_visible(db: AsyncSession, me: User, story_id: int) -> Story:
    story = await db.scalar(
        select(Story).where(
            Story.id == story_id,
            Story.expires_at > utcnow(),
            or_(
                Story.author_id == me.id,
                exists().where(
                    StoryRecipient.story_id == Story.id, StoryRecipient.user_id == me.id
                ),
            ),
            _unblocked(Story.author_id, me.id),
        )
    )
    if story is None:
        raise not_found("Story")
    return story


async def _audience(db: AsyncSession, story: Story) -> list[int]:
    return list(
        await db.scalars(
            select(StoryRecipient.user_id).where(
                StoryRecipient.story_id == story.id,
                _unblocked(story.author_id, StoryRecipient.user_id),
            )
        )
    )


async def _notify(story_id: int, user_ids: list[int]) -> None:
    await manager.send_to_users(user_ids, "story.changed", {"story_id": story_id})


async def present(db: AsyncSession, me: User, stories: list[Story]) -> list[StoryOut]:
    if not stories:
        return []
    ids = [s.id for s in stories]
    authors = list(
        await db.scalars(select(User).where(User.id.in_({s.author_id for s in stories})))
    )
    authors_out = {u.id: u for u in await users_svc.present_users(db, me.id, authors)}
    seen = dict(
        (
            await db.execute(
                select(StoryView.story_id, StoryView.viewed_at).where(
                    StoryView.story_id.in_(ids), StoryView.user_id == me.id
                )
            )
        ).all()
    )
    own_ids = [s.id for s in stories if s.author_id == me.id]
    recipients: dict[int, list[int]] = defaultdict(list)
    counts: dict[int, int] = defaultdict(int)
    if own_ids:
        for sid, uid in await db.execute(
            select(StoryRecipient.story_id, StoryRecipient.user_id).where(
                StoryRecipient.story_id.in_(own_ids)
            )
        ):
            recipients[sid].append(uid)
        if me.read_receipts_enabled:
            for sid in await db.scalars(
                select(StoryView.story_id)
                .join(User, User.id == StoryView.user_id)
                .where(
                    StoryView.story_id.in_(own_ids),
                    User.read_receipts_enabled.is_(True),
                    _unblocked(me.id, User.id),
                )
            ):
                counts[sid] += 1
    return [
        StoryOut(
            id=s.id,
            author=authors_out[s.author_id],
            kind=s.kind,
            body=s.body,
            color=s.color,
            media=StoryMedia(
                url=f"/api/stories/{s.id}/media",
                mime_type=s.mime_type,
                size_bytes=s.size_bytes,
                width=s.width,
                height=s.height,
            )
            if s.storage_key
            else None,
            created_at=s.created_at,
            expires_at=s.expires_at,
            is_own=s.author_id == me.id,
            viewed_at=seen.get(s.id),
            view_count=counts[s.id] if s.author_id == me.id and me.read_receipts_enabled else None,
            recipient_ids=sorted(recipients[s.id]) if s.author_id == me.id else None,
        )
        for s in stories
    ]


async def feed(db: AsyncSession, me: User) -> list[StoryOut]:
    stories = list(
        await db.scalars(
            select(Story)
            .where(
                Story.expires_at > utcnow(),
                or_(
                    Story.author_id == me.id,
                    exists().where(
                        StoryRecipient.story_id == Story.id, StoryRecipient.user_id == me.id
                    ),
                ),
                _unblocked(Story.author_id, me.id),
            )
            .order_by(Story.created_at.desc(), Story.id.desc())
        )
    )
    return await present(db, me, stories)


async def create(
    db: AsyncSession, me: User, data: StoryCreate, file: UploadFile | None
) -> StoryOut:
    audience = set(data.recipient_ids)
    if me.id in audience:
        raise bad_request("Choose other people as your story audience")
    found = set(
        await db.scalars(select(User.id).where(User.id.in_(audience), User.display_name != ""))
    )
    if missing := audience - found:
        raise bad_request(f"Unknown users: {sorted(missing)}")
    blocked = set(
        await db.scalars(select(User.id).where(User.id.in_(audience), ~_unblocked(me.id, User.id)))
    )
    if blocked:
        raise bad_request("Your audience includes a blocked person")
    if not data.body and file is None:
        raise bad_request("Add text or a photo/video to your story")
    media = await storage.save_story_media(file) if file is not None else None
    now = utcnow()
    story = Story(
        author_id=me.id,
        kind=media.mime_type.split("/", 1)[0] if media else "text",
        body=data.body,
        color=data.color.upper(),
        storage_key=media.key if media else None,
        mime_type=media.mime_type if media else None,
        size_bytes=media.size if media else None,
        width=media.width if media else None,
        height=media.height if media else None,
        created_at=now,
        expires_at=now + timedelta(hours=24),
    )
    story.recipients.extend(StoryRecipient(user_id=uid) for uid in sorted(audience))
    db.add(story)
    try:
        await db.commit()
    except BaseException:
        storage.delete_key(media.key if media else None)
        await db.rollback()
        raise
    out = (await present(db, me, [story]))[0]
    await _notify(story.id, [me.id, *await _audience(db, story)])
    return out


async def mark_viewed(db: AsyncSession, me: User, story_id: int) -> None:
    story = await get_visible(db, me, story_id)
    if story.author_id == me.id:
        return
    # Composite primary key arbitrates simultaneous view receipts without replacing
    # the first timestamp. The seen marker persists even with read receipts disabled.
    result = await db.execute(
        insert(StoryView)
        .values(story_id=story_id, user_id=me.id, viewed_at=utcnow())
        .on_conflict_do_nothing(index_elements=["story_id", "user_id"])
    )
    await db.commit()
    if result.rowcount:
        ids = [me.id]
        author = await db.get(User, story.author_id)
        if me.read_receipts_enabled and author.read_receipts_enabled:
            ids.append(author.id)
        await _notify(story_id, ids)


async def viewers(db: AsyncSession, me: User, story_id: int) -> list[StoryViewer]:
    story = await get_visible(db, me, story_id)
    if story.author_id != me.id:
        raise forbidden("Only the author can see story views")
    if not me.read_receipts_enabled:
        return []
    rows = (
        await db.execute(
            select(User, StoryView.viewed_at)
            .join(StoryView, StoryView.user_id == User.id)
            .where(
                StoryView.story_id == story_id,
                User.read_receipts_enabled.is_(True),
                _unblocked(me.id, User.id),
            )
            .order_by(StoryView.viewed_at.desc())
        )
    ).all()
    users = await users_svc.present_users(db, me.id, [u for u, _ in rows])
    return [
        StoryViewer(user=u, viewed_at=timestamp)
        for u, (_, timestamp) in zip(users, rows, strict=True)
    ]


async def remove(db: AsyncSession, me: User, story_id: int) -> None:
    story = await get_visible(db, me, story_id)
    if story.author_id != me.id:
        raise forbidden("Only the author can delete a story")
    ids = [me.id, *await _audience(db, story)]
    key = story.storage_key
    await db.execute(delete(Story).where(Story.id == story_id))
    await db.commit()
    storage.delete_key(key)
    await _notify(story_id, ids)


async def purge_expired(db: AsyncSession) -> None:
    stories = list(await db.scalars(select(Story).where(Story.expires_at <= utcnow())))
    if not stories:
        return
    targets = [(s.id, [s.author_id, *await _audience(db, s)], s.storage_key) for s in stories]
    await db.execute(delete(Story).where(Story.id.in_([s.id for s in stories])))
    await db.commit()
    for sid, ids, key in targets:
        storage.delete_key(key)
        await _notify(sid, ids)
