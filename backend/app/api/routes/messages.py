from typing import Literal

from fastapi import APIRouter

from app.api.deps import DB, CurrentUser
from app.schemas.message import (
    ForwardRequest,
    MessageEdit,
    MessageInfo,
    MessageOut,
    ReactionSet,
)
from app.services import messages as msg_svc
from app.ws.manager import manager

router = APIRouter(prefix="/messages", tags=["messages"])


@router.get("/{message_id}/info", response_model=MessageInfo)
async def message_info(message_id: int, me: CurrentUser, db: DB):
    return await msg_svc.message_info(db, me, message_id)


@router.patch("/{message_id}", response_model=MessageOut)
async def edit_message(message_id: int, body: MessageEdit, me: CurrentUser, db: DB):
    await msg_svc.edit_message(db, me, message_id, body.body)
    await msg_svc.broadcast_message_update(db, message_id)
    return (await msg_svc.reload_for_viewer(db, me, [message_id]))[0]


@router.delete("/{message_id}", status_code=204)
async def delete_message(
    message_id: int, me: CurrentUser, db: DB, scope: Literal["me", "everyone"] = "me"
) -> None:
    if scope == "everyone":
        await msg_svc.delete_for_everyone(db, me, message_id)
        await msg_svc.broadcast_message_update(db, message_id)
    else:
        msg = await msg_svc.delete_for_me(db, me, message_id)
        await manager.send_to_user(
            me.id,
            "message.hidden",
            {"message_id": message_id, "conversation_id": msg.conversation_id},
        )


@router.put("/{message_id}/reaction", status_code=204)
async def react(message_id: int, body: ReactionSet, me: CurrentUser, db: DB) -> None:
    msg = await msg_svc.set_reaction(db, me, message_id, body.emoji)
    await msg_svc.broadcast_reactions(db, message_id, msg.conversation_id)


@router.delete("/{message_id}/reaction", status_code=204)
async def unreact(message_id: int, me: CurrentUser, db: DB) -> None:
    msg = await msg_svc.set_reaction(db, me, message_id, None)
    await msg_svc.broadcast_reactions(db, message_id, msg.conversation_id)


@router.post("/{message_id}/forward", response_model=list[MessageOut], status_code=201)
async def forward(message_id: int, body: ForwardRequest, me: CurrentUser, db: DB):
    created = await msg_svc.forward_message(db, me, message_id, body.conversation_ids, body.note)
    return [await msg_svc.broadcast_new_message(db, msg) for msg in created]
