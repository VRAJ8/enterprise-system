from fastapi import APIRouter, HTTPException, Request, Response
from datetime import datetime, timezone, timedelta
from database import db
from models import UserRegister, UserLogin, UserResponse, TokenResponse, gen_id
from auth_utils import hash_password, verify_password, create_token, get_current_user
import requests
import logging

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.post("/register", response_model=TokenResponse)
async def register(data: UserRegister):
    existing = await db.users.find_one({"email": data.email}, {"_id": 0})
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered")

    user_id = gen_id("user_")
    now = datetime.now(timezone.utc).isoformat()
    user_doc = {
        "user_id": user_id,
        "name": data.name,
        "email": data.email,
        "password": hash_password(data.password),
        "role": data.role,
        "picture": None,
        "department": None,
        "created_at": now,
    }
    await db.users.insert_one(user_doc)

    token = create_token(user_id, data.email, data.role, data.name)
    user_resp = UserResponse(
        user_id=user_id, name=data.name, email=data.email,
        role=data.role, created_at=now
    )
    return TokenResponse(access_token=token, user=user_resp)


@router.post("/login", response_model=TokenResponse)
async def login(data: UserLogin):
    user = await db.users.find_one({"email": data.email}, {"_id": 0})
    if not user:
        raise HTTPException(status_code=401, detail="Invalid credentials")
    if not verify_password(data.password, user["password"]):
        raise HTTPException(status_code=401, detail="Invalid credentials")

    token = create_token(user["user_id"], user["email"], user["role"], user["name"])
    user_resp = UserResponse(**{k: user.get(k) for k in UserResponse.model_fields})
    return TokenResponse(access_token=token, user=user_resp)


@router.post("/session")
async def process_session(request: Request, response: Response):
    """Process Google OAuth session_id from Emergent Auth"""
    body = await request.json()
    session_id = body.get("session_id")
    if not session_id:
        raise HTTPException(status_code=400, detail="session_id required")

    # REMINDER: DO NOT HARDCODE THE URL, OR ADD ANY FALLBACKS OR REDIRECT URLS, THIS BREAKS THE AUTH
    try:
        resp = requests.get(
            "https://demobackend.emergentagent.com/auth/v1/env/oauth/session-data",
            headers={"X-Session-ID": session_id}
        )
        if resp.status_code != 200:
            raise HTTPException(status_code=401, detail="Invalid session")
        session_data = resp.json()
    except requests.RequestException as e:
        logger.error(f"OAuth session error: {e}")
        raise HTTPException(status_code=500, detail="Auth service unavailable")

    email = session_data["email"]
    name = session_data.get("name", email.split("@")[0])
    picture = session_data.get("picture", "")
    session_token = session_data.get("session_token", "")

    # Upsert user
    existing = await db.users.find_one({"email": email}, {"_id": 0})
    if existing:
        user_id = existing["user_id"]
        await db.users.update_one(
            {"user_id": user_id},
            {"$set": {"name": name, "picture": picture}}
        )
        role = existing["role"]
    else:
        user_id = gen_id("user_")
        role = "team_member"
        await db.users.insert_one({
            "user_id": user_id,
            "name": name,
            "email": email,
            "password": "",
            "role": role,
            "picture": picture,
            "department": None,
            "created_at": datetime.now(timezone.utc).isoformat(),
        })

    # Store session
    await db.user_sessions.insert_one({
        "user_id": user_id,
        "session_token": session_token,
        "expires_at": (datetime.now(timezone.utc) + timedelta(days=7)).isoformat(),
        "created_at": datetime.now(timezone.utc).isoformat(),
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
    return {
        "access_token": token,
        "token_type": "bearer",
        "user": {
            "user_id": user_id, "name": name, "email": email,
            "role": role, "picture": picture, "created_at": datetime.now(timezone.utc).isoformat()
        }
    }


@router.get("/me")
async def get_me(request: Request):
    user = await get_current_user(request)
    return {k: v for k, v in user.items() if k != "password"}


@router.post("/logout")
async def logout(request: Request, response: Response):
    session_token = request.cookies.get("session_token")
    if session_token:
        await db.user_sessions.delete_one({"session_token": session_token})
    response.delete_cookie("session_token", path="/", samesite="none", secure=True)
    return {"message": "Logged out"}
