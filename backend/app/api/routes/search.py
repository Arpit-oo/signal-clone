from fastapi import APIRouter, Query
from pydantic import BaseModel

from app.api.deps import DB, CurrentUser
from app.schemas.conversation import ConversationOut
from app.schemas.message import MessageOut
from app.schemas.user import UserOut
from app.services import conversations as conv_svc
from app.services import messages as msg_svc
from app.services import users as users_svc

router = APIRouter(tags=["search"])


class SearchResults(BaseModel):
    conversations: list[ConversationOut]
    contacts: list[UserOut]
    messages: list[MessageOut]


@router.get("/search", response_model=SearchResults)
async def search(me: CurrentUser, db: DB, q: str = Query(min_length=1, max_length=200)):
    """Signal's left-pane search: chats, contacts (people without a chat yet), and messages."""
    needle = q.strip().lower().lstrip("@")
    conversations = [
        c
        for c in await conv_svc.list_conversations(db, me)
        if needle
        and (
            needle in c.name.lower()
            or (
                c.peer
                and any(
                    needle in (value or "").lower()
                    for value in (
                        c.peer.phone,
                        c.peer.display_name,
                        c.peer.username,
                        c.peer.nickname,
                    )
                )
            )
        )
    ]
    in_chats = {c.peer.id for c in conversations if c.peer}
    people = await users_svc.present_users(db, me.id, await users_svc.search_users(db, me, q))
    contacts = [p for p in people if p.id not in in_chats and not p.is_blocked]
    messages = await msg_svc.search_messages(db, me, q)
    return SearchResults(conversations=conversations, contacts=contacts, messages=messages)
