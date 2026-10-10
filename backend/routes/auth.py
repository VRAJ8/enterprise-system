import re
import logging
from datetime import datetime, timezone, timedelta
import httpx
from fastapi import APIRouter, HTTPException, Request, Response
from database import db
from models import UserRegister, UserLogin, UserResponse, TokenResponse, gen_id
from auth_utils import hash_password, verify_password, create_token, get_current_user, public_user
from config import ALLOW_OPEN_REGISTRATION, EMERGENT_AUTH_ENABLED
from helpers import now_iso

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/auth", tags=["auth"])


async def find_user_by_email(email: str) -> dict | None:
    email = email.strip()
    user = await db.users.find_one({"email": email.lower()}, {"_id": 0})
    if user:
        return user
    # Legacy accounts may have been stored with mixed case
    return await db.users.find_one(
        {"email": {"$regex": f"^{re.escape(email)}$", "$options": "i"}}, {"_id": 0}
    )


@router.get("/config")
async def auth_config():
    """Public: lets the login page adapt (first-run setup, registration, SSO)."""
    has_users = await db.users.count_documents({}, limit=1) > 0
    return {
        "needs_setup": not has_users,
        "open_registration": ALLOW_OPEN_REGISTRATION or not has_users,
        "google_auth": EMERGENT_AUTH_ENABLED,
    }


@router.post("/register", response_model=TokenResponse)
async def register(data: UserRegister):
    is_first_user = await db.users.count_documents({}, limit=1) == 0
    if not is_first_user and not ALLOW_OPEN_REGISTRATION:
        raise HTTPException(status_code=403, detail="Registration is closed. Ask an administrator for an invite.")

    email = data.email.lower()
    if await find_user_by_email(email):
        raise HTTPException(status_code=400, detail="Email already registered")

    # Roles are never self-assigned: the first account bootstraps the workspace as admin,
    # everyone else starts as a team member and can be promoted by an admin.
    role = "admin" if is_first_user else "team_member"

    user_id = gen_id("user_")
    now = now_iso()
    user_doc = {
        "user_id": user_id,
        "name": data.name.strip(),
        "email": email,
        "password": hash_password(data.password),
        "role": role,
        "picture": None,
        "department": None,
        "created_at": now,
    }
    await db.users.insert_one(user_doc)

    token = create_token(user_id, email, role, user_doc["name"])
    return TokenResponse(access_token=token, user=UserResponse(**user_doc))


@router.post("/login", response_model=TokenResponse)
async def login(data: UserLogin):
    user = await find_user_by_email(data.email)
    if not user or not verify_password(data.password, user.get("password", "")):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    if user.get("disabled"):
        raise HTTPException(status_code=401, detail="Account is deactivated")

    await db.users.update_one({"user_id": user["user_id"]}, {"$set": {"last_login_at": now_iso()}})
    token = create_token(user["user_id"], user["email"], user["role"], user["name"])
    return TokenResponse(access_token=token, user=UserResponse(**user))


@router.post("/session")
async def process_session(request: Request, response: Response):
    """Process Google OAuth session_id from Emergent Auth (only available on the Emergent platform)."""
    if not EMERGENT_AUTH_ENABLED:
        raise HTTPException(status_code=404, detail="Google sign-in is not enabled")

    body = await request.json()
    session_id = body.get("session_id")
    if not session_id:
        raise HTTPException(status_code=400, detail="session_id required")

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(
                "https://demobackend.emergentagent.com/auth/v1/env/oauth/session-data",
                headers={"X-Session-ID": session_id},
            )
    except httpx.HTTPError as e:
        logger.error("OAuth session error: %s", e)
        raise HTTPException(status_code=503, detail="Auth service unavailable")
    if resp.status_code != 200:
        raise HTTPException(status_code=401, detail="Invalid session")
    session_data = resp.json()

    email = session_data["email"].lower()
    name = session_data.get("name", email.split("@")[0])
    picture = session_data.get("picture", "")
    session_token = session_data.get("session_token", "")

    existing = await find_user_by_email(email)
    if existing:
        if existing.get("disabled"):
            raise HTTPException(status_code=401, detail="Account is deactivated")
        user_id = existing["user_id"]
        await db.users.update_one(
            {"user_id": user_id},
            {"$set": {"name": name, "picture": picture, "last_login_at": now_iso()}}
        )
        role = existing["role"]
    else:
        is_first_user = await db.users.count_documents({}, limit=1) == 0
        if not is_first_user and not ALLOW_OPEN_REGISTRATION:
            raise HTTPException(status_code=403, detail="Registration is closed. Ask an administrator for an invite.")
        user_id = gen_id("user_")
        role = "admin" if is_first_user else "team_member"
        await db.users.insert_one({
            "user_id": user_id,
            "name": name,
            "email": email,
            "password": "",
            "role": role,
            "picture": picture,
            "department": None,
            "created_at": now_iso(),
        })

    await db.user_sessions.insert_one({
        "user_id": user_id,
        "session_token": session_token,
        "expires_at": (datetime.now(timezone.utc) + timedelta(days=7)).isoformat(),
        "created_at": now_iso(),
    })

    response.set_cookie(
        key="session_token",
        value=session_token,
        httponly=True,
        secure=True,
        samesite="none",
        path="/",
        max_age=7 * 24 * 3600,
    )

    token = create_token(user_id, email, role, name)
    user = await db.users.find_one({"user_id": user_id}, {"_id": 0})
    return {"access_token": token, "token_type": "bearer", "user": public_user(user)}


@router.get("/me")
async def get_me(request: Request):
    user = await get_current_user(request)
    return public_user(user)


@router.post("/logout")
async def logout(request: Request, response: Response):
    session_token = request.cookies.get("session_token")
    if session_token:
        await db.user_sessions.delete_one({"session_token": session_token})
    response.delete_cookie("session_token", path="/", samesite="none", secure=True)
    return {"message": "Logged out"}
