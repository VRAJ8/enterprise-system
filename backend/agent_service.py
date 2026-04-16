# backend/agent_service.py
import os
import json
from groq import Groq
from dotenv import load_dotenv

load_dotenv()

# 1. Initialize Groq (Fast & Reliable)
client = Groq(api_key=os.getenv("GROQ_API_KEY"))

# 2. The Data Fetcher (The AI's "Eyes")
async def fetch_task_data():
    from database import db
    tasks = await db.tasks.find({}, {"task_id": 1, "title": 1, "status": 1, "due_date": 1, "project_id": 1, "assigned_to": 1}).to_list(50)
    return json.dumps(tasks, default=str)

# 3. The Core Logic (Reactive & Proactive)
async def handle_ai_logic(user_prompt, system_type="chat"):
    from database import db
    # Fetch real data first
    real_data = await fetch_task_data()
    
    system_message = f"""
    You are the Enterprise System AI. 
    Current Project Data: {real_data}
    Role: Help the user manage tasks and alert them of deadlines.
    If the user asks you to perform an action on a task, use the provided tools to update the database. 
    Always reply with a friendly conversational message explaining what you did.
    """

    tools = [
        {
            "type": "function",
            "function": {
                "name": "update_task_status",
                "description": "Updates the status of a specific task. Use this when the user asks to move/update a task's status (e.g. todo, in_progress, in_review, done).",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "task_id": {"type": "string", "description": "The ID of the task to update. MUST exactly match an existing task_id."},
                        "status": {"type": "string", "enum": ["todo", "in_progress", "in_review", "done"], "description": "The new status."}
                    },
                    "required": ["task_id", "status"]
                }
            }
        }
    ]

    response = client.chat.completions.create(
        model="llama-3.3-70b-versatile", # Groq's best model
        messages=[
            {"role": "system", "content": system_message},
            {"role": "user", "content": user_prompt},
        ],
        temperature=0.2,
        tools=tools,
        tool_choice="auto",
    )
    
    message = response.choices[0].message
    
    # Check if a tool was called
    if message.tool_calls:
        from datetime import datetime, timezone
        for tool_call in message.tool_calls:
            if tool_call.function.name == "update_task_status":
                args = json.loads(tool_call.function.arguments)
                task_id = args.get("task_id")
                status = args.get("status")
                
                if task_id and status:
                    await db.tasks.update_one(
                        {"task_id": task_id}, 
                        {"$set": {
                            "status": status, 
                            "updated_at": datetime.now(timezone.utc).isoformat()
                        }}
                    )
        
        # After executing the tool, we return a success confirmation.
        # Often the LLM provides content along with tool_calls, or we can just send our own:
        if message.content:
            return message.content
        return f"I've successfully updated the task status!"

    return message.content

# 4. Functions for server.py (Synchronous Wrappers)
import asyncio

def handle_chat_query(msg):
    return asyncio.run(handle_ai_logic(msg))

def run_deadline_check():
    prompt = "Scan the data and give me a 1-sentence alert for any urgent deadlines."
    alert = asyncio.run(handle_ai_logic(prompt))
    print(f"PROACTIVE ALERT: {alert}")
    return alert