from fastapi import APIRouter, Request
from database import db
from auth_utils import get_current_user

router = APIRouter(prefix="/api/notifications", tags=["notifications"])


@router.get("")
async def list_notifications(request: Request):
    user = await get_current_user(request)
    notifs = await db.notifications.find(
        {"user_id": user["user_id"]}, {"_id": 0}
    ).sort("created_at", -1).to_list(100)
    return notifs


@router.get("/unread-count")
async def unread_count(request: Request):
    user = await get_current_user(request)
    count = await db.notifications.count_documents(
        {"user_id": user["user_id"], "read": False}
    )
    return {"count": count}


@router.put("/{notification_id}/read")
async def mark_read(notification_id: str, request: Request):
    user = await get_current_user(request)
    await db.notifications.update_one(
        {"notification_id": notification_id, "user_id": user["user_id"]},
        {"$set": {"read": True}}
    )
    return {"message": "Marked as read"}


@router.put("/read-all")
async def mark_all_read(request: Request):
    user = await get_current_user(request)
    await db.notifications.update_many(
        {"user_id": user["user_id"], "read": False},
        {"$set": {"read": True}}
    )
    return {"message": "All marked as read"}
