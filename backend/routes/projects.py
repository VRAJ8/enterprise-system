from fastapi import APIRouter, HTTPException, Request, Depends
from datetime import datetime, timezone
from database import db
from models import ProjectCreate, ProjectUpdate, MilestoneCreate, CommentCreate, gen_id
from auth_utils import get_current_user, require_role
from helpers import log_activity, notify_project_update

router = APIRouter(prefix="/api/projects", tags=["projects"])


@router.get("")
async def list_projects(request: Request):
    user = await get_current_user(request)
    if user["role"] == "admin":
        projects = await db.projects.find({}, {"_id": 0}).to_list(500)
    elif user["role"] == "project_manager":
        projects = await db.projects.find(
            {"$or": [{"created_by": user["user_id"]}, {"team_members": user["user_id"]}]},
            {"_id": 0}
        ).to_list(500)
    else:
        projects = await db.projects.find(
            {"team_members": user["user_id"]}, {"_id": 0}
        ).to_list(500)
    return projects


@router.post("")
async def create_project(data: ProjectCreate, request: Request):
    user = await require_role(["admin", "project_manager"])(request)
    project_id = gen_id("proj_")
    now = datetime.now(timezone.utc).isoformat()

    # Include creator in team
    members = list(set(data.team_members + [user["user_id"]]))

    project = {
        "project_id": project_id,
        "name": data.name,
        "description": data.description,
        "priority": data.priority,
        "status": "active",
        "start_date": data.start_date or now[:10],
        "end_date": data.end_date,
        "team_members": members,
        "created_by": user["user_id"],
        "created_by_name": user["name"],
        "created_at": now,
        "updated_at": now,
    }
    await db.projects.insert_one(project)
    await log_activity(user["user_id"], user["name"], "created", "project", project_id, data.name)

    # Create default chat channel for this project
    await db.chat_channels.insert_one({
        "channel_id": f"proj_{project_id}",
        "name": data.name,
        "type": "project",
        "project_id": project_id,
        "members": members,
        "created_at": now,
    })

    result = await db.projects.find_one({"project_id": project_id}, {"_id": 0})
    return result


@router.get("/{project_id}")
async def get_project(project_id: str, request: Request):
    await get_current_user(request)
    project = await db.projects.find_one({"project_id": project_id}, {"_id": 0})
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    # Get task counts
    tasks = await db.tasks.find({"project_id": project_id}, {"_id": 0}).to_list(1000)
    total = len(tasks)
    completed = sum(1 for t in tasks if t.get("status") == "completed")
    in_progress = sum(1 for t in tasks if t.get("status") == "in_progress")
    todo = total - completed - in_progress
    project["task_stats"] = {"total": total, "completed": completed, "in_progress": in_progress, "todo": todo}

    # Get team member details
    if project.get("team_members"):
        members = await db.users.find(
            {"user_id": {"$in": project["team_members"]}},
            {"_id": 0, "password": 0}
        ).to_list(100)
        project["team_details"] = members

    return project


@router.put("/{project_id}")
async def update_project(project_id: str, data: ProjectUpdate, request: Request):
    user = await require_role(["admin", "project_manager"])(request)
    update_data = {k: v for k, v in data.model_dump().items() if v is not None}
    if not update_data:
        raise HTTPException(status_code=400, detail="No fields to update")

    update_data["updated_at"] = datetime.now(timezone.utc).isoformat()
    await db.projects.update_one({"project_id": project_id}, {"$set": update_data})

    project = await db.projects.find_one({"project_id": project_id}, {"_id": 0})
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    await log_activity(user["user_id"], user["name"], "updated", "project", project_id, project["name"])

    # Notify team
    others = [m for m in project.get("team_members", []) if m != user["user_id"]]
    await notify_project_update(project, others, user["name"], "made updates")

    return project


@router.delete("/{project_id}")
async def delete_project(project_id: str, request: Request):
    user = await require_role(["admin", "project_manager"])(request)
    project = await db.projects.find_one({"project_id": project_id}, {"_id": 0})
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    await db.projects.delete_one({"project_id": project_id})
    await db.tasks.delete_many({"project_id": project_id})
    await db.milestones.delete_many({"project_id": project_id})
    await db.chat_channels.delete_one({"channel_id": f"proj_{project_id}"})
    await db.chat_messages.delete_many({"channel_id": f"proj_{project_id}"})
    await log_activity(user["user_id"], user["name"], "deleted", "project", project_id, project["name"])
    return {"message": "Project deleted"}


@router.post("/{project_id}/milestones")
async def create_milestone(project_id: str, data: MilestoneCreate, request: Request):
    user = await require_role(["admin", "project_manager"])(request)
    milestone_id = gen_id("ms_")
    milestone = {
        "milestone_id": milestone_id,
        "project_id": project_id,
        "title": data.title,
        "description": data.description,
        "due_date": data.due_date,
        "completed": False,
        "created_by": user["user_id"],
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.milestones.insert_one(milestone)
    return {k: v for k, v in milestone.items() if k != "_id"}


@router.get("/{project_id}/milestones")
async def list_milestones(project_id: str, request: Request):
    await get_current_user(request)
    milestones = await db.milestones.find({"project_id": project_id}, {"_id": 0}).to_list(100)
    return milestones


@router.put("/{project_id}/milestones/{milestone_id}")
async def toggle_milestone(project_id: str, milestone_id: str, request: Request):
    await require_role(["admin", "project_manager"])(request)
    ms = await db.milestones.find_one({"milestone_id": milestone_id}, {"_id": 0})
    if not ms:
        raise HTTPException(status_code=404, detail="Milestone not found")
    new_status = not ms.get("completed", False)
    await db.milestones.update_one({"milestone_id": milestone_id}, {"$set": {"completed": new_status}})
    ms["completed"] = new_status
    return ms
