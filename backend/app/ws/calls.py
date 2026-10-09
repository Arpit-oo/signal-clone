"""Ephemeral, authenticated one-to-one call signaling. Media stays between browsers.

The invitation belongs to the caller's socket. The first callee tab to accept
claims the call; SDP and ICE only reach those two sockets. Nothing is recorded.
All registry transitions are serialized before sending any network frames.
"""

import asyncio
import time
from dataclasses import dataclass
from typing import Literal
from uuid import UUID

from fastapi import WebSocket
from pydantic import BaseModel, Field

from app.core.errors import bad_request, forbidden
from app.ws.manager import manager


class Description(BaseModel):
    type: Literal["offer", "answer"]
    sdp: str = Field(min_length=1, max_length=65536)


class Invite(BaseModel):
    call_id: UUID
    conversation_id: int = Field(gt=0)
    kind: Literal["voice", "video"]
    offer: Description


class Candidate(BaseModel):
    candidate: str = Field(max_length=4096)
    sdpMid: str | None = Field(None, max_length=256)
    sdpMLineIndex: int | None = Field(None, ge=0, le=64)
    usernameFragment: str | None = Field(None, max_length=256)


class Signal(BaseModel):
    call_id: UUID
    description: Description | None = None
    candidate: Candidate | None = None


@dataclass
class Call:
    id: str
    caller: int
    callee: int
    caller_socket: WebSocket
    conversation_id: int
    deadline: float
    callee_socket: WebSocket | None = None
    answered: bool = False
    candidate_count: int = 0


class CallRegistry:
    def __init__(self) -> None:
        self.calls: dict[str, Call] = {}
        self.lock = asyncio.Lock()

    async def invite(
        self, ws: WebSocket, caller: int, callee: int, body: Invite, profile: dict
    ) -> None:
        if body.offer.type != "offer":
            raise bad_request("A call invitation needs an offer")
        call_id = str(body.call_id)
        async with self.lock:
            if call_id in self.calls or any(
                {caller, callee} & {c.caller, c.callee} for c in self.calls.values()
            ):
                raise bad_request("This person is already in a call")
            if not manager.is_online(callee):
                raise bad_request("This person is offline. Try calling when they're online.")
            call = Call(call_id, caller, callee, ws, body.conversation_id, time.monotonic() + 45)
            self.calls[call_id] = call
            await manager.send_socket(ws, "call.ringing", {"call_id": call_id})
            await manager.send_to_user(
                callee,
                "call.incoming",
                {
                    "call_id": call_id,
                    "conversation_id": body.conversation_id,
                    "kind": body.kind,
                    "caller": profile,
                    "offer": body.offer.model_dump(),
                },
            )

    def _participant(
        self, call_id: str, user_id: int, ws: WebSocket, *, ringing: bool = False
    ) -> Call:
        call = self.calls.get(call_id)
        if call is None:
            raise bad_request("This call has ended")
        if user_id == call.caller and ws is call.caller_socket:
            return call
        if user_id == call.callee and (
            ws is call.callee_socket or (ringing and call.callee_socket is None)
        ):
            return call
        raise forbidden("This call belongs to another session")

    async def accept(self, call_id: str, user_id: int, ws: WebSocket) -> None:
        async with self.lock:
            call = self._participant(call_id, user_id, ws, ringing=True)
            if user_id != call.callee or call.callee_socket is not None:
                raise bad_request("This call was already answered")
            call.callee_socket = ws
            call.deadline = time.monotonic() + 40
            await manager.send_socket(ws, "call.accepted", {"call_id": call_id})
            await manager.send_socket(call.caller_socket, "call.accepted", {"call_id": call_id})
            await manager.send_to_users(
                [user_id], "call.dismissed", {"call_id": call_id}, exclude=ws
            )

    async def signal(self, call_id: str, user_id: int, ws: WebSocket, body: Signal) -> None:
        async with self.lock:
            call = self._participant(call_id, user_id, ws)
            target = call.callee_socket if user_id == call.caller else call.caller_socket
            if target is None:
                raise bad_request("The call has not been accepted")
            if body.description:
                if user_id != call.callee or body.description.type != "answer" or call.answered:
                    raise bad_request("Unexpected call description")
                call.answered = True
            elif body.candidate:
                call.candidate_count += 1
                if call.candidate_count > 256:
                    raise bad_request("Too many connection candidates")
            else:
                raise bad_request("Missing call signal")
            await manager.send_socket(
                target, "call.signal", body.model_dump(mode="json", exclude_none=True)
            )

    async def connected(self, call_id: str, user_id: int, ws: WebSocket) -> None:
        async with self.lock:
            call = self._participant(call_id, user_id, ws)
            if call.answered:
                call.deadline = float("inf")

    async def end(self, call_id: str, user_id: int, ws: WebSocket, reason: str) -> None:
        async with self.lock:
            call = self._participant(call_id, user_id, ws, ringing=True)
            self.calls.pop(call_id)
            await self._notify_end(call, reason)

    async def _notify_end(self, call: Call, reason: str) -> None:
        await manager.send_to_users(
            [call.caller, call.callee], "call.ended", {"call_id": call.id, "reason": reason}
        )

    async def disconnected(self, user_id: int, ws: WebSocket) -> None:
        async with self.lock:
            for call in list(self.calls.values()):
                if (
                    ws is call.caller_socket
                    or ws is call.callee_socket
                    or (
                        user_id == call.callee
                        and call.callee_socket is None
                        and not manager.is_online(user_id)
                    )
                ):
                    self.calls.pop(call.id)
                    await self._notify_end(call, "disconnected")

    async def expire(self) -> None:
        async with self.lock:
            for call in list(self.calls.values()):
                if call.deadline <= time.monotonic():
                    self.calls.pop(call.id)
                    await self._notify_end(
                        call, "no_answer" if call.callee_socket is None else "connection_failed"
                    )

    async def blocked(self, user_id: int, other_id: int) -> None:
        async with self.lock:
            for call in list(self.calls.values()):
                if {call.caller, call.callee} == {user_id, other_id}:
                    self.calls.pop(call.id)
                    await self._notify_end(call, "hangup")


calls = CallRegistry()
