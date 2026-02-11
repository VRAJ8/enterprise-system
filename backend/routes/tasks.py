from fastapi import APIRouter, HTTPException, Request
from datetime import datetime, timezone
from database import db
from models import TaskCreate, TaskUpdate, gen_id
from auth_utils import get_current_user, require_role
from helpers import log_activity, notify_task_assigned, create_notification

router = APIRouter(prefix="/api/tasks", tags=["tasks"])


@router.get("")
async def list_tasks(request: Request, project_id: str = None, status: str = None, assigned_to: str = None):
    user = await get_current_user(request)
    query = {}

    if project_id:
        query["project_id"] = project_id
    if status:
        query["status"] = status
    if assigned_to:
        query["assigned_to"] = assigned_to

    # Non-admin users only see tasks in their projects or assigned to them
    if user["role"] == "team_member":
        user_projects = await db.projects.find(
            {"team_members": user["user_id"]}, {"_id": 0, "project_id": 1}
        ).to_list(500)
        proj_ids = [p["project_id"] for p in user_projects]
        query["$or"] = [{"project_id": {"$in": proj_ids}}, {"assigned_to": user["user_id"]}]

    tasks = await db.tasks.find(query, {"_id": 0}).sort("created_at", -1).to_list(1000)
    return tasks


@router.post("")
async def create_task(data: TaskCreate, request: Request):
    user = await require_role(["admin", "project_manager"])(request)

    # Verify project exists
    project = await db.projects.find_one({"project_id": data.project_id}, {"_id": 0})
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    task_id = gen_id("task_")
    now = datetime.now(timezone.utc).isoformat()
    task = {
        "task_id": task_id,
        "title": data.title,
        "description": data.description,
        "project_id": data.project_id,
        "project_name": project["name"],
        "assigned_to": data.assigned_to,
        "assigned_to_name": None,
        "priority": data.priority,
        "status": "todo",
        "due_date": data.due_date,
        "created_by": user["user_id"],
        "created_by_name": user["name"],
        "created_at": now,
        "updated_at": now,
    }

    # Get assignee name
    if data.assigned_to:
        assignee = await db.users.find_one({"user_id": data.assigned_to}, {"_id": 0})
        if assignee:
            task["assigned_to_name"] = assignee["name"]
            await notify_task_assigned(task, assignee, user["name"])

    await db.tasks.insert_one(task)
    await log_activity(user["user_id"], user["name"], "created", "task", task_id, data.title, data.project_id)

    result = await db.tasks.find_one({"task_id": task_id}, {"_id": 0})
    return result


@router.get("/{task_id}")
async def get_task(task_id: str, request: Request):
    await get_current_user(request)
    task = await db.tasks.find_one({"task_id": task_id}, {"_id": 0})
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    return task


@router.put("/{task_id}")
async def update_task(task_id: str, data: TaskUpdate, request: Request):
    user = await get_current_user(request)
    task = await db.tasks.find_one({"task_id": task_id}, {"_id": 0})
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    # Team members can only update status of their own tasks
    if user["role"] == "team_member":
        if task.get("assigned_to") != user["user_id"]:
            raise HTTPException(status_code=403, detail="Can only update your own tasks")
        allowed_fields = {"status"}
        update_data = {k: v for k, v in data.model_dump().items() if v is not None and k in allowed_fields}
    else:
        update_data = {k: v for k, v in data.model_dump().items() if v is not None}

    if not update_data:
        raise HTTPException(status_code=400, detail="No fields to update")

    update_data["updated_at"] = datetime.now(timezone.utc).isoformat()

    # Handle reassignment
    if "assigned_to" in update_data and update_data["assigned_to"] != task.get("assigned_to"):
        assignee = await db.users.find_one({"user_id": update_data["assigned_to"]}, {"_id": 0})
        if assignee:
            update_data["assigned_to_name"] = assignee["name"]
            await notify_task_assigned(task, assignee, user["name"])

    # Notify on status change
    if "status" in update_data and update_data["status"] != task.get("status"):
        if task.get("created_by") and task["created_by"] != user["user_id"]:
            await create_notification(
                user_id=task["created_by"],
                notif_type="task_status",
                title="Task Status Updated",
                message=f"{user['name']} changed '{task['title']}' to {update_data['status'].replace('_', ' ').title()}",
                link="/tasks"
            )

    await db.tasks.update_one({"task_id": task_id}, {"$set": update_data})
    await log_activity(user["user_id"], user["name"], "updated", "task", task_id, task["title"], task.get("project_id", ""))

    result = await db.tasks.find_one({"task_id": task_id}, {"_id": 0})
    return result


@router.delete("/{task_id}")
async def delete_task(task_id: str, request: Request):
    user = await require_role(["admin", "project_manager"])(request)
    task = await db.tasks.find_one({"task_id": task_id}, {"_id": 0})
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    await db.tasks.delete_one({"task_id": task_id})
    await db.comments.delete_many({"entity_type": "task", "entity_id": task_id})
    await log_activity(user["user_id"], user["name"], "deleted", "task", task_id, task["title"], task.get("project_id", ""))
    return {"message": "Task deleted"}
