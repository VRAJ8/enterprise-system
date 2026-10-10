from datetime import date, timedelta
from fastapi import APIRouter, Request
from database import db
from auth_utils import get_current_user
from permissions import visible_project_ids, visible_task_query, is_manager
from insights import task_stats_by_project, project_health, EMPTY_STATS, today_str

router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])


async def _scope(user: dict):
    """Returns (project_filter, task_filter) for what this user can see.

    Team members' numbers focus on their own assigned work.
    """
    proj_ids = await visible_project_ids(user)
    project_q = {} if proj_ids is None else {"project_id": {"$in": proj_ids}}
    if is_manager(user):
        task_q = await visible_task_query(user)
    else:
        task_q = {"assigned_to": user["user_id"]}
    return project_q, task_q


def _and(*qs):
    qs = [q for q in qs if q]
    if not qs:
        return {}
    return qs[0] if len(qs) == 1 else {"$and": qs}


@router.get("/stats")
async def get_stats(request: Request):
    user = await get_current_user(request)
    project_q, task_q = await _scope(user)
    today = today_str()
    week_end = (date.today() + timedelta(days=7)).isoformat()

    async def count(extra=None):
        return await db.tasks.count_documents(_and(task_q, extra or {}))

    total_tasks = await count()
    completed = await count({"status": "completed"})
    stats = {
        "total_projects": await db.projects.count_documents(project_q),
        "active_projects": await db.projects.count_documents(_and(project_q, {"status": "active"})),
        "total_tasks": total_tasks,
        "tasks_completed": completed,
        "tasks_in_progress": await count({"status": "in_progress"}),
        "tasks_in_review": await count({"status": "in_review"}),
        "tasks_todo": await count({"status": "todo"}),
        "tasks_overdue": await count({"status": {"$ne": "completed"}, "due_date": {"$lt": today, "$nin": [None, ""]}}),
        "tasks_due_this_week": await count({"status": {"$ne": "completed"}, "due_date": {"$gte": today, "$lte": week_end}}),
        "completion_rate": round((completed / total_tasks * 100) if total_tasks else 0, 1),
    }
    if user["role"] == "admin":
        stats["total_users"] = await db.users.count_documents({})
    return stats


@router.get("/charts")
async def get_chart_data(request: Request):
    user = await get_current_user(request)
    project_q, task_q = await _scope(user)

    priorities = []
    for p in ["low", "medium", "high", "critical"]:
        priorities.append({"name": p.title(), "value": await db.tasks.count_documents(_and(task_q, {"priority": p}))})

    project_statuses = []
    for s in ["planning", "active", "on_hold", "completed", "cancelled"]:
        project_statuses.append({"name": s.replace("_", " ").title(),
                                 "value": await db.projects.count_documents(_and(project_q, {"status": s}))})

    projects = await db.projects.find(_and(project_q, {"status": {"$nin": ["completed", "cancelled"]}}),
                                      {"_id": 0}).sort("updated_at", -1).limit(8).to_list(8)
    stats = await task_stats_by_project([p["project_id"] for p in projects])
    project_tasks = []
    for proj in projects:
        s = stats.get(proj["project_id"], EMPTY_STATS)
        project_tasks.append({
            "name": proj["name"][:20], "Todo": s["todo"], "In Progress": s["in_progress"],
            "In Review": s["in_review"], "Completed": s["completed"],
        })

    # Throughput: tasks completed per week, last 8 weeks
    today = date.today()
    start_of_week = today - timedelta(days=today.weekday())
    throughput = []
    for i in range(7, -1, -1):
        wk_start = start_of_week - timedelta(weeks=i)
        wk_end = wk_start + timedelta(days=7)
        n = await db.tasks.count_documents(_and(task_q, {
            "status": "completed",
            "completed_at": {"$gte": wk_start.isoformat(), "$lt": wk_end.isoformat()},
        }))
        throughput.append({"name": wk_start.strftime("%b %d"), "Completed": n})

    return {
        "priority_distribution": priorities,
        "project_statuses": project_statuses,
        "project_tasks": project_tasks,
        "throughput": throughput,
    }


@router.get("/portfolio")
async def portfolio(request: Request):
    """Health of every active project the user can see — the 'what needs my attention' view."""
    user = await get_current_user(request)
    project_q, _ = await _scope(user)
    projects = await db.projects.find(_and(project_q, {"status": {"$nin": ["completed", "cancelled"]}}),
                                      {"_id": 0, "project_id": 1, "name": 1, "status": 1, "priority": 1,
                                       "start_date": 1, "end_date": 1}).to_list(1000)
    stats = await task_stats_by_project([p["project_id"] for p in projects])
    out = []
    for p in projects:
        s = stats.get(p["project_id"], EMPTY_STATS)
        out.append({**p, "task_stats": s, **project_health(p, s)})
    order = {"off_track": 0, "at_risk": 1, "on_hold": 2, "on_track": 3}
    out.sort(key=lambda p: (order.get(p["health"], 9), p.get("end_date") or "9999"))
    summary = {k: sum(1 for p in out if p["health"] == k) for k in ("on_track", "at_risk", "off_track", "on_hold")}
    return {"projects": out, "summary": summary}


@router.get("/workload")
async def workload(request: Request, project_id: str = None):
    """Open work per person: task count, estimated hours vs. weekly capacity, overdue items."""
    user = await get_current_user(request)
    if not is_manager(user):
        return []
    task_q = await visible_task_query(user)
    if project_id:
        task_q = _and(task_q, {"project_id": project_id})
    today = today_str()

    pipeline = [
        {"$match": _and(task_q, {"status": {"$ne": "completed"}, "assigned_to": {"$nin": [None, ""]}})},
        {"$group": {
            "_id": "$assigned_to",
            "open_tasks": {"$sum": 1},
            "in_progress": {"$sum": {"$cond": [{"$eq": ["$status", "in_progress"]}, 1, 0]}},
            "estimated_hours": {"$sum": {"$ifNull": ["$estimate_hours", 0]}},
            "unestimated": {"$sum": {"$cond": [{"$gt": ["$estimate_hours", None]}, 0, 1]}},
            "overdue": {"$sum": {"$cond": [{"$and": [
                {"$gt": ["$due_date", None]}, {"$ne": ["$due_date", ""]}, {"$lt": ["$due_date", today]},
            ]}, 1, 0]}},
            "high_priority": {"$sum": {"$cond": [{"$in": ["$priority", ["high", "critical"]]}, 1, 0]}},
        }},
    ]
    rows = {r["_id"]: r async for r in db.tasks.aggregate(pipeline)}

    if project_id:
        proj = await db.projects.find_one({"project_id": project_id}, {"_id": 0, "team_members": 1}) or {}
        people_q = {"user_id": {"$in": list(set(proj.get("team_members", [])) | set(rows))}}
    elif user["role"] == "admin":
        people_q = {}
    else:
        proj_ids = await visible_project_ids(user)
        projs = await db.projects.find({"project_id": {"$in": proj_ids}}, {"_id": 0, "team_members": 1}).to_list(1000)
        ids = {m for p in projs for m in p.get("team_members", [])} | set(rows)
        people_q = {"user_id": {"$in": list(ids)}}

    people = await db.users.find({**people_q, "disabled": {"$ne": True}},
                                 {"_id": 0, "user_id": 1, "name": 1, "role": 1, "department": 1,
                                  "weekly_capacity_hours": 1}).to_list(2000)
    out = []
    for person in people:
        r = rows.get(person["user_id"], {})
        capacity = person.get("weekly_capacity_hours") or 40
        hours = r.get("estimated_hours", 0)
        load = round(hours / capacity * 100) if capacity else 0
        out.append({
            "user_id": person["user_id"], "name": person["name"], "role": person["role"],
            "department": person.get("department"), "capacity_hours": capacity,
            "open_tasks": r.get("open_tasks", 0), "in_progress": r.get("in_progress", 0),
            "estimated_hours": hours, "unestimated": r.get("unestimated", 0),
            "overdue": r.get("overdue", 0), "high_priority": r.get("high_priority", 0),
            "load_percent": load,
            "status": "overloaded" if load > 100 else "busy" if load > 75 else "available",
        })
    out.sort(key=lambda p: (-p["load_percent"], -p["open_tasks"]))
    return out


@router.get("/activity")
async def get_activity(request: Request, limit: int = 30, project_id: str = None):
    user = await get_current_user(request)
    limit = max(1, min(limit, 200))
    proj_ids = await visible_project_ids(user)
    if project_id:
        if proj_ids is not None and project_id not in proj_ids:
            return []
        query = {"project_id": project_id}
    elif proj_ids is None:
        query = {}
    else:
        query = {"$or": [{"project_id": {"$in": proj_ids}}, {"user_id": user["user_id"]}]}
    return await db.activity_logs.find(query, {"_id": 0}).sort("created_at", -1).to_list(limit)
