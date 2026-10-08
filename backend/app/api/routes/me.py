from fastapi import APIRouter, UploadFile

from app.api.deps import DB, CurrentUser
from app.models import User
from app.schemas.user import MeOut, MeUpdate
from app.services import conversations as conv_svc
from app.services import storage
from app.services import users as users_svc
from app.ws.manager import manager

router = APIRouter(prefix="/me", tags=["me"])

PUBLIC_PROFILE_FIELDS = (
    "id",
    "username",
    "display_name",
    "about",
    "about_emoji",
    "avatar_url",
    "avatar_color",
)


async def _broadcast_profile(db: DB, user: User) -> None:
    payload = {field: getattr(user, field) for field in PUBLIC_PROFILE_FIELDS}
    await manager.send_to_users(await conv_svc.peer_user_ids(db, user.id), "user.updated", payload)
    await manager.send_to_user(
        user.id, "me.updated", users_svc.present_me(user).model_dump(mode="json")
    )


@router.get("", response_model=MeOut)
async def get_me(me: CurrentUser) -> MeOut:
    return users_svc.present_me(me)


@router.patch("", response_model=MeOut)
async def update_me(body: MeUpdate, me: CurrentUser, db: DB) -> MeOut:
    user = await users_svc.update_me(db, me, body)
    await _broadcast_profile(db, user)
    return users_svc.present_me(user)


@router.post("/avatar", response_model=MeOut)
async def upload_avatar(file: UploadFile, me: CurrentUser, db: DB) -> MeOut:
    key = await storage.save_avatar(file)
    old = me.avatar_url
    me.avatar_url = storage.avatar_url(key)
    await db.commit()
    storage.delete_key(storage.key_from_url(old))
    await _broadcast_profile(db, me)
    return users_svc.present_me(me)


@router.delete("/avatar", response_model=MeOut)
async def delete_avatar(me: CurrentUser, db: DB) -> MeOut:
    old = me.avatar_url
    me.avatar_url = None
    await db.commit()
    storage.delete_key(storage.key_from_url(old))
    await _broadcast_profile(db, me)
    return users_svc.present_me(me)
