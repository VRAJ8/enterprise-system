"""Derived metrics: task stats, overdue detection and project health."""
from datetime import date
from database import db

OPEN_STATUSES = ("todo", "in_progress", "in_review")


def today_str() -> str:
    return date.today().isoformat()


def is_overdue(task: dict, today: str | None = None) -> bool:
    today = today or today_str()
    due = task.get("due_date")
    return bool(due) and task.get("status") != "completed" and due[:10] < today


async def task_stats_by_project(project_ids: list[str] | None = None) -> dict[str, dict]:
    """{project_id: {total, todo, in_progress, in_review, completed, overdue}} in one query."""
    today = today_str()
    match = {} if project_ids is None else {"project_id": {"$in": project_ids}}
    pipeline = [
        {"$match": match},
        {"$group": {
            "_id": "$project_id",
            "total": {"$sum": 1},
            "todo": {"$sum": {"$cond": [{"$eq": ["$status", "todo"]}, 1, 0]}},
            "in_progress": {"$sum": {"$cond": [{"$eq": ["$status", "in_progress"]}, 1, 0]}},
            "in_review": {"$sum": {"$cond": [{"$eq": ["$status", "in_review"]}, 1, 0]}},
            "completed": {"$sum": {"$cond": [{"$eq": ["$status", "completed"]}, 1, 0]}},
            "overdue": {"$sum": {"$cond": [{"$and": [
                {"$ne": ["$status", "completed"]},
                {"$gt": ["$due_date", None]},
                {"$ne": ["$due_date", ""]},
                {"$lt": ["$due_date", today]},
            ]}, 1, 0]}},
        }},
    ]
    stats = {}
    async for row in db.tasks.aggregate(pipeline):
        pid = row.pop("_id")
        stats[pid] = row
    return stats


EMPTY_STATS = {"total": 0, "todo": 0, "in_progress": 0, "in_review": 0, "completed": 0, "overdue": 0}


def project_health(project: dict, stats: dict, today: str | None = None) -> dict:
    """Classify a project as on_track / at_risk / off_track with a human-readable reason.

    Compares actual completion against how much of the schedule has elapsed,
    and flags overdue work.
    """
    today = today or today_str()
    total = stats.get("total", 0)
    completed = stats.get("completed", 0)
    overdue = stats.get("overdue", 0)
    progress = round(completed / total * 100) if total else 0
    status = project.get("status")

    if status in ("completed", "cancelled"):
        return {"progress": progress, "health": "done" if status == "completed" else "cancelled", "reason": ""}
    if status == "on_hold":
        return {"progress": progress, "health": "on_hold", "reason": "Project is on hold"}

    start, end = project.get("start_date"), project.get("end_date")
    expected = None
    if start and end and end > start:
        d0, d1, dn = date.fromisoformat(start[:10]), date.fromisoformat(end[:10]), date.fromisoformat(today)
        expected = max(0.0, min(1.0, (dn - d0).days / max(1, (d1 - d0).days))) * 100

    if end and end[:10] < today and progress < 100:
        return {"progress": progress, "health": "off_track", "expected": 100,
                "reason": f"Past deadline ({end[:10]}) with {100 - progress}% of work remaining"}
    if expected is not None and total and progress < expected - 25:
        return {"progress": progress, "health": "off_track", "expected": round(expected),
                "reason": f"{progress}% done vs {round(expected)}% of schedule elapsed"}
    if expected is not None and total and progress < expected - 10:
        return {"progress": progress, "health": "at_risk", "expected": round(expected),
                "reason": f"{progress}% done vs {round(expected)}% of schedule elapsed"}
    if overdue:
        return {"progress": progress, "health": "at_risk", "expected": round(expected) if expected is not None else None,
                "reason": f"{overdue} overdue task{'s' if overdue != 1 else ''}"}
    return {"progress": progress, "health": "on_track", "expected": round(expected) if expected is not None else None,
            "reason": ""}
