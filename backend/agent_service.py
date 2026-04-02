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
    tasks = await db.tasks.find({}, {"title": 1, "status": 1, "deadline": 1}).to_list(20)
    return json.dumps(tasks, default=str)

# 3. The Core Logic (Reactive & Proactive)
async def handle_ai_logic(user_prompt, system_type="chat"):
    # Fetch real data first
    real_data = await fetch_task_data()
    
    system_message = f"""
    You are the Enterprise System AI. 
    Current Project Data: {real_data}
    Role: Help the user manage tasks and alert them of deadlines.
    """

    response = client.chat.completions.create(
        model="llama-3.3-70b-versatile", # Groq's best model
        messages=[
            {"role": "system", "content": system_message},
            {"role": "user", "content": user_prompt},
        ],
        temperature=0.2
    )
    return response.choices[0].message.content

# 4. Functions for server.py (Synchronous Wrappers)
import asyncio

def handle_chat_query(msg):
    return asyncio.run(handle_ai_logic(msg))

def run_deadline_check():
    prompt = "Scan the data and give me a 1-sentence alert for any urgent deadlines."
    alert = asyncio.run(handle_ai_logic(prompt))
    print(f"PROACTIVE ALERT: {alert}")
    return alert