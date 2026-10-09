"""Bundled fictional demo portraits, optimized and versioned for public delivery."""

from pathlib import Path

AVATAR_KEYS = ("alex", "priya", "marcus", "sofia", "liam", "aisha", "daniel", "emma", "rahul")
AVATAR_FILES = {f"{key}-v1": key for key in AVATAR_KEYS}
ASSETS = Path(__file__).parent / "assets" / "demo_avatars"


def avatar_url(key: str) -> str:
    if key not in AVATAR_KEYS:
        raise ValueError("Unknown demo portrait")
    return f"/api/demo-avatars/{key}-v1.jpg"


def avatar_path(key: str) -> Path:
    if key not in AVATAR_KEYS:
        raise ValueError("Unknown demo portrait")
    return ASSETS / f"{key}-v1.jpg"
