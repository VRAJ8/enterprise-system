"""Sign up, sign in, token refresh (rotating httpOnly cookie), profile and sessions."""

import uuid
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Request, Response
from sqlalchemy import func, select, update

from app.core.config import settings
from app.core.deps import DB, CurrentUser
from app.core.errors import BadRequest, Conflict, Forbidden, NotFound, Unauthorized
from app.core.security import (
    create_access_token,
    hash_password,
    hash_token,
    needs_rehash,
    new_opaque_token,
    verify_password,
)
from app.models import Invitation, Session, User, Workspace, WorkspaceMember, WorkspaceRole
from app.schemas.auth import (
    ChangePasswordIn,
    LoginIn,
    MembershipOut,
    MeOut,
    MeUpdate,
    RegisterIn,
    SessionOut,
    TokenOut,
)
from app.schemas.common import Ok
from app.services.workspaces import create_workspace, pick_avatar_color

router = APIRouter(prefix="/auth", tags=["auth"])

REFRESH_COOKIE = "ph_refresh"
COOKIE_PATH = "/api/v1/auth"


async def build_me(db, user: User) -> MeOut:
    rows = (
        await db.execute(
            select(Workspace, WorkspaceMember.role)
            .join(WorkspaceMember, WorkspaceMember.workspace_id == Workspace.id)
            .where(WorkspaceMember.user_id == user.id, WorkspaceMember.deactivated_at.is_(None))
            .order_by(Workspace.name)
        )
    ).all()
    return MeOut(
        id=user.id,
        name=user.name,
        email=user.email,
        avatar_color=user.avatar_color,
        title=user.title,
        timezone=user.timezone,
        created_at=user.created_at,
        workspaces=[
            MembershipOut(workspace_id=w.id, workspace_name=w.name, workspace_slug=w.slug, role=role)
            for w, role in rows
        ],
    )


def _set_refresh_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        REFRESH_COOKIE,
        token,
        max_age=settings.refresh_token_days * 86400,
        httponly=True,
        secure=settings.cookie_secure,
        samesite=settings.cookie_samesite,
        path=COOKIE_PATH,
    )


def _clear_refresh_cookie(response: Response) -> None:
    response.delete_cookie(
        REFRESH_COOKIE, path=COOKIE_PATH, secure=settings.cookie_secure, samesite=settings.cookie_samesite
    )


async def _start_session(db, request: Request, response: Response, user: User) -> TokenOut:
    refresh = new_opaque_token()
    session = Session(
        id=uuid.uuid4(),
        user_id=user.id,
        refresh_token_hash=hash_token(refresh),
        user_agent=(request.headers.get("user-agent") or "")[:400] or None,
        ip=request.client.host if request.client else None,
        expires_at=datetime.now(UTC) + timedelta(days=settings.refresh_token_days),
    )
    db.add(session)
    await db.commit()
    _set_refresh_cookie(response, refresh)
    access, expires_in = create_access_token(user.id, session.id)
    return TokenOut(access_token=access, expires_in=expires_in, user=await build_me(db, user))


async def _valid_invitation(db, token: str) -> Invitation:
    inv = await db.scalar(select(Invitation).where(Invitation.token_hash == hash_token(token)))
    if inv is None:
        raise NotFound("Invitation not found")
    if inv.accepted_at is not None:
        raise Conflict("This invitation has already been used", code="invitation_used")
    if inv.expires_at < datetime.now(UTC):
        raise BadRequest("This invitation has expired. Ask for a new one.", code="invitation_expired")
    return inv


async def join_workspace(db, user: User, workspace_id: uuid.UUID, role: WorkspaceRole) -> None:
    """Add (or reactivate) a workspace membership."""
    existing = await db.get(WorkspaceMember, (workspace_id, user.id))
    if existing:
        existing.deactivated_at = None
        existing.role = role
    else:
        db.add(WorkspaceMember(workspace_id=workspace_id, user_id=user.id, role=role))


@router.post("/register", response_model=TokenOut, status_code=201)
async def register(data: RegisterIn, request: Request, response: Response, db: DB):
    email = data.email.lower()
    if await db.scalar(select(User.id).where(User.email == email)):
        raise Conflict("An account with this email already exists", code="email_taken")

    invitation = await _valid_invitation(db, data.invite_token) if data.invite_token else None
    if invitation and invitation.email.lower() != email:
        raise BadRequest("This invitation was sent to a different email address", code="invitation_email_mismatch")

    if invitation is None:
        is_first_user = (await db.scalar(select(func.count()).select_from(User))) == 0
        if not settings.allow_signup and not is_first_user:
            raise Forbidden("Sign-up is invite-only. Ask a workspace admin for an invitation.", code="signup_closed")
        if not data.workspace_name:
            raise BadRequest("Name your workspace to get started", code="workspace_name_required")

    user = User(
        id=uuid.uuid4(),
        email=email,
        name=data.name,
        password_hash=hash_password(data.password),
        avatar_color=pick_avatar_color(email),
        last_login_at=datetime.now(UTC),
    )
    db.add(user)
    await db.flush()

    if invitation:
        await join_workspace(db, user, invitation.workspace_id, invitation.role)
        invitation.accepted_at = datetime.now(UTC)
    else:
        await create_workspace(db, owner=user, name=data.workspace_name)

    return await _start_session(db, request, response, user)


@router.post("/login", response_model=TokenOut)
async def login(data: LoginIn, request: Request, response: Response, db: DB):
    user = await db.scalar(select(User).where(User.email == data.email.lower()))
    if user is None or not verify_password(data.password, user.password_hash):
        raise Unauthorized("Incorrect email or password", code="invalid_credentials")
    if not user.is_active:
        raise Unauthorized("This account has been disabled", code="account_disabled")
    if needs_rehash(user.password_hash):
        user.password_hash = hash_password(data.password)
    user.last_login_at = datetime.now(UTC)
    return await _start_session(db, request, response, user)


@router.post("/refresh", response_model=TokenOut)
async def refresh(request: Request, response: Response, db: DB):
    token = request.cookies.get(REFRESH_COOKIE)
    if not token:
        raise Unauthorized("No session", code="no_session")
    session = await db.scalar(select(Session).where(Session.refresh_token_hash == hash_token(token)))
    now = datetime.now(UTC)
    if session is None or session.revoked_at is not None or session.expires_at < now:
        _clear_refresh_cookie(response)
        raise Unauthorized("Session expired. Please sign in again.", code="session_expired")
    user = await db.get(User, session.user_id)
    if user is None or not user.is_active:
        raise Unauthorized("Account not found or disabled", code="session_expired")

    # Rotate: the old refresh token stops working immediately.
    new_token = new_opaque_token()
    session.refresh_token_hash = hash_token(new_token)
    session.last_used_at = now
    await db.commit()
    _set_refresh_cookie(response, new_token)
    access, expires_in = create_access_token(user.id, session.id)
    return TokenOut(access_token=access, expires_in=expires_in, user=await build_me(db, user))


@router.post("/logout", response_model=Ok)
async def logout(request: Request, response: Response, db: DB):
    token = request.cookies.get(REFRESH_COOKIE)
    if token:
        await db.execute(
            update(Session)
            .where(Session.refresh_token_hash == hash_token(token), Session.revoked_at.is_(None))
            .values(revoked_at=datetime.now(UTC))
        )
        await db.commit()
    _clear_refresh_cookie(response)
    return Ok()


@router.get("/me", response_model=MeOut)
async def me(user: CurrentUser, db: DB):
    return await build_me(db, user)


@router.patch("/me", response_model=MeOut)
async def update_me(data: MeUpdate, user: CurrentUser, db: DB):
    changes = data.model_dump(exclude_unset=True)
    if "timezone" in changes and changes["timezone"]:
        from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

        try:
            ZoneInfo(changes["timezone"])
        except (ZoneInfoNotFoundError, ValueError):
            raise BadRequest("Unknown timezone", code="invalid_timezone") from None
    for key, value in changes.items():
        if value is not None or key == "title":
            setattr(user, key, value)
    await db.commit()
    return await build_me(db, user)


@router.post("/change-password", response_model=Ok)
async def change_password(data: ChangePasswordIn, request: Request, user: CurrentUser, db: DB):
    if not verify_password(data.current_password, user.password_hash):
        raise BadRequest("Current password is incorrect", code="wrong_password")
    user.password_hash = hash_password(data.new_password)
    # Sign out every other device
    current_token = request.cookies.get(REFRESH_COOKIE)
    keep = hash_token(current_token) if current_token else None
    await db.execute(
        update(Session)
        .where(Session.user_id == user.id, Session.revoked_at.is_(None), Session.refresh_token_hash != (keep or ""))
        .values(revoked_at=datetime.now(UTC))
    )
    await db.commit()
    return Ok()


@router.get("/sessions", response_model=list[SessionOut])
async def list_sessions(request: Request, user: CurrentUser, db: DB):
    current_token = request.cookies.get(REFRESH_COOKIE)
    current_hash = hash_token(current_token) if current_token else None
    sessions = await db.scalars(
        select(Session)
        .where(Session.user_id == user.id, Session.revoked_at.is_(None), Session.expires_at > datetime.now(UTC))
        .order_by(Session.last_used_at.desc())
    )
    return [
        SessionOut(
            id=s.id,
            user_agent=s.user_agent,
            ip=s.ip,
            created_at=s.created_at,
            last_used_at=s.last_used_at,
            current=s.refresh_token_hash == current_hash,
        )
        for s in sessions
    ]


@router.delete("/sessions/{session_id}", response_model=Ok)
async def revoke_session(session_id: uuid.UUID, user: CurrentUser, db: DB):
    session = await db.get(Session, session_id)
    if session is None or session.user_id != user.id:
        raise NotFound("Session not found")
    session.revoked_at = datetime.now(UTC)
    await db.commit()
    return Ok()
