"""Which messages a member is allowed to see.

Shared by the timeline, the conversation list (last message, unread counts) and search so
they never disagree.
"""

from sqlalchemy import and_, exists, func, or_, select
from sqlalchemy.sql.elements import ColumnElement

from app.db.base import utcnow
from app.models import ConversationMember, Message, MessageHidden


def visible_to(viewer_id: int) -> list[ColumnElement[bool]]:
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
