from fastapi import APIRouter, HTTPException, Request
from database import db
from models import MessageCreate, gen_id
from auth_utils import get_current_user
from helpers import now_iso

router = APIRouter(prefix="/api/chat", tags=["chat"])


async def _require_channel_member(user: dict, channel_id: str) -> dict:
    channel = await db.chat_channels.find_one({"channel_id": channel_id}, {"_id": 0})
    if not channel or user["user_id"] not in channel.get("members", []):
        # Admins can read project channels (oversight) but never other people's DMs
        if not (channel and channel.get("type") == "project" and user["role"] == "admin"):
            raise HTTPException(status_code=404, detail="Channel not found")
    return channel


@router.get("/channels")
async def list_channels(request: Request):
    user = await get_current_user(request)
    channels = await db.chat_channels.find({"members": user["user_id"]}, {"_id": 0}).to_list(500)

    reads = await db.chat_reads.find({"user_id": user["user_id"]}, {"_id": 0}).to_list(1000)
    last_read = {r["channel_id"]: r["last_read_at"] for r in reads}

    for ch in channels:
        last_msg = await db.chat_messages.find(
            {"channel_id": ch["channel_id"]}, {"_id": 0}
        ).sort("created_at", -1).limit(1).to_list(1)
        ch["last_message"] = last_msg[0] if last_msg else None
        since = last_read.get(ch["channel_id"], "")
        ch["unread_count"] = await db.chat_messages.count_documents({
            "channel_id": ch["channel_id"],
            "created_at": {"$gt": since},
            "sender_id": {"$ne": user["user_id"]},
        })

    channels.sort(key=lambda c: (c["last_message"] or {}).get("created_at") or c.get("created_at", ""), reverse=True)
    return channels


@router.get("/messages/{channel_id}")
async def get_messages(channel_id: str, request: Request, limit: int = 50, before: str = None):
    user = await get_current_user(request)
    await _require_channel_member(user, channel_id)
    limit = max(1, min(limit, 200))
    query = {"channel_id": channel_id}
    if before:
        query["created_at"] = {"$lt": before}
    messages = await db.chat_messages.find(query, {"_id": 0}).sort("created_at", -1).limit(limit).to_list(limit)
    messages.reverse()
    await db.chat_reads.update_one(
        {"user_id": user["user_id"], "channel_id": channel_id},
        {"$set": {"last_read_at": now_iso()}},
        upsert=True,
    )
    return messages


@router.post("/messages")
async def send_message(data: MessageCreate, request: Request):
    user = await get_current_user(request)
    channel = await _require_channel_member(user, data.channel_id)
    if user["user_id"] not in channel.get("members", []):
        raise HTTPException(status_code=403, detail="Only channel members can post")

    message = {
        "message_id": gen_id("msg_"),
        "channel_id": data.channel_id,
        "sender_id": user["user_id"],
        "sender_name": user["name"],
        "sender_picture": user.get("picture", ""),
        "content": data.content.strip(),
        "created_at": now_iso(),
    }
    await db.chat_messages.insert_one(message)
    message.pop("_id", None)
    return message


@router.post("/dm/{target_user_id}")
async def create_dm_channel(target_user_id: str, request: Request):
    user = await get_current_user(request)
    if target_user_id == user["user_id"]:
        raise HTTPException(status_code=400, detail="Cannot start a conversation with yourself")
    ids = sorted([user["user_id"], target_user_id])
    channel_id = f"dm_{ids[0]}_{ids[1]}"

    existing = await db.chat_channels.find_one({"channel_id": channel_id}, {"_id": 0})
    if existing:
        return existing

    target = await db.users.find_one({"user_id": target_user_id}, {"_id": 0, "password": 0})
    if not target:
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
        "created_at": now_iso(),
    }
    await db.chat_channels.insert_one(channel)
    channel.pop("_id", None)
    return channel
