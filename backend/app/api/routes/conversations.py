from fastapi import APIRouter, Query, UploadFile, status
from fastapi.responses import JSONResponse

from app.api.deps import DB, CurrentUser
from app.core.errors import bad_request
from app.schemas.conversation import (
    ConversationCreate,
    ConversationDetail,
    ConversationOut,
    ConversationSettings,
    ConversationUpdate,
    MemberRoleUpdate,
    MembersAdd,
)
from app.schemas.message import MessageOut, MessagePage, MessageSend, ReadRequest
from app.services import conversations as conv_svc
from app.services import messages as msg_svc
from app.services import storage
from app.ws.manager import manager

router = APIRouter(prefix="/conversations", tags=["conversations"])


async def _announce(db: DB, conversation_id: int, notices=(), extra_user_ids=()) -> None:
    """Push system notices and refreshed conversation state after a group change."""
    for notice in notices:
        await conv_svc.broadcast_system_message(db, notice)
    member_ids = await conv_svc.active_member_ids(db, conversation_id)
    await conv_svc.broadcast_conversation(db, conversation_id, [*member_ids, *extra_user_ids])


@router.get("", response_model=list[ConversationOut])
async def list_conversations(me: CurrentUser, db: DB):
    return await conv_svc.list_conversations(db, me)


@router.post("", response_model=ConversationOut)
async def create_conversation(body: ConversationCreate, me: CurrentUser, db: DB):
    if body.type == "direct":
        if len(body.member_ids) != 1:
            raise bad_request("A direct chat needs exactly one other person")
        conv, created = await conv_svc.get_or_create_direct(db, me, body.member_ids[0])
        out = await conv_svc.conversation_out(db, me, conv.id)
        return JSONResponse(
            out.model_dump(mode="json"),
            status_code=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
        )
    conv = await conv_svc.create_group(db, me, body)
    for uid in await conv_svc.active_member_ids(db, conv.id):
        if uid != me.id:
            await conv_svc.broadcast_conversation(db, conv.id, [uid])
    out = await conv_svc.conversation_out(db, me, conv.id)
    return JSONResponse(out.model_dump(mode="json"), status_code=status.HTTP_201_CREATED)


@router.get("/{conversation_id}", response_model=ConversationDetail)
async def get_conversation(conversation_id: int, me: CurrentUser, db: DB):
    return await conv_svc.conversation_detail(db, me, conversation_id)


@router.patch("/{conversation_id}", response_model=ConversationDetail)
async def update_conversation(
    conversation_id: int, body: ConversationUpdate, me: CurrentUser, db: DB
):
    notices = await conv_svc.update_group(db, me, conversation_id, body)
    await _announce(db, conversation_id, notices)
    return await conv_svc.conversation_detail(db, me, conversation_id)


@router.post("/{conversation_id}/avatar", response_model=ConversationDetail)
async def upload_group_avatar(conversation_id: int, file: UploadFile, me: CurrentUser, db: DB):
    await conv_svc.get_membership(db, conversation_id, me.id)
    key = await storage.save_avatar(file)
    old, notice = await conv_svc.set_group_avatar(db, me, conversation_id, storage.avatar_url(key))
    storage.delete_key(storage.key_from_url(old))
    await _announce(db, conversation_id, [notice])
    return await conv_svc.conversation_detail(db, me, conversation_id)


@router.delete("/{conversation_id}/avatar", response_model=ConversationDetail)
async def delete_group_avatar(conversation_id: int, me: CurrentUser, db: DB):
    old, notice = await conv_svc.set_group_avatar(db, me, conversation_id, None)
    storage.delete_key(storage.key_from_url(old))
    await _announce(db, conversation_id, [notice])
    return await conv_svc.conversation_detail(db, me, conversation_id)


@router.patch("/{conversation_id}/settings", response_model=ConversationOut)
async def update_settings(
    conversation_id: int, body: ConversationSettings, me: CurrentUser, db: DB
):
    await conv_svc.update_settings(db, me, conversation_id, body)
    out = await conv_svc.conversation_out(db, me, conversation_id)
    await manager.send_to_user(me.id, "conversation.updated", out.model_dump(mode="json"))
    return out


@router.delete("/{conversation_id}", status_code=204)
async def delete_conversation(conversation_id: int, me: CurrentUser, db: DB) -> None:
    await conv_svc.hide_conversation(db, me, conversation_id)
    await manager.send_to_user(me.id, "conversation.removed", {"conversation_id": conversation_id})


# --- members -------------------------------------------------------------------------------


@router.post("/{conversation_id}/members", response_model=ConversationDetail)
async def add_members(conversation_id: int, body: MembersAdd, me: CurrentUser, db: DB):
    added, notice = await conv_svc.add_members(db, me, conversation_id, body.user_ids)
    if notice:
        await _announce(db, conversation_id, [notice])
    return await conv_svc.conversation_detail(db, me, conversation_id)


@router.delete("/{conversation_id}/members/{user_id}", response_model=ConversationDetail)
async def remove_member(conversation_id: int, user_id: int, me: CurrentUser, db: DB):
    notice = await conv_svc.remove_member(db, me, conversation_id, user_id)
    # The removed member gets the notice and their final view (no longer a member).
    await manager.send_to_user(
        user_id,
        "message.new",
        (await msg_svc.reload_for_viewer(db, me, [notice.id]))[0].model_dump(mode="json"),
    )
    await _announce(db, conversation_id, [notice], extra_user_ids=[user_id])
    return await conv_svc.conversation_detail(db, me, conversation_id)


@router.patch("/{conversation_id}/members/{user_id}", response_model=ConversationDetail)
async def set_member_role(
    conversation_id: int, user_id: int, body: MemberRoleUpdate, me: CurrentUser, db: DB
):
    notice = await conv_svc.set_role(db, me, conversation_id, user_id, body.role)
    await _announce(db, conversation_id, [notice])
    return await conv_svc.conversation_detail(db, me, conversation_id)


@router.post("/{conversation_id}/leave", response_model=ConversationOut)
async def leave(conversation_id: int, me: CurrentUser, db: DB):
    notice = await conv_svc.leave_group(db, me, conversation_id)
    await manager.send_to_user(
        me.id,
        "message.new",
        (await msg_svc.reload_for_viewer(db, me, [notice.id]))[0].model_dump(mode="json"),
    )
    await _announce(db, conversation_id, [notice], extra_user_ids=[me.id])
    return await conv_svc.conversation_out(db, me, conversation_id)


# --- messages ------------------------------------------------------------------------------


@router.get("/{conversation_id}/messages", response_model=MessagePage)
async def list_messages(
    conversation_id: int,
    me: CurrentUser,
    db: DB,
    before: int | None = None,
    after: int | None = None,
    around: int | None = None,
    limit: int = Query(50, ge=1, le=200),
):
    return await msg_svc.list_messages(
        db, me, conversation_id, before=before, after=after, around=around, limit=limit
    )


@router.post("/{conversation_id}/messages", response_model=MessageOut, status_code=201)
async def send_message(conversation_id: int, body: MessageSend, me: CurrentUser, db: DB):
    """REST fallback for sending; the client normally sends over the WebSocket."""
    msg, created = await msg_svc.create_message(db, me, conversation_id, body)
    if created:
        return await msg_svc.broadcast_new_message(db, msg)
    return (await msg_svc.reload_for_viewer(db, me, [msg.id]))[0]


@router.get("/{conversation_id}/messages/search", response_model=list[MessageOut])
async def search_in_conversation(
    conversation_id: int, me: CurrentUser, db: DB, q: str = Query(min_length=1, max_length=200)
):
    await conv_svc.get_membership(db, conversation_id, me.id, require_active=False)
    return await msg_svc.search_messages(db, me, q, conversation_id)


@router.post("/{conversation_id}/read", status_code=204)
async def mark_read(conversation_id: int, body: ReadRequest, me: CurrentUser, db: DB) -> None:
    await msg_svc.mark_read(db, me, conversation_id, body.up_to_id)
