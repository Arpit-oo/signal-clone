from fastapi import APIRouter, Query
from sqlalchemy import select
from sqlalchemy.orm import aliased

from app.api.deps import DB, CurrentUser
from app.core.errors import not_found
from app.models import Conversation, ConversationMember, User
from app.schemas.user import ContactCreate, ContactUpdate, UserOut, normalize_phone
from app.services import contacts as contacts_svc
from app.services import users as users_svc
from app.ws.calls import calls

router = APIRouter(tags=["users"])


@router.get("/users/search", response_model=list[UserOut])
async def search_users(me: CurrentUser, db: DB, q: str = Query(min_length=1, max_length=64)):
    return await users_svc.present_users(db, me.id, await users_svc.search_users(db, me, q))


@router.get("/users/lookup", response_model=UserOut)
async def lookup_user(
    me: CurrentUser, db: DB, phone: str | None = None, username: str | None = None
):
    """Exact match by phone or username, used by "Find by phone number / username"."""
    try:
        phone = normalize_phone(phone) if phone else None
    except ValueError:
        phone = None
    user = await users_svc.find_user(db, user_id=None, phone=phone, username=username)
    if user is None or not user.display_name:
        raise not_found("User")
    return await users_svc.present_user(db, me.id, user)


@router.get("/users/{user_id}", response_model=UserOut)
async def get_user(user_id: int, me: CurrentUser, db: DB):
    user = await db.get(User, user_id)
    if user is None:
        raise not_found("User")
    return await users_svc.present_user(db, me.id, user)


@router.get("/users/{user_id}/groups-in-common")
async def groups_in_common(user_id: int, me: CurrentUser, db: DB) -> list[dict]:
    mine, theirs = aliased(ConversationMember), aliased(ConversationMember)
    rows = await db.execute(
        select(
            Conversation.id, Conversation.name, Conversation.avatar_color, Conversation.avatar_url
        )
        .join(mine, (mine.conversation_id == Conversation.id) & (mine.user_id == me.id))
        .join(theirs, (theirs.conversation_id == Conversation.id) & (theirs.user_id == user_id))
        .where(Conversation.type == "group", mine.left_at.is_(None), theirs.left_at.is_(None))
        .order_by(Conversation.name)
    )
    return [
        {"id": cid, "name": name, "avatar_color": color, "avatar_url": url}
        for cid, name, color, url in rows
    ]


# --- contacts ------------------------------------------------------------------------------


@router.get("/contacts", response_model=list[UserOut])
async def list_contacts(me: CurrentUser, db: DB):
    return await contacts_svc.list_contacts(db, me)


@router.post("/contacts", response_model=UserOut, status_code=201)
async def add_contact(body: ContactCreate, me: CurrentUser, db: DB):
    user = await contacts_svc.add_contact(db, me, body)
    return await users_svc.present_user(db, me.id, user)


@router.patch("/contacts/{user_id}", response_model=UserOut)
async def update_contact(user_id: int, body: ContactUpdate, me: CurrentUser, db: DB):
    user = await contacts_svc.update_contact(db, me, user_id, body.nickname)
    return await users_svc.present_user(db, me.id, user)


@router.delete("/contacts/{user_id}", status_code=204)
async def remove_contact(user_id: int, me: CurrentUser, db: DB) -> None:
    await contacts_svc.remove_contact(db, me, user_id)


# --- blocking ------------------------------------------------------------------------------


@router.get("/blocks", response_model=list[UserOut])
async def list_blocked(me: CurrentUser, db: DB):
    return await contacts_svc.list_blocked(db, me)


@router.put("/blocks/{user_id}", response_model=UserOut)
async def block_user(user_id: int, me: CurrentUser, db: DB):
    user = await contacts_svc.block(db, me, user_id)
    await calls.blocked(me.id, user_id)
    return await users_svc.present_user(db, me.id, user)


@router.delete("/blocks/{user_id}", status_code=204)
async def unblock_user(user_id: int, me: CurrentUser, db: DB) -> None:
    await contacts_svc.unblock(db, me, user_id)
