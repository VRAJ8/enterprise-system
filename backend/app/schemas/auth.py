import uuid
from datetime import datetime

from pydantic import EmailStr, Field

from app.models.enums import WorkspaceRole
from app.schemas.common import Color, Name, Schema


class RegisterIn(Schema):
    name: Name
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    # Join an existing workspace through an invitation…
    invite_token: str | None = None
    # …or create a new one (required when not invited).
    workspace_name: Name | None = None


class LoginIn(Schema):
    email: EmailStr
    password: str = Field(max_length=128)


class MembershipOut(Schema):
    workspace_id: uuid.UUID
    workspace_name: str
    workspace_slug: str
    role: WorkspaceRole


class MeOut(Schema):
    id: uuid.UUID
    name: str
    email: str
    avatar_color: str
    title: str | None
    timezone: str
    created_at: datetime
    workspaces: list[MembershipOut]


class MeUpdate(Schema):
    name: Name | None = None
    title: str | None = Field(default=None, max_length=120)
    timezone: str | None = Field(default=None, max_length=64)
    avatar_color: Color | None = None


class ChangePasswordIn(Schema):
    current_password: str
    new_password: str = Field(min_length=8, max_length=128)


class TokenOut(Schema):
    access_token: str
    token_type: str = "bearer"
    expires_in: int
    user: MeOut


class SessionOut(Schema):
    id: uuid.UUID
    user_agent: str | None
    ip: str | None
    created_at: datetime
    last_used_at: datetime
    current: bool = False
