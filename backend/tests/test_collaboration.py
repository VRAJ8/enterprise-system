import database
from tests.test_projects_tasks import make_project, make_task


async def test_chat_requires_membership(ws, client):
    p = await make_project(client, ws.pm, team_members=[ws.member["id"]])
    channel = f"proj_{p['project_id']}"

    r = await client.post("/api/chat/messages", json={"channel_id": channel, "content": "hello"},
                          headers=ws.member["headers"])
    assert r.status_code == 200
    assert (await client.get(f"/api/chat/messages/{channel}", headers=ws.outsider["headers"])).status_code == 404
    r = await client.post("/api/chat/messages", json={"channel_id": channel, "content": "spam"},
                          headers=ws.outsider["headers"])
    assert r.status_code == 404


async def test_admin_cannot_read_private_dms(ws, client):
    dm = (await client.post(f"/api/chat/dm/{ws.outsider['id']}", headers=ws.member["headers"])).json()
    await client.post("/api/chat/messages", json={"channel_id": dm["channel_id"], "content": "private"},
                      headers=ws.member["headers"])
    assert (await client.get(f"/api/chat/messages/{dm['channel_id']}", headers=ws.admin["headers"])).status_code == 404
    msgs = (await client.get(f"/api/chat/messages/{dm['channel_id']}", headers=ws.outsider["headers"])).json()
    assert msgs[0]["content"] == "private"


async def test_unread_counts(ws, client):
    p = await make_project(client, ws.pm, team_members=[ws.member["id"]])
    channel = f"proj_{p['project_id']}"
    await client.post("/api/chat/messages", json={"channel_id": channel, "content": "one"}, headers=ws.pm["headers"])
    chans = (await client.get("/api/chat/channels", headers=ws.member["headers"])).json()
    assert chans[0]["unread_count"] == 1
    await client.get(f"/api/chat/messages/{channel}", headers=ws.member["headers"])
    chans = (await client.get("/api/chat/channels", headers=ws.member["headers"])).json()
    assert chans[0]["unread_count"] == 0


async def test_comments_are_access_checked_and_mentions_notify(ws, client):
    p = await make_project(client, ws.pm, team_members=[ws.member["id"]])
    t = await make_task(client, ws.pm, p["project_id"])

    r = await client.post("/api/users/comments",
                          json={"content": "@Maya can you review?", "entity_type": "task", "entity_id": t["task_id"]},
                          headers=ws.pm["headers"])
    assert r.status_code == 200
    notifs = (await client.get("/api/notifications", headers=ws.member["headers"])).json()
    assert any("mentioned you" in n["message"] for n in notifs)

    assert (await client.get(f"/api/users/comments/task/{t['task_id']}", headers=ws.outsider["headers"])).status_code == 404
    r = await client.post("/api/users/comments",
                          json={"content": "x", "entity_type": "project", "entity_id": p["project_id"]},
                          headers=ws.outsider["headers"])
    assert r.status_code == 404


async def test_file_upload_download_and_sanitised_name(ws, client, tmp_path, monkeypatch):
    import routes.users as users_routes
    monkeypatch.setattr(users_routes, "UPLOAD_DIR", tmp_path)
    p = await make_project(client, ws.pm, team_members=[ws.member["id"]])

    r = await client.post("/api/users/files/upload",
                          data={"entity_type": "project", "entity_id": p["project_id"]},
                          files={"file": ("../../etc/passwd", b"hello", "text/plain")},
                          headers=ws.member["headers"])
    assert r.status_code == 200, r.text
    f = r.json()
    assert f["original_name"] == "passwd"
    assert (tmp_path / f["stored_name"]).read_bytes() == b"hello"

    r = await client.get(f"/api/users/files/download/{f['file_id']}", headers=ws.member["headers"])
    assert r.status_code == 200 and r.content == b"hello"
    r = await client.get(f"/api/users/files/download/{f['file_id']}", headers=ws.outsider["headers"])
    assert r.status_code == 404


async def test_upload_size_limit(ws, client, tmp_path, monkeypatch):
    import routes.users as users_routes
    monkeypatch.setattr(users_routes, "UPLOAD_DIR", tmp_path)
    monkeypatch.setattr(users_routes, "MAX_UPLOAD_MB", 0)
    p = await make_project(client, ws.pm)
    r = await client.post("/api/users/files/upload",
                          data={"entity_type": "project", "entity_id": p["project_id"]},
                          files={"file": ("big.bin", b"x" * 10, "application/octet-stream")},
                          headers=ws.pm["headers"])
    assert r.status_code == 413


async def test_dashboard_is_scoped(ws, client):
    await make_project(client, ws.pm)
    stats = (await client.get("/api/dashboard/stats", headers=ws.outsider["headers"])).json()
    assert stats["total_projects"] == 0
    assert "total_users" not in stats
    charts = (await client.get("/api/dashboard/charts", headers=ws.outsider["headers"])).json()
    assert sum(s["value"] for s in charts["project_statuses"]) == 0
    activity = (await client.get("/api/dashboard/activity", headers=ws.outsider["headers"])).json()
    assert activity == []


async def test_workload(ws, client):
    p = await make_project(client, ws.pm, team_members=[ws.member["id"]])
    await make_task(client, ws.pm, p["project_id"], assigned_to=ws.member["id"], estimate_hours=30)
    await make_task(client, ws.pm, p["project_id"], assigned_to=ws.member["id"], estimate_hours=20)
    rows = (await client.get("/api/dashboard/workload", headers=ws.pm["headers"])).json()
    maya = next(r for r in rows if r["user_id"] == ws.member["id"])
    assert maya["estimated_hours"] == 50
    assert maya["status"] == "overloaded"
    assert (await client.get("/api/dashboard/workload", headers=ws.member["headers"])).json() == []


async def test_user_admin_rules(ws, client):
    # Non-admins can't change roles, even their own
    r = await client.put(f"/api/users/{ws.member['id']}", json={"role": "admin"}, headers=ws.member["headers"])
    assert r.status_code == 403
    # Self password change needs the current password
    r = await client.put(f"/api/users/{ws.member['id']}", json={"password": "newpassword1"}, headers=ws.member["headers"])
    assert r.status_code == 400
    r = await client.put(f"/api/users/{ws.member['id']}",
                         json={"password": "newpassword1", "current_password": "password123"},
                         headers=ws.member["headers"])
    assert r.status_code == 200
    # Last admin is protected
    r = await client.put(f"/api/users/{ws.admin['id']}", json={"role": "team_member"}, headers=ws.admin["headers"])
    assert r.status_code == 400


async def test_deleting_user_unassigns_their_tasks(ws, client):
    p = await make_project(client, ws.pm, team_members=[ws.member["id"]])
    t = await make_task(client, ws.pm, p["project_id"], assigned_to=ws.member["id"])
    assert (await client.delete(f"/api/users/{ws.member['id']}", headers=ws.admin["headers"])).status_code == 200
    task = await database.db.tasks.find_one({"task_id": t["task_id"]})
    assert task["assigned_to"] is None
    proj = await database.db.projects.find_one({"project_id": p["project_id"]})
    assert ws.member["id"] not in proj["team_members"]


async def test_admin_can_invite_users(ws, client):
    r = await client.post("/api/users", json={"name": "Nina", "email": "nina@example.com", "password": "password123",
                                              "role": "project_manager"}, headers=ws.admin["headers"])
    assert r.status_code == 200 and r.json()["role"] == "project_manager"
    r = await client.post("/api/users", json={"name": "X", "email": "x@example.com", "password": "password123"},
                          headers=ws.pm["headers"])
    assert r.status_code == 403
