"""Shared access rules.

- Admins can see and manage everything.
- Project managers can manage projects they created or belong to.
- Team members can see projects they belong to, and update tasks assigned to them.
"""
from fastapi import HTTPException
from database import db

MANAGER_ROLES = ("admin", "project_manager")


def is_admin(user: dict) -> bool:
    return user.get("role") == "admin"


def is_manager(user: dict) -> bool:
    return user.get("role") in MANAGER_ROLES


def is_project_member(user: dict, project: dict) -> bool:
    uid = user["user_id"]
    return uid in project.get("team_members", []) or project.get("created_by") == uid


def can_view_project(user: dict, project: dict) -> bool:
    return is_admin(user) or is_project_member(user, project)


def can_manage_project(user: dict, project: dict) -> bool:
    if is_admin(user):
        return True
    return user.get("role") == "project_manager" and is_project_member(user, project)


def can_edit_task(user: dict, task: dict, project: dict | None) -> bool:
    """Full edit rights (title, assignee, dates, ...)."""
    return project is not None and can_manage_project(user, project)


def can_update_task_progress(user: dict, task: dict, project: dict | None) -> bool:
    """Status / checklist updates: managers, or the assignee."""
    if can_edit_task(user, task, project):
        return True
    return task.get("assigned_to") == user["user_id"]


async def get_project_or_404(project_id: str) -> dict:
    project = await db.projects.find_one({"project_id": project_id}, {"_id": 0})
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return project


async def require_project_view(user: dict, project_id: str) -> dict:
    project = await get_project_or_404(project_id)
    if not can_view_project(user, project):
        # 404 rather than 403 so project IDs can't be probed
        raise HTTPException(status_code=404, detail="Project not found")
    return project


async def require_project_manage(user: dict, project_id: str) -> dict:
    project = await require_project_view(user, project_id)
    if not can_manage_project(user, project):
        raise HTTPException(status_code=403, detail="You don't have permission to manage this project")
    return project


async def visible_project_ids(user: dict) -> list[str] | None:
    """Project IDs the user can see, or None meaning 'all' (admin)."""
    if is_admin(user):
        return None
    projects = await db.projects.find(
        {"$or": [{"team_members": user["user_id"]}, {"created_by": user["user_id"]}]},
        {"_id": 0, "project_id": 1},
    ).to_list(5000)
    return [p["project_id"] for p in projects]


async def visible_task_query(user: dict) -> dict:
    """Mongo filter restricting tasks to what the user may see."""
    proj_ids = await visible_project_ids(user)
    if proj_ids is None:
        return {}
    return {"$or": [{"project_id": {"$in": proj_ids}}, {"assigned_to": user["user_id"]}]}


async def require_entity_view(user: dict, entity_type: str, entity_id: str) -> dict:
    """Access check for comments/files attached to a project or task. Returns the project."""
    if entity_type == "project":
        return await require_project_view(user, entity_id)
    if entity_type == "task":
        task = await db.tasks.find_one({"task_id": entity_id}, {"_id": 0})
        if not task:
            raise HTTPException(status_code=404, detail="Task not found")
        project = await db.projects.find_one({"project_id": task["project_id"]}, {"_id": 0})
        if project and can_view_project(user, project):
            return project
        if task.get("assigned_to") == user["user_id"]:
            return project or {}
        raise HTTPException(status_code=404, detail="Task not found")
    raise HTTPException(status_code=400, detail="entity_type must be 'project' or 'task'")
