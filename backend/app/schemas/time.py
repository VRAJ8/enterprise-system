import uuid
from datetime import date, datetime

from pydantic import Field

from app.schemas.common import ProjectBrief, Schema, TaskBrief, UserBrief


class TimeEntryOut(Schema):
    id: uuid.UUID
    task: TaskBrief
    project: ProjectBrief
    user: UserBrief
    started_at: datetime
    ended_at: datetime | None
    minutes: int = Field(description="Final duration; for a running timer, minutes elapsed so far")
    note: str
    running: bool


class TimeEntryCreate(Schema):
    minutes: int = Field(ge=1, le=24 * 60)
    date: date | None = Field(default=None, description="Day the work happened (defaults to today)")
    started_at: datetime | None = Field(default=None, description="Exact start; overrides `date`")
    note: str = Field(default="", max_length=2000)


class TimeEntryUpdate(Schema):
    minutes: int | None = Field(default=None, ge=1, le=24 * 60)
    date: date | None = None
    note: str | None = Field(default=None, max_length=2000)


class TimerStart(Schema):
    note: str = Field(default="", max_length=2000)


class TimerOut(Schema):
    entry: TimeEntryOut | None
