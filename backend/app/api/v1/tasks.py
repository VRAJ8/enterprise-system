"""Tasks: CRUD, filtering, drag & drop ordering, bulk edits, subtasks, dependencies, watchers, labels."""

import uuid
from datetime import date
from decimal import Decimal
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Query
from sqlalchemy import delete, select, tuple_
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import utcnow
from app.core.deps import DB, CurrentUser
from app.core.errors import BadRequest, Conflict, NotFound
from app.models import (
    Label,
    Milestone,
    NotificationType,
    Priority,
    Project,
    ProjectRole,
    StatusCategory,
    Task,
    TaskDependency,
    TaskLabel,
    TaskStatus,
    TaskWatcher,
    User,
)
from app.schemas.common import Ok
from app.schemas.task import (
    BulkResult,
    DueFilter,
    StateFilter,
    TaskBulkUpdate,
    TaskCreate,
    TaskDetail,
    TaskList,
    TaskMove,
    TaskOut,
    TaskSort,
    TaskUpdate,
)
from app.services import activity, permissions, serializers
from app.services import tasks as svc
from app.services.projects import POSITION_STEP, default_status, edge_position, next_task_number
from app.services.realtime import queue_event

router = APIRouter(tags=["tasks"])


# ─── Helpers ───


def task_filters(
    assignee: Annotated[str | None, Query(description="'me', 'unassigned' or a user id")] = None,
    state: StateFilter = "all",
    status_category: Annotated[list[StatusCategory] | None, Query()] = None,
    priority: Annotated[list[Priority] | None, Query()] = None,
    label_id: Annotated[list[uuid.UUID] | None, Query(description="Tasks with any of these labels")] = None,
    milestone_id: uuid.UUID | None = None,
    due: Annotated[DueFilter | None, Query(description="Relative to the user's today; week = today…today+7")] = None,
    q: Annotated[
        str | None, Query(max_length=200, description="Title contains (case-insensitive) or exact ref, e.g. WEB-12")
    ] = None,
    top_level: Annotated[bool, Query(description="Only tasks without a parent")] = False,
    sort: Annotated[
        TaskSort,
        Query(
            description="due_date: soonest first, undated last; priority: urgent first; updated/created: newest first"
        ),
    ] = "position",
) -> svc.TaskFilters:
    return svc.TaskFilters(
        assignee=assignee,
        state=state,
        status_category=status_category or [],
        priority=priority or [],
        label_id=label_id or [],
        milestone_id=milestone_id,
        due=due,
        q=q,
        top_level=top_level,
        sort=sort,
    )


Filters = Annotated[svc.TaskFilters, Depends(task_filters)]


def _ref(project: Project, task: Task) -> str:
    return serializers.task_ref(project.key, task.number)


def _iso(value: date | None) -> str | None:
    return value.isoformat() if value else None


def _excerpt(text: str, limit: int = 140) -> str:
    text = " ".join(text.split())
    return text if len(text) <= limit else text[: limit - 1] + "…"


async def _names(db: AsyncSession, user_ids: list[uuid.UUID | None]) -> dict[uuid.UUID, str]:
    return {uid: brief.name for uid, brief in (await serializers.user_briefs(db, user_ids)).items()}


async def _watchers_by_task(db: AsyncSession, task_ids: list[uuid.UUID]) -> dict[uuid.UUID, list[uuid.UUID]]:
    out: dict[uuid.UUID, list[uuid.UUID]] = {}
    if task_ids:
        rows = await db.execute(
            select(TaskWatcher.task_id, TaskWatcher.user_id).where(TaskWatcher.task_id.in_(task_ids))
        )
        for task_id, user_id in rows:
            out.setdefault(task_id, []).append(user_id)
    return out


async def _notify_status_change(
    db: AsyncSession, project: Project, task: Task, watchers: list[uuid.UUID], actor: User, old: str, new: str
) -> None:
    await activity.notify(
        db,
        user_ids=watchers,
        type=NotificationType.status_changed,
        workspace_id=project.workspace_id,
        actor_id=actor.id,
        project_id=project.id,
        task_id=task.id,
        data={"from": old, "to": new},
    )


async def _notify_assigned(db: AsyncSession, project: Project, task: Task, assignee_id: uuid.UUID, actor: User) -> None:
    await activity.notify(
        db,
        user_ids=[assignee_id],
        type=NotificationType.assigned,
        workspace_id=project.workspace_id,
        actor_id=actor.id,
        project_id=project.id,
        task_id=task.id,
        data={"ref": _ref(project, task), "title": task.title},
    )


async def _task_out(db: AsyncSession, task: Task, user: User) -> TaskOut:
    return (await serializers.tasks_out(db, [task], serializers.user_today(user)))[0]


# ─── Lists ───


@router.get("/workspaces/{workspace_id}/tasks", response_model=TaskList)
async def list_workspace_tasks(
    workspace_id: uuid.UUID,
    user: CurrentUser,
    db: DB,
    filters: Filters,
    project_id: Annotated[list[uuid.UUID] | None, Query(description="Limit to these projects")] = None,
    limit: Annotated[int, Query(ge=1, le=500)] = 100,
    cursor: Annotated[str | None, Query(description="next_cursor from the previous page")] = None,
):
    """Tasks across every project the current user can see (My Tasks, filtered lists, search)."""
    await permissions.require_workspace(db, user, workspace_id)
    project_ids = await permissions.visible_project_ids(db, user.id, workspace_id)
    if project_id:
        wanted = set(project_id)
        project_ids = [p for p in project_ids if p in wanted]
    return await svc.query_tasks(db, user, project_ids, filters, limit=limit, cursor=cursor)


@router.get("/projects/{project_id}/tasks", response_model=TaskList)
async def list_project_tasks(
    project_id: uuid.UUID,
    user: CurrentUser,
    db: DB,
    filters: Filters,
    limit: Annotated[int, Query(ge=1, le=2000)] = 1000,
    cursor: Annotated[str | None, Query(description="next_cursor from the previous page")] = None,
):
    """Tasks of one project (board, list and timeline views), subtasks included unless top_level=true."""
    await permissions.require_project(db, user, project_id)
    return await svc.query_tasks(db, user, [project_id], filters, limit=limit, cursor=cursor)


# ─── Create / read ───


@router.post("/projects/{project_id}/tasks", response_model=TaskDetail, status_code=201)
async def create_task(project_id: uuid.UUID, data: TaskCreate, user: CurrentUser, db: DB):
    """Create a task, or a subtask when `parent_id` is given."""
    project, role = await permissions.require_project(db, user, project_id, ProjectRole.member)
    status = (
        await svc.project_status(db, project.id, data.status_id)
        if data.status_id
        else await default_status(db, project.id)
    )
    assignee, needs_access = None, False
    if data.assignee_id:
        assignee, needs_access = await svc.resolve_assignee(db, project, data.assignee_id)
    if data.parent_id:
        await svc.validate_parent(db, project.id, data.parent_id)
    if data.milestone_id:
        await svc.validate_milestone(db, project.id, data.milestone_id)
    labels = await svc.validate_labels(db, project.workspace_id, data.label_ids)

    if assignee and needs_access:
        await svc.grant_project_access(db, project, assignee, user.id)
    task = Task(
        id=uuid.uuid4(),
        project_id=project.id,
        number=await next_task_number(db, project.id),
        title=data.title,
        description=data.description,
        priority=data.priority,
        assignee_id=data.assignee_id,
        reporter_id=user.id,
        parent_id=data.parent_id,
        milestone_id=data.milestone_id,
        start_date=data.start_date,
        due_date=data.due_date,
        estimate_hours=Decimal(str(data.estimate_hours)) if data.estimate_hours is not None else None,
        position=await edge_position(db, project.id, status.id, top=data.placement == "top"),
    )
    svc.apply_status(task, status)
    db.add(task)
    await db.flush()
    db.add_all(TaskLabel(task_id=task.id, label_id=label.id) for label in labels)
    await svc.add_watchers(db, [(task.id, user.id), (task.id, data.assignee_id)])

    ref = _ref(project, task)
    activity.record(
        db,
        workspace_id=project.workspace_id,
        actor_id=user.id,
        verb="created",
        project_id=project.id,
        task_id=task.id,
        data={"ref": ref, "title": task.title},
    )
    if assignee:
        await _notify_assigned(db, project, task, assignee.id, user)
    queue_event(
        db,
        "task.created",
        await permissions.project_audience(db, project),
        workspace_id=project.workspace_id,
        project_id=project.id,
        task_id=task.id,
        data={"ref": ref, "parent_id": str(task.parent_id) if task.parent_id else None},
    )
    await db.commit()
    return await svc.build_task_detail(db, task, user, role)


@router.get("/tasks/by-ref/{workspace_id}/{ref}", response_model=TaskDetail)
async def get_task_by_ref(workspace_id: uuid.UUID, ref: str, user: CurrentUser, db: DB):
    """Look a task up by its human reference, e.g. WEB-42 (case-insensitive)."""
    parsed = svc.parse_ref(ref)
    if parsed is None:
        raise NotFound("Task not found")
    key, number = parsed
    task_id = await db.scalar(
        select(Task.id)
        .join(Project, Project.id == Task.project_id)
        .where(
            Project.workspace_id == workspace_id,
            Project.key == key,
            Task.number == number,
            Task.deleted_at.is_(None),
        )
    )
    if task_id is None:
        raise NotFound("Task not found")
    task, _, role = await permissions.require_task(db, user, task_id)
    return await svc.build_task_detail(db, task, user, role)


@router.get("/tasks/{task_id}", response_model=TaskDetail)
async def get_task(task_id: uuid.UUID, user: CurrentUser, db: DB):
    """Full task detail: subtasks, dependencies, watchers and logged time."""
    task, _, role = await permissions.require_task(db, user, task_id)
    return await svc.build_task_detail(db, task, user, role)


# ─── Bulk (declared before /tasks/{task_id} so "bulk" isn't parsed as an id) ───


@router.patch("/tasks/bulk", response_model=BulkResult)
async def bulk_update(data: TaskBulkUpdate, user: CurrentUser, db: DB):
    """Apply the same change to many tasks at once. All-or-nothing: any invalid task aborts the whole edit."""
    ids = list(dict.fromkeys(data.task_ids))
    tasks = list(await db.scalars(select(Task).where(Task.id.in_(ids), Task.deleted_at.is_(None))))
    if len(tasks) != len(ids):
        raise NotFound("Some of these tasks no longer exist", code="tasks_not_found")
    projects: dict[uuid.UUID, Project] = {}
    for pid in {t.project_id for t in tasks}:
        try:
            projects[pid], _ = await permissions.require_project(db, user, pid, ProjectRole.member)
        except NotFound:
            raise NotFound("Some of these tasks no longer exist", code="tasks_not_found") from None
    tasks.sort(key=lambda t: (t.position, t.created_at))
    now = utcnow()

    if data.delete:
        subtasks = await svc.soft_delete(db, tasks, now)
        for t in tasks:
            project = projects[t.project_id]
            activity.record(
                db,
                workspace_id=project.workspace_id,
                actor_id=user.id,
                verb="deleted",
                project_id=project.id,
                task_id=t.id,
                data={"ref": _ref(project, t), "title": t.title},
            )
        for project in projects.values():
            removed = [str(t.id) for t in (*tasks, *subtasks) if t.project_id == project.id]
            queue_event(
                db,
                "task.deleted",
                await permissions.project_audience(db, project),
                workspace_id=project.workspace_id,
                project_id=project.id,
                data={"task_ids": removed, "bulk": True},
            )
        await db.commit()
        return BulkResult(updated=len(tasks), task_ids=[t.id for t in tasks])

    # Validate everything first.
    sent = data.model_fields_set
    if data.assignee_id and data.clear_assignee:
        raise BadRequest("Choose either an assignee or clear_assignee", code="conflicting_fields")
    status: TaskStatus | None = None
    if data.status_id:
        status = await db.get(TaskStatus, data.status_id)
        if status is None or any(t.project_id != status.project_id for t in tasks):
            raise BadRequest(
                "That status doesn't belong to every selected task's project", code="status_project_mismatch"
            )
    if data.milestone_id:
        milestone = await db.get(Milestone, data.milestone_id)
        if milestone is None or any(t.project_id != milestone.project_id for t in tasks):
            raise BadRequest(
                "That milestone doesn't belong to every selected task's project", code="milestone_project_mismatch"
            )
    grants: list[tuple[Project, User]] = []
    if data.assignee_id:
        for project in projects.values():
            assignee, needs_access = await svc.resolve_assignee(db, project, data.assignee_id)
            if needs_access:
                grants.append((project, assignee))
    add_labels: list[Label] = []
    if data.add_label_ids:
        workspace_ids = {p.workspace_id for p in projects.values()}
        if len(workspace_ids) > 1:
            raise BadRequest("Labels can only be added to tasks of one workspace at a time", code="invalid_label")
        add_labels = await svc.validate_labels(db, workspace_ids.pop(), data.add_label_ids)
    if "due_date" in sent and data.due_date and any(t.start_date and t.start_date > data.due_date for t in tasks):
        raise BadRequest("The due date must be on or after each task's start date", code="invalid_dates")

    # Lookups for human-readable activity.
    old_statuses = {
        s.id: s for s in await db.scalars(select(TaskStatus).where(TaskStatus.id.in_({t.status_id for t in tasks})))
    }
    names = await _names(db, [*(t.assignee_id for t in tasks), data.assignee_id])
    milestone_ids = {t.milestone_id for t in tasks} | {data.milestone_id}
    milestone_names = dict(
        (await db.execute(select(Milestone.id, Milestone.name).where(Milestone.id.in_(milestone_ids - {None})))).all()
    )
    current_labels: dict[uuid.UUID, dict[uuid.UUID, str]] = {}
    for task_id, label_id, label_name in await db.execute(
        select(TaskLabel.task_id, Label.id, Label.name)
        .join(Label, Label.id == TaskLabel.label_id)
        .where(TaskLabel.task_id.in_(ids))
    ):
        current_labels.setdefault(task_id, {})[label_id] = label_name
    next_position = await edge_position(db, status.project_id, status.id, top=False) if status else 0.0

    changed: list[tuple[Task, dict[str, Any]]] = []
    label_adds: list[dict] = []
    label_removals: list[tuple[uuid.UUID, uuid.UUID]] = []
    new_assignee = None if data.clear_assignee else data.assignee_id
    for t in tasks:
        changes: dict[str, Any] = {}
        if status and t.status_id != status.id:
            changes["status"] = {"from": old_statuses[t.status_id].name, "to": status.name}
            svc.apply_status(t, status, now)
            t.position = next_position
            next_position += POSITION_STEP
        if data.priority and t.priority != data.priority:
            changes["priority"] = {"from": t.priority.value, "to": data.priority.value}
            t.priority = data.priority
        if (data.assignee_id or data.clear_assignee) and t.assignee_id != new_assignee:
            changes["assignee"] = {"from": names.get(t.assignee_id), "to": names.get(new_assignee)}
            t.assignee_id = new_assignee
        if "milestone_id" in sent and t.milestone_id != data.milestone_id:
            changes["milestone"] = {
                "from": milestone_names.get(t.milestone_id),
                "to": milestone_names.get(data.milestone_id),
            }
            t.milestone_id = data.milestone_id
        if "due_date" in sent and t.due_date != data.due_date:
            changes["due_date"] = {"from": _iso(t.due_date), "to": _iso(data.due_date)}
            t.due_date = data.due_date
        have = current_labels.get(t.id, {})
        adding = {lb.id: lb.name for lb in add_labels if lb.id not in have}
        removing = [lid for lid in dict.fromkeys(data.remove_label_ids) if lid in have and lid not in adding]
        if adding or removing:
            label_adds.extend({"task_id": t.id, "label_id": lid} for lid in adding)
            label_removals.extend((t.id, lid) for lid in removing)
            after = {lid: name for lid, name in {**have, **adding}.items() if lid not in removing}
            changes["labels"] = {
                "from": sorted(have.values(), key=str.lower),
                "to": sorted(after.values(), key=str.lower),
            }
        if changes:
            t.updated_at = now
            changed.append((t, changes))

    if not changed:
        return BulkResult(updated=0, task_ids=[])

    for project, assignee in grants:
        if any(t.project_id == project.id and t.assignee_id == assignee.id for t, _ in changed):
            await svc.grant_project_access(db, project, assignee, user.id)
    if label_removals:
        await db.execute(delete(TaskLabel).where(tuple_(TaskLabel.task_id, TaskLabel.label_id).in_(label_removals)))
    if label_adds:
        db.add_all(TaskLabel(**row) for row in label_adds)

    status_moved = [t.id for t, ch in changed if "status" in ch]
    watchers = await _watchers_by_task(db, status_moved)
    for t, changes in changed:
        project = projects[t.project_id]
        activity.record(
            db,
            workspace_id=project.workspace_id,
            actor_id=user.id,
            verb="updated",
            project_id=project.id,
            task_id=t.id,
            data={"changes": changes, "bulk": True},
        )
        if "status" in changes:
            await _notify_status_change(
                db, project, t, watchers.get(t.id, []), user, changes["status"]["from"], changes["status"]["to"]
            )
        if "assignee" in changes and t.assignee_id:
            await _notify_assigned(db, project, t, t.assignee_id, user)
    if new_assignee:
        await svc.add_watchers(db, [(t.id, new_assignee) for t, ch in changed if "assignee" in ch])

    for project in projects.values():
        updated = [str(t.id) for t, _ in changed if t.project_id == project.id]
        if updated:
            queue_event(
                db,
                "task.updated",
                await permissions.project_audience(db, project),
                workspace_id=project.workspace_id,
                project_id=project.id,
                data={"task_ids": updated, "bulk": True},
            )
    await db.commit()
    changed_ids = {t.id for t, _ in changed}
    return BulkResult(updated=len(changed_ids), task_ids=[i for i in ids if i in changed_ids])


# ─── Update / delete / restore ───


@router.patch("/tasks/{task_id}", response_model=TaskDetail)
async def update_task(task_id: uuid.UUID, data: TaskUpdate, user: CurrentUser, db: DB):
    """Edit a task. Only the fields sent change; an explicit null clears nullable fields."""
    task, project, role = await permissions.require_task(db, user, task_id, ProjectRole.member)
    fields = data.model_dump(exclude_unset=True)
    for name in ("title", "status_id", "priority"):
        if name in fields and fields[name] is None:
            raise BadRequest(f"{name} can't be empty", code="field_required")

    # Validate everything before changing anything.
    old_status = await db.get(TaskStatus, task.status_id)
    new_status = None
    if fields.get("status_id") and fields["status_id"] != task.status_id:
        new_status = await svc.project_status(db, project.id, fields["status_id"])
    assignee_changed = "assignee_id" in fields and fields["assignee_id"] != task.assignee_id
    assignee, needs_access = None, False
    if assignee_changed and fields["assignee_id"]:
        assignee, needs_access = await svc.resolve_assignee(db, project, fields["assignee_id"])
    parent_changed = "parent_id" in fields and fields["parent_id"] != task.parent_id
    if parent_changed and fields["parent_id"]:
        await svc.validate_parent(db, project.id, fields["parent_id"], task)
    milestone_changed = "milestone_id" in fields and fields["milestone_id"] != task.milestone_id
    if milestone_changed and fields["milestone_id"]:
        await svc.validate_milestone(db, project.id, fields["milestone_id"])
    labels = (
        await svc.validate_labels(db, project.workspace_id, fields["label_ids"] or [])
        if "label_ids" in fields
        else None
    )
    start = fields.get("start_date", task.start_date)
    due = fields.get("due_date", task.due_date)
    if start and due and due < start:
        raise BadRequest("The due date must be on or after the start date", code="invalid_dates")

    now = utcnow()
    changes: dict[str, Any] = {}
    if "title" in fields and fields["title"] != task.title:
        changes["title"] = {"from": task.title, "to": fields["title"]}
        task.title = fields["title"]
    if "description" in fields and (fields["description"] or "") != task.description:
        new_description = fields["description"] or ""
        changes["description"] = {"from": _excerpt(task.description), "to": _excerpt(new_description)}
        task.description = new_description
    if fields.get("priority") and fields["priority"] != task.priority:
        changes["priority"] = {"from": task.priority.value, "to": fields["priority"].value}
        task.priority = fields["priority"]
    if new_status:
        # A task that changes column lands at the bottom of its new column.
        task.position = await edge_position(db, project.id, new_status.id, top=False)
        changes["status"] = {"from": old_status.name, "to": new_status.name}
        svc.apply_status(task, new_status, now)
    if assignee_changed:
        names = await _names(db, [task.assignee_id, fields["assignee_id"]])
        changes["assignee"] = {"from": names.get(task.assignee_id), "to": names.get(fields["assignee_id"])}
        task.assignee_id = fields["assignee_id"]
    if parent_changed:
        refs = await serializers.task_brief_map(db, [task.parent_id, fields["parent_id"]])
        old_ref, new_ref = refs.get(task.parent_id), refs.get(fields["parent_id"])
        changes["parent"] = {"from": old_ref.ref if old_ref else None, "to": new_ref.ref if new_ref else None}
        task.parent_id = fields["parent_id"]
    if milestone_changed:
        milestone_names = dict(
            (
                await db.execute(
                    select(Milestone.id, Milestone.name).where(
                        Milestone.id.in_([m for m in (task.milestone_id, fields["milestone_id"]) if m])
                    )
                )
            ).all()
        )
        changes["milestone"] = {
            "from": milestone_names.get(task.milestone_id),
            "to": milestone_names.get(fields["milestone_id"]),
        }
        task.milestone_id = fields["milestone_id"]
    for name in ("start_date", "due_date"):
        if name in fields and fields[name] != getattr(task, name):
            changes[name] = {"from": _iso(getattr(task, name)), "to": _iso(fields[name])}
            setattr(task, name, fields[name])
    if "estimate_hours" in fields:
        old_estimate = float(task.estimate_hours) if task.estimate_hours is not None else None
        if fields["estimate_hours"] != old_estimate:
            changes["estimate_hours"] = {"from": old_estimate, "to": fields["estimate_hours"]}
            value = fields["estimate_hours"]
            task.estimate_hours = Decimal(str(value)) if value is not None else None
    if labels is not None:
        old_labels = list(
            await db.scalars(
                select(Label)
                .join(TaskLabel, TaskLabel.label_id == Label.id)
                .where(TaskLabel.task_id == task.id)
                .order_by(Label.name)
            )
        )
        if {lb.id for lb in old_labels} != {lb.id for lb in labels}:
            changes["labels"] = {"from": [lb.name for lb in old_labels], "to": [lb.name for lb in labels]}
            await db.execute(delete(TaskLabel).where(TaskLabel.task_id == task.id))
            db.add_all(TaskLabel(task_id=task.id, label_id=lb.id) for lb in labels)

    if not changes:
        return await svc.build_task_detail(db, task, user, role)

    task.updated_at = now
    if assignee and needs_access:
        await svc.grant_project_access(db, project, assignee, user.id)
    activity.record(
        db,
        workspace_id=project.workspace_id,
        actor_id=user.id,
        verb="updated",
        project_id=project.id,
        task_id=task.id,
        data={"changes": changes},
    )
    if new_status:
        watchers = (await _watchers_by_task(db, [task.id])).get(task.id, [])
        await _notify_status_change(db, project, task, watchers, user, old_status.name, new_status.name)
    if assignee:
        await _notify_assigned(db, project, task, assignee.id, user)
        await svc.add_watchers(db, [(task.id, assignee.id)])
    queue_event(
        db,
        "task.updated",
        await permissions.project_audience(db, project),
        workspace_id=project.workspace_id,
        project_id=project.id,
        task_id=task.id,
        data={"changes": sorted(changes)},
    )
    await db.commit()
    return await svc.build_task_detail(db, task, user, role)


@router.delete("/tasks/{task_id}", response_model=Ok)
async def delete_task(task_id: uuid.UUID, user: CurrentUser, db: DB):
    """Move a task and its subtasks to the trash (restorable)."""
    task, project, _ = await permissions.require_task(db, user, task_id, ProjectRole.member)
    subtasks = await svc.soft_delete(db, [task], utcnow())
    ref = _ref(project, task)
    activity.record(
        db,
        workspace_id=project.workspace_id,
        actor_id=user.id,
        verb="deleted",
        project_id=project.id,
        task_id=task.id,
        data={"ref": ref, "title": task.title, "subtasks": len(subtasks)},
    )
    queue_event(
        db,
        "task.deleted",
        await permissions.project_audience(db, project),
        workspace_id=project.workspace_id,
        project_id=project.id,
        task_id=task.id,
        data={"ref": ref, "task_ids": [str(t.id) for t in (task, *subtasks)]},
    )
    await db.commit()
    return Ok()


@router.post("/tasks/{task_id}/restore", response_model=TaskDetail)
async def restore_task(task_id: uuid.UUID, user: CurrentUser, db: DB):
    """Bring a trashed task back, with the subtasks that were trashed along with it."""
    task, project, role = await permissions.require_task(db, user, task_id, ProjectRole.member, include_deleted=True)
    if task.deleted_at is None:
        return await svc.build_task_detail(db, task, user, role)
    if task.parent_id:
        parent = await db.get(Task, task.parent_id)
        if parent is None or parent.deleted_at is not None:
            raise BadRequest("Restore the parent task first", code="parent_deleted")
        if parent.parent_id is not None:
            raise BadRequest("The parent task has become a subtask itself", code="nested_subtask")
    subtasks = await svc.restore(db, task, utcnow())
    ref = _ref(project, task)
    activity.record(
        db,
        workspace_id=project.workspace_id,
        actor_id=user.id,
        verb="restored",
        project_id=project.id,
        task_id=task.id,
        data={"ref": ref, "title": task.title, "subtasks": len(subtasks)},
    )
    queue_event(
        db,
        "task.restored",
        await permissions.project_audience(db, project),
        workspace_id=project.workspace_id,
        project_id=project.id,
        task_id=task.id,
        data={"ref": ref, "task_ids": [str(t.id) for t in (task, *subtasks)]},
    )
    await db.commit()
    return await svc.build_task_detail(db, task, user, role)


# ─── Drag & drop ───


@router.post("/tasks/{task_id}/move", response_model=TaskOut)
async def move_task(task_id: uuid.UUID, data: TaskMove, user: CurrentUser, db: DB):
    """Drag & drop: optionally change status and place the task between two neighbours."""
    task, project, _ = await permissions.require_task(db, user, task_id, ProjectRole.member)
    old_status = await db.get(TaskStatus, task.status_id)
    target = await svc.project_status(db, project.id, data.status_id) if data.status_id else old_status
    after = await svc.load_neighbour(db, task, target, data.after_id)
    before = await svc.load_neighbour(db, task, target, data.before_id)
    position = await svc.drop_position(db, task, target, after, before)

    now = utcnow()
    status_changed = target.id != old_status.id
    if status_changed:
        svc.apply_status(task, target, now)
        activity.record(
            db,
            workspace_id=project.workspace_id,
            actor_id=user.id,
            verb="updated",
            project_id=project.id,
            task_id=task.id,
            data={"changes": {"status": {"from": old_status.name, "to": target.name}}},
        )
        watchers = (await _watchers_by_task(db, [task.id])).get(task.id, [])
        await _notify_status_change(db, project, task, watchers, user, old_status.name, target.name)
    task.position = position
    task.updated_at = now
    queue_event(
        db,
        "task.updated",
        await permissions.project_audience(db, project),
        workspace_id=project.workspace_id,
        project_id=project.id,
        task_id=task.id,
        data={"moved": True, "status_changed": status_changed},
    )
    await db.commit()
    return await _task_out(db, task, user)


# ─── Dependencies ───


async def _dependency_pair(
    db: AsyncSession, user: User, task_id: uuid.UUID, other_id: uuid.UUID, include_deleted_other: bool = False
) -> tuple[Task, Project, ProjectRole, Task, Project]:
    task, project, role = await permissions.require_task(db, user, task_id, ProjectRole.member)
    other, other_project, _ = await permissions.require_task(db, user, other_id, include_deleted=include_deleted_other)
    if other_project.workspace_id != project.workspace_id:
        raise NotFound("Task not found")
    return task, project, role, other, other_project


async def _dependency_events(
    db: AsyncSession, user: User, verb: str, task: Task, project: Project, other: Task, other_project: Project
) -> None:
    activity.record(
        db,
        workspace_id=project.workspace_id,
        actor_id=user.id,
        verb=verb,
        project_id=project.id,
        task_id=task.id,
        data={
            "blocker": {"id": str(other.id), "ref": _ref(other_project, other)},
            "blocked": {"id": str(task.id), "ref": _ref(project, task)},
        },
    )
    for t, p in ((task, project), (other, other_project)):
        queue_event(
            db,
            "task.updated",
            await permissions.project_audience(db, p),
            workspace_id=p.workspace_id,
            project_id=p.id,
            task_id=t.id,
            data={"dependency": verb},
        )


@router.post("/tasks/{task_id}/dependencies/{other_id}", response_model=TaskDetail, status_code=201)
async def add_dependency(task_id: uuid.UUID, other_id: uuid.UUID, user: CurrentUser, db: DB):
    """Record that `other_id` blocks `task_id` (it must finish first). Returns the blocked task."""
    task, project, role, other, other_project = await _dependency_pair(db, user, task_id, other_id)
    if other.id == task.id:
        raise BadRequest("A task can't block itself", code="self_dependency")
    if await db.get(TaskDependency, (other.id, task.id)):
        raise Conflict("That dependency already exists", code="dependency_exists")
    if await svc.creates_cycle(db, blocker_id=other.id, blocked_id=task.id):
        raise BadRequest("That would create a circular dependency", code="dependency_cycle")
    db.add(TaskDependency(blocker_id=other.id, blocked_id=task.id))
    await _dependency_events(db, user, "dependency_added", task, project, other, other_project)
    await db.commit()
    return await svc.build_task_detail(db, task, user, role)


@router.delete("/tasks/{task_id}/dependencies/{other_id}", response_model=Ok)
async def remove_dependency(task_id: uuid.UUID, other_id: uuid.UUID, user: CurrentUser, db: DB):
    """Remove the "other_id blocks task_id" dependency."""
    task, project, _, other, other_project = await _dependency_pair(
        db, user, task_id, other_id, include_deleted_other=True
    )
    dependency = await db.get(TaskDependency, (other.id, task.id))
    if dependency is None:
        raise NotFound("Dependency not found", code="dependency_not_found")
    await db.delete(dependency)
    await _dependency_events(db, user, "dependency_removed", task, project, other, other_project)
    await db.commit()
    return Ok()


# ─── Watchers ───


async def _watch_event(db: AsyncSession, task: Task, project: Project, user: User, watching: bool) -> None:
    queue_event(
        db,
        "task.updated",
        await permissions.project_audience(db, project),
        workspace_id=project.workspace_id,
        project_id=project.id,
        task_id=task.id,
        data={"watcher": str(user.id), "watching": watching},
    )


@router.post("/tasks/{task_id}/watch", response_model=Ok)
async def watch_task(task_id: uuid.UUID, user: CurrentUser, db: DB):
    """Follow a task to be notified about its changes (idempotent)."""
    task, project, _ = await permissions.require_task(db, user, task_id)
    if await db.get(TaskWatcher, (task.id, user.id)) is None:
        await svc.add_watchers(db, [(task.id, user.id)])
        await _watch_event(db, task, project, user, True)
        await db.commit()
    return Ok()


@router.delete("/tasks/{task_id}/watch", response_model=Ok)
async def unwatch_task(task_id: uuid.UUID, user: CurrentUser, db: DB):
    """Stop following a task (idempotent)."""
    task, project, _ = await permissions.require_task(db, user, task_id)
    watcher = await db.get(TaskWatcher, (task.id, user.id))
    if watcher is not None:
        await db.delete(watcher)
        await _watch_event(db, task, project, user, False)
        await db.commit()
    return Ok()
