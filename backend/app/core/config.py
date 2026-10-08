from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

BASE_DIR = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_name: str = "Signal Clone API"
    database_url: str = f"sqlite+aiosqlite:///{(BASE_DIR / 'data' / 'signal.db').as_posix()}"
    # Tests open the DB from more than one event loop, which pooled aiosqlite connections dislike.
    db_null_pool: bool = False
    upload_dir: Path = BASE_DIR / "data" / "uploads"
    max_upload_bytes: int = 25 * 1024 * 1024

    jwt_secret: str = "dev-only-secret-change-me-in-production-0123456789"
    jwt_algorithm: str = "HS256"
    jwt_ttl_days: int = 30

    # Phone verification is mocked: every number accepts this code.
    mock_otp: str = "123456"

    cors_origins: list[str] = ["http://localhost:3000", "http://127.0.0.1:3000"]

    # Edits are allowed for this long after sending (Signal uses 24h).
    edit_window_seconds: int = 24 * 60 * 60
    typing_ttl_seconds: int = 6
    expiry_sweep_seconds: float = 2.0

    seed_on_startup: bool = False


@lru_cache
def get_settings() -> Settings:
    return Settings()
