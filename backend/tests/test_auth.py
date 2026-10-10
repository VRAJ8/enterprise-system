from datetime import UTC, datetime, timedelta

from sqlalchemy import select, update

from app.models import Invitation, Session, User
from tests.conftest import invite, signup


async def test_register_creates_workspace_and_owner(client):
    a = await signup(client, "Jane Doe", workspace_name="Acme Corp")
    assert a.user["workspaces"][0]["role"] == "owner"
    assert a.user["workspaces"][0]["workspace_slug"] == "acme-corp"
    r = await a.get("/api/v1/auth/me")
    assert r.status_code == 200 and r.json()["email"] == "jane.doe@example.com"


async def test_register_requires_workspace_name_without_invite(client):
    r = await client.post(
        "/api/v1/auth/register", json={"name": "A", "email": "a@example.com", "password": "password123"}
    )
    assert r.status_code == 400 and r.json()["code"] == "workspace_name_required"


async def test_register_validation_and_duplicate_email(client):
    r = await client.post(
        "/api/v1/auth/register",
        json={"name": "A", "email": "a@example.com", "password": "short", "workspace_name": "X"},
    )
    assert r.status_code == 422
    await signup(client, "A", "a@example.com")
    r = await client.post(
        "/api/v1/auth/register",
        json={"name": "B", "email": "A@Example.com", "password": "password123", "workspace_name": "Y"},
    )
    assert r.status_code == 409 and r.json()["code"] == "email_taken"


async def test_login_and_wrong_password(client):
    await signup(client, "A", "a@example.com")
    r = await client.post("/api/v1/auth/login", json={"email": "A@EXAMPLE.COM", "password": "password123"})
    assert r.status_code == 200
    r = await client.post("/api/v1/auth/login", json={"email": "a@example.com", "password": "nope-nope"})
    assert r.status_code == 401 and r.json()["code"] == "invalid_credentials"


async def test_protected_routes_need_token(client):
    assert (await client.get("/api/v1/auth/me")).status_code == 401
    r = await client.get("/api/v1/auth/me", headers={"Authorization": "Bearer garbage"})
    assert r.status_code == 401 and r.json()["code"] == "invalid_token"


async def test_refresh_rotates_cookie_and_old_token_stops_working(client):
    await signup(client, "A", "a@example.com")
    old_cookie = client.cookies.get("ph_refresh")
    assert old_cookie
    r = await client.post("/api/v1/auth/refresh")
    assert r.status_code == 200 and r.json()["access_token"]
    new_cookie = client.cookies.get("ph_refresh")
    assert new_cookie and new_cookie != old_cookie

    client.cookies.set("ph_refresh", old_cookie, path="/api/v1/auth")
    r = await client.post("/api/v1/auth/refresh")
    assert r.status_code == 401


async def test_logout_revokes_session(client, db):
    await signup(client, "A", "a@example.com")
    assert (await client.post("/api/v1/auth/logout")).status_code == 200
    assert (await client.post("/api/v1/auth/refresh")).status_code == 401
    sessions = list(await db.scalars(select(Session)))
    assert all(s.revoked_at is not None for s in sessions)


async def test_expired_session_cannot_refresh(client, db):
    await signup(client, "A", "a@example.com")
    await db.execute(update(Session).values(expires_at=datetime.now(UTC) - timedelta(minutes=1)))
    await db.commit()
    assert (await client.post("/api/v1/auth/refresh")).status_code == 401


async def test_update_profile_and_timezone_validation(client):
    a = await signup(client, "A", "a@example.com")
    r = await a.patch("/api/v1/auth/me", {"name": "Alice", "title": "PM", "timezone": "Europe/Berlin"})
    assert r.status_code == 200 and r.json()["name"] == "Alice" and r.json()["timezone"] == "Europe/Berlin"
    r = await a.patch("/api/v1/auth/me", {"timezone": "Mars/Olympus"})
    assert r.status_code == 400


async def test_change_password_requires_current(client):
    a = await signup(client, "A", "a@example.com")
    r = await a.post("/api/v1/auth/change-password", {"current_password": "wrong", "new_password": "newpassword1"})
    assert r.status_code == 400
    r = await a.post(
        "/api/v1/auth/change-password", {"current_password": "password123", "new_password": "newpassword1"}
    )
    assert r.status_code == 200
    r = await client.post("/api/v1/auth/login", json={"email": "a@example.com", "password": "newpassword1"})
    assert r.status_code == 200


async def test_invitation_signup_flow(client, db):
    owner = await signup(client, "Owner", "owner@example.com", workspace_name="Acme")
    wid = owner.user["workspaces"][0]["workspace_id"]
    r = await owner.post(f"/api/v1/workspaces/{wid}/invitations", {"email": "new@example.com", "role": "admin"})
    assert r.status_code == 201
    token = r.json()["invite_url"].rsplit("/", 1)[1]

    look = await client.get("/api/v1/invitations/lookup", params={"token": token})
    assert look.status_code == 200
    assert look.json()["workspace_name"] == "Acme" and look.json()["account_exists"] is False

    # Wrong email can't use the token
    r = await client.post(
        "/api/v1/auth/register",
        json={"name": "X", "email": "other@example.com", "password": "password123", "invite_token": token},
    )
    assert r.status_code == 400

    new = await signup(client, "New", "new@example.com", invite_token=token)
    assert new.user["workspaces"][0]["role"] == "admin"
    # Single use
    inv = await db.scalar(select(Invitation))
    assert inv.accepted_at is not None


async def test_existing_user_accepts_invitation(client):
    owner = await signup(client, "Owner", "owner@example.com", workspace_name="Acme")
    other = await signup(client, "Other", "other@example.com", workspace_name="Other Co")
    wid = owner.user["workspaces"][0]["workspace_id"]
    r = await owner.post(f"/api/v1/workspaces/{wid}/invitations", {"email": "other@example.com"})
    token = r.json()["invite_url"].rsplit("/", 1)[1]
    r = await other.post("/api/v1/invitations/accept", {"token": token})
    assert r.status_code == 200 and r.json()["name"] == "Acme"
    me = (await other.get("/api/v1/auth/me")).json()
    assert {w["workspace_name"] for w in me["workspaces"]} == {"Acme", "Other Co"}


async def test_signup_closed(client, monkeypatch):
    from app.api.v1 import auth as auth_module

    await signup(client, "First", "first@example.com")
    monkeypatch.setattr(auth_module.settings, "allow_signup", False)
    r = await client.post(
        "/api/v1/auth/register",
        json={"name": "B", "email": "b@example.com", "password": "password123", "workspace_name": "B"},
    )
    assert r.status_code == 403 and r.json()["code"] == "signup_closed"


async def test_disabled_user_rejected(client, db):
    a = await signup(client, "A", "a@example.com")
    await db.execute(update(User).values(is_active=False))
    await db.commit()
    assert (await a.get("/api/v1/auth/me")).status_code == 401


async def test_invite_helper_roles(client):
    owner = await signup(client, "Owner", "owner@example.com")
    wid = owner.user["workspaces"][0]["workspace_id"]
    g = await invite(owner, wid, "Guest Person", "guest")
    assert g.user["workspaces"][0]["role"] == "guest"
