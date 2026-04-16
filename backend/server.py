# backend/server.py
from fastapi import FastAPI, Body
from fastapi.staticfiles import StaticFiles
from starlette.middleware.cors import CORSMiddleware
import os
import logging
from pathlib import Path
from dotenv import load_dotenv
from apscheduler.schedulers.background import BackgroundScheduler

# Import ONLY the brain functions from your other file
from agent_service import run_deadline_check, handle_ai_logic

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

app = FastAPI(title="Enterprise PM System")

# CORS Setup
app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', 'http://localhost:5173').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount uploads
uploads_dir = ROOT_DIR / "uploads"
uploads_dir.mkdir(exist_ok=True)
app.mount("/api/uploads", StaticFiles(directory=str(uploads_dir)), name="uploads")

# Include your existing routes
from routes.auth import router as auth_router
from routes.projects import router as projects_router
from routes.tasks import router as tasks_router
from routes.chat import router as chat_router
from routes.notifications import router as notifications_router
from routes.dashboard import router as dashboard_router
from routes.users import router as users_router

app.include_router(auth_router)
app.include_router(projects_router)
app.include_router(tasks_router)
app.include_router(chat_router)
app.include_router(notifications_router)
app.include_router(dashboard_router)
app.include_router(users_router)

# AI Endpoints
@app.post("/api/ai/chat")
async def chat_with_ai(payload: dict = Body(...)):
    user_message = payload.get("message")
    ai_response = await handle_ai_logic(user_message)
    return {"reply": ai_response}

@app.get("/api/ai/trigger-scan")
async def manual_trigger():
    # This lets you test the proactive part manually
    run_deadline_check()
    return {"message": "Agent is scanning tasks..."}

# Startup logic
scheduler = BackgroundScheduler()

@app.on_event("startup")
async def startup():
    from database import db
    # Create your indexes
    await db.users.create_index("user_id", unique=True)
    # ... (rest of your existing indexes)
    
    # Start the Proactive AI Scheduler
    scheduler.add_job(run_deadline_check, 'cron', hour=9, minute=0)
    scheduler.start()

@app.on_event("shutdown")
async def shutdown():
    from database import client
    client.close()
    scheduler.shutdown()

@app.get("/api")
async def root():
    return {"message": "Enterprise PM System API", "status": "running"}