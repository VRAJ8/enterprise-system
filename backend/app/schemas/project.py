import uuid
from datetime import date, datetime
from typing import Annotated

from pydantic import Field, StringConstraints, model_validator

from app.models.enums import Health, Priority, ProjectRole, ProjectStatus, ProjectVisibility, StatusCategory
from app.schemas.common import Color, Name, Schema, UserBrief

ProjectKey = Annotated[str, StringConstraints(strip_whitespace=True, to_upper=True, pattern=r"^[A-Z][A-Z0-9]{1,5}$")]


class ProjectCreate(Schema):
    name: Name
    key: ProjectKey | None = Field(default=None, description="2–6 chars; derived from the name when omitted")
    description: str = Field(default="", max_length=20000)
    color: Color = "#6366f1"
    icon: str = Field(default="folder", max_length=32)
    status: ProjectStatus = ProjectStatus.active
    priority: Priority = Priority.medium
    visibility: ProjectVisibility = ProjectVisibility.workspace
    lead_id: uuid.UUID | None = None
    start_date: date | None = None
    target_date: date | None = None
    member_ids: list[uuid.UUID] = Field(default_factory=list)

    @model_validator(mode="after")
    def _dates(self):
        if self.start_date and self.target_date and self.target_date < self.start_date:
            raise ValueError("target_date must be on or after start_date")
        return self


class ProjectUpdate(Schema):
    name: Name | None = None
    key: ProjectKey | None = None
    description: str | None = Field(default=None, max_length=20000)
    color: Color | None = None
    icon: str | None = Field(default=None, max_length=32)
    status: ProjectStatus | None = None
    priority: Priority | None = None
    visibility: ProjectVisibility | None = None
    lead_id: uuid.UUID | None = None
    start_date: date | None = None
    target_date: date | None = None


class ProjectStats(Schema):
    total: int = 0
    open: int = 0
    completed: int = 0
    overdue: int = 0
    progress: float = Field(default=0.0, description="0–1, share of non-canceled tasks completed")


class ProjectOut(Schema):
    id: uuid.UUID
    workspace_id: uuid.UUID
    key: str
    name: str
    description: str
    color: str
    icon: str
    status: ProjectStatus
    priority: Priority
    visibility: ProjectVisibility
    lead: UserBrief | None
    start_date: date | None
    target_date: date | None
    created_at: datetime
    updated_at: datetime
    my_role: ProjectRole | None = Field(description="Effective access level of the current user")
    member_count: int
    stats: ProjectStats


class ProjectMemberOut(Schema):
    user: UserBrief
    role: ProjectRole
    added_at: datetime


class ProjectMemberCreate(Schema):
    user_id: uuid.UUID
    role: ProjectRole = ProjectRole.member


class ProjectMemberUpdate(Schema):
    role: ProjectRole


class StatusOut(Schema):
    id: uuid.UUID
    project_id: uuid.UUID
    name: str
    category: StatusCategory
    color: str
    position: float
    task_count: int = 0


class StatusCreate(Schema):
    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=48)]
    category: StatusCategory
    color: Color


class StatusUpdate(Schema):
    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=48)] | None = None
    category: StatusCategory | None = None
    color: Color | None = None


class StatusReorder(Schema):
    status_ids: list[uuid.UUID]


class MilestoneCreate(Schema):
    name: Name
    description: str = Field(default="", max_length=5000)
    due_date: date | None = None


class MilestoneUpdate(Schema):
    name: Name | None = None
    description: str | None = Field(default=None, max_length=5000)
    due_date: date | None = None
    completed: bool | None = None


class MilestoneOut(Schema):
    id: uuid.UUID
    project_id: uuid.UUID
    name: str
    description: str
    due_date: date | None
    completed_at: datetime | None
    created_at: datetime
    task_total: int = 0
    task_done: int = 0


class ProjectUpdateCreate(Schema):
    health: Health
    body: str = Field(min_length=1, max_length=20000)


class ProjectUpdateOut(Schema):
    id: uuid.UUID
    project_id: uuid.UUID
    author: UserBrief | None
    health: Health
    body: str
    created_at: datetime
