from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from starlette.middleware.cors import CORSMiddleware
import os
import logging
from pathlib import Path
from dotenv import load_dotenv

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

app = FastAPI(title="Enterprise PM System")

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)

# Logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# Mount uploads directory
uploads_dir = ROOT_DIR / "uploads"
uploads_dir.mkdir(exist_ok=True)
app.mount("/api/uploads", StaticFiles(directory=str(uploads_dir)), name="uploads")

# Import and include routers
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


@app.get("/api")
async def root():
    return {"message": "Enterprise PM System API", "status": "running"}


# DB indexes on startup
@app.on_event("startup")
async def startup():
    from database import db
    await db.users.create_index("user_id", unique=True)
    await db.users.create_index("email", unique=True)
    await db.projects.create_index("project_id", unique=True)
    await db.tasks.create_index("task_id", unique=True)
    await db.tasks.create_index("project_id")
    await db.tasks.create_index("assigned_to")
    await db.notifications.create_index("user_id")
    await db.chat_messages.create_index("channel_id")
    await db.activity_logs.create_index("created_at")
    logger.info("Database indexes created")


@app.on_event("shutdown")
async def shutdown():
    from database import client
    client.close()
