import asyncio
import logging
from html import escape
from datetime import datetime, timezone
import resend
from database import db
from models import gen_id
from config import RESEND_API_KEY, SENDER_EMAIL

logger = logging.getLogger(__name__)

resend.api_key = RESEND_API_KEY


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


async def create_notification(user_id: str, notif_type: str, title: str, message: str,
                              link: str = "", ref_id: str = ""):
    notif = {
        "notification_id": gen_id("notif_"),
        "user_id": user_id,
        "type": notif_type,
        "title": title,
        "message": message,
        "read": False,
        "link": link,
        "ref_id": ref_id,
        "created_at": now_iso(),
    }
    await db.notifications.insert_one(notif)
    notif.pop("_id", None)
    return notif


async def log_activity(user_id: str, user_name: str, action: str, entity_type: str, entity_id: str,
                       entity_name: str, project_id: str = "", details: str = ""):
    activity = {
        "activity_id": gen_id("act_"),
        "user_id": user_id,
        "user_name": user_name,
        "action": action,
        "entity_type": entity_type,
        "entity_id": entity_id,
        "entity_name": entity_name,
        "project_id": project_id,
        "details": details,
        "created_at": now_iso(),
    }
    await db.activity_logs.insert_one(activity)
    activity.pop("_id", None)
    return activity


async def send_email_notification(to_email: str, subject: str, html_content: str):
    if not resend.api_key:
        logger.debug("No Resend API key configured, skipping email to %s", to_email)
        return None
    try:
        params = {
            "from": SENDER_EMAIL,
            "to": [to_email],
            "subject": subject,
            "html": html_content,
        }
        result = await asyncio.to_thread(resend.Emails.send, params)
        logger.info("Email sent to %s", to_email)
        return result
    except Exception as e:
        logger.error("Failed to send email to %s: %s", to_email, e)
        return None


async def notify_task_assigned(task: dict, assignee: dict, assigner_name: str):
    await create_notification(
        user_id=assignee["user_id"],
        notif_type="task_assigned",
        title="New Task Assigned",
        message=f"{assigner_name} assigned you the task: {task['title']}",
        link=f"/tasks?task={task['task_id']}",
        ref_id=task["task_id"],
    )
    if not assignee.get("email"):
        return
    due = f"<p style=\"color:#a1a1aa;margin:8px 0 0;\">Due: {escape(task['due_date'])}</p>" if task.get("due_date") else ""
    await send_email_notification(
        to_email=assignee["email"],
        subject=f"New Task: {task['title']}",
        html_content=f"""
        <div style="font-family:Arial,sans-serif;padding:20px;background:#09090b;color:#fafafa;">
            <h2 style="color:#6366f1;">New Task Assigned</h2>
            <p>{escape(assigner_name)} assigned you a new task:</p>
            <div style="background:#18181b;padding:16px;border-radius:8px;margin:12px 0;">
                <h3 style="color:#fafafa;margin:0 0 8px;">{escape(task['title'])}</h3>
                <p style="color:#a1a1aa;margin:0;">{escape(task.get('description') or '')}</p>
                <p style="color:#a1a1aa;margin:8px 0 0;">Priority: {escape((task.get('priority') or 'medium').upper())}</p>
                {due}
            </div>
        </div>"""
    )


async def notify_project_update(project: dict, user_ids: list, updater_name: str, change: str):
    for uid in user_ids:
        await create_notification(
            user_id=uid,
            notif_type="project_update",
            title="Project Updated",
            message=f"{updater_name} {change} in project: {project['name']}",
            link=f"/projects/{project['project_id']}",
            ref_id=project["project_id"],
        )
