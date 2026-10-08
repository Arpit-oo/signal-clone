from fastapi import APIRouter

from app.api.deps import DB
from app.core.config import get_settings
from app.core.errors import bad_request
from app.core.security import create_access_token
from app.schemas.user import AuthOut, OtpRequest, OtpRequestOut, OtpVerify
from app.services import conversations as conv_svc
from app.services import users as users_svc

router = APIRouter(prefix="/auth", tags=["auth"])
settings = get_settings()


@router.post("/request-otp", response_model=OtpRequestOut)
async def request_otp(body: OtpRequest) -> OtpRequestOut:
    # No SMS is sent: verification is mocked with a fixed code.
    return OtpRequestOut(phone=body.phone, dev_code=settings.mock_otp)


@router.post("/verify", response_model=AuthOut)
async def verify(body: OtpVerify, db: DB) -> AuthOut:
    if body.code != settings.mock_otp:
        raise bad_request("Incorrect code. Try again.")
    user, created = await users_svc.get_or_create_by_phone(db, body.phone)
    await conv_svc.get_or_create_note_to_self(db, user)
    return AuthOut(
        token=create_access_token(user.id),
        user=users_svc.present_me(user),
        # The client sends new users (and users who never set a name) to profile setup.
        is_new=created or not user.display_name,
    )
