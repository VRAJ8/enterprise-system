import database


async def test_first_user_becomes_admin_and_role_cannot_be_self_assigned(client):
    r = await client.post("/api/auth/register", json={"name": "First", "email": "first@example.com", "password": "password123"})
    assert r.json()["user"]["role"] == "admin"

    # Extra "role" field in the payload must be ignored
    r = await client.post("/api/auth/register", json={
        "name": "Mallory", "email": "mallory@example.com", "password": "password123", "role": "admin"})
    assert r.status_code == 200
    assert r.json()["user"]["role"] == "team_member"


async def test_auth_config_reports_first_run(client):
    assert (await client.get("/api/auth/config")).json()["needs_setup"] is True
    await client.post("/api/auth/register", json={"name": "A", "email": "a@example.com", "password": "password123"})
    cfg = (await client.get("/api/auth/config")).json()
    assert cfg["needs_setup"] is False
    assert cfg["google_auth"] is False


async def test_registration_validation(client):
    r = await client.post("/api/auth/register", json={"name": "A", "email": "not-an-email", "password": "password123"})
    assert r.status_code == 422
    r = await client.post("/api/auth/register", json={"name": "A", "email": "a@example.com", "password": "short"})
    assert r.status_code == 422


async def test_duplicate_email_is_case_insensitive(client):
    await client.post("/api/auth/register", json={"name": "A", "email": "a@example.com", "password": "password123"})
    r = await client.post("/api/auth/register", json={"name": "A2", "email": "A@Example.com", "password": "password123"})
    assert r.status_code == 400


async def test_login_case_insensitive_and_wrong_password(client):
    await client.post("/api/auth/register", json={"name": "A", "email": "a@example.com", "password": "password123"})
    assert (await client.post("/api/auth/login", json={"email": "A@EXAMPLE.com", "password": "password123"})).status_code == 200
    assert (await client.post("/api/auth/login", json={"email": "a@example.com", "password": "nope"})).status_code == 401


async def test_me_never_returns_password(ws, client):
    r = await client.get("/api/auth/me", headers=ws.member["headers"])
    assert r.status_code == 200
    assert "password" not in r.json()


async def test_deactivated_user_cannot_use_token_or_login(ws, client):
    r = await client.put(f"/api/users/{ws.member['id']}/status", json={"disabled": True}, headers=ws.admin["headers"])
    assert r.status_code == 200
    assert (await client.get("/api/auth/me", headers=ws.member["headers"])).status_code == 401
    r = await client.post("/api/auth/login", json={"email": "maya@example.com", "password": "password123"})
    assert r.status_code == 401


async def test_google_session_disabled_by_default(client):
    r = await client.post("/api/auth/session", json={"session_id": "x"})
    assert r.status_code == 404


async def test_closed_registration(client, monkeypatch):
    import routes.auth as auth_routes
    await client.post("/api/auth/register", json={"name": "A", "email": "a@example.com", "password": "password123"})
    monkeypatch.setattr(auth_routes, "ALLOW_OPEN_REGISTRATION", False)
    r = await client.post("/api/auth/register", json={"name": "B", "email": "b@example.com", "password": "password123"})
    assert r.status_code == 403
    assert await database.db.users.count_documents({}) == 1
