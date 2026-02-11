import asyncio
import os
import logging
import resend
from datetime import datetime, timezone
from database import db
from models import gen_id

logger = logging.getLogger(__name__)

resend.api_key = os.environ.get('RESEND_API_KEY', '')
SENDER_EMAIL = os.environ.get('SENDER_EMAIL', 'onboarding@resend.dev')


async def create_notification(user_id: str, notif_type: str, title: str, message: str, link: str = ""):
    notif = {
        "notification_id": gen_id("notif_"),
        "user_id": user_id,
        "type": notif_type,
        "title": title,
        "message": message,
        "read": False,
        "link": link,
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    await db.notifications.insert_one(notif)
    return notif


async def log_activity(user_id: str, user_name: str, action: str, entity_type: str, entity_id: str, entity_name: str, project_id: str = ""):
    activity = {
        "activity_id": gen_id("act_"),
        "user_id": user_id,
        "user_name": user_name,
        "action": action,
        "entity_type": entity_type,
        "entity_id": entity_id,
        "entity_name": entity_name,
        "project_id": project_id,
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    await db.activity_logs.insert_one(activity)
    return activity


async def send_email_notification(to_email: str, subject: str, html_content: str):
    if not resend.api_key:
        logger.warning("No Resend API key configured, skipping email")
        return None
    try:
        params = {
            "from": SENDER_EMAIL,
            "to": [to_email],
            "subject": subject,
            "html": html_content,
        }
        result = await asyncio.to_thread(resend.Emails.send, params)
        logger.info(f"Email sent to {to_email}: {result}")
        return result
    except Exception as e:
        logger.error(f"Failed to send email to {to_email}: {e}")
        return None


async def notify_task_assigned(task: dict, assignee: dict, assigner_name: str):
    await create_notification(
        user_id=assignee["user_id"],
        notif_type="task_assigned",
        title="New Task Assigned",
        message=f"{assigner_name} assigned you the task: {task['title']}",
        link=f"/tasks"
    )
    await send_email_notification(
        to_email=assignee["email"],
        subject=f"New Task: {task['title']}",
        html_content=f"""
        <div style="font-family:Arial,sans-serif;padding:20px;background:#09090b;color:#fafafa;">
            <h2 style="color:#6366f1;">New Task Assigned</h2>
            <p>{assigner_name} assigned you a new task:</p>
            <div style="background:#18181b;padding:16px;border-radius:8px;margin:12px 0;">
                <h3 style="color:#fafafa;margin:0 0 8px;">{task['title']}</h3>
                <p style="color:#a1a1aa;margin:0;">{task.get('description', '')}</p>
                <p style="color:#a1a1aa;margin:8px 0 0;">Priority: {task.get('priority', 'medium').upper()}</p>
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
            link=f"/projects/{project['project_id']}"
        )
