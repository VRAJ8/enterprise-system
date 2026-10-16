import datetime as dt  # module import: the `date` field name below would otherwise shadow the `date` type
import uuid

from pydantic import Field

from app.schemas.common import ProjectBrief, Schema, TaskBrief, UserBrief


class TimeEntryOut(Schema):
    id: uuid.UUID
    task: TaskBrief
    project: ProjectBrief
    user: UserBrief
    started_at: dt.datetime
    ended_at: dt.datetime | None
    minutes: int = Field(description="Final duration; for a running timer, minutes elapsed so far")
    note: str
    running: bool


class TimeEntryCreate(Schema):
    minutes: int = Field(ge=1, le=24 * 60)
    date: dt.date | None = Field(
        default=None, description="Day the work happened, in your timezone (defaults to today); starts at 09:00"
    )
    started_at: dt.datetime | None = Field(
        default=None, description="Exact start; overrides `date`. Without an offset it is read in your timezone"
    )
    note: str = Field(default="", max_length=2000)


class TimeEntryUpdate(Schema):
    minutes: int | None = Field(default=None, ge=1, le=24 * 60)
    date: dt.date | None = Field(default=None, description="Move the entry to this day (your timezone), same time")
    note: str | None = Field(default=None, max_length=2000)


class TimerStart(Schema):
    note: str = Field(default="", max_length=2000)


class TimerOut(Schema):
    entry: TimeEntryOut | None
