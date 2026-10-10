import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI, Depends, HTTPException
from starlette.middleware.cors import CORSMiddleware
from apscheduler.schedulers.asyncio import AsyncIOScheduler

from config import CORS_ORIGINS, DEADLINE_SCAN_MINUTES, UPLOAD_DIR, GROQ_API_KEY
from database import client, ensure_indexes, migrate_legacy_data
from auth_utils import current_user
from models import AIChatRequest
from agent_service import run_deadline_check, handle_ai_logic, AIUnavailable

from routes.auth import router as auth_router
from routes.projects import router as projects_router
from routes.tasks import router as tasks_router
from routes.chat import router as chat_router
from routes.notifications import router as notifications_router
from routes.dashboard import router as dashboard_router
from routes.users import router as users_router

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

scheduler = AsyncIOScheduler()


@asynccontextmanager
async def lifespan(app: FastAPI):
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    await ensure_indexes()
    await migrate_legacy_data()
    scheduler.add_job(run_deadline_check, "interval", minutes=DEADLINE_SCAN_MINUTES, id="deadline_scan",
                      replace_existing=True)
    scheduler.start()
    yield
    scheduler.shutdown(wait=False)
    client.close()


app = FastAPI(title="Enterprise PM System", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=CORS_ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],
)

for router in (auth_router, projects_router, tasks_router, chat_router, notifications_router,
               dashboard_router, users_router):
    app.include_router(router)


@app.post("/api/ai/chat")
async def chat_with_ai(payload: AIChatRequest, user: dict = Depends(current_user)):
    try:
        return await handle_ai_logic(user, payload.message, payload.history)
    except AIUnavailable as e:
        raise HTTPException(status_code=503, detail=str(e))


@app.get("/api/ai/status")
async def ai_status(user: dict = Depends(current_user)):
    return {"enabled": bool(GROQ_API_KEY)}


@app.post("/api/ai/trigger-scan")
async def manual_trigger(user: dict = Depends(current_user)):
    if user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Admins only")
    return await run_deadline_check()


@app.get("/api")
async def root():
    return {"message": "Enterprise PM System API", "status": "running"}


@app.get("/api/health")
async def health():
    await client.admin.command("ping")
    return {"status": "ok"}
