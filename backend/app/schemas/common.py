"""Shared schema building blocks."""

import uuid
from datetime import date, datetime
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

from app.models.enums import Priority, ProjectStatus, StatusCategory

Color = Annotated[str, StringConstraints(pattern=r"^#[0-9a-fA-F]{6}$")]
Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)]


class Schema(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class UserBrief(Schema):
    id: uuid.UUID
    name: str
    email: str
    avatar_color: str
    title: str | None = None


class ProjectBrief(Schema):
    id: uuid.UUID
    key: str
    name: str
    color: str
    icon: str
    status: ProjectStatus


class StatusBrief(Schema):
    id: uuid.UUID
    name: str
    category: StatusCategory
    color: str


class TaskBrief(Schema):
    id: uuid.UUID
    ref: str = Field(description="Human reference, e.g. WEB-42")
    title: str
    project_id: uuid.UUID
    status: StatusBrief
    priority: Priority
    due_date: date | None = None


class MilestoneBrief(Schema):
    id: uuid.UUID
    name: str
    due_date: date | None = None
    completed_at: datetime | None = None


class Ok(Schema):
    ok: bool = True
