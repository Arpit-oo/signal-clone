from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import bad_request, not_found
from app.models import Block, Contact, User
from app.schemas.user import ContactCreate, UserOut, normalize_phone
from app.services import users as users_svc


async def list_contacts(db: AsyncSession, me: User) -> list[UserOut]:
    rows = (
        await db.scalars(
            select(User)
            .join(Contact, Contact.contact_id == User.id)
            .where(Contact.owner_id == me.id)
        )
    ).all()
    out = await users_svc.present_users(db, me.id, rows)
    out.sort(key=lambda u: (u.nickname or u.display_name or u.phone).lower())
    return out


async def add_contact(db: AsyncSession, me: User, data: ContactCreate) -> User:
    phone = None
    if data.phone:
        try:
            phone = normalize_phone(data.phone)
        except ValueError as exc:
            raise bad_request(str(exc)) from exc
    target = await users_svc.find_user(
        db, user_id=data.user_id, phone=phone, username=data.username
    )
    if target is None:
        raise not_found("No Signal user with that number or username")
    if target.id == me.id:
        raise bad_request("You can't add yourself as a contact")
    existing = await db.get(Contact, (me.id, target.id))
    if existing:
        if data.nickname is not None:
            existing.nickname = data.nickname.strip() or None
    else:
        db.add(
            Contact(
                owner_id=me.id,
                contact_id=target.id,
                nickname=(data.nickname or "").strip() or None,
            )
        )
    await db.commit()
    return target


async def update_contact(db: AsyncSession, me: User, user_id: int, nickname: str | None) -> User:
    contact = await db.get(Contact, (me.id, user_id))
    if contact is None:
        raise not_found("Contact")
    contact.nickname = (nickname or "").strip() or None
    await db.commit()
    return await db.get(User, user_id)


async def remove_contact(db: AsyncSession, me: User, user_id: int) -> None:
    await db.execute(
        delete(Contact).where(Contact.owner_id == me.id, Contact.contact_id == user_id)
    )
    await db.commit()


async def list_blocked(db: AsyncSession, me: User) -> list[UserOut]:
    rows = (
        await db.scalars(
            select(User).join(Block, Block.blocked_id == User.id).where(Block.blocker_id == me.id)
        )
    ).all()
    return await users_svc.present_users(db, me.id, rows)


async def block(db: AsyncSession, me: User, user_id: int) -> User:
    target = await db.get(User, user_id)
    if target is None:
        raise not_found("User")
    if target.id == me.id:
        raise bad_request("You can't block yourself")
    if await db.get(Block, (me.id, user_id)) is None:
        db.add(Block(blocker_id=me.id, blocked_id=user_id))
        await db.commit()
    return target


async def unblock(db: AsyncSession, me: User, user_id: int) -> None:
    await db.execute(delete(Block).where(Block.blocker_id == me.id, Block.blocked_id == user_id))
    await db.commit()
