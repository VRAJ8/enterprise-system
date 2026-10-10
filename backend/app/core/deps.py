"""FastAPI dependencies shared by every router."""

import uuid
from typing import Annotated

from fastapi import Depends
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_db
from app.core.errors import Unauthorized
from app.core.security import decode_access_token
from app.models import User

_bearer = HTTPBearer(auto_error=False)

DB = Annotated[AsyncSession, Depends(get_db)]


async def user_from_token(db: AsyncSession, token: str) -> User:
    payload = decode_access_token(token)
    try:
        user_id = uuid.UUID(payload["sub"])
    except (KeyError, ValueError):
        raise Unauthorized("Invalid access token", code="invalid_token") from None
    user = await db.get(User, user_id)
    if user is None or not user.is_active:
        raise Unauthorized("Account not found or disabled", code="invalid_token")
    return user


async def get_current_user(db: DB, creds: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)]) -> User:
    if creds is None or creds.scheme.lower() != "bearer":
        raise Unauthorized("Not authenticated", code="not_authenticated")
    return await user_from_token(db, creds.credentials)


CurrentUser = Annotated[User, Depends(get_current_user)]
