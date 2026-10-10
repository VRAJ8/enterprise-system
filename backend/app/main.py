"""FastAPI application factory."""

import logging
from contextlib import asynccontextmanager

from fastapi import APIRouter, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text

from app.api.v1 import auth, comments, insights, notifications, projects, realtime, tasks, time_tracking, workspaces
from app.core.config import settings
from app.core.db import get_engine
from app.core.errors import install_error_handlers
from app.services import scheduler

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings.upload_dir.mkdir(parents=True, exist_ok=True)
    if settings.enable_scheduler and not settings.is_test:
        scheduler.start()
    yield
    scheduler.stop()
    await get_engine().dispose()


def create_app() -> FastAPI:
    app = FastAPI(
        title="ProjectHub API",
        version="1.0.0",
        lifespan=lifespan,
        docs_url="/api/docs",
        openapi_url="/api/openapi.json",
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    install_error_handlers(app)

    api = APIRouter(prefix="/api/v1")
    for module in (auth, workspaces, projects, tasks, comments, time_tracking, notifications, insights, realtime):
        api.include_router(module.router)
    app.include_router(api)

    @app.get("/api/health", tags=["meta"])
    async def health():
        async with get_engine().connect() as conn:
            await conn.execute(text("SELECT 1"))
        return {"status": "ok"}

    return app


app = create_app()
