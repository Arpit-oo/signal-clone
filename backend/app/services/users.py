import random
from collections.abc import Sequence

from sqlalchemy import exists, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import conflict
from app.models import Block, Contact, User
from app.schemas.user import AVATAR_COLORS, MeOut, MeUpdate, UserOut
from app.ws.manager import manager


async def present_users(db: AsyncSession, viewer_id: int, users: Sequence[User]) -> list[UserOut]:
    """Serialize users as the viewer sees them: contact nickname, block state, online flag."""
    if not users:
        return []
    ids = [u.id for u in users]
    contacts = dict(
        (
            await db.execute(
                select(Contact.contact_id, Contact.nickname).where(
                    Contact.owner_id == viewer_id, Contact.contact_id.in_(ids)
                )
            )
        ).all()
    )
    blocked = set(
        (
            await db.scalars(
                select(Block.blocked_id).where(
                    Block.blocker_id == viewer_id, Block.blocked_id.in_(ids)
                )
            )
        ).all()
    )
    out = []
    for u in users:
        item = UserOut.model_validate(u)
        item.is_online = manager.is_online(u.id)
        item.is_contact = u.id in contacts
        item.nickname = contacts.get(u.id)
        item.is_blocked = u.id in blocked
        out.append(item)
    return out


async def present_user(db: AsyncSession, viewer_id: int, user: User) -> UserOut:
    return (await present_users(db, viewer_id, [user]))[0]


def present_me(user: User) -> MeOut:
    me = MeOut.model_validate(user)
    me.is_online = manager.is_online(user.id)
    return me


async def get_or_create_by_phone(db: AsyncSession, phone: str) -> tuple[User, bool]:
    user = await db.scalar(select(User).where(User.phone == phone))
    if user:
        return user, False
    user = User(phone=phone, avatar_color=random.choice(AVATAR_COLORS))
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user, True


async def update_me(db: AsyncSession, user: User, data: MeUpdate) -> User:
    changes = data.model_dump(exclude_unset=True)
    if "username" in changes:
        username = changes["username"] or None
        if username:
            taken = await db.scalar(
                select(User.id).where(User.username == username, User.id != user.id)
            )
            if taken:
                raise conflict("That username is taken")
        changes["username"] = username
    for key, value in changes.items():
        setattr(user, key, value)
    await db.commit()
    await db.refresh(user)
    return user


async def search_users(db: AsyncSession, viewer: User, q: str, limit: int = 20) -> list[User]:
    q = q.strip().lstrip("@")
    if not q:
        return []
    digits = "".join(ch for ch in q if ch.isdigit())
    filters = [
        User.display_name.icontains(q, autoescape=True),
        User.username.icontains(q, autoescape=True),
        exists().where(
            Contact.owner_id == viewer.id,
            Contact.contact_id == User.id,
            Contact.nickname.icontains(q, autoescape=True),
        ),
    ]
    if len(digits) >= 3:
        filters.append(User.phone.like(f"%{digits}%"))
    rows = await db.scalars(
        select(User)
        .where(User.id != viewer.id, User.display_name != "", or_(*filters))
        .order_by(User.display_name)
        .limit(limit)
    )
    return list(rows)


async def find_user(
    db: AsyncSession, *, user_id: int | None, phone: str | None, username: str | None
) -> User | None:
    if user_id is not None:
        return await db.get(User, user_id)
    if phone:
        return await db.scalar(select(User).where(User.phone == phone))
    if username:
        return await db.scalar(select(User).where(User.username == username.lower().lstrip("@")))
    return None


async def contact_user_ids(db: AsyncSession, owner_id: int) -> set[int]:
    return set(
        (await db.scalars(select(Contact.contact_id).where(Contact.owner_id == owner_id))).all()
    )


async def is_blocked_between(db: AsyncSession, a: int, b: int) -> bool:
    row = await db.scalar(
        select(Block.blocker_id).where(
            or_(
                (Block.blocker_id == a) & (Block.blocked_id == b),
                (Block.blocker_id == b) & (Block.blocked_id == a),
            )
        )
    )
    return row is not None
