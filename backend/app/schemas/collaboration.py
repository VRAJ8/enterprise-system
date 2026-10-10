import uuid
from datetime import datetime

from pydantic import Field

from app.models.enums import NotificationType
from app.schemas.common import ProjectBrief, Schema, TaskBrief, UserBrief


class CommentCreate(Schema):
    body: str = Field(min_length=1, max_length=20000)


class CommentUpdate(Schema):
    body: str = Field(min_length=1, max_length=20000)


class CommentOut(Schema):
    id: uuid.UUID
    task_id: uuid.UUID
    author: UserBrief | None
    body: str
    created_at: datetime
    edited_at: datetime | None
    can_edit: bool = False


class AttachmentOut(Schema):
    id: uuid.UUID
    task_id: uuid.UUID
    uploader: UserBrief | None
    filename: str
    content_type: str
    size_bytes: int
    created_at: datetime
    is_image: bool = False


class ActivityOut(Schema):
    id: uuid.UUID
    verb: str
    actor: UserBrief | None
    project_id: uuid.UUID | None
    task: TaskBrief | None
    data: dict
    created_at: datetime


class NotificationOut(Schema):
    id: uuid.UUID
    type: NotificationType
    workspace_id: uuid.UUID
    actor: UserBrief | None
    project: ProjectBrief | None
    task: TaskBrief | None
    data: dict
    read_at: datetime | None
    created_at: datetime


class UnreadCount(Schema):
    count: int


class MarkRead(Schema):
    ids: list[uuid.UUID] = Field(default_factory=list)
    all: bool = False
    workspace_id: uuid.UUID | None = None
