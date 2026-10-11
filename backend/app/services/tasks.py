"""Task domain logic: status transitions, reference validation, list queries and the task detail view.

The router (`api/v1/tasks.py`) owns request handling, activity, notifications and realtime events;
everything here only reads or stages changes on the session — the caller commits.
"""

import base64
import re
import uuid
from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta

from sqlalchemy import ColumnElement, and_, case, func, or_, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import utcnow
from app.core.errors import BadRequest
from app.models import (
    CLOSED_CATEGORIES,
    PRIORITY_RANK,
    STARTED_CATEGORIES,
    Label,
    Milestone,
    Priority,
    Project,
    ProjectMember,
    ProjectRole,
    StatusCategory,
    Task,
    TaskDependency,
    TaskLabel,
    TaskStatus,
    TaskWatcher,
    TimeEntry,
    User,
)
from app.schemas.task import DueFilter, StateFilter, TaskDetail, TaskList, TaskSort
from app.services import activity, permissions, serializers
from app.services.projects import between, edge_position, rebalance_column
from app.services.realtime import queue_event

REF_RE = re.compile(r"^([A-Za-z][A-Za-z0-9]{1,5})-(\d{1,9})$")
_CLOSED = [c.value for c in CLOSED_CATEGORIES]


def parse_ref(ref: str) -> tuple[str, int] | None:
    """'web-12' → ('WEB', 12); None when it isn't shaped like a task reference."""
    m = REF_RE.match(ref.strip())
    if m is None:
        return None
    return m.group(1).upper(), int(m.group(2))


# ─── Status rules ───


def apply_status(task: Task, status: TaskStatus, now: datetime | None = None) -> None:
    """Put `task` in `status` and keep the lifecycle timestamps consistent with the status category.

    Entering `done` stamps completed_at (kept if already set); any other category clears it.
    The first entry into in_progress/review stamps started_at.
    """
    now = now or utcnow()
    task.status_id = status.id
    if status.category == StatusCategory.done:
        if task.completed_at is None:
            task.completed_at = now
    else:
        task.completed_at = None
    if status.category in STARTED_CATEGORIES and task.started_at is None:
        task.started_at = now


# ─── Validation of what a task points at ───


async def project_status(db: AsyncSession, project_id: uuid.UUID, status_id: uuid.UUID) -> TaskStatus:
    status = await db.get(TaskStatus, status_id)
    if status is None or status.project_id != project_id:
        raise BadRequest("That status doesn't belong to this project", code="invalid_status")
    return status


async def resolve_assignee(db: AsyncSession, project: Project, assignee_id: uuid.UUID) -> tuple[User, bool]:
    """Validate an assignee. Returns (user, needs_project_membership).

    Anyone active in the workspace can be assigned; people who can't see the project yet
    (private project, guests) must be added to it as members.
    """
    membership = await permissions.get_membership(db, assignee_id, project.workspace_id)
    user = await db.get(User, assignee_id) if membership else None
    if user is None or not user.is_active:
        raise BadRequest("The assignee must be an active member of this workspace", code="invalid_assignee")
    return user, await permissions.project_access(db, assignee_id, project) is None


async def grant_project_access(db: AsyncSession, project: Project, user: User, actor_id: uuid.UUID) -> None:
    """Add `user` as a project member so they can work on a task assigned to them."""
    db.add(ProjectMember(project_id=project.id, user_id=user.id, role=ProjectRole.member))
    await db.flush()
    activity.record(
        db,
        workspace_id=project.workspace_id,
        actor_id=actor_id,
        verb="member_added",
        project_id=project.id,
        data={"user_id": str(user.id), "user": user.name, "role": ProjectRole.member.value, "reason": "assigned"},
    )
    queue_event(
        db,
        "project.member_added",
        await permissions.project_audience(db, project),
        workspace_id=project.workspace_id,
        project_id=project.id,
        data={"user_id": str(user.id), "role": ProjectRole.member.value},
    )


async def validate_parent(
    db: AsyncSession, project_id: uuid.UUID, parent_id: uuid.UUID, task: Task | None = None
) -> Task:
    """A parent must be a live, top-level task of the same project (one level of subtasks only)."""
    parent = await db.get(Task, parent_id)
    if parent is None or parent.deleted_at is not None or parent.project_id != project_id:
        raise BadRequest("The parent task must be in the same project", code="invalid_parent")
    if task is not None and parent.id == task.id:
        raise BadRequest("A task can't be its own parent", code="invalid_parent")
    if parent.parent_id is not None:
        raise BadRequest("Subtasks can't have subtasks", code="nested_subtask")
    if task is not None and await db.scalar(
        select(Task.id).where(Task.parent_id == task.id, Task.deleted_at.is_(None)).limit(1)
    ):
        raise BadRequest("A task that has subtasks can't become a subtask", code="nested_subtask")
    return parent


async def validate_milestone(db: AsyncSession, project_id: uuid.UUID, milestone_id: uuid.UUID) -> Milestone:
    milestone = await db.get(Milestone, milestone_id)
    if milestone is None or milestone.project_id != project_id:
        raise BadRequest("That milestone doesn't belong to this project", code="invalid_milestone")
    return milestone


async def validate_labels(db: AsyncSession, workspace_id: uuid.UUID, label_ids: Iterable[uuid.UUID]) -> list[Label]:
    ids = list(dict.fromkeys(label_ids))
    if not ids:
        return []
    labels = list(
        await db.scalars(
            select(Label).where(Label.id.in_(ids), Label.workspace_id == workspace_id).order_by(func.lower(Label.name))
        )
    )
    if len(labels) != len(ids):
        raise BadRequest("Unknown label", code="invalid_label")
    return labels


# ─── Watchers, deletion, ordering, dependencies ───


async def add_watchers(db: AsyncSession, pairs: Iterable[tuple[uuid.UUID, uuid.UUID | None]]) -> None:
    """Insert (task_id, user_id) watcher rows, ignoring ones that already exist."""
    rows = [{"task_id": t, "user_id": u} for t, u in dict.fromkeys(pairs) if u is not None]
    if rows:
        await db.execute(pg_insert(TaskWatcher).values(rows).on_conflict_do_nothing())


async def soft_delete(db: AsyncSession, tasks: Sequence[Task], now: datetime) -> list[Task]:
    """Trash tasks together with their live subtasks (same timestamp, so restore can bring them back).
    Returns the subtasks that were trashed alongside."""
    ids = {t.id for t in tasks}
    subtasks = [
        t
        for t in await db.scalars(select(Task).where(Task.parent_id.in_(ids), Task.deleted_at.is_(None)))
        if t.id not in ids
    ]
    for t in (*tasks, *subtasks):
        t.deleted_at = now
        t.updated_at = now
    return subtasks


async def restore(db: AsyncSession, task: Task, now: datetime) -> list[Task]:
    """Restore a trashed task and the subtasks that were trashed in the same operation."""
    subtasks = list(await db.scalars(select(Task).where(Task.parent_id == task.id, Task.deleted_at == task.deleted_at)))
    for t in (task, *subtasks):
        t.deleted_at = None
        t.updated_at = now
    return subtasks


async def load_neighbour(
    db: AsyncSession, task: Task, status: TaskStatus, neighbour_id: uuid.UUID | None
) -> Task | None:
    if neighbour_id is None:
        return None
    other = await db.get(Task, neighbour_id)
    if (
        other is None
        or other.id == task.id
        or other.deleted_at is not None
        or other.project_id != task.project_id
        or other.status_id != status.id
    ):
        raise BadRequest("Neighbouring tasks must be in the target column", code="invalid_neighbor")
    return other


async def _adjacent_position(
    db: AsyncSession, task: Task, status: TaskStatus, position: float, above: bool
) -> float | None:
    q = select(Task.position).where(
        Task.project_id == task.project_id,
        Task.status_id == status.id,
        Task.deleted_at.is_(None),
        Task.id != task.id,
    )
    if above:
        q = q.where(Task.position < position).order_by(Task.position.desc())
    else:
        q = q.where(Task.position > position).order_by(Task.position.asc())
    return await db.scalar(q.limit(1))


async def drop_position(
    db: AsyncSession, task: Task, status: TaskStatus, after: Task | None, before: Task | None
) -> float:
    """Position that places `task` directly below `after` and above `before` in `status`'s column.

    A missing neighbour is looked up from the column, so the task never jumps past another one.
    When the gap is too small to bisect, the column is rebalanced once and the midpoint recomputed.
    """
    if after is None and before is None:
        return await edge_position(db, task.project_id, status.id, top=False)
    for _ in range(2):
        lower = after.position if after else await _adjacent_position(db, task, status, before.position, above=True)
        upper = before.position if before else await _adjacent_position(db, task, status, after.position, above=False)
        position = between(lower, upper)
        if position is not None:
            return position
        await rebalance_column(db, task.project_id, status.id)
    raise BadRequest("after_id must be above before_id", code="invalid_neighbor")


async def creates_cycle(db: AsyncSession, blocker_id: uuid.UUID, blocked_id: uuid.UUID) -> bool:
    """Would "blocker blocks blocked" close a loop, i.e. does `blocked` already (transitively) block `blocker`?"""
    downstream = (
        select(TaskDependency.blocked_id.label("id"))
        .where(TaskDependency.blocker_id == blocked_id)
        .cte("downstream", recursive=True)
    )
    downstream = downstream.union(
        select(TaskDependency.blocked_id).join(downstream, TaskDependency.blocker_id == downstream.c.id)
    )
    return await db.scalar(select(downstream.c.id).where(downstream.c.id == blocker_id).limit(1)) is not None


# ─── Lists ───


@dataclass
class TaskFilters:
    assignee: str | None = None
    state: StateFilter = "all"
    status_category: list[StatusCategory] = field(default_factory=list)
    priority: list[Priority] = field(default_factory=list)
    label_id: list[uuid.UUID] = field(default_factory=list)
    milestone_id: uuid.UUID | None = None
    due: DueFilter | None = None
    q: str | None = None
    top_level: bool = False
    sort: TaskSort = "position"


def encode_cursor(offset: int) -> str:
    return base64.urlsafe_b64encode(f"offset:{offset}".encode()).decode().rstrip("=")


def decode_cursor(cursor: str | None) -> int:
    if not cursor:
        return 0
    try:
        raw = base64.urlsafe_b64decode(cursor + "=" * (-len(cursor) % 4)).decode()
        prefix, _, value = raw.partition(":")
        offset = int(value)
    except ValueError:  # covers binascii.Error and UnicodeDecodeError
        raise BadRequest("Invalid cursor", code="invalid_cursor") from None
    if prefix != "offset" or offset < 0:
        raise BadRequest("Invalid cursor", code="invalid_cursor")
    return offset


def _filter_conditions(filters: TaskFilters, user: User, today: date) -> list[ColumnElement[bool]]:
    conds: list[ColumnElement[bool]] = []
    if filters.assignee:
        if filters.assignee == "me":
            conds.append(Task.assignee_id == user.id)
        elif filters.assignee == "unassigned":
            conds.append(Task.assignee_id.is_(None))
        else:
            try:
                conds.append(Task.assignee_id == uuid.UUID(filters.assignee))
            except ValueError:
                raise BadRequest("assignee must be 'me', 'unassigned' or a user id", code="invalid_filter") from None
    if filters.state == "open":
        conds.append(TaskStatus.category.notin_(_CLOSED))
    elif filters.state == "closed":
        conds.append(TaskStatus.category.in_(_CLOSED))
    if filters.status_category:
        conds.append(TaskStatus.category.in_([c.value for c in filters.status_category]))
    if filters.priority:
        conds.append(Task.priority.in_([p.value for p in filters.priority]))
    if filters.label_id:
        conds.append(
            select(TaskLabel.task_id)
            .where(TaskLabel.task_id == Task.id, TaskLabel.label_id.in_(filters.label_id))
            .exists()
        )
    if filters.milestone_id:
        conds.append(Task.milestone_id == filters.milestone_id)
    match filters.due:
        case "overdue":
            conds.extend([Task.due_date < today, TaskStatus.category.notin_(_CLOSED)])
        case "today":
            conds.append(Task.due_date == today)
        case "week":
            conds.append(Task.due_date.between(today, today + timedelta(days=7)))
        case "none":
            conds.append(Task.due_date.is_(None))
        case "scheduled":
            conds.append(Task.due_date.is_not(None))
    q = (filters.q or "").strip()
    if q:
        match_title = Task.title.icontains(q, autoescape=True)
        ref = parse_ref(q)
        conds.append(or_(match_title, and_(Project.key == ref[0], Task.number == ref[1])) if ref else match_title)
    if filters.top_level:
        conds.append(Task.parent_id.is_(None))
    return conds


_PRIORITY_ORDER = case(PRIORITY_RANK, value=Task.priority, else_=len(PRIORITY_RANK))


def _sort_clauses(sort: TaskSort) -> list:
    match sort:
        case "due_date":
            return [Task.due_date.asc().nulls_last(), _PRIORITY_ORDER, Task.position, Task.id]
        case "priority":
            return [_PRIORITY_ORDER, Task.due_date.asc().nulls_last(), Task.position, Task.id]
        case "updated":
            return [Task.updated_at.desc(), Task.id]
        case "created":
            return [Task.created_at.desc(), Task.id]
        case "title":
            return [func.lower(Task.title), Task.id]
        case _:
            return [Task.position, Task.created_at, Task.id]


async def query_tasks(
    db: AsyncSession,
    user: User,
    project_ids: Sequence[uuid.UUID],
    filters: TaskFilters,
    *,
    limit: int,
    cursor: str | None,
) -> TaskList:
    """Filter, sort and paginate live tasks within `project_ids` (already access-checked by the caller)."""
    offset = decode_cursor(cursor)
    today = serializers.user_today(user)
    if not project_ids:
        return TaskList(items=[], next_cursor=None, total=0)
    conds = [Task.project_id.in_(project_ids), Task.deleted_at.is_(None), *_filter_conditions(filters, user, today)]

    def joined(stmt):
        return stmt.join(TaskStatus, TaskStatus.id == Task.status_id).join(Project, Project.id == Task.project_id)

    total = await db.scalar(joined(select(func.count()).select_from(Task)).where(*conds))
    tasks = list(
        await db.scalars(
            joined(select(Task)).where(*conds).order_by(*_sort_clauses(filters.sort)).offset(offset).limit(limit)
        )
    )
    return TaskList(
        items=await serializers.tasks_out(db, tasks, today),
        next_cursor=encode_cursor(offset + limit) if offset + len(tasks) < total else None,
        total=total,
    )


# ─── Detail ───


async def build_task_detail(db: AsyncSession, task: Task, user: User, role: ProjectRole | None = None) -> TaskDetail:
    """Full task view. `role` is the user's effective project role (looked up when not given)."""
    project = await db.get(Project, task.project_id)
    if role is None:
        role = await permissions.project_access(db, user.id, project)
    today = serializers.user_today(user)

    subtasks = list(
        await db.scalars(
            select(Task)
            .where(Task.parent_id == task.id, Task.deleted_at.is_(None))
            .order_by(Task.position, Task.created_at, Task.id)
        )
    )
    base, *subtask_outs = await serializers.tasks_out(db, [task, *subtasks], today)

    deps = (
        await db.execute(
            select(TaskDependency.blocker_id, TaskDependency.blocked_id).where(
                or_(TaskDependency.blocked_id == task.id, TaskDependency.blocker_id == task.id)
            )
        )
    ).all()
    blocker_ids = {blocker for blocker, blocked in deps if blocked == task.id}
    blocking_ids = {blocked for blocker, blocked in deps if blocker == task.id}
    related: list[Task] = []
    if deps:
        related = list(
            await db.scalars(
                select(Task)
                .where(Task.id.in_(blocker_ids | blocking_ids), Task.deleted_at.is_(None))
                .order_by(Task.number)
            )
        )
        # Dependencies may cross projects: never reveal tasks from projects this user can't see.
        if any(t.project_id != task.project_id for t in related):
            visible = set(await permissions.visible_project_ids(db, user.id, project.workspace_id))
            related = [t for t in related if t.project_id == task.project_id or t.project_id in visible]
    parent_task = await db.get(Task, task.parent_id) if task.parent_id else None
    briefs = {b.id: b for b in await serializers.task_briefs(db, [*related, *([parent_task] if parent_task else [])])}

    watcher_ids = list(await db.scalars(select(TaskWatcher.user_id).where(TaskWatcher.task_id == task.id)))
    people = await serializers.user_briefs(db, [*watcher_ids, task.reporter_id])
    minutes = await db.scalar(
        select(func.coalesce(func.sum(TimeEntry.minutes), 0)).where(
            TimeEntry.task_id == task.id, TimeEntry.ended_at.is_not(None)
        )
    )

    return TaskDetail(
        **dict(base),
        description=task.description,
        reporter=people.get(task.reporter_id) if task.reporter_id else None,
        parent=briefs.get(parent_task.id) if parent_task else None,
        milestone=await serializers.milestone_brief(db, task.milestone_id),
        subtasks=subtask_outs,
        blocked_by=[briefs[t.id] for t in related if t.id in blocker_ids],
        blocking=[briefs[t.id] for t in related if t.id in blocking_ids],
        watchers=sorted((people[u] for u in watcher_ids if u in people), key=lambda u: u.name.lower()),
        is_watching=user.id in watcher_ids,
        time_logged_minutes=int(minutes or 0),
        can_edit=permissions.can_edit(role),
    )
