from fastapi import APIRouter, Request
from datetime import datetime, timezone
from database import db
from models import MessageCreate, gen_id
from auth_utils import get_current_user

router = APIRouter(prefix="/api/chat", tags=["chat"])


@router.get("/channels")
async def list_channels(request: Request):
    user = await get_current_user(request)
    if user["role"] == "admin":
        channels = await db.chat_channels.find({}, {"_id": 0}).to_list(200)
    else:
        channels = await db.chat_channels.find(
            {"members": user["user_id"]}, {"_id": 0}
        ).to_list(200)

    # Also include DM channels
    dm_channels = await db.chat_channels.find(
        {"type": "dm", "members": user["user_id"]}, {"_id": 0}
    ).to_list(200)

    all_ids = {c["channel_id"] for c in channels}
    for dm in dm_channels:
        if dm["channel_id"] not in all_ids:
            channels.append(dm)

    # Add last message and unread count for each channel
    for ch in channels:
        last_msg = await db.chat_messages.find(
            {"channel_id": ch["channel_id"]}, {"_id": 0}
        ).sort("created_at", -1).limit(1).to_list(1)
        ch["last_message"] = last_msg[0] if last_msg else None

    return channels


@router.get("/messages/{channel_id}")
async def get_messages(channel_id: str, request: Request, limit: int = 50):
    await get_current_user(request)
    messages = await db.chat_messages.find(
        {"channel_id": channel_id}, {"_id": 0}
    ).sort("created_at", -1).limit(limit).to_list(limit)
    messages.reverse()
    return messages


@router.post("/messages")
async def send_message(data: MessageCreate, request: Request):
    user = await get_current_user(request)
    msg_id = gen_id("msg_")
    now = datetime.now(timezone.utc).isoformat()
    message = {
        "message_id": msg_id,
        "channel_id": data.channel_id,
        "sender_id": user["user_id"],
        "sender_name": user["name"],
        "sender_picture": user.get("picture", ""),
        "content": data.content,
        "created_at": now,
    }
    await db.chat_messages.insert_one(message)
    return {k: v for k, v in message.items() if k != "_id"}


@router.post("/dm/{target_user_id}")
async def create_dm_channel(target_user_id: str, request: Request):
    user = await get_current_user(request)
    # Create sorted channel ID for consistency
    ids = sorted([user["user_id"], target_user_id])
    channel_id = f"dm_{ids[0]}_{ids[1]}"

    existing = await db.chat_channels.find_one({"channel_id": channel_id}, {"_id": 0})
    if existing:
        return existing

    target = await db.users.find_one({"user_id": target_user_id}, {"_id": 0, "password": 0})
    if not target:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="User not found")

    channel = {
        "channel_id": channel_id,
        "name": f"{user['name']} & {target['name']}",
        "type": "dm",
        "members": [user["user_id"], target_user_id],
        "member_details": {
            user["user_id"]: {"name": user["name"], "picture": user.get("picture", "")},
            target_user_id: {"name": target["name"], "picture": target.get("picture", "")},
        },
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.chat_channels.insert_one(channel)
    return {k: v for k, v in channel.items() if k != "_id"}
