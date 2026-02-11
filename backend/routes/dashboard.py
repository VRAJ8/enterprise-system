from fastapi import APIRouter, Request
from database import db
from auth_utils import get_current_user

router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])


@router.get("/stats")
async def get_stats(request: Request):
    user = await get_current_user(request)
    role = user["role"]

    if role == "admin":
        total_users = await db.users.count_documents({})
        total_projects = await db.projects.count_documents({})
        total_tasks = await db.tasks.count_documents({})
        tasks_completed = await db.tasks.count_documents({"status": "completed"})
        tasks_in_progress = await db.tasks.count_documents({"status": "in_progress"})
        tasks_todo = await db.tasks.count_documents({"status": "todo"})
        active_projects = await db.projects.count_documents({"status": "active"})

        return {
            "total_users": total_users,
            "total_projects": total_projects,
            "active_projects": active_projects,
            "total_tasks": total_tasks,
            "tasks_completed": tasks_completed,
            "tasks_in_progress": tasks_in_progress,
            "tasks_todo": tasks_todo,
            "completion_rate": round((tasks_completed / total_tasks * 100) if total_tasks > 0 else 0, 1),
        }
    elif role == "project_manager":
        my_projects = await db.projects.find(
            {"$or": [{"created_by": user["user_id"]}, {"team_members": user["user_id"]}]},
            {"_id": 0, "project_id": 1}
        ).to_list(500)
        proj_ids = [p["project_id"] for p in my_projects]

        total_projects = len(proj_ids)
        total_tasks = await db.tasks.count_documents({"project_id": {"$in": proj_ids}})
        tasks_completed = await db.tasks.count_documents({"project_id": {"$in": proj_ids}, "status": "completed"})
        tasks_in_progress = await db.tasks.count_documents({"project_id": {"$in": proj_ids}, "status": "in_progress"})
        tasks_todo = await db.tasks.count_documents({"project_id": {"$in": proj_ids}, "status": "todo"})

        return {
            "total_projects": total_projects,
            "total_tasks": total_tasks,
            "tasks_completed": tasks_completed,
            "tasks_in_progress": tasks_in_progress,
            "tasks_todo": tasks_todo,
            "completion_rate": round((tasks_completed / total_tasks * 100) if total_tasks > 0 else 0, 1),
        }
    else:
        my_tasks = await db.tasks.count_documents({"assigned_to": user["user_id"]})
        completed = await db.tasks.count_documents({"assigned_to": user["user_id"], "status": "completed"})
        in_progress = await db.tasks.count_documents({"assigned_to": user["user_id"], "status": "in_progress"})
        todo = await db.tasks.count_documents({"assigned_to": user["user_id"], "status": "todo"})
        my_projects = await db.projects.find(
            {"team_members": user["user_id"]}, {"_id": 0, "project_id": 1}
        ).to_list(500)

        return {
            "total_projects": len(my_projects),
            "total_tasks": my_tasks,
            "tasks_completed": completed,
            "tasks_in_progress": in_progress,
            "tasks_todo": todo,
            "completion_rate": round((completed / my_tasks * 100) if my_tasks > 0 else 0, 1),
        }


@router.get("/charts")
async def get_chart_data(request: Request):
    user = await get_current_user(request)

    # Priority distribution
    priorities = []
    for p in ["low", "medium", "high", "critical"]:
        count = await db.tasks.count_documents({"priority": p})
        priorities.append({"name": p.title(), "value": count})

    # Project status distribution
    project_statuses = []
    for s in ["active", "completed", "on_hold", "cancelled"]:
        count = await db.projects.count_documents({"status": s})
        project_statuses.append({"name": s.replace("_", " ").title(), "value": count})

    # Task status per project (top 5 projects)
    projects = await db.projects.find({}, {"_id": 0, "project_id": 1, "name": 1}).limit(5).to_list(5)
    project_tasks = []
    for proj in projects:
        todo = await db.tasks.count_documents({"project_id": proj["project_id"], "status": "todo"})
        ip = await db.tasks.count_documents({"project_id": proj["project_id"], "status": "in_progress"})
        done = await db.tasks.count_documents({"project_id": proj["project_id"], "status": "completed"})
        project_tasks.append({
            "name": proj["name"][:20],
            "Todo": todo, "In Progress": ip, "Completed": done
        })

    return {
        "priority_distribution": priorities,
        "project_statuses": project_statuses,
        "project_tasks": project_tasks,
    }


@router.get("/activity")
async def get_activity(request: Request, limit: int = 30, project_id: str = None):
    user = await get_current_user(request)
    query = {}
    if project_id:
        query["project_id"] = project_id
    activities = await db.activity_logs.find(query, {"_id": 0}).sort("created_at", -1).to_list(limit)
    return activities
