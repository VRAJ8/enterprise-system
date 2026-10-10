"""Direct-to-database factories for arranging state quickly in tests.

Prefer the API for the behaviour under test; use these to set up surrounding data.
"""

import uuid
from datetime import date, datetime

from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    Priority,
    Project,
    ProjectMember,
    ProjectRole,
    ProjectVisibility,
    StatusCategory,
    Task,
)
from app.services.projects import add_default_statuses, next_task_number


async def make_project(
    db: AsyncSession,
    workspace_id,
    *,
    name: str = "Website",
    key: str | None = None,
    visibility: ProjectVisibility = ProjectVisibility.workspace,
    members: dict | None = None,
    start_date: date | None = None,
    target_date: date | None = None,
    created_by=None,
) -> tuple[Project, dict[StatusCategory, uuid.UUID]]:
    """Create a project with default statuses. `members` maps user_id -> ProjectRole.
    Returns (project, {category: status_id})."""
    project = Project(
        id=uuid.uuid4(),
        workspace_id=uuid.UUID(str(workspace_id)),
        key=key or name[:3].upper(),
        name=name,
        visibility=visibility,
        start_date=start_date,
        target_date=target_date,
        created_by=uuid.UUID(str(created_by)) if created_by else None,
    )
    db.add(project)
    await db.flush()
    statuses = add_default_statuses(db, project.id)
    for uid, role in (members or {}).items():
        db.add(ProjectMember(project_id=project.id, user_id=uuid.UUID(str(uid)), role=ProjectRole(role)))
    await db.commit()
    return project, {s.category: s.id for s in statuses}


async def make_task(
    db: AsyncSession,
    project: Project,
    status_id,
    *,
    title: str = "Task",
    assignee_id=None,
    priority: Priority = Priority.none,
    start_date: date | None = None,
    due_date: date | None = None,
    estimate_hours: float | None = None,
    parent_id=None,
    position: float | None = None,
    completed_at: datetime | None = None,
    started_at: datetime | None = None,
    created_at: datetime | None = None,
) -> Task:
    number = await next_task_number(db, project.id)
    task = Task(
        id=uuid.uuid4(),
        project_id=project.id,
        number=number,
        title=title,
        status_id=uuid.UUID(str(status_id)),
        priority=priority,
        assignee_id=uuid.UUID(str(assignee_id)) if assignee_id else None,
        start_date=start_date,
        due_date=due_date,
        estimate_hours=estimate_hours,
        parent_id=parent_id,
        position=position if position is not None else number * 1024.0,
        completed_at=completed_at,
        started_at=started_at,
    )
    if created_at:
        task.created_at = created_at
    db.add(task)
    await db.commit()
    return task
