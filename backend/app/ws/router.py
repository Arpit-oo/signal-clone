"""The WebSocket endpoint: one socket per client tab, JSON frames shaped {type, data}.

Client -> server:  message.send, typing.start, typing.stop, receipt.delivered, receipt.read, ping
Server -> client:  message.new (also the send ack, matched by client_id), message.updated,
                   message.hidden, message.expired, message.timer_started, reaction.updated,
                   receipt.updated, typing, presence, user.updated, me.updated,
                   conversation.updated, conversation.read, conversation.removed, error, pong
"""

import logging
from typing import Any

import anyio
from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect, status
from pydantic import ValidationError

from app.core.security import decode_access_token
from app.db.base import utcnow
from app.db.session import SessionLocal
from app.models import ConversationMember, User
from app.schemas.message import MessageSend
from app.services import conversations as conv_svc
from app.services import messages as msg_svc
from app.ws.manager import manager
from app.ws.typing import typing_registry

log = logging.getLogger(__name__)
router = APIRouter()


async def broadcast_presence(user_id: int, online: bool, last_seen_at) -> None:
    async with SessionLocal() as db:
        peers = await conv_svc.peer_user_ids(db, user_id)
    await manager.send_to_users(
        peers,
        "presence",
        {
            "user_id": user_id,
            "online": online,
            "last_seen_at": last_seen_at.isoformat() if last_seen_at else None,
        },
    )


async def broadcast_typing(conversation_id: int, user_id: int, is_typing: bool) -> None:
    async with SessionLocal() as db:
        member_ids = await conv_svc.active_member_ids(db, conversation_id)
    await manager.send_to_users(
        [uid for uid in member_ids if uid != user_id],
        "typing",
        {"conversation_id": conversation_id, "user_id": user_id, "is_typing": is_typing},
    )


async def _handle(ws: WebSocket, user_id: int, type_: str, data: Any) -> None:
    if type_ == "ping":
        await ws.send_json({"type": "pong", "data": None})
        return

    async with SessionLocal() as db:
        me = await db.get(User, user_id)
        if me is None:
            await ws.close(code=status.WS_1008_POLICY_VIOLATION)
            return

        if type_ == "message.send":
            payload = MessageSend.model_validate(data)
            conversation_id = int(data["conversation_id"])
            msg, created = await msg_svc.create_message(db, me, conversation_id, payload)
            if typing_registry.stop(conversation_id, me.id):
                await broadcast_typing(conversation_id, me.id, False)
            if created:
                await msg_svc.broadcast_new_message(db, msg)
            else:
                # A retry of something we already stored: just re-ack this socket.
                view = (await msg_svc.reload_for_viewer(db, me, [msg.id]))[0]
                await ws.send_json({"type": "message.new", "data": view.model_dump(mode="json")})

        elif type_ in ("typing.start", "typing.stop"):
            conversation_id = int(data["conversation_id"])
            member = await db.get(ConversationMember, (conversation_id, me.id))
            if member is None or member.left_at is not None:
                return
            member = await conv_svc.get_membership(db, conversation_id, me.id)
            await msg_svc.check_can_send(db, me, member.conversation)
            if type_ == "typing.start" and me.typing_indicators_enabled:
                if typing_registry.start(conversation_id, me.id):
                    await broadcast_typing(conversation_id, me.id, True)
            elif typing_registry.stop(conversation_id, me.id):
                await broadcast_typing(conversation_id, me.id, False)

        elif type_ == "receipt.delivered":
            ids = [int(i) for i in data.get("message_ids", [])][:500]
            if ids:
                await msg_svc.mark_delivered(db, me, ids)

        elif type_ == "receipt.read":
            await msg_svc.mark_read(db, me, int(data["conversation_id"]), int(data["up_to_id"]))

        else:
            raise ValueError(f"Unknown event type: {type_}")


@router.websocket("/ws")
async def websocket_endpoint(ws: WebSocket, token: str = "") -> None:
    user_id = decode_access_token(token)
    if user_id is None:
        await ws.close(code=status.WS_1008_POLICY_VIOLATION)
        return
    async with SessionLocal() as db:
        me = await db.get(User, user_id)
        if me is None:
            await ws.close(code=status.WS_1008_POLICY_VIOLATION)
            return

    await ws.accept()
    # Register before anything else can await, so the finally block always unregisters.
    first_socket = await manager.connect(user_id, ws)
    try:
        if first_socket:
            await broadcast_presence(user_id, True, None)
        # Anything sent while we were offline is now on its way to this client.
        async with SessionLocal() as db:
            me = await db.get(User, user_id)
            await msg_svc.mark_delivered(db, me)

        while True:
            type_ = None
            data = {}
            try:
                frame = await ws.receive_json()
                if not isinstance(frame, dict):
                    raise ValueError("A WebSocket frame must be an object")
                type_ = frame.get("type")
                data = frame.get("data") or {}
                if not isinstance(data, dict):
                    raise ValueError("Event data must be an object")
                await _handle(ws, user_id, type_, data)
            except HTTPException as exc:
                await ws.send_json(
                    {"type": "error", "data": {"detail": exc.detail, "event": type_, "ref": data}}
                )
            except (ValidationError, ValueError, KeyError, TypeError) as exc:
                await ws.send_json(
                    {"type": "error", "data": {"detail": str(exc), "event": type_, "ref": data}}
                )
    except WebSocketDisconnect:
        pass
    except Exception:
        log.exception("websocket loop crashed")
    finally:
        # Shielded: if the server task is being cancelled (shutdown, client vanished), still
        # record last-seen and tell peers we went offline.
        with anyio.CancelScope(shield=True):
            await _on_disconnect(user_id, ws)


async def _on_disconnect(user_id: int, ws: WebSocket) -> None:
    if not await manager.disconnect(user_id, ws):
        return
    now = utcnow()
    async with SessionLocal() as db:
        me = await db.get(User, user_id)
        if me is not None:
            me.last_seen_at = now
            await db.commit()
    for conversation_id in typing_registry.stop_all_for(user_id):
        await broadcast_typing(conversation_id, user_id, False)
    await broadcast_presence(user_id, False, now)
