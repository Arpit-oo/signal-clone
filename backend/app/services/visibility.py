"""Which messages a member is allowed to see.

Shared by the timeline, the conversation list (last message, unread counts) and search so
they never disagree.
"""

from sqlalchemy import and_, exists, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.sql.elements import ColumnElement

from app.db.base import utcnow
from app.models import ConversationMember, Message, MessageHidden


def visible_to(viewer_id: int | ColumnElement[int]) -> list[ColumnElement[bool]]:
    """Filter clauses for `Message` joined to the viewer's `ConversationMember` row.

    The caller must join ConversationMember on Message.conversation_id.
    """
    cm = ConversationMember
    return [
        cm.user_id == viewer_id,
        # Members only see messages from while they were in the conversation.
        Message.created_at >= cm.joined_at,
        or_(cm.left_at.is_(None), Message.created_at <= cm.left_at),
        # "Delete chat" clears history for this member only.
        Message.id > func.coalesce(cm.cleared_before_id, 0),
        or_(Message.expires_at.is_(None), Message.expires_at > utcnow()),
        ~exists().where(
            and_(MessageHidden.message_id == Message.id, MessageHidden.user_id == viewer_id)
        ),
    ]


def visible_messages(viewer_id: int):
    """`select(Message)` already joined and filtered to what the viewer can see."""
    return (
        select(Message)
        .join(ConversationMember, ConversationMember.conversation_id == Message.conversation_id)
        .where(*visible_to(viewer_id))
    )


async def visible_viewers(db: AsyncSession, message_id: int, user_ids: list[int]) -> set[int]:
    """Apply the timeline's visibility rules to WebSocket recipients as well."""
    cm = ConversationMember
    return set(
        await db.scalars(
            select(cm.user_id)
            .join(Message, Message.conversation_id == cm.conversation_id)
            .where(Message.id == message_id, cm.user_id.in_(user_ids), *visible_to(cm.user_id))
        )
    )
