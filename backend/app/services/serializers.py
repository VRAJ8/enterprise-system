"""Batch serializers shared by every module. Always serialize lists in one go to avoid N+1 queries."""

import uuid
from collections.abc import Iterable, Sequence
from datetime import date, datetime
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    CLOSED_CATEGORIES,
    Attachment,
    Comment,
    Label,
    Milestone,
    Project,
    StatusCategory,
    Task,
    TaskDependency,
    TaskLabel,
    TaskStatus,
    User,
)
from app.schemas.common import MilestoneBrief, ProjectBrief, StatusBrief, TaskBrief, UserBrief
from app.schemas.task import TaskOut
from app.schemas.workspace import LabelOut


def user_today(user: User | None) -> date:
    """'Today' in the user's own timezone (overdue/due-today depend on it)."""
    tz_name = getattr(user, "timezone", None) or "UTC"
    try:
        return datetime.now(ZoneInfo(tz_name)).date()
    except ZoneInfoNotFoundError:
        return datetime.now(ZoneInfo("UTC")).date()


def task_ref(project_key: str, number: int) -> str:
    return f"{project_key}-{number}"


def is_closed(category: StatusCategory) -> bool:
    return category in CLOSED_CATEGORIES


async def user_briefs(db: AsyncSession, ids: Iterable[uuid.UUID | None]) -> dict[uuid.UUID, UserBrief]:
    ids = {i for i in ids if i}
    if not ids:
        return {}
    users = await db.scalars(select(User).where(User.id.in_(ids)))
    return {u.id: UserBrief.model_validate(u) for u in users}


async def project_briefs(db: AsyncSession, ids: Iterable[uuid.UUID | None]) -> dict[uuid.UUID, ProjectBrief]:
    ids = {i for i in ids if i}
    if not ids:
        return {}
    projects = await db.scalars(select(Project).where(Project.id.in_(ids)))
    return {p.id: ProjectBrief.model_validate(p) for p in projects}


async def _projects_and_statuses(
    db: AsyncSession, tasks: Sequence[Task]
) -> tuple[dict[uuid.UUID, Project], dict[uuid.UUID, TaskStatus]]:
    project_ids = {t.project_id for t in tasks}
    status_ids = {t.status_id for t in tasks}
    projects = {p.id: p for p in await db.scalars(select(Project).where(Project.id.in_(project_ids)))}
    statuses = {s.id: s for s in await db.scalars(select(TaskStatus).where(TaskStatus.id.in_(status_ids)))}
    return projects, statuses


async def task_briefs(db: AsyncSession, tasks: Sequence[Task]) -> list[TaskBrief]:
    if not tasks:
        return []
    projects, statuses = await _projects_and_statuses(db, tasks)
    return [
        TaskBrief(
            id=t.id,
            ref=task_ref(projects[t.project_id].key, t.number),
            title=t.title,
            project_id=t.project_id,
            status=StatusBrief.model_validate(statuses[t.status_id]),
            priority=t.priority,
            due_date=t.due_date,
        )
        for t in tasks
    ]


async def task_brief_map(db: AsyncSession, ids: Iterable[uuid.UUID | None]) -> dict[uuid.UUID, TaskBrief]:
    ids = {i for i in ids if i}
    if not ids:
        return {}
    tasks = list(await db.scalars(select(Task).where(Task.id.in_(ids))))
    return {b.id: b for b in await task_briefs(db, tasks)}


async def milestone_brief(db: AsyncSession, milestone_id: uuid.UUID | None) -> MilestoneBrief | None:
    if not milestone_id:
        return None
    m = await db.get(Milestone, milestone_id)
    return MilestoneBrief.model_validate(m) if m else None


async def tasks_out(db: AsyncSession, tasks: Sequence[Task], today: date | None = None) -> list[TaskOut]:
    """Serialize tasks for list views, with counts and labels loaded in a fixed number of queries."""
    if not tasks:
        return []
    today = today or date.today()
    ids = [t.id for t in tasks]
    projects, statuses = await _projects_and_statuses(db, tasks)
    users = await user_briefs(db, (t.assignee_id for t in tasks))

    label_rows = (
        await db.execute(
            select(TaskLabel.task_id, Label)
            .join(Label, Label.id == TaskLabel.label_id)
            .where(TaskLabel.task_id.in_(ids))
        )
    ).all()
    labels: dict[uuid.UUID, list[LabelOut]] = {}
    for task_id, label in label_rows:
        labels.setdefault(task_id, []).append(LabelOut.model_validate(label))

    sub_rows = (
        await db.execute(
            select(Task.parent_id, TaskStatus.category, func.count())
            .join(TaskStatus, TaskStatus.id == Task.status_id)
            .where(Task.parent_id.in_(ids), Task.deleted_at.is_(None))
            .group_by(Task.parent_id, TaskStatus.category)
        )
    ).all()
    sub_total: dict[uuid.UUID, int] = {}
    sub_done: dict[uuid.UUID, int] = {}
    for parent_id, category, n in sub_rows:
        sub_total[parent_id] = sub_total.get(parent_id, 0) + n
        if category == StatusCategory.done:
            sub_done[parent_id] = sub_done.get(parent_id, 0) + n

    comment_counts = dict(
        (
            await db.execute(
                select(Comment.task_id, func.count())
                .where(Comment.task_id.in_(ids), Comment.deleted_at.is_(None))
                .group_by(Comment.task_id)
            )
        ).all()
    )
    attachment_counts = dict(
        (
            await db.execute(
                select(Attachment.task_id, func.count()).where(Attachment.task_id.in_(ids)).group_by(Attachment.task_id)
            )
        ).all()
    )
    blocker = Task.__table__.alias("blocker")
    blocker_status = TaskStatus.__table__.alias("blocker_status")
    blocked_counts = dict(
        (
            await db.execute(
                select(TaskDependency.blocked_id, func.count())
                .join(blocker, blocker.c.id == TaskDependency.blocker_id)
                .join(blocker_status, blocker_status.c.id == blocker.c.status_id)
                .where(
                    TaskDependency.blocked_id.in_(ids),
                    blocker.c.deleted_at.is_(None),
                    blocker_status.c.category.notin_([c.value for c in CLOSED_CATEGORIES]),
                )
                .group_by(TaskDependency.blocked_id)
            )
        ).all()
    )

    out = []
    for t in tasks:
        project = projects[t.project_id]
        status = statuses[t.status_id]
        out.append(
            TaskOut(
                id=t.id,
                ref=task_ref(project.key, t.number),
                number=t.number,
                title=t.title,
                project=ProjectBrief.model_validate(project),
                status=StatusBrief.model_validate(status),
                priority=t.priority,
                assignee=users.get(t.assignee_id) if t.assignee_id else None,
                parent_id=t.parent_id,
                milestone_id=t.milestone_id,
                start_date=t.start_date,
                due_date=t.due_date,
                estimate_hours=float(t.estimate_hours) if t.estimate_hours is not None else None,
                position=t.position,
                labels=sorted(labels.get(t.id, []), key=lambda lb: lb.name.lower()),
                subtask_count=sub_total.get(t.id, 0),
                subtask_done_count=sub_done.get(t.id, 0),
                comment_count=comment_counts.get(t.id, 0),
                attachment_count=attachment_counts.get(t.id, 0),
                blocked_by_count=blocked_counts.get(t.id, 0),
                is_overdue=bool(t.due_date and t.due_date < today and not is_closed(status.category)),
                started_at=t.started_at,
                completed_at=t.completed_at,
                created_at=t.created_at,
                updated_at=t.updated_at,
            )
        )
    return out
