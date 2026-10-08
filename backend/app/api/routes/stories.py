import json

from fastapi import APIRouter, Form, UploadFile
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse
from pydantic import ValidationError

from app.api.deps import DB, CurrentUser, MediaUser
from app.core.errors import bad_request, not_found
from app.schemas.story import StoryCreate, StoryOut, StoryViewer
from app.services import storage
from app.services import stories as story_svc

router = APIRouter(prefix="/stories", tags=["stories"])


@router.get("", response_model=list[StoryOut])
async def feed(me: CurrentUser, db: DB):
    return await story_svc.feed(db, me)


@router.post("", response_model=StoryOut, status_code=201)
async def create(
    me: CurrentUser,
    db: DB,
    recipient_ids: str = Form(),
    body: str = Form(""),
    color: str = Form("#3B45FD"),
    file: UploadFile | None = None,
):
    try:
        audience = json.loads(recipient_ids)
    except json.JSONDecodeError as exc:
        raise bad_request("recipient_ids must be a JSON array of user IDs") from exc
    try:
        data = StoryCreate(body=body, color=color, recipient_ids=audience)
    except ValidationError as exc:
        raise RequestValidationError(exc.errors()) from exc
    return await story_svc.create(db, me, data, file)


@router.post("/{story_id}/views", status_code=204)
async def mark_viewed(story_id: int, me: CurrentUser, db: DB) -> None:
    await story_svc.mark_viewed(db, me, story_id)


@router.get("/{story_id}/views", response_model=list[StoryViewer])
async def viewers(story_id: int, me: CurrentUser, db: DB):
    return await story_svc.viewers(db, me, story_id)


@router.delete("/{story_id}", status_code=204)
async def remove(story_id: int, me: CurrentUser, db: DB) -> None:
    await story_svc.remove(db, me, story_id)


@router.get("/{story_id}/media")
async def media(story_id: int, me: MediaUser, db: DB) -> FileResponse:
    story = await story_svc.get_visible(db, me, story_id)
    if not story.storage_key:
        raise not_found("Story media")
    path = storage.path_for(story.storage_key)
    if not path.is_file():
        raise not_found("Story media")
    return FileResponse(
        path,
        media_type=story.mime_type,
        headers={
            "Cache-Control": "private, no-store",
            "X-Content-Type-Options": "nosniff",
        },
    )
