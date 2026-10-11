"""Time-tracking primitives shared by the time router and insights (timesheets, utilisation).

- Durations: a running entry reports the whole minutes elapsed so far; a stopped timer is rounded to
  the nearest minute, with a one-minute floor so a stopped timer always counts.
- Calendar days are read in a person's own timezone and converted to UTC bounds for queries.
- Visibility (`TimeScope`): everyone sees their own entries, workspace owners/admins see every entry,
  project leads see every entry on projects they lead, and nobody sees entries on projects they can't view.
"""

import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy import ColumnElement, and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import utcnow
from app.models import ProjectMember, ProjectRole, Task, TimeEntry, User
from app.schemas.time import TimeEntryOut
from app.services import permissions, serializers

MANUAL_START_TIME = time(9, 0)  # manual entries without an exact start begin at 09:00 local time
DEFAULT_RANGE_DAYS = 7
MAX_RANGE_DAYS = 366


# ─── Timezones and calendar days ───


def user_tz(user: User | None) -> ZoneInfo:
    """The user's timezone, falling back to UTC when unset or unknown."""
    name = getattr(user, "timezone", None) or "UTC"
    try:
        return ZoneInfo(name)
    except (ZoneInfoNotFoundError, ValueError):
        return ZoneInfo("UTC")


def as_utc(moment: datetime, tz: ZoneInfo) -> datetime:
    """Aware datetimes are converted to UTC; naive ones are read as wall-clock time in `tz`."""
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=tz)
    return moment.astimezone(UTC)


def local_date(moment: datetime, tz: ZoneInfo) -> date:
    """The calendar day `moment` falls on in `tz`."""
    return moment.astimezone(tz).date()


def at_local_time(day: date, clock: time, tz: ZoneInfo) -> datetime:
    """`day` at wall-clock `clock` in `tz`, as UTC (DST-aware)."""
    return datetime.combine(day, clock, tzinfo=tz).astimezone(UTC)


def manual_start(day: date, tz: ZoneInfo) -> datetime:
    """Start of a manual entry logged for `day` without an exact time: 09:00 local, as UTC."""
    return at_local_time(day, MANUAL_START_TIME, tz)


def day_bounds(date_from: date, date_to: date, tz: ZoneInfo) -> tuple[datetime, datetime]:
    """UTC `[start, end)` covering the local calendar days `date_from`..`date_to` inclusive."""
    return at_local_time(date_from, time.min, tz), at_local_time(date_to + timedelta(days=1), time.min, tz)


# ─── Durations ───


def elapsed_minutes(started_at: datetime, now: datetime | None = None) -> int:
    """Whole minutes elapsed since `started_at` (what a running timer shows)."""
    seconds = ((now or utcnow()) - started_at).total_seconds()
    return max(0, int(seconds // 60))


def stopped_minutes(started_at: datetime, ended_at: datetime) -> int:
    """Final duration of a stopped timer: nearest minute (halves round up), at least one."""
    seconds = (ended_at - started_at).total_seconds()
    return max(1, int((seconds + 30) // 60))


def entry_minutes(entry: TimeEntry, now: datetime | None = None) -> int:
    """Minutes an entry counts for: its final duration, or the time elapsed so far while running."""
    if entry.ended_at is None:
        return elapsed_minutes(entry.started_at, now)
    return entry.minutes


def finalize(entry: TimeEntry, now: datetime | None = None) -> int:
    """Stop a running entry at `now` and store its final duration. The caller commits."""
    entry.ended_at = now or utcnow()
    entry.minutes = stopped_minutes(entry.started_at, entry.ended_at)
    return entry.minutes


async def running_entry(db: AsyncSession, user_id: uuid.UUID, *, lock: bool = False) -> TimeEntry | None:
    """The user's running timer in any workspace. `lock=True` holds a row lock until commit/rollback,
    so concurrent start/stop requests for the same user are serialized."""
    query = select(TimeEntry).where(TimeEntry.user_id == user_id, TimeEntry.ended_at.is_(None))
    if lock:
        query = query.with_for_update()
    return await db.scalar(query)


# ─── Visibility ───


@dataclass(frozen=True)
class TimeScope:
    """Which time entries a viewer may see in one workspace."""

    viewer_id: uuid.UUID
    project_ids: frozenset[uuid.UUID]  # projects the viewer can view
    team_project_ids: frozenset[uuid.UUID]  # subset where the viewer sees everyone's entries

    def allows(self, entry_user_id: uuid.UUID, project_id: uuid.UUID) -> bool:
        return project_id in self.project_ids and (
            entry_user_id == self.viewer_id or project_id in self.team_project_ids
        )

    def condition(self) -> ColumnElement[bool]:
        """SQL filter for a query that selects `TimeEntry` joined with `Task`."""
        return and_(
            Task.project_id.in_(list(self.project_ids)),
            or_(TimeEntry.user_id == self.viewer_id, Task.project_id.in_(list(self.team_project_ids))),
        )


async def time_scope(db: AsyncSession, user_id: uuid.UUID, workspace_id: uuid.UUID) -> TimeScope:
    visible = frozenset(await permissions.visible_project_ids(db, user_id, workspace_id))
    membership = await permissions.get_membership(db, user_id, workspace_id)
    if permissions.is_workspace_admin(membership) or not visible:
        team = visible
    else:
        # Non-admins have effective `lead` access only through an explicit lead membership.
        led = await db.scalars(
            select(ProjectMember.project_id).where(
                ProjectMember.user_id == user_id,
                ProjectMember.role == ProjectRole.lead,
                ProjectMember.project_id.in_(list(visible)),
            )
        )
        team = frozenset(led)
    return TimeScope(viewer_id=user_id, project_ids=visible, team_project_ids=team)


# ─── Serialization ───


async def entries_out(
    db: AsyncSession, entries: Sequence[TimeEntry], now: datetime | None = None
) -> list[TimeEntryOut]:
    """Serialize entries in a fixed number of queries (tasks, statuses, projects, people)."""
    if not entries:
        return []
    now = now or utcnow()
    tasks = await serializers.task_brief_map(db, (e.task_id for e in entries))
    projects = await serializers.project_briefs(db, (t.project_id for t in tasks.values()))
    users = await serializers.user_briefs(db, (e.user_id for e in entries))
    out = []
    for e in entries:
        task = tasks[e.task_id]
        out.append(
            TimeEntryOut(
                id=e.id,
                task=task,
                project=projects[task.project_id],
                user=users[e.user_id],
                started_at=e.started_at,
                ended_at=e.ended_at,
                minutes=entry_minutes(e, now),
                note=e.note,
                running=e.ended_at is None,
            )
        )
    return out
