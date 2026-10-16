import uuid
from datetime import date
from typing import Literal

from pydantic import Field

from app.schemas.common import ProjectBrief, Schema, TaskBrief, UserBrief
from app.schemas.project import MilestoneOut, ProjectUpdateOut
from app.schemas.task import TaskOut
from app.schemas.time import TimeEntryOut

HealthStatus = Literal["on_track", "at_risk", "off_track", "not_started", "done", "no_data"]


class HealthOut(Schema):
    status: HealthStatus
    reasons: list[str] = Field(default_factory=list, description="Human-readable explanations, most important first")
    progress: float = Field(description="0–1 share of scope completed (estimate-weighted when estimates exist)")
    expected_progress: float | None = Field(description="0–1 share of the schedule elapsed; null without dates")


class ScopeOut(Schema):
    total: int
    open: int
    done: int
    canceled: int
    overdue: int
    blocked: int
    unassigned: int
    unestimated: int
    estimate_total_hours: float
    estimate_done_hours: float


class ForecastOut(Schema):
    completion_date: date | None = Field(description="Projected finish at recent throughput; null if not enough data")
    earliest: date | None
    latest: date | None
    weekly_throughput: float = Field(description="Median tasks completed per week, last 6 weeks")
    confidence: Literal["high", "medium", "low", "none"]
    will_miss_target: bool | None = Field(description="Forecast later than the project's target date")


class BurnupPoint(Schema):
    date: date
    scope: int
    completed: int


class StatusCount(Schema):
    status_id: uuid.UUID
    name: str
    category: str
    color: str
    count: int


class WeekCount(Schema):
    week_start: date
    completed: int
    created: int


class PersonLoad(Schema):
    user: UserBrief
    open_tasks: int
    estimate_hours: float
    overdue: int


class MilestoneRisk(MilestoneOut):
    at_risk: bool = False
    risk_reason: str | None = None


class ProjectInsightsOut(Schema):
    project_id: uuid.UUID
    health: HealthOut
    scope: ScopeOut
    forecast: ForecastOut
    burnup: list[BurnupPoint]
    status_breakdown: list[StatusCount]
    weekly: list[WeekCount]
    cycle_time_days: float | None
    people: list[PersonLoad]
    milestones: list[MilestoneRisk]
    at_risk_tasks: list[TaskOut] = Field(description="Overdue, blocked, or due soon without being started")
    latest_update: ProjectUpdateOut | None


class PortfolioProject(Schema):
    project: ProjectBrief
    lead: UserBrief | None
    target_date: date | None
    health: HealthOut
    open: int
    overdue: int
    forecast_date: date | None
    latest_update_health: str | None


class PortfolioOut(Schema):
    projects: list[PortfolioProject]
    summary: dict[str, int] = Field(description="Count of projects per health status")


class WorkloadWeek(Schema):
    week_start: date
    planned_hours: float
    capacity_hours: float
    task_count: int
    utilization: float = Field(description="planned / capacity (can exceed 1)")


class WorkloadPerson(Schema):
    user: UserBrief
    capacity_hours: float
    weeks: list[WorkloadWeek]
    unscheduled_hours: float = Field(description="Open estimated work with no due date")
    unestimated_tasks: int
    overdue_tasks: int


class WorkloadOut(Schema):
    weeks: list[date]
    people: list[WorkloadPerson]


class TimeByUser(Schema):
    user: UserBrief
    minutes: int
    capacity_minutes: int
    utilization: float


class TimeByProject(Schema):
    project: ProjectBrief
    minutes: int


class TimeByDay(Schema):
    date: date
    minutes: int


class TimeReportOut(Schema):
    date_from: date
    date_to: date
    total_minutes: int
    by_user: list[TimeByUser]
    by_project: list[TimeByProject]
    by_day: list[TimeByDay]


class HomeProject(Schema):
    project: ProjectBrief
    health: HealthOut
    my_open_tasks: int


class HomeOut(Schema):
    open_count: int
    overdue: list[TaskOut]
    due_today: list[TaskOut]
    due_this_week: list[TaskOut]
    in_progress: list[TaskOut]
    review_queue: list[TaskOut] = Field(description="Tasks in review in projects the user leads")
    completed_last_7_days: int
    time_this_week_minutes: int
    capacity_hours: float
    timer: TimeEntryOut | None
    projects: list[HomeProject]


class SearchOut(Schema):
    tasks: list[TaskBrief]
    projects: list[ProjectBrief]
    people: list[UserBrief]
