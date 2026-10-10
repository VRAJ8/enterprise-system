"""AI project assistant (Groq) and the proactive deadline scanner.

The assistant only sees data the requesting user can see, and every action it
takes goes through the same route handlers (and permission checks) as the UI.
"""
import json
import logging
from datetime import date, timedelta
from fastapi import HTTPException
from pydantic import ValidationError
from database import db
from config import GROQ_API_KEY, GROQ_MODEL
from models import ProjectCreate, TaskCreate, TaskUpdate
from permissions import visible_project_ids, visible_task_query, is_manager
from helpers import create_notification

logger = logging.getLogger(__name__)

MAX_TOOL_ROUNDS = 4

_client = None


class AIUnavailable(Exception):
    pass


def _get_client():
    global _client
    if not GROQ_API_KEY:
        raise AIUnavailable("The AI assistant isn't configured. Set GROQ_API_KEY on the server to enable it.")
    if _client is None:
        from groq import AsyncGroq
        _client = AsyncGroq(api_key=GROQ_API_KEY)
    return _client


async def fetch_context(user: dict) -> str:
    """Compact snapshot of the projects, tasks and people this user can see."""
    proj_ids = await visible_project_ids(user)
    pq = {} if proj_ids is None else {"project_id": {"$in": proj_ids}}
    projects = await db.projects.find(
        pq, {"_id": 0, "project_id": 1, "name": 1, "status": 1, "priority": 1, "end_date": 1, "team_members": 1}
    ).to_list(100)
    tasks = await db.tasks.find(
        await visible_task_query(user),
        {"_id": 0, "task_id": 1, "title": 1, "status": 1, "priority": 1, "due_date": 1,
         "project_id": 1, "assigned_to": 1, "assigned_to_name": 1, "estimate_hours": 1},
    ).sort("updated_at", -1).to_list(200)
    member_ids = {m for p in projects for m in p.get("team_members", [])} | {user["user_id"]}
    users = await db.users.find(
        {} if user["role"] == "admin" else {"user_id": {"$in": list(member_ids)}},
        {"_id": 0, "user_id": 1, "name": 1, "role": 1, "department": 1},
    ).to_list(200)
    return json.dumps({"today": date.today().isoformat(), "projects": projects, "tasks": tasks, "users": users},
                      default=str)


TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "create_project",
            "description": "Create a new project. Only admins and project managers can do this.",
            "parameters": {
                "type": "object",
                "properties": {
                    "name": {"type": "string"},
                    "description": {"type": "string"},
                    "priority": {"type": "string", "enum": ["low", "medium", "high", "critical"]},
                    "end_date": {"type": "string", "description": "Deadline, YYYY-MM-DD"},
                    "team_members": {"type": "array", "items": {"type": "string"}, "description": "User IDs"},
                },
                "required": ["name"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "create_task",
            "description": "Create a task in a project.",
            "parameters": {
                "type": "object",
                "properties": {
                    "title": {"type": "string"},
                    "description": {"type": "string"},
                    "project_id": {"type": "string"},
                    "assigned_to": {"type": "string", "description": "User ID of the assignee"},
                    "priority": {"type": "string", "enum": ["low", "medium", "high", "critical"]},
                    "due_date": {"type": "string", "description": "YYYY-MM-DD"},
                    "estimate_hours": {"type": "number"},
                },
                "required": ["title", "project_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "update_task",
            "description": "Update a task: change status, reassign, reprioritise or change the due date. "
                           "Only include fields that should change.",
            "parameters": {
                "type": "object",
                "properties": {
                    "task_id": {"type": "string"},
                    "status": {"type": "string", "enum": ["todo", "in_progress", "in_review", "completed"]},
                    "assigned_to": {"type": "string", "description": "User ID of the new assignee"},
                    "priority": {"type": "string", "enum": ["low", "medium", "high", "critical"]},
                    "due_date": {"type": "string", "description": "YYYY-MM-DD"},
                },
                "required": ["task_id"],
            },
        },
    },
]


async def _run_tool(name: str, args: dict, user: dict) -> dict:
    # Imported here to avoid a circular import (routes import helpers that import models)
    from routes.projects import create_project
    from routes.tasks import create_task, update_task

    try:
        if name == "create_project":
            p = await create_project(ProjectCreate(**args), user=user)
            return {"ok": True, "project_id": p["project_id"], "name": p["name"]}
        if name == "create_task":
            t = await create_task(TaskCreate(**args), user=user)
            return {"ok": True, "task_id": t["task_id"], "title": t["title"], "assigned_to": t.get("assigned_to_name")}
        if name == "update_task":
            task_id = args.pop("task_id")
            t = await update_task(task_id, TaskUpdate(**args), user=user)
            return {"ok": True, "task_id": t["task_id"], "title": t["title"], "status": t["status"],
                    "assigned_to": t.get("assigned_to_name"), "due_date": t.get("due_date")}
        return {"ok": False, "error": f"Unknown tool {name}"}
    except HTTPException as e:
        return {"ok": False, "error": e.detail}
    except ValidationError as e:
        return {"ok": False, "error": f"Invalid arguments: {e.errors()[0].get('msg')}"}


async def handle_ai_logic(user: dict, user_prompt: str, history: list[dict] | None = None) -> dict:
    """Run one assistant turn. Returns {"reply": str, "actions": [...]}."""
    client = _get_client()
    context = await fetch_context(user)
    role_note = ("You may create projects and tasks and edit any task in the user's projects."
                 if is_manager(user) else
                 "This user is a team member: they can only change the status of tasks assigned to them. "
                 "Don't offer to create projects or tasks for them.")
    system_message = (
        "You are ProjectHub's project assistant, helping a professional team plan and deliver work.\n"
        f"You are talking to {user['name']} (role: {user['role']}, user_id: {user['user_id']}). {role_note}\n"
        "Use the data below to answer questions about workload, deadlines, priorities and progress. "
        "Be concise and specific: name tasks, people and dates. Prefer short bullet lists.\n"
        "When the user asks you to change something, call the matching tool. Use real IDs from the data; "
        "if a request is ambiguous (e.g. several tasks match), ask a clarifying question instead of guessing. "
        "Never claim an action succeeded unless the tool result says ok.\n"
        f"Workspace data (JSON): {context}"
    )

    messages = [{"role": "system", "content": system_message}]
    for h in (history or [])[-10:]:
        role = "assistant" if h.get("role") in ("ai", "assistant") else "user"
        text = str(h.get("text") or h.get("content") or "")[:2000]
        if text:
            messages.append({"role": role, "content": text})
    messages.append({"role": "user", "content": user_prompt})

    actions = []
    try:
        for _ in range(MAX_TOOL_ROUNDS):
            response = await client.chat.completions.create(
                model=GROQ_MODEL, messages=messages, temperature=0.2, tools=TOOLS, tool_choice="auto",
            )
            message = response.choices[0].message
            if not message.tool_calls:
                return {"reply": message.content or "", "actions": actions}

            messages.append({
                "role": "assistant",
                "content": message.content or "",
                "tool_calls": [
                    {"id": tc.id, "type": "function",
                     "function": {"name": tc.function.name, "arguments": tc.function.arguments}}
                    for tc in message.tool_calls
                ],
            })
            for tc in message.tool_calls:
                try:
                    args = json.loads(tc.function.arguments or "{}")
                except json.JSONDecodeError:
                    args = {}
                result = await _run_tool(tc.function.name, args, user)
                actions.append({"tool": tc.function.name, **result})
                messages.append({"role": "tool", "tool_call_id": tc.id, "content": json.dumps(result)})
    except AIUnavailable:
        raise
    except Exception as e:
        logger.exception("AI request failed")
        raise AIUnavailable("The AI service is unreachable right now. Please try again shortly.") from e

    return {"reply": "I made the changes listed below.", "actions": actions}


# ─── Proactive deadline scanner ───

async def run_deadline_check() -> dict:
    """Notify assignees about tasks due within 2 days, and assignees + owners about overdue tasks.

    Each (task, due date, kind) is notified at most once, so rescheduling a task re-arms its reminder.
    """
    today = date.today()
    soon = (today + timedelta(days=2)).isoformat()
    t = today.isoformat()

    tasks = await db.tasks.find({
        "status": {"$ne": "completed"},
        "due_date": {"$nin": [None, ""], "$lte": soon},
    }, {"_id": 0}).to_list(5000)

    sent = 0
    for task in tasks:
        due = task["due_date"][:10]
        overdue = due < t
        kind = "deadline_overdue" if overdue else "deadline_warning"
        recipients = {task.get("assigned_to")}
        if overdue:
            recipients.add(task.get("created_by"))
        for uid in recipients - {None, "", "system_ai"}:
            key = f"{task['task_id']}:{due}"
            if await db.notifications.find_one({"user_id": uid, "type": kind, "ref_id": key}):
                continue
            if overdue:
                title, msg = "Task Overdue", f"'{task['title']}' was due {due} and isn't completed yet."
            elif due == t:
                title, msg = "Due Today", f"'{task['title']}' is due today."
            else:
                title, msg = "Upcoming Deadline", f"'{task['title']}' is due {due}."
            await create_notification(uid, kind, title, msg, link=f"/tasks?task={task['task_id']}", ref_id=key)
            sent += 1

    logger.info("Deadline scan: %d notifications sent", sent)
    return {"notifications_sent": sent, "tasks_checked": len(tasks)}
