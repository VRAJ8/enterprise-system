"""Time entries, running timer and timesheets."""

import uuid
from datetime import date, datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, Body, Query
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import utcnow
from app.core.deps import DB, CurrentUser
from app.core.errors import BadRequest, Conflict, Forbidden, NotFound
from app.models import ProjectRole, Task, TimeEntry, User
from app.schemas.common import Ok
from app.schemas.time import TimeEntryCreate, TimeEntryOut, TimeEntryUpdate, TimerOut, TimerStart
from app.services import activity, permissions, serializers
from app.services import time as svc
from app.services.realtime import queue_event

router = APIRouter(tags=["time"])

# Explicit start times may run slightly ahead of the server clock (client clock skew).
CLOCK_SKEW = timedelta(minutes=1)


# ─── Helpers ───


def _future_entry() -> BadRequest:
    return BadRequest("Time can't be logged in the future", code="future_entry")


async def _entry_out(db: AsyncSession, entry: TimeEntry, now: datetime | None = None) -> TimeEntryOut:
    return (await svc.entries_out(db, [entry], now))[0]


async def _visible_entry(db: AsyncSession, user: User, entry_id: uuid.UUID) -> tuple[TimeEntry, Task]:
    """An entry the current user may see, with its task; 404 otherwise."""
    entry = await db.get(TimeEntry, entry_id)
    if entry is None:
        raise NotFound("Time entry not found")
    task = await db.get(Task, entry.task_id)
    if task is None or task.deleted_at is not None:
        raise NotFound("Time entry not found")
    scope = await svc.time_scope(db, user.id, entry.workspace_id)
    if not scope.allows(entry.user_id, task.project_id):
        raise NotFound("Time entry not found")
    return entry, task


async def _editable_entry(db: AsyncSession, user: User, entry_id: uuid.UUID) -> tuple[TimeEntry, Task]:
    """Entries can be changed by the person who logged them, or by a workspace owner/admin."""
    entry, task = await _visible_entry(db, user, entry_id)
    if entry.user_id != user.id:
        membership = await permissions.get_membership(db, user.id, entry.workspace_id)
        if not permissions.is_workspace_admin(membership):
            raise Forbidden("Only the person who logged this time or a workspace admin can change it")
    return entry, task


def _record(db: AsyncSession, entry: TimeEntry, task: Task, actor: User, verb: str, data: dict) -> None:
    activity.record(
        db,
        workspace_id=entry.workspace_id,
        actor_id=actor.id,
        verb=verb,
        project_id=task.project_id,
        task_id=task.id,
        data=data,
    )


async def _stop(db: AsyncSession, entry: TimeEntry, actor: User, now: datetime) -> Task:
    """Finalize a running entry and log it on its task's activity feed."""
    svc.finalize(entry, now)
    task = await db.get(Task, entry.task_id)
    _record(db, entry, task, actor, "logged_time", {"minutes": entry.minutes})
    return task


def _timer_event(
    db: AsyncSession,
    user_id: uuid.UUID,
    workspace_id: uuid.UUID,
    task: Task,
    *,
    running: TimeEntry | None,
    stopped: TimeEntry | None = None,
) -> None:
    """`timer.updated` to the timer's owner: what is running now (if anything) and what just stopped.
    `task` is the running entry's task, or the task of the entry that stopped or was discarded."""
    queue_event(
        db,
        "timer.updated",
        [user_id],
        workspace_id=workspace_id,
        project_id=task.project_id,
        task_id=task.id,
        data={
            "running": running is not None,
            "entry_id": str(running.id) if running else None,
            "stopped_entry_id": str(stopped.id) if stopped else None,
            "stopped_minutes": stopped.minutes if stopped else None,
        },
    )


async def _commit_timer(db: AsyncSession) -> None:
    """Commit, turning a violation of the one-running-timer-per-user index into a 409."""
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise Conflict("A timer is already running. Stop it first.", code="timer_running") from None


# ─── Time entries ───


@router.get("/workspaces/{workspace_id}/time-entries", response_model=list[TimeEntryOut])
async def list_time_entries(
    workspace_id: uuid.UUID,
    user: CurrentUser,
    db: DB,
    user_id: Annotated[
        uuid.UUID | None, Query(description="Only this person's entries (as far as you may see)")
    ] = None,
    project_id: uuid.UUID | None = None,
    task_id: uuid.UUID | None = None,
    date_from: Annotated[
        date | None, Query(description="First day, inclusive, in your timezone (default: 6 days before date_to)")
    ] = None,
    date_to: Annotated[date | None, Query(description="Last day, inclusive, in your timezone (default: today)")] = None,
):
    """Time entries you may see in a workspace and date range (newest first), running timers included."""
    await permissions.require_workspace(db, user, workspace_id)
    date_to = date_to or serializers.user_today(user)
    date_from = date_from or date_to - timedelta(days=svc.DEFAULT_RANGE_DAYS - 1)
    if date_from > date_to:
        raise BadRequest("date_from must be on or before date_to", code="invalid_range")
    if (date_to - date_from).days + 1 > svc.MAX_RANGE_DAYS:
        raise BadRequest(f"Pick a range of at most {svc.MAX_RANGE_DAYS} days", code="range_too_large")

    scope = await svc.time_scope(db, user.id, workspace_id)
    if not scope.project_ids:
        return []
    start, end = svc.day_bounds(date_from, date_to, svc.user_tz(user))
    query = (
        select(TimeEntry)
        .join(Task, Task.id == TimeEntry.task_id)
        .where(
            TimeEntry.workspace_id == workspace_id,
            Task.deleted_at.is_(None),
            scope.condition(),
            TimeEntry.started_at >= start,
            TimeEntry.started_at < end,
        )
        .order_by(TimeEntry.started_at.desc(), TimeEntry.id.desc())
    )
    if user_id:
        query = query.where(TimeEntry.user_id == user_id)
    if project_id:
        query = query.where(Task.project_id == project_id)
    if task_id:
        query = query.where(TimeEntry.task_id == task_id)
    return await svc.entries_out(db, list(await db.scalars(query)))


@router.post("/tasks/{task_id}/time-entries", response_model=TimeEntryOut, status_code=201)
async def log_time(task_id: uuid.UUID, data: TimeEntryCreate, user: CurrentUser, db: DB):
    """Log time on a task; without `started_at` it starts at 09:00 on `date` (default today) in your timezone."""
    task, project, _ = await permissions.require_task(db, user, task_id, ProjectRole.member)
    tz = svc.user_tz(user)
    if data.started_at is not None:
        started_at = svc.as_utc(data.started_at, tz)
        if started_at > utcnow() + CLOCK_SKEW:
            raise _future_entry()
    else:
        today = serializers.user_today(user)
        day = data.date or today
        if day > today:
            raise _future_entry()
        started_at = svc.manual_start(day, tz)

    entry = TimeEntry(
        id=uuid.uuid4(),
        workspace_id=project.workspace_id,
        task_id=task.id,
        user_id=user.id,
        started_at=started_at,
        ended_at=started_at + timedelta(minutes=data.minutes),
        minutes=data.minutes,
        note=data.note.strip(),
    )
    db.add(entry)
    _record(db, entry, task, user, "logged_time", {"minutes": data.minutes})
    queue_event(
        db,
        "time_entry.created",
        [user.id],
        workspace_id=project.workspace_id,
        project_id=project.id,
        task_id=task.id,
        data={"id": str(entry.id), "minutes": entry.minutes},
    )
    await db.commit()
    return await _entry_out(db, entry)


@router.patch("/time-entries/{entry_id}", response_model=TimeEntryOut)
async def update_time_entry(entry_id: uuid.UUID, data: TimeEntryUpdate, user: CurrentUser, db: DB):
    """Edit a time entry (yours, or anyone's as a workspace admin); a running timer only accepts a new note."""
    entry, task = await _editable_entry(db, user, entry_id)
    running = entry.ended_at is None
    if running and (data.minutes is not None or data.date is not None):
        raise BadRequest("Stop the timer before changing its duration or date", code="timer_running")

    changes: dict[str, dict] = {}
    if data.date is not None:
        tz = svc.user_tz(user)
        old_day = svc.local_date(entry.started_at, tz)
        if data.date != old_day:
            if data.date > serializers.user_today(user):
                raise _future_entry()
            # Keep the wall-clock start time; only the day moves.
            entry.started_at = svc.at_local_time(data.date, entry.started_at.astimezone(tz).time(), tz)
            changes["date"] = {"from": old_day.isoformat(), "to": data.date.isoformat()}
    if data.minutes is not None and data.minutes != entry.minutes:
        changes["minutes"] = {"from": entry.minutes, "to": data.minutes}
        entry.minutes = data.minutes
    if changes:
        entry.ended_at = entry.started_at + timedelta(minutes=entry.minutes)
        _record(db, entry, task, user, "updated_time", {"changes": changes})
    if data.note is not None:
        entry.note = data.note.strip()

    queue_event(
        db,
        "time_entry.updated",
        {entry.user_id, user.id},
        workspace_id=entry.workspace_id,
        project_id=task.project_id,
        task_id=task.id,
        data={"id": str(entry.id)},
    )
    if running:
        _timer_event(db, entry.user_id, entry.workspace_id, task, running=entry)
    await db.commit()
    return await _entry_out(db, entry)


@router.delete("/time-entries/{entry_id}", response_model=Ok)
async def delete_time_entry(entry_id: uuid.UUID, user: CurrentUser, db: DB):
    """Delete a time entry (yours, or anyone's as a workspace admin); deleting a running timer discards it."""
    entry, task = await _editable_entry(db, user, entry_id)
    was_running = entry.ended_at is None
    if not was_running:
        _record(db, entry, task, user, "deleted_time", {"minutes": entry.minutes})
    queue_event(
        db,
        "time_entry.deleted",
        {entry.user_id, user.id},
        workspace_id=entry.workspace_id,
        project_id=task.project_id,
        task_id=task.id,
        data={"id": str(entry.id)},
    )
    if was_running:
        _timer_event(db, entry.user_id, entry.workspace_id, task, running=None)
    await db.delete(entry)
    await db.commit()
    return Ok()


# ─── Timer ───


@router.get("/timer", response_model=TimerOut)
async def get_timer(user: CurrentUser, db: DB):
    """Your running timer in any workspace, or null."""
    entry = await svc.running_entry(db, user.id)
    return TimerOut(entry=await _entry_out(db, entry) if entry else None)


@router.post("/tasks/{task_id}/timer/start", response_model=TimerOut, status_code=201)
async def start_timer(task_id: uuid.UUID, user: CurrentUser, db: DB, data: Annotated[TimerStart | None, Body()] = None):
    """Start a timer on a task, stopping (and logging) any timer you already have running elsewhere."""
    task, project, _ = await permissions.require_task(db, user, task_id, ProjectRole.member)
    now = utcnow()
    current = await svc.running_entry(db, user.id, lock=True)
    if current is not None and current.task_id == task.id:
        return TimerOut(entry=await _entry_out(db, current, now))  # already timing this task

    if current is not None:
        await _stop(db, current, user, now)
    entry = TimeEntry(
        id=uuid.uuid4(),
        workspace_id=project.workspace_id,
        task_id=task.id,
        user_id=user.id,
        started_at=now,
        ended_at=None,
        minutes=0,
        note=data.note.strip() if data else "",
    )
    db.add(entry)
    _timer_event(db, user.id, project.workspace_id, task, running=entry, stopped=current)
    await _commit_timer(db)
    return TimerOut(entry=await _entry_out(db, entry, now))


@router.post("/timer/stop", response_model=TimeEntryOut)
async def stop_timer(user: CurrentUser, db: DB):
    """Stop your running timer and log its time (rounded to the nearest minute, at least one)."""
    entry = await svc.running_entry(db, user.id, lock=True)
    if entry is None:
        raise NotFound("No timer is running", code="no_timer")
    now = utcnow()
    task = await _stop(db, entry, user, now)
    _timer_event(db, user.id, entry.workspace_id, task, running=None, stopped=entry)
    await db.commit()
    return await _entry_out(db, entry, now)
