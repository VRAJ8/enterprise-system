"""Project primitives shared across modules: default statuses, task numbering, ordering."""

import uuid

from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Project, StatusCategory, Task, TaskStatus

DEFAULT_STATUSES: list[tuple[str, StatusCategory, str]] = [
    ("Backlog", StatusCategory.backlog, "#94a3b8"),
    ("To Do", StatusCategory.todo, "#64748b"),
    ("In Progress", StatusCategory.in_progress, "#3b82f6"),
    ("In Review", StatusCategory.review, "#a855f7"),
    ("Done", StatusCategory.done, "#22c55e"),
    ("Canceled", StatusCategory.canceled, "#71717a"),
]

POSITION_STEP = 1024.0
MIN_GAP = 1e-6


def add_default_statuses(db: AsyncSession, project_id: uuid.UUID) -> list[TaskStatus]:
    statuses = [
        TaskStatus(id=uuid.uuid4(), project_id=project_id, name=name, category=cat, color=color, position=float(i))
        for i, (name, cat, color) in enumerate(DEFAULT_STATUSES)
    ]
    db.add_all(statuses)
    return statuses


async def project_statuses(db: AsyncSession, project_id: uuid.UUID) -> list[TaskStatus]:
    return list(
        await db.scalars(select(TaskStatus).where(TaskStatus.project_id == project_id).order_by(TaskStatus.position))
    )


async def default_status(db: AsyncSession, project_id: uuid.UUID) -> TaskStatus:
    """First 'todo' status, falling back to the first status of any category."""
    statuses = await project_statuses(db, project_id)
    for s in statuses:
        if s.category == StatusCategory.todo:
            return s
    return statuses[0]


async def next_task_number(db: AsyncSession, project_id: uuid.UUID) -> int:
    """Atomically allocate the next per-project task number (safe under concurrency)."""
    return await db.scalar(
        update(Project)
        .where(Project.id == project_id)
        .values(task_counter=Project.task_counter + 1)
        .returning(Project.task_counter)
    )


async def edge_position(db: AsyncSession, project_id: uuid.UUID, status_id: uuid.UUID, top: bool) -> float:
    """Position for a task placed at the top or bottom of a status column."""
    agg = func.min(Task.position) if top else func.max(Task.position)
    current = await db.scalar(
        select(agg).where(Task.project_id == project_id, Task.status_id == status_id, Task.deleted_at.is_(None))
    )
    if current is None:
        return POSITION_STEP
    return current - POSITION_STEP if top else current + POSITION_STEP


async def rebalance_column(db: AsyncSession, project_id: uuid.UUID, status_id: uuid.UUID) -> None:
    """Re-space positions evenly when neighbours get too close to bisect."""
    tasks = list(
        await db.scalars(
            select(Task)
            .where(Task.project_id == project_id, Task.status_id == status_id, Task.deleted_at.is_(None))
            .order_by(Task.position, Task.created_at)
        )
    )
    for i, t in enumerate(tasks, start=1):
        t.position = i * POSITION_STEP
    await db.flush()


def between(lower: float | None, upper: float | None) -> float | None:
    """Midpoint between two positions; None means the gap is too small (rebalance first)."""
    if lower is None and upper is None:
        return POSITION_STEP
    if lower is None:
        return upper - POSITION_STEP
    if upper is None:
        return lower + POSITION_STEP
    if upper - lower < MIN_GAP:
        return None
    return (lower + upper) / 2
