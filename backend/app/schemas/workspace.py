import uuid
from datetime import datetime
from typing import Annotated

from pydantic import EmailStr, Field, StringConstraints

from app.models.enums import WorkspaceRole
from app.schemas.common import Color, Name, Schema, UserBrief

Slug = Annotated[
    str, StringConstraints(strip_whitespace=True, to_lower=True, pattern=r"^[a-z0-9](?:[a-z0-9-]{1,46}[a-z0-9])$")
]


class WorkspaceCreate(Schema):
    name: Name
    slug: Slug | None = None


class WorkspaceUpdate(Schema):
    name: Name | None = None
    slug: Slug | None = None


class WorkspaceOut(Schema):
    id: uuid.UUID
    name: str
    slug: str
    created_at: datetime
    role: WorkspaceRole
    member_count: int


class MemberOut(Schema):
    user: UserBrief
    role: WorkspaceRole
    weekly_capacity_hours: float
    joined_at: datetime
    deactivated: bool
    last_login_at: datetime | None = None


class MemberUpdate(Schema):
    role: WorkspaceRole | None = None
    weekly_capacity_hours: float | None = Field(default=None, ge=0, le=168)
    deactivated: bool | None = None


class InvitationCreate(Schema):
    email: EmailStr
    role: WorkspaceRole = WorkspaceRole.member


class InvitationOut(Schema):
    id: uuid.UUID
    email: str
    role: WorkspaceRole
    created_at: datetime
    expires_at: datetime
    accepted_at: datetime | None
    invited_by: UserBrief | None = None
    # Only returned when the invitation is created (the token is never stored in plain text)
    invite_url: str | None = None


class InvitationLookupOut(Schema):
    workspace_name: str
    email: str
    role: WorkspaceRole
    inviter_name: str | None
    expired: bool
    accepted: bool
    account_exists: bool


class AcceptInvitationIn(Schema):
    token: str


class LabelCreate(Schema):
    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=48)]
    color: Color


class LabelUpdate(Schema):
    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=48)] | None = None
    color: Color | None = None


class LabelOut(Schema):
    id: uuid.UUID
    name: str
    color: str
