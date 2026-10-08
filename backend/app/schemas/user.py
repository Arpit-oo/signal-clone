import re
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator

PHONE_RE = re.compile(r"^\+?[1-9]\d{6,14}$")
USERNAME_RE = re.compile(r"^[a-z][a-z0-9_]{2,31}$")
AVATAR_COLORS = tuple(f"A{n}" for n in range(100, 220, 10))


def normalize_phone(raw: str) -> str:
    digits = re.sub(r"[\s\-().]", "", raw)
    if not digits.startswith("+"):
        digits = "+" + digits
    if not PHONE_RE.match(digits):
        raise ValueError("Enter a valid phone number with country code")
    return digits


class UserOut(BaseModel):
    """What other people can see about a user."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    phone: str
    username: str | None
    display_name: str
    about: str
    about_emoji: str | None
    avatar_url: str | None
    avatar_color: str
    last_seen_at: datetime | None
    is_online: bool = False
    is_contact: bool = False
    is_blocked: bool = False
    nickname: str | None = None


class MeOut(UserOut):
    read_receipts_enabled: bool
    typing_indicators_enabled: bool
    created_at: datetime


class MeUpdate(BaseModel):
    display_name: str | None = Field(None, min_length=1, max_length=64)
    username: str | None = Field(None, max_length=32)
    about: str | None = Field(None, max_length=140)
    about_emoji: str | None = Field(None, max_length=16)
    avatar_color: str | None = None
    read_receipts_enabled: bool | None = None
    typing_indicators_enabled: bool | None = None

    @field_validator(
        "display_name",
        "about",
        "avatar_color",
        "read_receipts_enabled",
        "typing_indicators_enabled",
        mode="before",
    )
    @classmethod
    def _not_null(cls, v):
        if v is None:
            raise ValueError("This field cannot be null")
        return v

    @field_validator("display_name")
    @classmethod
    def _strip_name(cls, v: str | None) -> str | None:
        if v is None:
            return v
        v = v.strip()
        if not v:
            raise ValueError("Name cannot be empty")
        return v

    @field_validator("username")
    @classmethod
    def _check_username(cls, v: str | None) -> str | None:
        if v is None or v == "":
            return v
        v = v.strip().lower()
        if not USERNAME_RE.match(v):
            raise ValueError(
                "Usernames are 3-32 characters: letters, numbers and underscores, "
                "starting with a letter"
            )
        return v

    @field_validator("avatar_color")
    @classmethod
    def _check_color(cls, v: str | None) -> str | None:
        if v is not None and v not in AVATAR_COLORS:
            raise ValueError("Unknown avatar color")
        return v


class OtpRequest(BaseModel):
    phone: str

    @field_validator("phone")
    @classmethod
    def _phone(cls, v: str) -> str:
        return normalize_phone(v)


class OtpVerify(OtpRequest):
    code: str = Field(min_length=6, max_length=6)


class OtpRequestOut(BaseModel):
    phone: str
    # Verification is mocked; the code is returned so the UI can hint at it.
    dev_code: str


class AuthOut(BaseModel):
    token: str
    user: MeOut
    is_new: bool


class ContactCreate(BaseModel):
    user_id: int | None = None
    phone: str | None = None
    username: str | None = None
    nickname: str | None = Field(None, max_length=64)


class ContactUpdate(BaseModel):
    nickname: str | None = Field(None, max_length=64)
