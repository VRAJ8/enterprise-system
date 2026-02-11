from fastapi import APIRouter, HTTPException, Request
from database import db
from models import gen_id
from auth_utils import get_current_user, require_role, hash_password
from helpers import log_activity
from datetime import datetime, timezone

router = APIRouter(prefix="/api/users", tags=["users"])


@router.get("")
async def list_users(request: Request):
    user = await get_current_user(request)
    users = await db.users.find({}, {"_id": 0, "password": 0}).to_list(500)
    return users


@router.get("/{user_id}")
async def get_user(user_id: str, request: Request):
    await get_current_user(request)
    user = await db.users.find_one({"user_id": user_id}, {"_id": 0, "password": 0})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return user


@router.put("/{user_id}")
async def update_user(user_id: str, request: Request):
    current_user = await get_current_user(request)
    body = await request.json()

    # Only admin can change roles, or user can update their own profile
    if current_user["role"] != "admin" and current_user["user_id"] != user_id:
        raise HTTPException(status_code=403, detail="Insufficient permissions")

    allowed = {"name", "department", "picture"}
    if current_user["role"] == "admin":
        allowed.add("role")

    update_data = {k: v for k, v in body.items() if k in allowed}
    if "password" in body and body["password"]:
        update_data["password"] = hash_password(body["password"])

    if not update_data:
        raise HTTPException(status_code=400, detail="No valid fields")

    await db.users.update_one({"user_id": user_id}, {"$set": update_data})
    user = await db.users.find_one({"user_id": user_id}, {"_id": 0, "password": 0})
    return user


@router.delete("/{user_id}")
async def delete_user(user_id: str, request: Request):
    admin = await require_role(["admin"])(request)
    if admin["user_id"] == user_id:
        raise HTTPException(status_code=400, detail="Cannot delete yourself")

    user = await db.users.find_one({"user_id": user_id}, {"_id": 0})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    await db.users.delete_one({"user_id": user_id})
    await db.user_sessions.delete_many({"user_id": user_id})
    await log_activity(admin["user_id"], admin["name"], "deleted user", "user", user_id, user["name"])
    return {"message": "User deleted"}


# ─── Comments (shared for projects and tasks) ───

@router.post("/comments")
async def create_comment(request: Request):
    user = await get_current_user(request)
    body = await request.json()
    content = body.get("content", "")
    entity_type = body.get("entity_type", "")
    entity_id = body.get("entity_id", "")

    if not content or not entity_type or not entity_id:
        raise HTTPException(status_code=400, detail="content, entity_type, entity_id required")

    comment_id = gen_id("cmt_")
    comment = {
        "comment_id": comment_id,
        "content": content,
        "entity_type": entity_type,
        "entity_id": entity_id,
        "user_id": user["user_id"],
        "user_name": user["name"],
        "user_picture": user.get("picture", ""),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.comments.insert_one(comment)
    return {k: v for k, v in comment.items() if k != "_id"}


@router.get("/comments/{entity_type}/{entity_id}")
async def list_comments(entity_type: str, entity_id: str, request: Request):
    await get_current_user(request)
    comments = await db.comments.find(
        {"entity_type": entity_type, "entity_id": entity_id}, {"_id": 0}
    ).sort("created_at", 1).to_list(200)
    return comments


# ─── File Upload ───

@router.post("/files/upload")
async def upload_file(request: Request):
    from fastapi import UploadFile, File, Form
    import aiofiles
    import os

    user = await get_current_user(request)
    form = await request.form()
    file = form.get("file")
    entity_type = form.get("entity_type", "general")
    entity_id = form.get("entity_id", "")

    if not file:
        raise HTTPException(status_code=400, detail="No file provided")

    file_id = gen_id("file_")
    filename = f"{file_id}_{file.filename}"
    upload_dir = "/app/backend/uploads"
    os.makedirs(upload_dir, exist_ok=True)
    filepath = os.path.join(upload_dir, filename)

    async with aiofiles.open(filepath, "wb") as f:
        content = await file.read()
        await f.write(content)

    file_doc = {
        "file_id": file_id,
        "original_name": file.filename,
        "stored_name": filename,
        "entity_type": entity_type,
        "entity_id": entity_id,
        "uploaded_by": user["user_id"],
        "uploaded_by_name": user["name"],
        "size": len(content),
        "content_type": file.content_type or "application/octet-stream",
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.files.insert_one(file_doc)

    await log_activity(user["user_id"], user["name"], "uploaded file", entity_type, entity_id, file.filename)
    return {k: v for k, v in file_doc.items() if k != "_id"}


@router.get("/files/{entity_type}/{entity_id}")
async def list_files(entity_type: str, entity_id: str, request: Request):
    await get_current_user(request)
    files = await db.files.find(
        {"entity_type": entity_type, "entity_id": entity_id}, {"_id": 0}
    ).sort("created_at", -1).to_list(100)
    return files
