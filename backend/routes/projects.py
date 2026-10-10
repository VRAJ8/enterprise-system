from fastapi import APIRouter, HTTPException, Request, Depends
from database import db
from models import ProjectCreate, ProjectUpdate, MilestoneCreate, gen_id
from auth_utils import get_current_user, current_user
from helpers import log_activity, notify_project_update, create_notification, now_iso
from permissions import (
    require_project_view, require_project_manage, visible_project_ids, can_manage_project,
)
from insights import task_stats_by_project, project_health, EMPTY_STATS

router = APIRouter(prefix="/api/projects", tags=["projects"])


async def _existing_user_ids(user_ids: list[str]) -> list[str]:
    if not user_ids:
        return []
    found = await db.users.find({"user_id": {"$in": list(set(user_ids))}}, {"_id": 0, "user_id": 1}).to_list(1000)
    return [u["user_id"] for u in found]


def _decorate(project: dict, stats: dict, user: dict) -> dict:
    s = stats.get(project["project_id"], EMPTY_STATS)
    project["task_stats"] = s
    project.update(project_health(project, s))
    project["can_manage"] = can_manage_project(user, project)
    return project


@router.get("")
async def list_projects(request: Request):
    user = await get_current_user(request)
    proj_ids = await visible_project_ids(user)
    query = {} if proj_ids is None else {"project_id": {"$in": proj_ids}}
    projects = await db.projects.find(query, {"_id": 0}).sort("created_at", -1).to_list(1000)
    stats = await task_stats_by_project([p["project_id"] for p in projects])
    return [_decorate(p, stats, user) for p in projects]


@router.post("")
async def create_project(data: ProjectCreate, user: dict = Depends(current_user)):
    if user["role"] not in ("admin", "project_manager"):
        raise HTTPException(status_code=403, detail="Only admins and project managers can create projects")
    if data.start_date and data.end_date and data.end_date < data.start_date:
        raise HTTPException(status_code=400, detail="End date must be after start date")

    project_id = gen_id("proj_")
    now = now_iso()
    members = await _existing_user_ids(data.team_members + [user["user_id"]])

    project = {
        "project_id": project_id,
        "name": data.name.strip(),
        "description": data.description,
        "priority": data.priority,
        "status": data.status,
        "start_date": data.start_date or now[:10],
        "end_date": data.end_date,
        "team_members": members,
        "created_by": user["user_id"],
        "created_by_name": user["name"],
        "created_at": now,
        "updated_at": now,
    }
    await db.projects.insert_one(project)
    await log_activity(user["user_id"], user["name"], "created", "project", project_id, project["name"], project_id)

    await db.chat_channels.insert_one({
        "channel_id": f"proj_{project_id}",
        "name": project["name"],
        "type": "project",
        "project_id": project_id,
        "members": members,
        "created_at": now,
    })

    for uid in members:
        if uid != user["user_id"]:
            await create_notification(uid, "project_added", "Added to Project",
                                      f"{user['name']} added you to {project['name']}",
                                      link=f"/projects/{project_id}", ref_id=project_id)

    project.pop("_id", None)
    return _decorate(project, {}, user)


@router.get("/{project_id}")
async def get_project(project_id: str, request: Request):
    user = await get_current_user(request)
    project = await require_project_view(user, project_id)
    stats = await task_stats_by_project([project_id])
    _decorate(project, stats, user)

    if project.get("team_members"):
        project["team_details"] = await db.users.find(
            {"user_id": {"$in": project["team_members"]}},
            {"_id": 0, "password": 0}
        ).to_list(500)
    else:
        project["team_details"] = []
    return project


@router.put("/{project_id}")
async def update_project(project_id: str, data: ProjectUpdate, request: Request):
    user = await get_current_user(request)
    project = await require_project_manage(user, project_id)

    update_data = {k: v for k, v in data.model_dump(exclude_unset=True).items()
                   if v is not None or k in ("end_date",)}
    if not update_data:
        raise HTTPException(status_code=400, detail="No fields to update")

    start = update_data.get("start_date", project.get("start_date"))
    end = update_data.get("end_date", project.get("end_date"))
    if start and end and end < start:
        raise HTTPException(status_code=400, detail="End date must be after start date")

    added = []
    if "team_members" in update_data:
        members = await _existing_user_ids(update_data["team_members"])
        # The project owner always stays on the team
        if project.get("created_by") and project["created_by"] not in members:
            members.append(project["created_by"])
        added = [m for m in members if m not in project.get("team_members", [])]
        update_data["team_members"] = members
        await db.chat_channels.update_one({"channel_id": f"proj_{project_id}"}, {"$set": {"members": members}})

    if "name" in update_data:
        await db.chat_channels.update_one({"channel_id": f"proj_{project_id}"}, {"$set": {"name": update_data["name"]}})
        await db.tasks.update_many({"project_id": project_id}, {"$set": {"project_name": update_data["name"]}})

    update_data["updated_at"] = now_iso()
    await db.projects.update_one({"project_id": project_id}, {"$set": update_data})
    project = await db.projects.find_one({"project_id": project_id}, {"_id": 0})

    changed = ", ".join(k.replace("_", " ") for k in update_data if k != "updated_at")
    await log_activity(user["user_id"], user["name"], "updated", "project", project_id, project["name"],
                       project_id, details=changed)

    for uid in added:
        if uid != user["user_id"]:
            await create_notification(uid, "project_added", "Added to Project",
                                      f"{user['name']} added you to {project['name']}",
                                      link=f"/projects/{project_id}", ref_id=project_id)
    if "status" in update_data:
        others = [m for m in project.get("team_members", []) if m != user["user_id"] and m not in added]
        await notify_project_update(project, others, user["name"],
                                    f"changed the status to {update_data['status'].replace('_', ' ')}")

    stats = await task_stats_by_project([project_id])
    return _decorate(project, stats, user)


@router.delete("/{project_id}")
async def delete_project(project_id: str, request: Request):
    user = await get_current_user(request)
    project = await require_project_manage(user, project_id)

    task_ids = [t["task_id"] for t in await db.tasks.find({"project_id": project_id}, {"_id": 0, "task_id": 1}).to_list(10000)]
    await db.projects.delete_one({"project_id": project_id})
    await db.tasks.delete_many({"project_id": project_id})
    await db.milestones.delete_many({"project_id": project_id})
    await db.comments.delete_many({"$or": [
        {"entity_type": "project", "entity_id": project_id},
        {"entity_type": "task", "entity_id": {"$in": task_ids}},
    ]})
    await db.files.delete_many({"$or": [
        {"entity_type": "project", "entity_id": project_id},
        {"entity_type": "task", "entity_id": {"$in": task_ids}},
    ]})
    await db.chat_channels.delete_one({"channel_id": f"proj_{project_id}"})
    await db.chat_messages.delete_many({"channel_id": f"proj_{project_id}"})
    await log_activity(user["user_id"], user["name"], "deleted", "project", project_id, project["name"], project_id)
    return {"message": "Project deleted"}


@router.get("/{project_id}/activity")
async def project_activity(project_id: str, request: Request, limit: int = 50):
    user = await get_current_user(request)
    await require_project_view(user, project_id)
    limit = max(1, min(limit, 200))
    return await db.activity_logs.find({"project_id": project_id}, {"_id": 0}).sort("created_at", -1).to_list(limit)


# ─── Milestones ───

@router.post("/{project_id}/milestones")
async def create_milestone(project_id: str, data: MilestoneCreate, request: Request):
    user = await get_current_user(request)
    project = await require_project_manage(user, project_id)
    milestone = {
        "milestone_id": gen_id("ms_"),
        "project_id": project_id,
        "title": data.title,
        "description": data.description,
        "due_date": data.due_date,
        "completed": False,
        "created_by": user["user_id"],
        "created_at": now_iso(),
    }
    await db.milestones.insert_one(milestone)
    milestone.pop("_id", None)
    await log_activity(user["user_id"], user["name"], "added milestone", "milestone", milestone["milestone_id"],
                       data.title, project_id)
    return milestone


@router.get("/{project_id}/milestones")
async def list_milestones(project_id: str, request: Request):
    user = await get_current_user(request)
    await require_project_view(user, project_id)
    return await db.milestones.find({"project_id": project_id}, {"_id": 0}).sort("due_date", 1).to_list(500)


@router.put("/{project_id}/milestones/{milestone_id}")
async def toggle_milestone(project_id: str, milestone_id: str, request: Request):
    user = await get_current_user(request)
    await require_project_manage(user, project_id)
    ms = await db.milestones.find_one({"milestone_id": milestone_id, "project_id": project_id}, {"_id": 0})
    if not ms:
        raise HTTPException(status_code=404, detail="Milestone not found")
    new_status = not ms.get("completed", False)
    await db.milestones.update_one({"milestone_id": milestone_id}, {"$set": {"completed": new_status}})
    ms["completed"] = new_status
    if new_status:
        await log_activity(user["user_id"], user["name"], "completed milestone", "milestone", milestone_id,
                           ms["title"], project_id)
    return ms


@router.delete("/{project_id}/milestones/{milestone_id}")
async def delete_milestone(project_id: str, milestone_id: str, request: Request):
    user = await get_current_user(request)
    await require_project_manage(user, project_id)
    result = await db.milestones.delete_one({"milestone_id": milestone_id, "project_id": project_id})
    if not result.deleted_count:
        raise HTTPException(status_code=404, detail="Milestone not found")
    return {"message": "Milestone deleted"}
