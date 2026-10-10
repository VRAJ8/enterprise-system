import re
import aiofiles
from pathlib import Path
from fastapi import APIRouter, HTTPException, Request, UploadFile, File, Form
from fastapi.responses import FileResponse
from database import db
from models import gen_id, UserCreate, UserUpdate, CommentCreate
from auth_utils import get_current_user, require_role, hash_password, verify_password, public_user
from helpers import log_activity, create_notification, now_iso
from permissions import require_entity_view
from config import UPLOAD_DIR, MAX_UPLOAD_MB

router = APIRouter(prefix="/api/users", tags=["users"])


@router.get("")
async def list_users(request: Request, include_disabled: bool = False):
    user = await get_current_user(request)
    query = {} if (include_disabled and user["role"] == "admin") else {"disabled": {"$ne": True}}
    return await db.users.find(query, {"_id": 0, "password": 0}).sort("name", 1).to_list(5000)


@router.post("")
async def create_user(data: UserCreate, request: Request):
    """Admin invites a user with an initial password."""
    admin = await require_role(["admin"])(request)
    email = data.email.lower()
    if await db.users.find_one({"email": email}):
        raise HTTPException(status_code=400, detail="Email already registered")
    user_doc = {
        "user_id": gen_id("user_"),
        "name": data.name.strip(),
        "email": email,
        "password": hash_password(data.password),
        "role": data.role,
        "picture": None,
        "department": data.department,
        "title": data.title,
        "created_at": now_iso(),
        "invited_by": admin["user_id"],
    }
    await db.users.insert_one(user_doc)
    await log_activity(admin["user_id"], admin["name"], "invited user", "user", user_doc["user_id"], user_doc["name"])
    return public_user(user_doc)


@router.get("/{user_id}")
async def get_user(user_id: str, request: Request):
    await get_current_user(request)
    user = await db.users.find_one({"user_id": user_id}, {"_id": 0, "password": 0})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return user


async def _admin_count() -> int:
    return await db.users.count_documents({"role": "admin", "disabled": {"$ne": True}})


@router.put("/{user_id}")
async def update_user(user_id: str, data: UserUpdate, request: Request):
    current_user = await get_current_user(request)
    is_admin = current_user["role"] == "admin"
    is_self = current_user["user_id"] == user_id
    if not is_admin and not is_self:
        raise HTTPException(status_code=403, detail="Insufficient permissions")

    target = await db.users.find_one({"user_id": user_id}, {"_id": 0})
    if not target:
        raise HTTPException(status_code=404, detail="User not found")

    changes = data.model_dump(exclude_unset=True)
    update_data = {k: v for k, v in changes.items()
                   if k in ("name", "department", "title", "picture", "weekly_capacity_hours") and (v is not None or k != "name")}

    if "role" in changes and changes["role"] and changes["role"] != target["role"]:
        if not is_admin:
            raise HTTPException(status_code=403, detail="Only admins can change roles")
        if target["role"] == "admin" and await _admin_count() <= 1:
            raise HTTPException(status_code=400, detail="Cannot demote the last admin")
        update_data["role"] = changes["role"]

    if changes.get("password"):
        # Users changing their own password must prove they know the current one.
        # Admins resetting someone else's password don't.
        if is_self and target.get("password"):
            if not verify_password(changes.get("current_password") or "", target["password"]):
                raise HTTPException(status_code=400, detail="Current password is incorrect")
        update_data["password"] = hash_password(changes["password"])

    if not update_data:
        raise HTTPException(status_code=400, detail="No valid fields")

    await db.users.update_one({"user_id": user_id}, {"$set": update_data})

    # Keep denormalised names in sync
    if "name" in update_data:
        await db.tasks.update_many({"assigned_to": user_id}, {"$set": {"assigned_to_name": update_data["name"]}})

    if "role" in update_data:
        await log_activity(current_user["user_id"], current_user["name"], f"changed role to {update_data['role']}",
                           "user", user_id, target["name"])
    return await db.users.find_one({"user_id": user_id}, {"_id": 0, "password": 0})


@router.put("/{user_id}/status")
async def set_user_status(user_id: str, request: Request):
    """Deactivate / reactivate an account. Deactivated users can't sign in but their history is kept."""
    admin = await require_role(["admin"])(request)
    body = await request.json()
    disabled = bool(body.get("disabled"))
    if admin["user_id"] == user_id and disabled:
        raise HTTPException(status_code=400, detail="Cannot deactivate yourself")
    target = await db.users.find_one({"user_id": user_id}, {"_id": 0})
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    if disabled and target["role"] == "admin" and await _admin_count() <= 1:
        raise HTTPException(status_code=400, detail="Cannot deactivate the last admin")
    await db.users.update_one({"user_id": user_id}, {"$set": {"disabled": disabled}})
    if disabled:
        await db.user_sessions.delete_many({"user_id": user_id})
    await log_activity(admin["user_id"], admin["name"], "deactivated user" if disabled else "reactivated user",
                       "user", user_id, target["name"])
    return await db.users.find_one({"user_id": user_id}, {"_id": 0, "password": 0})


@router.delete("/{user_id}")
async def delete_user(user_id: str, request: Request):
    admin = await require_role(["admin"])(request)
    if admin["user_id"] == user_id:
        raise HTTPException(status_code=400, detail="Cannot delete yourself")

    user = await db.users.find_one({"user_id": user_id}, {"_id": 0})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if user["role"] == "admin" and await _admin_count() <= 1:
        raise HTTPException(status_code=400, detail="Cannot delete the last admin")

    await db.users.delete_one({"user_id": user_id})
    await db.user_sessions.delete_many({"user_id": user_id})
    # Don't leave work assigned to someone who no longer exists
    await db.tasks.update_many({"assigned_to": user_id}, {"$set": {"assigned_to": None, "assigned_to_name": None}})
    await db.projects.update_many({"team_members": user_id}, {"$pull": {"team_members": user_id}})
    await db.chat_channels.update_many({"type": "project", "members": user_id}, {"$pull": {"members": user_id}})
    await db.notifications.delete_many({"user_id": user_id})
    await log_activity(admin["user_id"], admin["name"], "deleted user", "user", user_id, user["name"])
    return {"message": "User deleted"}


# ─── Comments (shared for projects and tasks) ───

@router.post("/comments")
async def create_comment(data: CommentCreate, request: Request):
    user = await get_current_user(request)
    project = await require_entity_view(user, data.entity_type, data.entity_id)

    comment = {
        "comment_id": gen_id("cmt_"),
        "content": data.content.strip(),
        "entity_type": data.entity_type,
        "entity_id": data.entity_id,
        "user_id": user["user_id"],
        "user_name": user["name"],
        "user_picture": user.get("picture", ""),
        "created_at": now_iso(),
    }
    await db.comments.insert_one(comment)
    comment.pop("_id", None)

    # Notify people involved + anyone @mentioned by name
    notify = set()
    if data.entity_type == "task":
        task = await db.tasks.find_one({"task_id": data.entity_id}, {"_id": 0})
        notify |= {task.get("assigned_to"), task.get("created_by")}
        entity_name, link = task["title"], f"/tasks?task={data.entity_id}"
    else:
        entity_name, link = project.get("name", ""), f"/projects/{data.entity_id}"
    members = await db.users.find({"user_id": {"$in": project.get("team_members", [])}},
                                  {"_id": 0, "user_id": 1, "name": 1}).to_list(1000) if project else []
    mentioned = {m["user_id"] for m in members
                 if re.search(rf"@{re.escape(m['name'])}\b", comment["content"], re.IGNORECASE)}
    notify |= mentioned
    for uid in notify - {user["user_id"], None, "system_ai"}:
        verb = "mentioned you" if uid in mentioned else "commented"
        await create_notification(uid, "comment", "New Comment",
                                  f"{user['name']} {verb} on {entity_name}: {comment['content'][:120]}",
                                  link=link, ref_id=data.entity_id)
    await log_activity(user["user_id"], user["name"], "commented on", data.entity_type, data.entity_id,
                       entity_name, project.get("project_id", "") if project else "")
    return comment


@router.get("/comments/{entity_type}/{entity_id}")
async def list_comments(entity_type: str, entity_id: str, request: Request):
    user = await get_current_user(request)
    await require_entity_view(user, entity_type, entity_id)
    return await db.comments.find(
        {"entity_type": entity_type, "entity_id": entity_id}, {"_id": 0}
    ).sort("created_at", 1).to_list(1000)


@router.delete("/comments/{comment_id}")
async def delete_comment(comment_id: str, request: Request):
    user = await get_current_user(request)
    comment = await db.comments.find_one({"comment_id": comment_id}, {"_id": 0})
    if not comment:
        raise HTTPException(status_code=404, detail="Comment not found")
    if comment["user_id"] != user["user_id"] and user["role"] != "admin":
        raise HTTPException(status_code=403, detail="You can only delete your own comments")
    await db.comments.delete_one({"comment_id": comment_id})
    return {"message": "Comment deleted"}


# ─── Files ───

def _safe_filename(name: str) -> str:
    name = Path(name or "file").name  # drop any directory components
    name = re.sub(r"[^A-Za-z0-9._ -]", "_", name).strip(" .")
    return name[:150] or "file"


@router.post("/files/upload")
async def upload_file(request: Request, file: UploadFile = File(...),
                      entity_type: str = Form(...), entity_id: str = Form(...)):
    user = await get_current_user(request)
    project = await require_entity_view(user, entity_type, entity_id)

    max_bytes = MAX_UPLOAD_MB * 1024 * 1024
    content = await file.read(max_bytes + 1)
    if len(content) > max_bytes:
        raise HTTPException(status_code=413, detail=f"File exceeds {MAX_UPLOAD_MB} MB limit")
    if not content:
        raise HTTPException(status_code=400, detail="File is empty")

    file_id = gen_id("file_")
    original = _safe_filename(file.filename)
    stored = f"{file_id}_{original}"
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    async with aiofiles.open(UPLOAD_DIR / stored, "wb") as f:
        await f.write(content)

    file_doc = {
        "file_id": file_id,
        "original_name": original,
        "stored_name": stored,
        "entity_type": entity_type,
        "entity_id": entity_id,
        "uploaded_by": user["user_id"],
        "uploaded_by_name": user["name"],
        "size": len(content),
        "content_type": file.content_type or "application/octet-stream",
        "created_at": now_iso(),
    }
    await db.files.insert_one(file_doc)
    file_doc.pop("_id", None)
    await log_activity(user["user_id"], user["name"], "uploaded file", entity_type, entity_id, original,
                       project.get("project_id", "") if project else "")
    return file_doc


async def _load_file(user: dict, file_id: str) -> dict:
    doc = await db.files.find_one({"file_id": file_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="File not found")
    await require_entity_view(user, doc["entity_type"], doc["entity_id"])
    return doc


@router.get("/files/download/{file_id}")
async def download_file(file_id: str, request: Request):
    user = await get_current_user(request)
    doc = await _load_file(user, file_id)
    path = UPLOAD_DIR / doc["stored_name"]
    if not path.is_file():
        raise HTTPException(status_code=404, detail="File is missing from storage")
    return FileResponse(path, media_type=doc["content_type"], filename=doc["original_name"])


@router.get("/files/{entity_type}/{entity_id}")
async def list_files(entity_type: str, entity_id: str, request: Request):
    user = await get_current_user(request)
    await require_entity_view(user, entity_type, entity_id)
    return await db.files.find(
        {"entity_type": entity_type, "entity_id": entity_id}, {"_id": 0}
    ).sort("created_at", -1).to_list(500)


@router.delete("/files/{file_id}")
async def delete_file(file_id: str, request: Request):
    user = await get_current_user(request)
    doc = await _load_file(user, file_id)
    if doc["uploaded_by"] != user["user_id"] and user["role"] not in ("admin", "project_manager"):
        raise HTTPException(status_code=403, detail="You can only delete your own files")
    (UPLOAD_DIR / doc["stored_name"]).unlink(missing_ok=True)
    await db.files.delete_one({"file_id": file_id})
    return {"message": "File deleted"}
