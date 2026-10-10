"""Background jobs (in-process APScheduler). Jobs must be idempotent: they may run on several instances."""

import logging

from apscheduler.schedulers.asyncio import AsyncIOScheduler

from app.core.config import settings

logger = logging.getLogger(__name__)

_scheduler: AsyncIOScheduler | None = None


def start() -> None:
    global _scheduler
    from app.services.reminders import run_deadline_reminders

    _scheduler = AsyncIOScheduler()
    _scheduler.add_job(
        run_deadline_reminders,
        "interval",
        minutes=settings.reminder_interval_minutes,
        id="deadline_reminders",
        replace_existing=True,
        max_instances=1,
        coalesce=True,
    )
    _scheduler.start()
    logger.info("Scheduler started (deadline reminders every %s min)", settings.reminder_interval_minutes)


def stop() -> None:
    global _scheduler
    if _scheduler is not None:
        _scheduler.shutdown(wait=False)
        _scheduler = None
