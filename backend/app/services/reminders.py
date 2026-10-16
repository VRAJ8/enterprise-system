"""Deadline reminders: "due soon" to the assignee, "overdue" to the assignee and the reporter.

The scheduler runs this every few minutes, possibly on several instances, so a run is idempotent:
each (task, due date) pair notifies a person at most once (`dedupe_key`), and concurrent runs are
serialized with a Postgres advisory lock. Rescheduling a task changes its key, which re-arms it.
"""

import logging
import uuid
from dataclasses import dataclass
from datetime import timedelta
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import session_factory, utcnow
from app.models import CLOSED_CATEGORIES, Notification, NotificationType, Project, Task, TaskStatus, User
from app.services import activity, permissions
from app.services.serializers import task_ref, user_today

logger = logging.getLogger(__name__)

DUE_SOON_DAYS = 2
_LOCK_KEY = 0x50485F52454D  # arbitrary, identifies this job's advisory lock


@dataclass
class _Reminder:
    type: NotificationType
    task: Task
    project: Project
    recipients: set[uuid.UUID]
    data: dict[str, Any]

    @property
    def dedupe_key(self) -> str:
        return dedupe_key(self.type, self.task.id, self.task.due_date)


def dedupe_key(type: NotificationType, task_id: uuid.UUID, due_date) -> str:
    return f"{type.value}:{task_id}:{due_date.isoformat()}"


async def run_deadline_reminders() -> dict[str, int]:
    """Scheduler entry point: one pass in its own session. Returns how many notifications were sent."""
    async with session_factory()() as db:
        counts = await send_deadline_reminders(db)
        await db.commit()
    if any(counts.values()):
        logger.info("Deadline reminders sent: %s", counts)
    return counts


async def send_deadline_reminders(db: AsyncSession) -> dict[str, int]:
    """Add due-soon / overdue notifications to `db` (the caller commits). Returns counts per type."""
    await db.execute(select(func.pg_advisory_xact_lock(_LOCK_KEY)))
    counts = {NotificationType.due_soon.value: 0, NotificationType.overdue.value: 0}
    reminders, users = await _pending_reminders(db)
    if not reminders:
        return counts

    sent = {
        (key, user_id)
        for key, user_id in await db.execute(
            select(Notification.dedupe_key, Notification.user_id).where(
                Notification.dedupe_key.in_({r.dedupe_key for r in reminders})
            )
        )
    }
    access: dict[tuple[uuid.UUID, uuid.UUID], bool] = {}
    for reminder in reminders:
        recipients = [
            uid
            for uid in reminder.recipients
            if (reminder.dedupe_key, uid) not in sent
            and await _can_receive(db, users.get(uid), reminder.project, access)
        ]
        if not recipients:
            continue
        created = await activity.notify(
            db,
            user_ids=recipients,
            type=reminder.type,
            workspace_id=reminder.project.workspace_id,
            actor_id=None,
            project_id=reminder.project.id,
            task_id=reminder.task.id,
            data=reminder.data,
            dedupe_key=reminder.dedupe_key,
        )
        counts[reminder.type.value] += len(created)
    return counts


async def _pending_reminders(db: AsyncSession) -> tuple[list[_Reminder], dict[uuid.UUID, User]]:
    """Open, assigned tasks that are due soon or overdue in their assignee's own timezone."""
    # Local dates run up to a day ahead of UTC, so fetch with a margin and classify per assignee below.
    horizon = utcnow().date() + timedelta(days=DUE_SOON_DAYS + 1)
    rows = (
        await db.execute(
            select(Task, Project)
            .join(Project, Project.id == Task.project_id)
            .join(TaskStatus, TaskStatus.id == Task.status_id)
            .where(
                Task.deleted_at.is_(None),
                Task.assignee_id.is_not(None),
                Task.due_date <= horizon,
                TaskStatus.category.notin_([c.value for c in CLOSED_CATEGORIES]),
            )
            .order_by(Task.due_date, Task.id)
        )
    ).all()
    user_ids = {uid for task, _ in rows for uid in (task.assignee_id, task.reporter_id) if uid}
    users = {u.id: u for u in await db.scalars(select(User).where(User.id.in_(user_ids)))} if user_ids else {}

    reminders: list[_Reminder] = []
    for task, project in rows:
        assignee = users.get(task.assignee_id)
        if assignee is None:
            continue
        today = user_today(assignee)
        data = {"ref": task_ref(project.key, task.number), "title": task.title, "due_date": task.due_date.isoformat()}
        if task.due_date < today:
            recipients = {uid for uid in (task.assignee_id, task.reporter_id) if uid}
            data |= {"days_overdue": (today - task.due_date).days, "assignee_name": assignee.name}
            reminders.append(_Reminder(NotificationType.overdue, task, project, recipients, data))
        elif task.due_date <= today + timedelta(days=DUE_SOON_DAYS):
            data |= {"days_left": (task.due_date - today).days}
            reminders.append(_Reminder(NotificationType.due_soon, task, project, {assignee.id}, data))
    return reminders, users


async def _can_receive(
    db: AsyncSession, user: User | None, project: Project, cache: dict[tuple[uuid.UUID, uuid.UUID], bool]
) -> bool:
    """Active accounts that can still see the project (deactivated workspace members can't)."""
    if user is None or not user.is_active:
        return False
    key = (user.id, project.id)
    if key not in cache:
        cache[key] = await permissions.project_access(db, user.id, project) is not None
    return cache[key]
