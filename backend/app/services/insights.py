"""Computed project insights: health, forecast, burn-up, cycle time and workload (ARCHITECTURE §7).

Everything here is plain arithmetic over task rows, so it is cheap to recompute on every request.
"""

import statistics
import uuid
from collections import defaultdict
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import CLOSED_CATEGORIES, Project, ProjectStatus, StatusCategory, Task, TaskDependency, TaskStatus
from app.schemas.insights import BurnupPoint, ForecastOut, HealthOut, ScopeOut, WeekCount

FORECAST_WEEKS = 6
CYCLE_TIME_DAYS = 30
DUE_SOON_DAYS = 2


@dataclass
class TaskRow:
    """The columns insights need, without loading full ORM objects."""

    id: uuid.UUID
    project_id: uuid.UUID
    category: StatusCategory
    assignee_id: uuid.UUID | None
    estimate: float | None
    start_date: date | None
    due_date: date | None
    created: date
    started_at: datetime | None
    completed_at: datetime | None

    @property
    def closed(self) -> bool:
        return self.category in CLOSED_CATEGORIES

    @property
    def done(self) -> bool:
        return self.category == StatusCategory.done


def week_start(day: date) -> date:
    return day - timedelta(days=day.weekday())


async def load_rows(db: AsyncSession, project_ids: list[uuid.UUID]) -> list[TaskRow]:
    if not project_ids:
        return []
    result = await db.execute(
        select(
            Task.id,
            Task.project_id,
            TaskStatus.category,
            Task.assignee_id,
            Task.estimate_hours,
            Task.start_date,
            Task.due_date,
            Task.created_at,
            Task.started_at,
            Task.completed_at,
        )
        .join(TaskStatus, TaskStatus.id == Task.status_id)
        .where(Task.project_id.in_(project_ids), Task.deleted_at.is_(None))
    )
    return [
        TaskRow(
            id=r[0],
            project_id=r[1],
            category=StatusCategory(r[2]),
            assignee_id=r[3],
            estimate=float(r[4]) if isinstance(r[4], Decimal) else r[4],
            start_date=r[5],
            due_date=r[6],
            created=r[7].date(),
            started_at=r[8],
            completed_at=r[9],
        )
        for r in result
    ]


async def blocked_ids(db: AsyncSession, task_ids: list[uuid.UUID]) -> set[uuid.UUID]:
    """Tasks (among `task_ids`) with at least one open, non-deleted blocker."""
    if not task_ids:
        return set()
    rows = await db.scalars(
        select(TaskDependency.blocked_id)
        .join(Task, Task.id == TaskDependency.blocker_id)
        .join(TaskStatus, TaskStatus.id == Task.status_id)
        .where(
            TaskDependency.blocked_id.in_(task_ids),
            Task.deleted_at.is_(None),
            TaskStatus.category.notin_([c.value for c in CLOSED_CATEGORIES]),
        )
    )
    return set(rows)


def scope(rows: list[TaskRow], blocked: set[uuid.UUID], today: date) -> ScopeOut:
    open_rows = [r for r in rows if not r.closed]
    return ScopeOut(
        total=len(rows),
        open=len(open_rows),
        done=sum(r.done for r in rows),
        canceled=sum(r.category == StatusCategory.canceled for r in rows),
        overdue=sum(1 for r in open_rows if r.due_date and r.due_date < today),
        blocked=sum(1 for r in open_rows if r.id in blocked),
        unassigned=sum(1 for r in open_rows if r.assignee_id is None),
        unestimated=sum(1 for r in open_rows if not r.estimate),
        estimate_total_hours=round(sum(r.estimate or 0 for r in rows if r.category != StatusCategory.canceled), 1),
        estimate_done_hours=round(sum(r.estimate or 0 for r in rows if r.done), 1),
    )


def progress(s: ScopeOut) -> float:
    """Share of scope done: estimate-weighted when estimates exist, otherwise by count (canceled excluded)."""
    if s.estimate_total_hours > 0:
        return min(1.0, s.estimate_done_hours / s.estimate_total_hours)
    countable = s.total - s.canceled
    return s.done / countable if countable else 0.0


def _pct(x: float) -> str:
    return f"{round(x * 100)}%"


def health(project: Project, s: ScopeOut, today: date) -> HealthOut:
    done_share = progress(s)
    start = project.start_date or project.created_at.date()
    expected: float | None = None
    if project.target_date and project.target_date > start:
        expected = min(1.0, max(0.0, (today - start).days / (project.target_date - start).days))

    def out(status, reasons):
        return HealthOut(status=status, reasons=reasons, progress=round(done_share, 3), expected_progress=expected)

    if project.status == ProjectStatus.completed or (s.total and s.open == 0 and s.done):
        return out("done", ["All work is complete"])
    if s.total == 0:
        return out("no_data", ["No tasks yet"])
    if project.start_date and project.start_date > today:
        return out("not_started", [f"Starts {project.start_date:%b %-d}"])

    off, risk = [], []
    if project.target_date and today > project.target_date:
        off.append(f"Past target date ({project.target_date:%b %-d}) with {s.open} open tasks")
    if expected is not None:
        gap = expected - done_share
        trail = f"{_pct(done_share)} done vs {_pct(expected)} of schedule elapsed"
        if gap > 0.25:
            off.append(trail)
        elif gap > 0.10:
            risk.append(trail)
    if s.overdue:
        risk.append(f"{s.overdue} overdue task{'s' if s.overdue != 1 else ''}")
    if s.blocked:
        risk.append(f"{s.blocked} blocked task{'s' if s.blocked != 1 else ''}")
    if off:
        return out("off_track", off + risk)
    if risk:
        return out("at_risk", risk)
    if expected is None:
        return out("on_track", [f"{_pct(done_share)} done · no target date set"])
    return out("on_track", [f"{_pct(done_share)} done, in line with schedule"])


def weekly(rows: list[TaskRow], today: date, weeks: int = FORECAST_WEEKS) -> list[WeekCount]:
    first = week_start(today) - timedelta(weeks=weeks - 1)
    completed: dict[date, int] = defaultdict(int)
    created: dict[date, int] = defaultdict(int)
    for r in rows:
        if r.done and r.completed_at:
            completed[week_start(r.completed_at.date())] += 1
        created[week_start(r.created)] += 1
    return [
        WeekCount(week_start=w, completed=completed[w], created=created[w])
        for w in (first + timedelta(weeks=i) for i in range(weeks))
    ]


def forecast(project: Project, s: ScopeOut, weeks: list[WeekCount], today: date) -> ForecastOut:
    # The current week is partial; use the full weeks before it.
    counts = [w.completed for w in weeks[:-1]] or [0]
    median = statistics.median(counts)
    active_weeks = sum(1 for c in counts if c)

    def none(confidence="none"):
        return ForecastOut(
            completion_date=None,
            earliest=None,
            latest=None,
            weekly_throughput=round(median, 1),
            confidence=confidence,
            will_miss_target=None,
        )

    if s.open == 0:
        return none()
    if median <= 0:
        return none("none")
    best = max(counts)
    worst = min((c for c in counts if c), default=median)
    completion = today + timedelta(days=round(s.open / median * 7))
    confidence = "high" if active_weeks >= 4 else "medium" if active_weeks >= 2 else "low"
    return ForecastOut(
        completion_date=completion,
        earliest=today + timedelta(days=round(s.open / best * 7)),
        latest=today + timedelta(days=round(s.open / worst * 7)),
        weekly_throughput=round(median, 1),
        confidence=confidence,
        will_miss_target=(completion > project.target_date) if project.target_date else None,
    )


def burnup(project: Project, rows: list[TaskRow], today: date, max_points: int = 60) -> list[BurnupPoint]:
    start = min([project.start_date or project.created_at.date(), *(r.created for r in rows)])
    days = (today - start).days
    if days < 0:
        return []
    step = max(1, -(-days // max_points))  # ceil
    dates = [start + timedelta(days=i) for i in range(0, days + 1, step)]
    if dates[-1] != today:
        dates.append(today)
    countable = [r for r in rows if r.category != StatusCategory.canceled]
    done_dates = sorted(r.completed_at.date() for r in countable if r.done and r.completed_at)
    created_dates = sorted(r.created for r in countable)
    out, ci, di = [], 0, 0
    for d in dates:
        while ci < len(created_dates) and created_dates[ci] <= d:
            ci += 1
        while di < len(done_dates) and done_dates[di] <= d:
            di += 1
        out.append(BurnupPoint(date=d, scope=ci, completed=di))
    return out


def cycle_time(rows: list[TaskRow], today: date) -> float | None:
    since = today - timedelta(days=CYCLE_TIME_DAYS)
    durations = [
        (r.completed_at - r.started_at).total_seconds() / 86400
        for r in rows
        if r.done and r.completed_at and r.started_at and r.completed_at.date() >= since
    ]
    return round(statistics.median(durations), 1) if durations else None


def at_risk(row: TaskRow, blocked: set[uuid.UUID], today: date) -> bool:
    if row.closed:
        return False
    if row.due_date and row.due_date < today:
        return True
    if row.id in blocked:
        return True
    not_started = row.category in (StatusCategory.backlog, StatusCategory.todo)
    return bool(not_started and row.due_date and row.due_date <= today + timedelta(days=DUE_SOON_DAYS))


# ─── Workload ───


def working_days(first: date, last: date) -> list[date]:
    return [
        first + timedelta(days=i) for i in range((last - first).days + 1) if (first + timedelta(days=i)).weekday() < 5
    ]


def spread_hours(row: TaskRow, today: date) -> dict[date, float]:
    """Open estimate hours per week, spread evenly over working days from start (or today) to due."""
    if not row.estimate or not row.due_date:
        return {}
    if row.due_date < today:
        return {week_start(today): row.estimate}  # overdue: the whole remainder lands now
    first = max(row.start_date or today, today)
    days = working_days(first, row.due_date) if first <= row.due_date else []
    if not days:
        return {week_start(row.due_date): row.estimate}
    per_day = row.estimate / len(days)
    out: dict[date, float] = defaultdict(float)
    for d in days:
        out[week_start(d)] += per_day
    return out
