from typing import Annotated

from fastapi import Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import get_current_user, get_user_for_media
from app.db.session import get_db
from app.models import User

DB = Annotated[AsyncSession, Depends(get_db)]
CurrentUser = Annotated[User, Depends(get_current_user)]
MediaUser = Annotated[User, Depends(get_user_for_media)]
