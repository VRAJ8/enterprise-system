"""Password hashing (Argon2), JWT access tokens and opaque refresh tokens."""

import hashlib
import secrets
import uuid
from datetime import UTC, datetime, timedelta

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError

from app.core.config import settings
from app.core.errors import Unauthorized

# Cheap parameters under test so the suite stays fast; library defaults otherwise.
_hasher = PasswordHasher(time_cost=1, memory_cost=1024, parallelism=1) if settings.is_test else PasswordHasher()

ALGORITHM = "HS256"


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password: str, password_hash: str | None) -> bool:
    if not password_hash:
        return False
    try:
        return _hasher.verify(password_hash, password)
    except (VerificationError, InvalidHashError):
        return False


def needs_rehash(password_hash: str) -> bool:
    return _hasher.check_needs_rehash(password_hash)


def create_access_token(user_id: uuid.UUID, session_id: uuid.UUID) -> tuple[str, int]:
    """Returns (token, expires_in_seconds)."""
    expires_in = settings.access_token_minutes * 60
    now = datetime.now(UTC)
    payload = {
        "sub": str(user_id),
        "sid": str(session_id),
        "type": "access",
        "iat": now,
        "exp": now + timedelta(seconds=expires_in),
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=ALGORITHM), expires_in


def decode_access_token(token: str) -> dict:
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=[ALGORITHM])
    except jwt.ExpiredSignatureError:
        raise Unauthorized("Access token expired", code="token_expired") from None
    except jwt.InvalidTokenError:
        raise Unauthorized("Invalid access token", code="invalid_token") from None
    if payload.get("type") != "access":
        raise Unauthorized("Invalid access token", code="invalid_token")
    return payload


def new_opaque_token() -> str:
    """Random token for refresh sessions and invitations (only its hash is stored)."""
    return secrets.token_urlsafe(48)


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()
