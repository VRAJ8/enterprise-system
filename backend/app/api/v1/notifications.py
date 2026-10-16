"""Inbox notifications and activity feeds."""

import uuid
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Query
from sqlalchemy import ColumnElement, Select, func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import utcnow
from app.core.deps import DB, CurrentUser
from app.core.errors import BadRequest
from app.models import Activity, Notification, NotificationType, Task, User, WorkspaceMember
from app.schemas.collaboration import ActivityOut, MarkRead, NotificationOut, UnreadCount
from app.schemas.common import Ok
from app.services import permissions, serializers
from app.services.realtime import queue_event

router = APIRouter(tags=["notifications"])

MAX_MARK_READ_IDS = 1000

Before = Annotated[
    datetime | None,
    Query(description="Cursor: only entries created before this time (pass the last item's created_at)"),
]


# ─── Helpers ───


async def _newest_first[M: (Activity, Notification)](
    db: AsyncSession, query: Select[tuple[M]], model: type[M], limit: int, before: datetime | None
) -> list[M]:
    """One page of `query`, newest first.

    Rows written in one transaction share `created_at`, so a page never splits such a group: it is
    extended to include the whole group (and may run past `limit`). That keeps a plain `before`
    timestamp cursor from skipping anything, and a page shorter than `limit` still means "no more".
    """
    if before is not None:
        query = query.where(model.created_at < (before if before.tzinfo else before.replace(tzinfo=UTC)))
    rows = list(await db.scalars(query.order_by(model.created_at.desc(), model.id.desc()).limit(limit)))
    if len(rows) == limit:
        last = rows[-1]
        rows.extend(
            await db.scalars(
                query.where(model.created_at == last.created_at, model.id < last.id).order_by(model.id.desc())
            )
        )
    return rows


def _inbox_conditions(user: User, workspace_id: uuid.UUID | None) -> list[ColumnElement[bool]]:
    """The user's own notifications in workspaces where they're an active member.

    Invitations are the exception: they're addressed to people who haven't joined that workspace yet.
    """
    active_workspaces = select(WorkspaceMember.workspace_id).where(
        WorkspaceMember.user_id == user.id, WorkspaceMember.deactivated_at.is_(None)
    )
    conditions = [
        Notification.user_id == user.id,
        or_(Notification.workspace_id.in_(active_workspaces), Notification.type == NotificationType.invited),
    ]
    if workspace_id is not None:
        conditions.append(Notification.workspace_id == workspace_id)
    return conditions


async def _notifications_out(db: AsyncSession, user: User, rows: list[Notification]) -> list[NotificationOut]:
    """Batch-serialize notifications. Projects the user can no longer see and trashed tasks come back as null."""
    visible: set[uuid.UUID] = set()
    for workspace_id in {n.workspace_id for n in rows}:
        visible.update(await permissions.visible_project_ids(db, user.id, workspace_id))
    actors = await serializers.user_briefs(db, (n.actor_id for n in rows))
    projects = await serializers.project_briefs(db, (n.project_id for n in rows if n.project_id in visible))
    task_ids = {n.task_id for n in rows if n.task_id}
    tasks: list[Task] = []
    if task_ids and visible:
        tasks = list(
            await db.scalars(
                select(Task).where(Task.id.in_(task_ids), Task.deleted_at.is_(None), Task.project_id.in_(visible))
            )
        )
    briefs = {b.id: b for b in await serializers.task_briefs(db, tasks)}
    return [
        NotificationOut(
            id=n.id,
            type=n.type,
            workspace_id=n.workspace_id,
            actor=actors.get(n.actor_id) if n.actor_id else None,
            project=projects.get(n.project_id) if n.project_id else None,
            task=briefs.get(n.task_id) if n.task_id else None,
            data=n.data or {},
            read_at=n.read_at,
            created_at=n.created_at,
        )
        for n in rows
    ]


async def _activity_out(db: AsyncSession, rows: list[Activity]) -> list[ActivityOut]:
    """Batch-serialize activity entries (task briefs include tasks in the trash)."""
    actors = await serializers.user_briefs(db, (a.actor_id for a in rows))
    tasks = await serializers.task_brief_map(db, (a.task_id for a in rows))
    return [
        ActivityOut(
            id=a.id,
            verb=a.verb,
            actor=actors.get(a.actor_id) if a.actor_id else None,
            project_id=a.project_id,
            task=tasks.get(a.task_id) if a.task_id else None,
            data=a.data or {},
            created_at=a.created_at,
        )
        for a in rows
    ]


# ─── Notifications ───


@router.get("/notifications", response_model=list[NotificationOut])
async def list_notifications(
    user: CurrentUser,
    db: DB,
    workspace_id: Annotated[
        uuid.UUID | None, Query(description="Only this workspace (omit to include invitations to other workspaces)")
    ] = None,
    unread_only: bool = False,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    before: Before = None,
):
    """Your inbox, newest first; project/task are null once you lose access or the task is trashed."""
    query = select(Notification).where(*_inbox_conditions(user, workspace_id))
    if unread_only:
        query = query.where(Notification.read_at.is_(None))
    rows = await _newest_first(db, query, Notification, limit, before)
    return await _notifications_out(db, user, rows)


@router.get("/notifications/unread-count", response_model=UnreadCount)
async def unread_count(user: CurrentUser, db: DB, workspace_id: uuid.UUID | None = None):
    """Number of unread notifications in your inbox (optionally for one workspace)."""
    count = await db.scalar(
        select(func.count())
        .select_from(Notification)
        .where(*_inbox_conditions(user, workspace_id), Notification.read_at.is_(None))
    )
    return UnreadCount(count=count or 0)


@router.post("/notifications/mark-read", response_model=Ok)
async def mark_read(data: MarkRead, user: CurrentUser, db: DB):
    """Mark your notifications read: the given ids, or all of them (optionally in one workspace)."""
    if not data.all and not data.ids:
        raise BadRequest("Pass the ids to mark as read, or all=true", code="nothing_to_mark")
    if len(data.ids) > MAX_MARK_READ_IDS:
        raise BadRequest(f"Mark at most {MAX_MARK_READ_IDS} notifications at once", code="too_many_ids")

    stmt = update(Notification).where(Notification.user_id == user.id, Notification.read_at.is_(None))
    if not data.all:
        stmt = stmt.where(Notification.id.in_(set(data.ids)))
    if data.workspace_id is not None:
        stmt = stmt.where(Notification.workspace_id == data.workspace_id)
    marked = list((await db.execute(stmt.values(read_at=utcnow()).returning(Notification.id))).scalars())
    if marked:
        queue_event(
            db,
            "notification.read",
            [user.id],
            workspace_id=data.workspace_id,
            data={"ids": [] if data.all else [str(i) for i in marked], "all": data.all, "count": len(marked)},
        )
    await db.commit()
    return Ok()


# ─── Activity feeds ───


@router.get("/projects/{project_id}/activity", response_model=list[ActivityOut])
async def project_activity(
    project_id: uuid.UUID,
    user: CurrentUser,
    db: DB,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    before: Before = None,
):
    """A project's history, newest first (entries about trashed tasks included)."""
    await permissions.require_project(db, user, project_id)
    rows = await _newest_first(db, select(Activity).where(Activity.project_id == project_id), Activity, limit, before)
    return await _activity_out(db, rows)


@router.get("/tasks/{task_id}/activity", response_model=list[ActivityOut])
async def task_activity(
    task_id: uuid.UUID,
    user: CurrentUser,
    db: DB,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    before: Before = None,
):
    """A task's history, newest first (also available while the task is in the trash)."""
    task, _, _ = await permissions.require_task(db, user, task_id, include_deleted=True)
    rows = await _newest_first(db, select(Activity).where(Activity.task_id == task.id), Activity, limit, before)
    return await _activity_out(db, rows)


@router.get("/workspaces/{workspace_id}/activity", response_model=list[ActivityOut])
async def workspace_activity(
    workspace_id: uuid.UUID,
    user: CurrentUser,
    db: DB,
    limit: Annotated[int, Query(ge=1, le=100)] = 30,
    before: Before = None,
):
    """Recent activity across the projects you can see; workspace-level entries for owners/admins only."""
    membership = await permissions.require_workspace(db, user, workspace_id)
    query = select(Activity).where(Activity.workspace_id == workspace_id)
    if not permissions.is_workspace_admin(membership):
        project_ids = await permissions.visible_project_ids(db, user.id, workspace_id)
        if not project_ids:
            return []
        query = query.where(Activity.project_id.in_(project_ids))
    rows = await _newest_first(db, query, Activity, limit, before)
    return await _activity_out(db, rows)
