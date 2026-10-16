import uuid
from datetime import date, datetime
from typing import Annotated, Literal

from pydantic import Field, StringConstraints, model_validator

from app.models.enums import Priority
from app.schemas.common import MilestoneBrief, ProjectBrief, Schema, StatusBrief, TaskBrief, UserBrief
from app.schemas.workspace import LabelOut

TaskTitle = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=300)]


class TaskOut(Schema):
    """List representation, used by board, list, timeline, my tasks and search."""

    id: uuid.UUID
    ref: str
    number: int
    title: str
    project: ProjectBrief
    status: StatusBrief
    priority: Priority
    assignee: UserBrief | None
    parent_id: uuid.UUID | None
    milestone_id: uuid.UUID | None
    start_date: date | None
    due_date: date | None
    estimate_hours: float | None
    position: float
    labels: list[LabelOut]
    subtask_count: int = 0
    subtask_done_count: int = 0
    comment_count: int = 0
    attachment_count: int = 0
    blocked_by_count: int = Field(default=0, description="Open tasks that block this one")
    is_overdue: bool = False
    started_at: datetime | None
    completed_at: datetime | None
    created_at: datetime
    updated_at: datetime


class TaskDetail(TaskOut):
    description: str
    reporter: UserBrief | None
    parent: TaskBrief | None
    milestone: MilestoneBrief | None
    subtasks: list[TaskOut]
    blocked_by: list[TaskBrief]
    blocking: list[TaskBrief]
    watchers: list[UserBrief]
    is_watching: bool
    time_logged_minutes: int
    can_edit: bool


class TaskCreate(Schema):
    title: TaskTitle
    description: str = Field(default="", max_length=50000)
    status_id: uuid.UUID | None = Field(default=None, description="Defaults to the project's first 'todo' status")
    priority: Priority = Priority.none
    assignee_id: uuid.UUID | None = None
    parent_id: uuid.UUID | None = None
    milestone_id: uuid.UUID | None = None
    start_date: date | None = None
    due_date: date | None = None
    estimate_hours: float | None = Field(default=None, ge=0, le=10000)
    label_ids: list[uuid.UUID] = Field(default_factory=list)
    placement: Literal["top", "bottom"] = "bottom"

    @model_validator(mode="after")
    def _dates(self):
        if self.start_date and self.due_date and self.due_date < self.start_date:
            raise ValueError("due_date must be on or after start_date")
        return self


class TaskUpdate(Schema):
    title: TaskTitle | None = None
    description: str | None = Field(default=None, max_length=50000)
    status_id: uuid.UUID | None = None
    priority: Priority | None = None
    assignee_id: uuid.UUID | None = None
    parent_id: uuid.UUID | None = None
    milestone_id: uuid.UUID | None = None
    start_date: date | None = None
    due_date: date | None = None
    estimate_hours: float | None = Field(default=None, ge=0, le=10000)
    label_ids: list[uuid.UUID] | None = Field(default=None, description="Replaces the full label set")


class TaskMove(Schema):
    """Drag & drop: optionally change status, and place between two neighbours (either may be null)."""

    status_id: uuid.UUID | None = None
    after_id: uuid.UUID | None = Field(default=None, description="Task that should end up directly above")
    before_id: uuid.UUID | None = Field(default=None, description="Task that should end up directly below")


class TaskBulkUpdate(Schema):
    """Same change applied to every task (all-or-nothing). Omitted fields are left alone."""

    task_ids: list[uuid.UUID] = Field(min_length=1, max_length=500)
    status_id: uuid.UUID | None = Field(default=None, description="Must belong to every task's project")
    priority: Priority | None = None
    assignee_id: uuid.UUID | None = None
    clear_assignee: bool = False
    milestone_id: uuid.UUID | None = Field(
        default=None, description="Must belong to every task's project; explicit null clears"
    )
    due_date: date | None = Field(default=None, description="Explicit null clears the due date")
    add_label_ids: list[uuid.UUID] = Field(default_factory=list)
    remove_label_ids: list[uuid.UUID] = Field(default_factory=list)
    delete: bool = Field(
        default=False, description="Move the tasks (and their subtasks) to the trash; other fields are ignored"
    )


class BulkResult(Schema):
    updated: int
    task_ids: list[uuid.UUID]


TaskSort = Literal["position", "due_date", "priority", "updated", "created", "title"]
DueFilter = Literal["overdue", "today", "week", "none", "scheduled"]
StateFilter = Literal["open", "closed", "all"]


class TaskList(Schema):
    items: list[TaskOut]
    next_cursor: str | None = None
    total: int
