import re
from datetime import date, timedelta
from fastapi import APIRouter, HTTPException, Request, Depends
from database import db
from models import TaskCreate, TaskUpdate, gen_id
from auth_utils import get_current_user, current_user
from helpers import log_activity, notify_task_assigned, create_notification, now_iso
from permissions import (
    require_project_manage, visible_task_query, can_edit_task, can_update_task_progress,
    can_view_project,
)
from insights import is_overdue, today_str

router = APIRouter(prefix="/api/tasks", tags=["tasks"])

PROGRESS_FIELDS = {"status", "checklist"}
STATUS_LABELS = {"todo": "To Do", "in_progress": "In Progress", "in_review": "In Review", "completed": "Completed"}


def _decorate(task: dict, user: dict, project: dict | None, today: str) -> dict:
    task["overdue"] = is_overdue(task, today)
    task["can_edit"] = can_edit_task(user, task, project)
    task["can_update"] = can_update_task_progress(user, task, project)
    return task


async def _load_task_and_project(task_id: str):
    task = await db.tasks.find_one({"task_id": task_id}, {"_id": 0})
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    project = await db.projects.find_one({"project_id": task["project_id"]}, {"_id": 0})
    return task, project


def _can_view_task(user: dict, task: dict, project: dict | None) -> bool:
    if project and can_view_project(user, project):
        return True
    return task.get("assigned_to") == user["user_id"]


async def _ensure_on_team(project: dict, user_id: str, actor: dict):
    """Assigning work to someone outside the project adds them to the team."""
    if user_id in project.get("team_members", []):
        return
    await db.projects.update_one({"project_id": project["project_id"]}, {"$addToSet": {"team_members": user_id}})
    await db.chat_channels.update_one({"channel_id": f"proj_{project['project_id']}"}, {"$addToSet": {"members": user_id}})
    project.setdefault("team_members", []).append(user_id)
    await log_activity(actor["user_id"], actor["name"], "added to team", "project", project["project_id"],
                       project["name"], project["project_id"])


@router.get("")
async def list_tasks(request: Request, project_id: str = None, status: str = None, assigned_to: str = None,
                     priority: str = None, due: str = None, q: str = None):
    """List visible tasks.

    Filters: project_id, status, priority, assigned_to ('me', 'unassigned' or a user id),
    due ('overdue' | 'today' | 'week' | 'none'), q (title search).
    """
    user = await get_current_user(request)
    clauses = [await visible_task_query(user)]
    today = today_str()

    if project_id:
        clauses.append({"project_id": project_id})
    if status:
        clauses.append({"status": {"$in": status.split(",")}})
    if priority:
        clauses.append({"priority": {"$in": priority.split(",")}})
    if assigned_to == "me":
        clauses.append({"assigned_to": user["user_id"]})
    elif assigned_to == "unassigned":
        clauses.append({"assigned_to": {"$in": [None, ""]}})
    elif assigned_to:
        clauses.append({"assigned_to": assigned_to})
    if due == "overdue":
        clauses.append({"status": {"$ne": "completed"}, "due_date": {"$lt": today, "$nin": [None, ""]}})
    elif due == "today":
        clauses.append({"due_date": today})
    elif due == "week":
        week_end = (date.today() + timedelta(days=7)).isoformat()
        clauses.append({"due_date": {"$gte": today, "$lte": week_end}})
    elif due == "none":
        clauses.append({"due_date": {"$in": [None, ""]}})
    if q:
        clauses.append({"title": {"$regex": re.escape(q.strip()), "$options": "i"}})

    query = {"$and": [c for c in clauses if c]} if any(clauses) else {}
    tasks = await db.tasks.find(query, {"_id": 0}).sort("created_at", -1).to_list(2000)

    proj_ids = list({t["project_id"] for t in tasks})
    projects = {p["project_id"]: p for p in await db.projects.find({"project_id": {"$in": proj_ids}}, {"_id": 0}).to_list(2000)}
    return [_decorate(t, user, projects.get(t["project_id"]), today) for t in tasks]


@router.get("/my-work")
async def my_work(request: Request):
    """Personal work queue grouped by urgency."""
    user = await get_current_user(request)
    today = date.today()
    t, week_end = today.isoformat(), (today + timedelta(days=7)).isoformat()
    tasks = await db.tasks.find(
        {"assigned_to": user["user_id"], "status": {"$ne": "completed"}}, {"_id": 0}
    ).to_list(2000)
    proj_ids = list({x["project_id"] for x in tasks})
    projects = {p["project_id"]: p for p in await db.projects.find({"project_id": {"$in": proj_ids}}, {"_id": 0}).to_list(2000)}

    groups = {"overdue": [], "today": [], "this_week": [], "later": [], "no_date": []}
    for task in tasks:
        _decorate(task, user, projects.get(task["project_id"]), t)
        due = (task.get("due_date") or "")[:10]
        if not due:
            groups["no_date"].append(task)
        elif due < t:
            groups["overdue"].append(task)
        elif due == t:
            groups["today"].append(task)
        elif due <= week_end:
            groups["this_week"].append(task)
        else:
            groups["later"].append(task)

    prio = {"critical": 0, "high": 1, "medium": 2, "low": 3}
    for items in groups.values():
        items.sort(key=lambda x: (x.get("due_date") or "9999", prio.get(x.get("priority"), 9)))

    completed_week = await db.tasks.count_documents({
        "assigned_to": user["user_id"], "status": "completed",
        "completed_at": {"$gte": (today - timedelta(days=7)).isoformat()},
    })
    return {"groups": groups, "open_count": len(tasks), "completed_last_7_days": completed_week}


@router.post("")
async def create_task(data: TaskCreate, user: dict = Depends(current_user)):
    project = await require_project_manage(user, data.project_id)

    task_id = gen_id("task_")
    now = now_iso()
    task = {
        "task_id": task_id,
        "title": data.title.strip(),
        "description": data.description,
        "project_id": data.project_id,
        "project_name": project["name"],
        "assigned_to": None,
        "assigned_to_name": None,
        "priority": data.priority,
        "status": data.status,
        "start_date": data.start_date,
        "due_date": data.due_date,
        "estimate_hours": data.estimate_hours,
        "checklist": [c.model_dump() for c in data.checklist],
        "created_by": user["user_id"],
        "created_by_name": user["name"],
        "created_at": now,
        "updated_at": now,
        "completed_at": now if data.status == "completed" else None,
    }

    assignee = None
    if data.assigned_to:
        assignee = await db.users.find_one({"user_id": data.assigned_to}, {"_id": 0})
        if not assignee:
            raise HTTPException(status_code=400, detail="Assignee not found")
        await _ensure_on_team(project, assignee["user_id"], user)
        task["assigned_to"] = assignee["user_id"]
        task["assigned_to_name"] = assignee["name"]

    await db.tasks.insert_one(task)
    task.pop("_id", None)
    await log_activity(user["user_id"], user["name"], "created", "task", task_id, task["title"], data.project_id)
    if assignee and assignee["user_id"] != user["user_id"]:
        await notify_task_assigned(task, assignee, user["name"])

    return _decorate(task, user, project, today_str())


@router.get("/{task_id}")
async def get_task(task_id: str, request: Request):
    user = await get_current_user(request)
    task, project = await _load_task_and_project(task_id)
    if not _can_view_task(user, task, project):
        raise HTTPException(status_code=404, detail="Task not found")
    return _decorate(task, user, project, today_str())


@router.put("/{task_id}")
async def update_task(task_id: str, data: TaskUpdate, user: dict = Depends(current_user)):
    task, project = await _load_task_and_project(task_id)
    if not _can_view_task(user, task, project):
        raise HTTPException(status_code=404, detail="Task not found")

    changes = data.model_dump(exclude_unset=True)
    # Required fields can't be cleared; optional ones (assignee, dates, estimate) can be set to null
    for k in ("title", "status", "priority", "description", "checklist"):
        if k in changes and changes[k] is None:
            changes.pop(k)
    if not changes:
        raise HTTPException(status_code=400, detail="No fields to update")

    if not set(changes) <= PROGRESS_FIELDS:
        if not can_edit_task(user, task, project):
            raise HTTPException(status_code=403, detail="Only project managers can edit task details")
    elif not can_update_task_progress(user, task, project):
        raise HTTPException(status_code=403, detail="You can only update tasks assigned to you")

    update_data = dict(changes)
    now = now_iso()
    update_data["updated_at"] = now

    if "status" in update_data and update_data["status"] != task.get("status"):
        update_data["completed_at"] = now if update_data["status"] == "completed" else None

    assignee = None
    if "assigned_to" in update_data:
        new_assignee = update_data["assigned_to"] or None
        update_data["assigned_to"] = new_assignee
        if new_assignee is None:
            update_data["assigned_to_name"] = None
        elif new_assignee != task.get("assigned_to"):
            assignee = await db.users.find_one({"user_id": new_assignee}, {"_id": 0})
            if not assignee:
                raise HTTPException(status_code=400, detail="Assignee not found")
            if project:
                await _ensure_on_team(project, new_assignee, user)
            update_data["assigned_to_name"] = assignee["name"]

    await db.tasks.update_one({"task_id": task_id}, {"$set": update_data})
    updated = await db.tasks.find_one({"task_id": task_id}, {"_id": 0})

    # Activity + notifications
    if "status" in changes and changes["status"] != task.get("status"):
        label = STATUS_LABELS.get(changes["status"], changes["status"])
        await log_activity(user["user_id"], user["name"], f"moved to {label}", "task", task_id, task["title"],
                           task["project_id"])
        watchers = {task.get("created_by"), task.get("assigned_to")} - {user["user_id"], None, "system_ai"}
        for uid in watchers:
            await create_notification(uid, "task_status", "Task Status Updated",
                                      f"{user['name']} moved '{task['title']}' to {label}",
                                      link=f"/tasks?task={task_id}", ref_id=task_id)
    other = set(changes) - {"status"}
    if other:
        await log_activity(user["user_id"], user["name"], "updated", "task", task_id, updated["title"],
                           task["project_id"], details=", ".join(sorted(k.replace("_", " ") for k in other)))
    if assignee and assignee["user_id"] != user["user_id"]:
        await notify_task_assigned(updated, assignee, user["name"])

    return _decorate(updated, user, project, today_str())


@router.delete("/{task_id}")
async def delete_task(task_id: str, request: Request):
    user = await get_current_user(request)
    task, project = await _load_task_and_project(task_id)
    if project:
        await require_project_manage(user, project["project_id"])
    elif user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Insufficient permissions")

    await db.tasks.delete_one({"task_id": task_id})
    await db.comments.delete_many({"entity_type": "task", "entity_id": task_id})
    await db.files.delete_many({"entity_type": "task", "entity_id": task_id})
    await log_activity(user["user_id"], user["name"], "deleted", "task", task_id, task["title"], task.get("project_id", ""))
    return {"message": "Task deleted"}
