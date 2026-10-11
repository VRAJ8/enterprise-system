"""Projects, project members, statuses, milestones and status updates."""

import re
import unicodedata
import uuid
from collections.abc import Iterable, Mapping
from datetime import UTC, date, datetime
from enum import Enum
from typing import Any

from fastapi import APIRouter, Query
from sqlalchemy import delete, func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import DB, CurrentUser
from app.core.errors import BadRequest, Conflict, Forbidden, NotFound
from app.models import (
    CLOSED_CATEGORIES,
    STARTED_CATEGORIES,
    Milestone,
    NotificationType,
    Project,
    ProjectMember,
    ProjectRole,
    ProjectStatus,
    ProjectUpdate,
    StatusCategory,
    Task,
    TaskStatus,
    User,
    WorkspaceMember,
    WorkspaceRole,
)
from app.schemas.common import Ok
from app.schemas.project import (
    MilestoneCreate,
    MilestoneOut,
    MilestoneUpdate,
    ProjectCreate,
    ProjectMemberCreate,
    ProjectMemberOut,
    ProjectMemberUpdate,
    ProjectOut,
    ProjectStats,
    ProjectUpdateCreate,
    ProjectUpdateOut,
    StatusCreate,
    StatusOut,
    StatusReorder,
    StatusUpdate,
)
from app.schemas.project import ProjectUpdate as ProjectPatch
from app.services import activity, permissions, realtime
from app.services.projects import POSITION_STEP, add_default_statuses, project_statuses
from app.services.serializers import user_briefs, user_today

router = APIRouter(tags=["projects"])

KEY_MAX_LENGTH = 6
EXCERPT_LENGTH = 140
_CLOSED = [c.value for c in CLOSED_CATEGORIES]
# List order: work in flight first, then finished/paused, archived last (only when requested).
_STATUS_GROUP = {
    ProjectStatus.active: 0,
    ProjectStatus.planning: 0,
    ProjectStatus.completed: 1,
    ProjectStatus.on_hold: 1,
    ProjectStatus.archived: 2,
}
# Project columns that can't be cleared with an explicit null (null means "leave unchanged").
_REQUIRED_FIELDS = ("name", "key", "description", "color", "icon", "status", "priority", "visibility")
_PLAIN_FIELDS = (*_REQUIRED_FIELDS, "start_date", "target_date")


# ─── Helpers ───


def derive_key(name: str) -> str:
    """Suggest a key from a project name: initials of several words, or the first letters of one word."""
    ascii_name = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode().upper()
    words = re.findall(r"[A-Z0-9]+", ascii_name)
    if not words:
        return "PRJ"
    key = "".join(w[0] for w in words) if len(words) > 1 else words[0][:3]
    if not key[0].isalpha():
        key = "P" + key
    return key.ljust(2, "X")[:KEY_MAX_LENGTH]


async def _unique_key(db: AsyncSession, workspace_id: uuid.UUID, base: str) -> str:
    """`base`, or `base` with a numeric suffix (kept within 6 chars) when it's taken in the workspace."""
    taken = set(await db.scalars(select(Project.key).where(Project.workspace_id == workspace_id)))
    candidate, n = base, 1
    while candidate in taken:
        n += 1
        suffix = str(n)
        candidate = base[: KEY_MAX_LENGTH - len(suffix)] + suffix
    return candidate


async def _ensure_key_free(
    db: AsyncSession, workspace_id: uuid.UUID, key: str, exclude: uuid.UUID | None = None
) -> None:
    q = select(Project.id).where(Project.workspace_id == workspace_id, Project.key == key)
    if exclude:
        q = q.where(Project.id != exclude)
    if await db.scalar(q):
        raise Conflict(f"The key {key} is already used by another project", code="key_taken")


async def _flush_checking_key(db: AsyncSession) -> None:
    """Flush, turning a lost race on the (workspace, key) unique constraint into a 409."""
    try:
        await db.flush()
    except IntegrityError as exc:
        await db.rollback()
        if "uq_projects_workspace_key" in str(exc.orig):
            raise Conflict("That project key is already in use", code="key_taken") from None
        raise


async def _require_active_member(db: AsyncSession, workspace_id: uuid.UUID, user_id: uuid.UUID, what: str) -> None:
    if await permissions.get_membership(db, user_id, workspace_id) is None:
        raise BadRequest(f"The {what} must be an active member of this workspace", code="not_workspace_member")


async def _active_member_ids(
    db: AsyncSession, workspace_id: uuid.UUID, user_ids: Iterable[uuid.UUID]
) -> set[uuid.UUID]:
    ids = set(user_ids)
    if not ids:
        return set()
    return set(
        await db.scalars(
            select(WorkspaceMember.user_id).where(
                WorkspaceMember.workspace_id == workspace_id,
                WorkspaceMember.user_id.in_(ids),
                WorkspaceMember.deactivated_at.is_(None),
            )
        )
    )


async def _explicit_member_ids(db: AsyncSession, project: Project) -> list[uuid.UUID]:
    """Explicit project members whose workspace membership is still active."""
    return list(
        await db.scalars(
            select(ProjectMember.user_id)
            .join(
                WorkspaceMember,
                (WorkspaceMember.user_id == ProjectMember.user_id)
                & (WorkspaceMember.workspace_id == project.workspace_id),
            )
            .where(ProjectMember.project_id == project.id, WorkspaceMember.deactivated_at.is_(None))
        )
    )


async def _lead_count(db: AsyncSession, project_id: uuid.UUID) -> int:
    return await db.scalar(
        select(func.count())
        .select_from(ProjectMember)
        .where(ProjectMember.project_id == project_id, ProjectMember.role == ProjectRole.lead)
    )


async def _make_lead(db: AsyncSession, project: Project, user_id: uuid.UUID) -> bool:
    """Ensure `user_id` is an explicit lead of `project`. Returns True when they were newly added."""
    pm = await db.get(ProjectMember, (project.id, user_id))
    if pm is None:
        db.add(ProjectMember(project_id=project.id, user_id=user_id, role=ProjectRole.lead))
        return True
    pm.role = ProjectRole.lead
    return False


def _display(value: Any) -> Any:
    """Activity-friendly representation of a field value."""
    if isinstance(value, Enum):
        return value.value
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, uuid.UUID):
        return str(value)
    return value


def _excerpt(text: str, limit: int = EXCERPT_LENGTH) -> str:
    flat = " ".join(text.split())
    return flat if len(flat) <= limit else flat[: limit - 1].rstrip() + "…"


def _emit(db: AsyncSession, type: str, audience: Iterable[uuid.UUID], project: Project, data: dict[str, Any]) -> None:
    realtime.queue_event(db, type, audience, workspace_id=project.workspace_id, project_id=project.id, data=data)


async def _roles_for_visible(
    db: AsyncSession, user: User, workspace_id: uuid.UUID, project_ids: list[uuid.UUID]
) -> dict[uuid.UUID, ProjectRole]:
    """Effective role on projects already known to be visible to `user` (see permissions.visible_project_ids).

    Batched equivalent of permissions.project_access for a list: admins lead everything, explicit members
    get their role, and the only remaining way to see a project is the workspace-wide viewer role.
    """
    membership = await permissions.get_membership(db, user.id, workspace_id)
    if permissions.is_workspace_admin(membership):
        return dict.fromkeys(project_ids, ProjectRole.lead)
    explicit = dict(
        (
            await db.execute(
                select(ProjectMember.project_id, ProjectMember.role).where(
                    ProjectMember.user_id == user.id, ProjectMember.project_id.in_(project_ids)
                )
            )
        ).all()
    )
    return {pid: explicit.get(pid, ProjectRole.viewer) for pid in project_ids}


async def _project_outs(
    db: AsyncSession, user: User, projects: list[Project], roles: Mapping[uuid.UUID, ProjectRole | None]
) -> list[ProjectOut]:
    """Serialize projects with lead, member count and task stats in a fixed number of queries."""
    if not projects:
        return []
    ids = [p.id for p in projects]
    is_open = TaskStatus.category.notin_(_CLOSED)
    stat_rows = (
        await db.execute(
            select(
                Task.project_id,
                func.count(),
                func.count().filter(is_open),
                func.count().filter(TaskStatus.category == StatusCategory.done),
                func.count().filter(TaskStatus.category == StatusCategory.canceled),
                func.count().filter(is_open, Task.due_date < user_today(user)),
            )
            .join(TaskStatus, TaskStatus.id == Task.status_id)
            .where(Task.project_id.in_(ids), Task.deleted_at.is_(None))
            .group_by(Task.project_id)
        )
    ).all()
    stats: dict[uuid.UUID, ProjectStats] = {}
    for pid, total, open_count, completed, canceled, overdue in stat_rows:
        scope = total - canceled
        stats[pid] = ProjectStats(
            total=total,
            open=open_count,
            completed=completed,
            overdue=overdue,
            progress=round(completed / scope, 4) if scope else 0.0,
        )
    member_counts = dict(
        (
            await db.execute(
                select(ProjectMember.project_id, func.count())
                .where(ProjectMember.project_id.in_(ids))
                .group_by(ProjectMember.project_id)
            )
        ).all()
    )
    leads = await user_briefs(db, (p.lead_id for p in projects))
    return [
        ProjectOut(
            id=p.id,
            workspace_id=p.workspace_id,
            key=p.key,
            name=p.name,
            description=p.description,
            color=p.color,
            icon=p.icon,
            status=p.status,
            priority=p.priority,
            visibility=p.visibility,
            lead=leads.get(p.lead_id) if p.lead_id else None,
            start_date=p.start_date,
            target_date=p.target_date,
            created_at=p.created_at,
            updated_at=p.updated_at,
            my_role=roles.get(p.id),
            member_count=member_counts.get(p.id, 0),
            stats=stats.get(p.id, ProjectStats()),
        )
        for p in projects
    ]


async def _project_out(db: AsyncSession, user: User, project: Project, role: ProjectRole | None) -> ProjectOut:
    return (await _project_outs(db, user, [project], {project.id: role}))[0]


async def _member_outs(db: AsyncSession, members: list[ProjectMember]) -> list[ProjectMemberOut]:
    users = await user_briefs(db, (m.user_id for m in members))
    out = [
        ProjectMemberOut(user=users[m.user_id], role=m.role, added_at=m.added_at) for m in members if m.user_id in users
    ]
    return sorted(out, key=lambda o: (-permissions.ROLE_RANK[o.role], o.user.name.lower()))


async def _status_outs(db: AsyncSession, statuses: list[TaskStatus]) -> list[StatusOut]:
    if not statuses:
        return []
    counts = dict(
        (
            await db.execute(
                select(Task.status_id, func.count())
                .where(Task.status_id.in_([s.id for s in statuses]), Task.deleted_at.is_(None))
                .group_by(Task.status_id)
            )
        ).all()
    )
    return [
        StatusOut(
            id=s.id,
            project_id=s.project_id,
            name=s.name,
            category=s.category,
            color=s.color,
            position=s.position,
            task_count=counts.get(s.id, 0),
        )
        for s in statuses
    ]


async def _milestone_outs(db: AsyncSession, milestones: list[Milestone]) -> list[MilestoneOut]:
    if not milestones:
        return []
    rows = (
        await db.execute(
            select(
                Task.milestone_id,
                func.count(),
                func.count().filter(TaskStatus.category == StatusCategory.done),
            )
            .join(TaskStatus, TaskStatus.id == Task.status_id)
            .where(Task.milestone_id.in_([m.id for m in milestones]), Task.deleted_at.is_(None))
            .group_by(Task.milestone_id)
        )
    ).all()
    counts = {mid: (total, done) for mid, total, done in rows}
    return [
        MilestoneOut(
            id=m.id,
            project_id=m.project_id,
            name=m.name,
            description=m.description,
            due_date=m.due_date,
            completed_at=m.completed_at,
            created_at=m.created_at,
            task_total=counts.get(m.id, (0, 0))[0],
            task_done=counts.get(m.id, (0, 0))[1],
        )
        for m in milestones
    ]


async def _update_outs(db: AsyncSession, updates: list[ProjectUpdate]) -> list[ProjectUpdateOut]:
    authors = await user_briefs(db, (u.author_id for u in updates))
    return [
        ProjectUpdateOut(
            id=u.id,
            project_id=u.project_id,
            author=authors.get(u.author_id) if u.author_id else None,
            health=u.health,
            body=u.body,
            created_at=u.created_at,
        )
        for u in updates
    ]


async def _load_status(
    db: AsyncSession, user: User, status_id: uuid.UUID, min_role: ProjectRole
) -> tuple[TaskStatus, Project]:
    status = await db.get(TaskStatus, status_id)
    if status is None:
        raise NotFound("Status not found")
    try:
        project, _ = await permissions.require_project(db, user, status.project_id, min_role)
    except NotFound:
        raise NotFound("Status not found") from None
    return status, project


async def _load_milestone(
    db: AsyncSession, user: User, milestone_id: uuid.UUID, min_role: ProjectRole
) -> tuple[Milestone, Project]:
    milestone = await db.get(Milestone, milestone_id)
    if milestone is None:
        raise NotFound("Milestone not found")
    try:
        project, _ = await permissions.require_project(db, user, milestone.project_id, min_role)
    except NotFound:
        raise NotFound("Milestone not found") from None
    return milestone, project


async def _sync_task_dates(db: AsyncSession, status_id: uuid.UUID, old: StatusCategory, new: StatusCategory) -> None:
    """Keep completed_at / started_at of a status' tasks consistent with a category change.

    Entering `done` stamps completed_at (where missing); leaving it clears completed_at.
    Entering a started category stamps started_at where missing.
    """
    now = datetime.now(UTC)
    in_status = Task.status_id == status_id
    if new == StatusCategory.done and old != StatusCategory.done:
        await db.execute(
            update(Task)
            .where(in_status, Task.completed_at.is_(None))
            .values(completed_at=now)
            .execution_options(synchronize_session=False)
        )
    elif old == StatusCategory.done and new != StatusCategory.done:
        await db.execute(
            update(Task).where(in_status).values(completed_at=None).execution_options(synchronize_session=False)
        )
    if new in STARTED_CATEGORIES and old not in STARTED_CATEGORIES:
        await db.execute(
            update(Task)
            .where(in_status, Task.started_at.is_(None))
            .values(started_at=now)
            .execution_options(synchronize_session=False)
        )


async def _ensure_status_name_free(
    db: AsyncSession, project_id: uuid.UUID, name: str, exclude: uuid.UUID | None = None
) -> None:
    q = select(TaskStatus.id).where(TaskStatus.project_id == project_id, func.lower(TaskStatus.name) == name.lower())
    if exclude:
        q = q.where(TaskStatus.id != exclude)
    if await db.scalar(q):
        raise Conflict("This project already has a status with that name", code="status_exists")


# ─── Projects ───


@router.get("/workspaces/{workspace_id}/projects", response_model=list[ProjectOut])
async def list_projects(workspace_id: uuid.UUID, user: CurrentUser, db: DB, include_archived: bool = False):
    """Projects in the workspace the current user can see, with progress stats."""
    await permissions.require_workspace(db, user, workspace_id)
    ids = await permissions.visible_project_ids(db, user.id, workspace_id)
    if not ids:
        return []
    q = select(Project).where(Project.id.in_(ids))
    if not include_archived:
        q = q.where(Project.status != ProjectStatus.archived)
    projects = sorted(await db.scalars(q), key=lambda p: (_STATUS_GROUP[p.status], p.name.lower(), p.key))
    roles = await _roles_for_visible(db, user, workspace_id, [p.id for p in projects])
    return await _project_outs(db, user, projects, roles)


@router.post("/workspaces/{workspace_id}/projects", response_model=ProjectOut, status_code=201)
async def create_project(workspace_id: uuid.UUID, data: ProjectCreate, user: CurrentUser, db: DB):
    """Create a project with default statuses; the creator (and chosen lead) become project leads."""
    await permissions.require_workspace(db, user, workspace_id, WorkspaceRole.member)

    lead_id = data.lead_id or user.id
    if lead_id != user.id:
        await _require_active_member(db, workspace_id, lead_id, "project lead")
    requested = set(data.member_ids)
    if requested - await _active_member_ids(db, workspace_id, requested):
        raise BadRequest("Every project member must be an active member of this workspace", code="not_workspace_member")

    if data.key:
        await _ensure_key_free(db, workspace_id, data.key)
        key = data.key
    else:
        key = await _unique_key(db, workspace_id, derive_key(data.name))

    project = Project(
        id=uuid.uuid4(),
        workspace_id=workspace_id,
        key=key,
        name=data.name,
        description=data.description,
        color=data.color,
        icon=data.icon,
        status=data.status,
        priority=data.priority,
        visibility=data.visibility,
        lead_id=lead_id,
        start_date=data.start_date,
        target_date=data.target_date,
        created_by=user.id,
    )
    db.add(project)
    await _flush_checking_key(db)

    roles: dict[uuid.UUID, ProjectRole] = dict.fromkeys(requested, ProjectRole.member)
    roles[user.id] = ProjectRole.lead
    roles[lead_id] = ProjectRole.lead
    db.add_all(ProjectMember(project_id=project.id, user_id=uid, role=role) for uid, role in roles.items())
    add_default_statuses(db, project.id)

    activity.record(
        db,
        workspace_id=workspace_id,
        actor_id=user.id,
        verb="created",
        project_id=project.id,
        data={"name": project.name, "key": project.key},
    )
    for role in (ProjectRole.lead, ProjectRole.member):
        await activity.notify(
            db,
            user_ids=[uid for uid, r in roles.items() if r == role],
            type=NotificationType.added_to_project,
            workspace_id=workspace_id,
            actor_id=user.id,
            project_id=project.id,
            data={"project_name": project.name, "role": role.value},
        )
    _emit(
        db,
        "project.created",
        await permissions.project_audience(db, project),
        project,
        {"id": project.id, "key": project.key, "name": project.name},
    )
    await db.commit()
    return await _project_out(db, user, project, await permissions.project_access(db, user.id, project))


@router.get("/projects/{project_id}", response_model=ProjectOut)
async def get_project(project_id: uuid.UUID, user: CurrentUser, db: DB):
    """A single project with stats and the caller's effective role."""
    project, role = await permissions.require_project(db, user, project_id)
    return await _project_out(db, user, project, role)


@router.patch("/projects/{project_id}", response_model=ProjectOut)
async def update_project(project_id: uuid.UUID, data: ProjectPatch, user: CurrentUser, db: DB):
    """Edit project settings (project leads). Explicit null clears lead and dates."""
    project, role = await permissions.require_project(db, user, project_id, ProjectRole.lead)
    changes = data.model_dump(exclude_unset=True)
    for field in _REQUIRED_FIELDS:
        if changes.get(field, "") is None:
            del changes[field]

    start = changes.get("start_date", project.start_date)
    target = changes.get("target_date", project.target_date)
    if start and target and target < start:
        raise BadRequest("The target date must be on or after the start date", code="invalid_dates")
    if "key" in changes and changes["key"] != project.key:
        await _ensure_key_free(db, project.workspace_id, changes["key"], exclude=project.id)

    audience = await permissions.project_audience(db, project)
    readable: dict[str, dict[str, Any]] = {}
    new_lead_added = False
    if "lead_id" in changes and changes["lead_id"] != project.lead_id:
        new_lead = changes["lead_id"]
        if new_lead is not None:
            await _require_active_member(db, project.workspace_id, new_lead, "project lead")
            new_lead_added = await _make_lead(db, project, new_lead)
        names = await user_briefs(db, (project.lead_id, new_lead))
        readable["lead"] = {
            "from": names[project.lead_id].name if project.lead_id in names else None,
            "to": names[new_lead].name if new_lead in names else None,
        }
        project.lead_id = new_lead

    for field in _PLAIN_FIELDS:
        if field not in changes or changes[field] == getattr(project, field):
            continue
        old, new = getattr(project, field), changes[field]
        if field == "description":
            readable[field] = {"from": _excerpt(old), "to": _excerpt(new)}
        else:
            readable[field] = {"from": _display(old), "to": _display(new)}
        setattr(project, field, new)

    if readable:
        await _flush_checking_key(db)
        activity.record(
            db,
            workspace_id=project.workspace_id,
            actor_id=user.id,
            verb="updated",
            project_id=project.id,
            data={"changes": readable},
        )
        if new_lead_added:
            await activity.notify(
                db,
                user_ids=[project.lead_id],
                type=NotificationType.added_to_project,
                workspace_id=project.workspace_id,
                actor_id=user.id,
                project_id=project.id,
                data={"project_name": project.name, "role": ProjectRole.lead.value},
            )
        # Include people who just lost access (e.g. made private) so their clients drop the project.
        audience |= await permissions.project_audience(db, project)
        _emit(db, "project.updated", audience, project, {"id": project.id, "changes": sorted(readable)})
    await db.commit()
    return await _project_out(db, user, project, role)


@router.delete("/projects/{project_id}", response_model=Ok)
async def delete_project(project_id: uuid.UUID, user: CurrentUser, db: DB):
    """Permanently delete a project and everything in it (workspace admins or project leads)."""
    project, _ = await permissions.require_project(db, user, project_id, ProjectRole.lead)
    audience = await permissions.project_audience(db, project)
    activity.record(
        db,
        workspace_id=project.workspace_id,
        actor_id=user.id,
        verb="project_deleted",
        data={"name": project.name, "key": project.key},
    )
    _emit(db, "project.deleted", audience, project, {"id": project.id, "key": project.key, "name": project.name})
    # Tasks first: they reference statuses with ON DELETE RESTRICT; everything else cascades from the project.
    await db.execute(delete(Task).where(Task.project_id == project.id).execution_options(synchronize_session=False))
    await db.delete(project)
    await db.commit()
    return Ok()


# ─── Project members ───


@router.get("/projects/{project_id}/members", response_model=list[ProjectMemberOut])
async def list_project_members(project_id: uuid.UUID, user: CurrentUser, db: DB):
    """Explicit project members, leads first."""
    project, _ = await permissions.require_project(db, user, project_id)
    members = list(await db.scalars(select(ProjectMember).where(ProjectMember.project_id == project.id)))
    return await _member_outs(db, members)


@router.post("/projects/{project_id}/members", response_model=ProjectMemberOut, status_code=201)
async def add_project_member(project_id: uuid.UUID, data: ProjectMemberCreate, user: CurrentUser, db: DB):
    """Add a workspace member to the project (project leads)."""
    project, _ = await permissions.require_project(db, user, project_id, ProjectRole.lead)
    await _require_active_member(db, project.workspace_id, data.user_id, "new project member")
    if await db.get(ProjectMember, (project.id, data.user_id)) is not None:
        raise Conflict("That person is already a member of this project", code="already_member")

    pm = ProjectMember(project_id=project.id, user_id=data.user_id, role=data.role)
    db.add(pm)
    await db.flush()
    target = (await user_briefs(db, [data.user_id]))[data.user_id]
    activity.record(
        db,
        workspace_id=project.workspace_id,
        actor_id=user.id,
        verb="member_added",
        project_id=project.id,
        data={"user_id": str(data.user_id), "user": target.name, "role": data.role.value},
    )
    await activity.notify(
        db,
        user_ids=[data.user_id],
        type=NotificationType.added_to_project,
        workspace_id=project.workspace_id,
        actor_id=user.id,
        project_id=project.id,
        data={"project_name": project.name, "role": data.role.value},
    )
    _emit(
        db,
        "project_member.created",
        await permissions.project_audience(db, project),
        project,
        {"user_id": data.user_id, "role": data.role.value},
    )
    await db.commit()
    return ProjectMemberOut(user=target, role=pm.role, added_at=pm.added_at)


@router.patch("/projects/{project_id}/members/{user_id}", response_model=ProjectMemberOut)
async def update_project_member(
    project_id: uuid.UUID, user_id: uuid.UUID, data: ProjectMemberUpdate, user: CurrentUser, db: DB
):
    """Change a member's project role (project leads)."""
    project, _ = await permissions.require_project(db, user, project_id, ProjectRole.lead)
    pm = await db.get(ProjectMember, (project.id, user_id))
    if pm is None:
        raise NotFound("Member not found")
    target = (await user_briefs(db, [user_id]))[user_id]
    if data.role != pm.role:
        if pm.role == ProjectRole.lead and await _lead_count(db, project.id) <= 1:
            raise BadRequest("A project needs at least one lead", code="last_lead")
        old = pm.role
        pm.role = data.role
        if old == ProjectRole.lead and project.lead_id == user_id:
            project.lead_id = None
        activity.record(
            db,
            workspace_id=project.workspace_id,
            actor_id=user.id,
            verb="member_role_changed",
            project_id=project.id,
            data={"user_id": str(user_id), "user": target.name, "from": old.value, "to": data.role.value},
        )
        _emit(
            db,
            "project_member.updated",
            await permissions.project_audience(db, project),
            project,
            {"user_id": user_id, "role": data.role.value},
        )
        await db.commit()
    return ProjectMemberOut(user=target, role=pm.role, added_at=pm.added_at)


@router.delete("/projects/{project_id}/members/{user_id}", response_model=Ok)
async def remove_project_member(project_id: uuid.UUID, user_id: uuid.UUID, user: CurrentUser, db: DB):
    """Remove a member (project leads), or leave the project yourself."""
    project, role = await permissions.require_project(db, user, project_id)
    leaving = user_id == user.id
    if not leaving and role != ProjectRole.lead:
        raise Forbidden("Only project leads can remove members")
    pm = await db.get(ProjectMember, (project.id, user_id))
    if pm is None:
        raise NotFound("Member not found")
    if pm.role == ProjectRole.lead and await _lead_count(db, project.id) <= 1:
        raise BadRequest("A project needs at least one lead", code="last_lead")

    audience = await permissions.project_audience(db, project)  # before removal, so the person is told too
    target = (await user_briefs(db, [user_id])).get(user_id)
    await db.delete(pm)
    if project.lead_id == user_id:
        project.lead_id = None
    activity.record(
        db,
        workspace_id=project.workspace_id,
        actor_id=user.id,
        verb="member_left" if leaving else "member_removed",
        project_id=project.id,
        data={"user_id": str(user_id), "user": target.name if target else None},
    )
    _emit(db, "project_member.deleted", audience, project, {"user_id": user_id})
    await db.commit()
    return Ok()


# ─── Statuses ───


@router.get("/projects/{project_id}/statuses", response_model=list[StatusOut])
async def list_statuses(project_id: uuid.UUID, user: CurrentUser, db: DB):
    """The project's workflow statuses in board order, with task counts."""
    project, _ = await permissions.require_project(db, user, project_id)
    return await _status_outs(db, await project_statuses(db, project.id))


@router.post("/projects/{project_id}/statuses", response_model=StatusOut, status_code=201)
async def create_status(project_id: uuid.UUID, data: StatusCreate, user: CurrentUser, db: DB):
    """Add a status at the end of the workflow (project leads)."""
    project, _ = await permissions.require_project(db, user, project_id, ProjectRole.lead)
    await _ensure_status_name_free(db, project.id, data.name)
    last = await db.scalar(select(func.max(TaskStatus.position)).where(TaskStatus.project_id == project.id))
    status = TaskStatus(
        id=uuid.uuid4(),
        project_id=project.id,
        name=data.name,
        category=data.category,
        color=data.color,
        position=(last + 1.0) if last is not None else 0.0,
    )
    db.add(status)
    activity.record(
        db,
        workspace_id=project.workspace_id,
        actor_id=user.id,
        verb="status_created",
        project_id=project.id,
        data={"status": status.name, "category": status.category.value},
    )
    _emit(db, "status.created", await permissions.project_audience(db, project), project, {"id": status.id})
    await db.commit()
    return (await _status_outs(db, [status]))[0]


@router.patch("/statuses/{status_id}", response_model=StatusOut)
async def update_status(status_id: uuid.UUID, data: StatusUpdate, user: CurrentUser, db: DB):
    """Rename, recolor or recategorize a status (project leads); task completion follows the category."""
    status, project = await _load_status(db, user, status_id, ProjectRole.lead)
    readable: dict[str, dict[str, Any]] = {}
    if data.name is not None and data.name != status.name:
        await _ensure_status_name_free(db, project.id, data.name, exclude=status.id)
        readable["name"] = {"from": status.name, "to": data.name}
        status.name = data.name
    if data.color is not None and data.color != status.color:
        readable["color"] = {"from": status.color, "to": data.color}
        status.color = data.color
    if data.category is not None and data.category != status.category:
        await _sync_task_dates(db, status.id, status.category, data.category)
        readable["category"] = {"from": status.category.value, "to": data.category.value}
        status.category = data.category

    if readable:
        activity.record(
            db,
            workspace_id=project.workspace_id,
            actor_id=user.id,
            verb="status_updated",
            project_id=project.id,
            data={"status": status.name, "changes": readable},
        )
        _emit(
            db,
            "status.updated",
            await permissions.project_audience(db, project),
            project,
            {"id": status.id, "changes": sorted(readable)},
        )
        await db.commit()
    return (await _status_outs(db, [status]))[0]


@router.delete("/statuses/{status_id}", response_model=Ok)
async def delete_status(
    status_id: uuid.UUID,
    user: CurrentUser,
    db: DB,
    move_to: uuid.UUID | None = Query(default=None, description="Status that receives this status' tasks"),
):
    """Delete a status (project leads), moving its tasks to `move_to` when it has any."""
    status, project = await _load_status(db, user, status_id, ProjectRole.lead)
    others = [s for s in await project_statuses(db, project.id) if s.id != status.id]
    if not others:
        raise BadRequest("A project needs at least one status", code="last_status")

    live_tasks = await db.scalar(
        select(func.count()).select_from(Task).where(Task.status_id == status.id, Task.deleted_at.is_(None))
    )
    if move_to is not None:
        target = next((s for s in others if s.id == move_to), None)
        if target is None:
            raise BadRequest("Move tasks to another status of the same project", code="invalid_move_to")
    elif live_tasks:
        raise BadRequest("This status has tasks. Choose where to move them.", code="move_to_required")
    else:
        target = others[0]  # only soft-deleted tasks (if any) remain; park them in the first status

    target_max = await db.scalar(select(func.max(Task.position)).where(Task.status_id == target.id))
    source_min = await db.scalar(select(func.min(Task.position)).where(Task.status_id == status.id))
    if source_min is not None:
        # Append the moved tasks below the target column, keeping their relative order.
        offset = (target_max + POSITION_STEP - source_min) if target_max is not None else 0.0
        await _sync_task_dates(db, status.id, status.category, target.category)
        await db.execute(
            update(Task)
            .where(Task.status_id == status.id)
            .values(status_id=target.id, position=Task.position + offset)
            .execution_options(synchronize_session=False)
        )
    await db.delete(status)
    activity.record(
        db,
        workspace_id=project.workspace_id,
        actor_id=user.id,
        verb="status_deleted",
        project_id=project.id,
        data={"status": status.name, "moved_to": target.name if live_tasks else None, "moved_tasks": live_tasks},
    )
    _emit(
        db,
        "status.deleted",
        await permissions.project_audience(db, project),
        project,
        {"id": status.id, "moved_to": target.id if live_tasks else None},
    )
    await db.commit()
    return Ok()


@router.post("/projects/{project_id}/statuses/reorder", response_model=list[StatusOut])
async def reorder_statuses(project_id: uuid.UUID, data: StatusReorder, user: CurrentUser, db: DB):
    """Set the order of the project's statuses; the body must list every status exactly once (project leads)."""
    project, _ = await permissions.require_project(db, user, project_id, ProjectRole.lead)
    statuses = {s.id: s for s in await project_statuses(db, project.id)}
    if len(data.status_ids) != len(set(data.status_ids)) or set(data.status_ids) != set(statuses):
        raise BadRequest("Send every status of this project exactly once", code="invalid_order")
    ordered = [statuses[sid] for sid in data.status_ids]
    for i, status in enumerate(ordered):
        status.position = float(i)
    _emit(
        db,
        "status.reordered",
        await permissions.project_audience(db, project),
        project,
        {"status_ids": data.status_ids},
    )
    await db.commit()
    return await _status_outs(db, ordered)


# ─── Milestones ───


@router.get("/projects/{project_id}/milestones", response_model=list[MilestoneOut])
async def list_milestones(project_id: uuid.UUID, user: CurrentUser, db: DB):
    """Milestones by due date (undated last), with task progress."""
    project, _ = await permissions.require_project(db, user, project_id)
    milestones = await db.scalars(
        select(Milestone)
        .where(Milestone.project_id == project.id)
        .order_by(Milestone.due_date.asc().nulls_last(), Milestone.created_at, Milestone.name)
    )
    return await _milestone_outs(db, list(milestones))


@router.post("/projects/{project_id}/milestones", response_model=MilestoneOut, status_code=201)
async def create_milestone(project_id: uuid.UUID, data: MilestoneCreate, user: CurrentUser, db: DB):
    """Create a milestone (project leads)."""
    project, _ = await permissions.require_project(db, user, project_id, ProjectRole.lead)
    milestone = Milestone(
        id=uuid.uuid4(), project_id=project.id, name=data.name, description=data.description, due_date=data.due_date
    )
    db.add(milestone)
    activity.record(
        db,
        workspace_id=project.workspace_id,
        actor_id=user.id,
        verb="milestone_created",
        project_id=project.id,
        data={"milestone": milestone.name, "due_date": _display(milestone.due_date)},
    )
    _emit(db, "milestone.created", await permissions.project_audience(db, project), project, {"id": milestone.id})
    await db.commit()
    return (await _milestone_outs(db, [milestone]))[0]


@router.patch("/milestones/{milestone_id}", response_model=MilestoneOut)
async def update_milestone(milestone_id: uuid.UUID, data: MilestoneUpdate, user: CurrentUser, db: DB):
    """Edit or complete a milestone (project leads). Explicit null clears the due date."""
    milestone, project = await _load_milestone(db, user, milestone_id, ProjectRole.lead)
    changes = data.model_dump(exclude_unset=True)
    readable: dict[str, dict[str, Any]] = {}
    if changes.get("name") is not None and changes["name"] != milestone.name:
        readable["name"] = {"from": milestone.name, "to": changes["name"]}
        milestone.name = changes["name"]
    if changes.get("description") is not None and changes["description"] != milestone.description:
        readable["description"] = {"from": _excerpt(milestone.description), "to": _excerpt(changes["description"])}
        milestone.description = changes["description"]
    if "due_date" in changes and changes["due_date"] != milestone.due_date:
        readable["due_date"] = {"from": _display(milestone.due_date), "to": _display(changes["due_date"])}
        milestone.due_date = changes["due_date"]
    completed = changes.get("completed")
    if completed is not None and completed != (milestone.completed_at is not None):
        readable["completed"] = {"from": not completed, "to": completed}
        milestone.completed_at = datetime.now(UTC) if completed else None

    if readable:
        verb = "milestone_updated"
        if set(readable) == {"completed"}:
            verb = "milestone_completed" if completed else "milestone_reopened"
        activity.record(
            db,
            workspace_id=project.workspace_id,
            actor_id=user.id,
            verb=verb,
            project_id=project.id,
            data={"milestone": milestone.name, "changes": readable},
        )
        _emit(
            db,
            "milestone.updated",
            await permissions.project_audience(db, project),
            project,
            {"id": milestone.id, "changes": sorted(readable)},
        )
        await db.commit()
    return (await _milestone_outs(db, [milestone]))[0]


@router.delete("/milestones/{milestone_id}", response_model=Ok)
async def delete_milestone(milestone_id: uuid.UUID, user: CurrentUser, db: DB):
    """Delete a milestone (project leads); its tasks are kept and simply lose the milestone."""
    milestone, project = await _load_milestone(db, user, milestone_id, ProjectRole.lead)
    await db.delete(milestone)
    activity.record(
        db,
        workspace_id=project.workspace_id,
        actor_id=user.id,
        verb="milestone_deleted",
        project_id=project.id,
        data={"milestone": milestone.name},
    )
    _emit(db, "milestone.deleted", await permissions.project_audience(db, project), project, {"id": milestone.id})
    await db.commit()
    return Ok()


# ─── Status updates ───


@router.get("/projects/{project_id}/updates", response_model=list[ProjectUpdateOut])
async def list_project_updates(
    project_id: uuid.UUID, user: CurrentUser, db: DB, limit: int = Query(default=50, ge=1, le=200)
):
    """Written status updates, newest first."""
    project, _ = await permissions.require_project(db, user, project_id)
    updates = await db.scalars(
        select(ProjectUpdate)
        .where(ProjectUpdate.project_id == project.id)
        .order_by(ProjectUpdate.created_at.desc(), ProjectUpdate.id)
        .limit(limit)
    )
    return await _update_outs(db, list(updates))


@router.post("/projects/{project_id}/updates", response_model=ProjectUpdateOut, status_code=201)
async def create_project_update(project_id: uuid.UUID, data: ProjectUpdateCreate, user: CurrentUser, db: DB):
    """Post a status update (project members); explicit members are notified."""
    project, _ = await permissions.require_project(db, user, project_id, ProjectRole.member)
    post = ProjectUpdate(id=uuid.uuid4(), project_id=project.id, author_id=user.id, health=data.health, body=data.body)
    db.add(post)
    await db.flush()
    excerpt = _excerpt(data.body)
    activity.record(
        db,
        workspace_id=project.workspace_id,
        actor_id=user.id,
        verb="posted_update",
        project_id=project.id,
        data={"health": data.health.value, "excerpt": excerpt},
    )
    await activity.notify(
        db,
        user_ids=await _explicit_member_ids(db, project),
        type=NotificationType.project_update,
        workspace_id=project.workspace_id,
        actor_id=user.id,
        project_id=project.id,
        data={"health": data.health.value, "excerpt": excerpt},
    )
    _emit(
        db,
        "project_update.created",
        await permissions.project_audience(db, project),
        project,
        {"id": post.id, "health": data.health.value},
    )
    await db.commit()
    return (await _update_outs(db, [post]))[0]
