"""Application settings, read from environment variables (and backend/.env)."""

import logging
from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parents[2]
logger = logging.getLogger(__name__)

_DEV_SECRET = "dev-insecure-secret-do-not-use-in-production-0123456789"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=BACKEND_DIR / ".env", extra="ignore")

    env: Literal["development", "test", "production"] = "development"
    database_url: str = "postgresql+asyncpg://pm:pm@localhost:5432/pm"

    jwt_secret: str = ""
    access_token_minutes: int = 15
    refresh_token_days: int = 30
    cookie_secure: bool = False
    cookie_samesite: Literal["lax", "strict", "none"] = "lax"

    # Comma-separated list of browser origins allowed to call the API
    cors_origins: str = "http://localhost:5173"
    # Public URL of the web app (used in invitation links and emails)
    app_url: str = "http://localhost:5173"

    # When false, people can only join through an invitation (the first account is always allowed)
    allow_signup: bool = True

    upload_dir: Path = BACKEND_DIR / "uploads"
    max_upload_mb: int = 25

    reminder_interval_minutes: int = 30
    enable_scheduler: bool = True

    @field_validator("database_url")
    @classmethod
    def _async_driver(cls, url: str) -> str:
        """Hosts like Render and Heroku hand out postgres:// URLs; the app needs the asyncpg driver."""
        for prefix in ("postgres://", "postgresql://"):
            if url.startswith(prefix):
                return "postgresql+asyncpg://" + url[len(prefix) :]
        return url

    @model_validator(mode="after")
    def _check_secret(self) -> "Settings":
        if not self.jwt_secret:
            if self.env == "production":
                raise ValueError("JWT_SECRET must be set in production")
            self.jwt_secret = _DEV_SECRET
        elif self.env == "production" and len(self.jwt_secret) < 32:
            raise ValueError("JWT_SECRET must be at least 32 characters in production")
        if self.cookie_samesite == "none" and not self.cookie_secure:
            raise ValueError("COOKIE_SAMESITE=none requires COOKIE_SECURE=true")
        return self

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def is_test(self) -> bool:
        return self.env == "test"


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
