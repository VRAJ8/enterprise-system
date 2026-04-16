# backend/agent_service.py
import os
import json
from groq import Groq
from dotenv import load_dotenv
import asyncio
from datetime import datetime, timezone, timedelta

load_dotenv()

# 1. Initialize Groq (Fast & Reliable)
client = Groq(api_key=os.getenv("GROQ_API_KEY"))

# 2. Context Fetcher (The AI's "Eyes")
async def fetch_system_data():
    from database import db
    # Fetch Data for Context
    tasks = await db.tasks.find({}, {"task_id": 1, "title": 1, "status": 1, "due_date": 1, "project_id": 1, "assigned_to": 1}).to_list(50)
    users = await db.users.find({}, {"user_id": 1, "name": 1, "email": 1}).to_list(50)
    projects = await db.projects.find({}, {"project_id": 1, "name": 1, "status": 1}).to_list(50)
    
    return json.dumps({
        "tasks": tasks,
        "users": users,
        "projects": projects
    }, default=str)

# 3. The Core Logic (Reactive)
async def handle_ai_logic(user_prompt, system_type="chat"):
    from database import db
    from models import gen_id
    from helpers import notify_task_assigned, log_activity

    real_data = await fetch_system_data()
    
    system_message = f"""
    You are the Enterprise System AI Manager. 
    Current System Data: {real_data}
    Role: Help the user manage the system. You have full capability to answer questions about users' workload, project status, and task details.
    If the user asks you to perform an action (create project, create task, reassign task, or update status), ALWAYS use the provided tools to execute the action. 
    Always reply with a friendly conversational message explaining what you did or answering the user's question clearly.
    """

    tools = [
        {
            "type": "function",
            "function": {
                "name": "update_task_status",
                "description": "Updates the status of a task.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "task_id": {"type": "string", "description": "The ID of the task to update."},
                        "status": {"type": "string", "enum": ["todo", "in_progress", "in_review", "done"], "description": "The new status."}
                    },
                    "required": ["task_id", "status"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "create_project",
                "description": "Create a new project.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "name": {"type": "string", "description": "Name of the project."},
                        "description": {"type": "string", "description": "Project description."}
                    },
                    "required": ["name"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "create_task",
                "description": "Create a new task.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "title": {"type": "string", "description": "Task title."},
                        "description": {"type": "string", "description": "Task description."},
                        "project_id": {"type": "string", "description": "ID of the project this task belongs to."},
                        "assigned_to": {"type": "string", "description": "User ID of the assignee (optional)."}
                    },
                    "required": ["title", "project_id"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "reassign_task",
                "description": "Reassigns a task to a different user.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "task_id": {"type": "string", "description": "The ID of the task."},
                        "assigned_to": {"type": "string", "description": "The new assignee's User ID."}
                    },
                    "required": ["task_id", "assigned_to"]
                }
            }
        }
    ]

    response = client.chat.completions.create(
        model="llama-3.3-70b-versatile",
        messages=[
            {"role": "system", "content": system_message},
            {"role": "user", "content": user_prompt},
        ],
        temperature=0.2,
        tools=tools,
        tool_choice="auto",
    )
    
    message = response.choices[0].message
    
    # Execute Tools if chosen
    if message.tool_calls:
        for tool_call in message.tool_calls:
            args = json.loads(tool_call.function.arguments)
            now_iso = datetime.now(timezone.utc).isoformat()
            
            if tool_call.function.name == "update_task_status":
                if args.get("task_id") and args.get("status"):
                    await db.tasks.update_one(
                        {"task_id": args["task_id"]}, 
                        {"$set": {"status": args["status"], "updated_at": now_iso}}
                    )

            elif tool_call.function.name == "create_project":
                project_id = gen_id("proj_")
                project = {
                    "project_id": project_id,
                    "name": args.get("name"),
                    "description": args.get("description", ""),
                    "priority": "medium",
                    "status": "planning",
                    "team_members": [],
                    "created_by": "system_ai",
                    "created_at": now_iso,
                    "updated_at": now_iso
                }
                await db.projects.insert_one(project)

            elif tool_call.function.name == "create_task":
                task_id = gen_id("task_")
                project = await db.projects.find_one({"project_id": args.get("project_id")})
                
                assignee_name = None
                if args.get("assigned_to"):
                    assignee = await db.users.find_one({"user_id": args["assigned_to"]})
                    if assignee:
                        assignee_name = assignee["name"]

                task = {
                    "task_id": task_id,
                    "title": args.get("title"),
                    "description": args.get("description", ""),
                    "project_id": args.get("project_id"),
                    "project_name": project.get("name") if project else "Unknown Project",
                    "assigned_to": args.get("assigned_to"),
                    "assigned_to_name": assignee_name,
                    "priority": "medium",
                    "status": "todo",
                    "due_date": None,
                    "created_by": "system_ai",
                    "created_at": now_iso,
                    "updated_at": now_iso
                }
                await db.tasks.insert_one(task)
                if assignee_name:
                    from helpers import notify_task_assigned
                    assignee = await db.users.find_one({"user_id": args.get("assigned_to")})
                    await notify_task_assigned(task, assignee, "System AI")

            elif tool_call.function.name == "reassign_task":
                assignee = await db.users.find_one({"user_id": args.get("assigned_to")})
                task = await db.tasks.find_one({"task_id": args.get("task_id")})
                if assignee and task:
                    await db.tasks.update_one(
                        {"task_id": task["task_id"]},
                        {"$set": {"assigned_to": assignee["user_id"], "assigned_to_name": assignee["name"], "updated_at": now_iso}}
                    )
                    from helpers import notify_task_assigned
                    await notify_task_assigned(task, assignee, "System AI")
        
        if message.content:
            return message.content
        return "I have successfully completed the action requested!"

    return message.content

# 4. Proactive Logic
def handle_chat_query(msg):
    return asyncio.run(handle_ai_logic(msg))

async def async_run_deadline_check():
    from database import db
    from helpers import create_notification
    
    now = datetime.now(timezone.utc)
    target_date = now + timedelta(days=2)
    now_iso = now.isoformat()
    target_iso = target_date.isoformat()

    # Find tasks due in less than 48 hours that are not done
    urgent_tasks = await db.tasks.find({
        "status": {"$ne": "done"},
        "due_date": {"$ne": None},
        "due_date": {"$gte": now_iso, "$lte": target_iso}
    }).to_list(100)

    alerts_sent = 0
    for task in urgent_tasks:
        if task.get("assigned_to"):
            message_text = f"Reminder: The task '{task['title']}' is due soon."
            
            # Prevent duplicate notifications for the same task
            existing_notif = await db.notifications.find_one({
                "user_id": task["assigned_to"],
                "type": "deadline_warning",
                "message": message_text
            })
            
            if not existing_notif:
                await create_notification(
                    user_id=task["assigned_to"],
                    notif_type="deadline_warning",
                    title="Upcoming Deadline!",
                    message=message_text,
                    link=f"/tasks"
                )
                alerts_sent += 1
            
    print(f"PROACTIVE ALERT: Sent {alerts_sent} deadline notifications.")
    return f"Sent {alerts_sent} deadline notifications."

def run_deadline_check():
    return asyncio.run(async_run_deadline_check())