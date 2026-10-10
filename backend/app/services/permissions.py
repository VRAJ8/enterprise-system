"""Single source of truth for access control. See docs/ARCHITECTURE.md §5.

Rules:
- Workspace owner/admin → treated as project `lead` on every project.
- Explicit project membership → that project role.
- Workspace `member` (not guest) + project visibility `workspace` → `viewer`.
- Otherwise no access → callers raise NotFound (never 403) so IDs can't be probed.
"""

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import Forbidden, NotFound
from app.models import (
    Project,
    ProjectMember,
    ProjectRole,
    ProjectVisibility,
    Task,
    User,
    WorkspaceMember,
    WorkspaceRole,
)

ROLE_RANK = {ProjectRole.viewer: 0, ProjectRole.member: 1, ProjectRole.lead: 2}
WS_ROLE_RANK = {WorkspaceRole.guest: 0, WorkspaceRole.member: 1, WorkspaceRole.admin: 2, WorkspaceRole.owner: 3}


# ─── Workspace ───


async def get_membership(db: AsyncSession, user_id: uuid.UUID, workspace_id: uuid.UUID) -> WorkspaceMember | None:
    """Active membership, or None (deactivated members count as non-members)."""
    m = await db.get(WorkspaceMember, (workspace_id, user_id))
    if m is None or m.deactivated_at is not None:
        return None
    return m


async def require_workspace(
    db: AsyncSession, user: User, workspace_id: uuid.UUID, min_role: WorkspaceRole = WorkspaceRole.guest
) -> WorkspaceMember:
    m = await get_membership(db, user.id, workspace_id)
    if m is None:
        raise NotFound("Workspace not found")
    if WS_ROLE_RANK[m.role] < WS_ROLE_RANK[min_role]:
        raise Forbidden("You need a higher workspace role for this action")
    return m


def is_workspace_admin(m: WorkspaceMember | None) -> bool:
    return m is not None and m.role in (WorkspaceRole.owner, WorkspaceRole.admin)


# ─── Project ───


async def project_access(db: AsyncSession, user_id: uuid.UUID, project: Project) -> ProjectRole | None:
    ws = await get_membership(db, user_id, project.workspace_id)
    if ws is None:
        return None
    if ws.role in (WorkspaceRole.owner, WorkspaceRole.admin):
        return ProjectRole.lead
    pm = await db.get(ProjectMember, (project.id, user_id))
    if pm is not None:
        return pm.role
    if ws.role == WorkspaceRole.member and project.visibility == ProjectVisibility.workspace:
        return ProjectRole.viewer
    return None


async def require_project(
    db: AsyncSession, user: User, project_id: uuid.UUID, min_role: ProjectRole = ProjectRole.viewer
) -> tuple[Project, ProjectRole]:
    """Load a project the user can access with at least `min_role`. Returns (project, effective_role)."""
    project = await db.get(Project, project_id)
    if project is None:
        raise NotFound("Project not found")
    role = await project_access(db, user.id, project)
    if role is None:
        raise NotFound("Project not found")
    if ROLE_RANK[role] < ROLE_RANK[min_role]:
        raise Forbidden(
            "Only project leads can do this"
            if min_role == ProjectRole.lead
            else "You have view-only access to this project"
        )
    return project, role


async def require_task(
    db: AsyncSession,
    user: User,
    task_id: uuid.UUID,
    min_role: ProjectRole = ProjectRole.viewer,
    include_deleted: bool = False,
) -> tuple[Task, Project, ProjectRole]:
    task = await db.get(Task, task_id)
    if task is None or (task.deleted_at is not None and not include_deleted):
        raise NotFound("Task not found")
    try:
        project, role = await require_project(db, user, task.project_id, min_role)
    except NotFound:
        raise NotFound("Task not found") from None
    return task, project, role


async def visible_project_ids(db: AsyncSession, user_id: uuid.UUID, workspace_id: uuid.UUID) -> list[uuid.UUID]:
    """IDs of every project in the workspace the user can at least view."""
    ws = await get_membership(db, user_id, workspace_id)
    if ws is None:
        return []
    if ws.role in (WorkspaceRole.owner, WorkspaceRole.admin):
        rows = await db.scalars(select(Project.id).where(Project.workspace_id == workspace_id))
        return list(rows)
    member_of = select(ProjectMember.project_id).where(ProjectMember.user_id == user_id)
    cond = Project.id.in_(member_of)
    if ws.role == WorkspaceRole.member:
        cond = cond | (Project.visibility == ProjectVisibility.workspace)
    rows = await db.scalars(select(Project.id).where(Project.workspace_id == workspace_id, cond))
    return list(rows)


async def project_audience(db: AsyncSession, project: Project) -> set[uuid.UUID]:
    """Every active user who can view the project (used for realtime fan-out)."""
    rows = (
        await db.execute(
            select(WorkspaceMember.user_id, WorkspaceMember.role).where(
                WorkspaceMember.workspace_id == project.workspace_id, WorkspaceMember.deactivated_at.is_(None)
            )
        )
    ).all()
    explicit = set(await db.scalars(select(ProjectMember.user_id).where(ProjectMember.project_id == project.id)))
    audience = set()
    for uid, role in rows:
        if (
            role in (WorkspaceRole.owner, WorkspaceRole.admin)
            or uid in explicit
            or role == WorkspaceRole.member
            and project.visibility == ProjectVisibility.workspace
        ):
            audience.add(uid)
    return audience


def can_edit(role: ProjectRole | None) -> bool:
    return role in (ProjectRole.member, ProjectRole.lead)
