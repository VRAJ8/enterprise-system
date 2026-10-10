from datetime import date, timedelta
import database


async def make_project(client, owner, **extra):
    body = {"name": "Website Relaunch", "description": "Q3 relaunch", **extra}
    r = await client.post("/api/projects", json=body, headers=owner["headers"])
    assert r.status_code == 200, r.text
    return r.json()


async def make_task(client, owner, project_id, **extra):
    r = await client.post("/api/tasks", json={"title": "Design homepage", "project_id": project_id, **extra},
                          headers=owner["headers"])
    assert r.status_code == 200, r.text
    return r.json()


async def test_team_member_cannot_create_project(ws, client):
    r = await client.post("/api/projects", json={"name": "X"}, headers=ws.member["headers"])
    assert r.status_code == 403


async def test_project_visibility_is_scoped(ws, client):
    p = await make_project(client, ws.pm, team_members=[ws.member["id"]])
    pid = p["project_id"]

    assert (await client.get(f"/api/projects/{pid}", headers=ws.member["headers"])).status_code == 200
    assert (await client.get(f"/api/projects/{pid}", headers=ws.admin["headers"])).status_code == 200
    assert (await client.get(f"/api/projects/{pid}", headers=ws.outsider["headers"])).status_code == 404
    assert (await client.get(f"/api/projects/{pid}/milestones", headers=ws.outsider["headers"])).status_code == 404

    listed = (await client.get("/api/projects", headers=ws.outsider["headers"])).json()
    assert listed == []


async def test_pm_cannot_manage_someone_elses_project(ws, client):
    other_pm = await ws.user("Petra", "project_manager")
    p = await make_project(client, ws.pm)
    r = await client.put(f"/api/projects/{p['project_id']}", json={"name": "Hijacked"}, headers=other_pm["headers"])
    assert r.status_code == 404
    r = await client.delete(f"/api/projects/{p['project_id']}", headers=other_pm["headers"])
    assert r.status_code == 404


async def test_invalid_enums_and_dates_rejected(ws, client):
    r = await client.post("/api/projects", json={"name": "X", "priority": "urgent"}, headers=ws.pm["headers"])
    assert r.status_code == 422
    r = await client.post("/api/projects", json={"name": "X", "end_date": "31/12/2026"}, headers=ws.pm["headers"])
    assert r.status_code == 422
    r = await client.post("/api/projects", json={"name": "X", "start_date": "2026-05-01", "end_date": "2026-04-01"},
                          headers=ws.pm["headers"])
    assert r.status_code == 400


async def test_update_team_syncs_chat_channel_and_notifies(ws, client):
    p = await make_project(client, ws.pm)
    pid = p["project_id"]
    r = await client.put(f"/api/projects/{pid}", json={"team_members": [ws.member["id"]]}, headers=ws.pm["headers"])
    assert r.status_code == 200
    # Owner always stays on the team
    assert set(r.json()["team_members"]) == {ws.pm["id"], ws.member["id"]}
    channel = await database.db.chat_channels.find_one({"channel_id": f"proj_{pid}"})
    assert set(channel["members"]) == {ws.pm["id"], ws.member["id"]}
    notifs = (await client.get("/api/notifications", headers=ws.member["headers"])).json()
    assert any(n["type"] == "project_added" for n in notifs)


async def test_assigning_outsider_adds_them_to_team(ws, client):
    p = await make_project(client, ws.pm)
    t = await make_task(client, ws.pm, p["project_id"], assigned_to=ws.outsider["id"])
    assert t["assigned_to_name"] == "Oscar"
    proj = (await client.get(f"/api/projects/{p['project_id']}", headers=ws.outsider["headers"])).json()
    assert ws.outsider["id"] in proj["team_members"]


async def test_team_member_can_only_update_progress_of_own_tasks(ws, client):
    p = await make_project(client, ws.pm, team_members=[ws.member["id"]])
    mine = await make_task(client, ws.pm, p["project_id"], assigned_to=ws.member["id"])
    theirs = await make_task(client, ws.pm, p["project_id"], title="Other")

    r = await client.put(f"/api/tasks/{mine['task_id']}", json={"status": "in_progress"}, headers=ws.member["headers"])
    assert r.status_code == 200 and r.json()["status"] == "in_progress"

    r = await client.put(f"/api/tasks/{mine['task_id']}", json={"title": "Renamed"}, headers=ws.member["headers"])
    assert r.status_code == 403

    r = await client.put(f"/api/tasks/{theirs['task_id']}", json={"status": "completed"}, headers=ws.member["headers"])
    assert r.status_code == 403

    r = await client.put(f"/api/tasks/{mine['task_id']}", json={"status": "done"}, headers=ws.member["headers"])
    assert r.status_code == 422


async def test_outsider_cannot_see_or_touch_tasks(ws, client):
    p = await make_project(client, ws.pm)
    t = await make_task(client, ws.pm, p["project_id"])
    assert (await client.get(f"/api/tasks/{t['task_id']}", headers=ws.outsider["headers"])).status_code == 404
    assert (await client.put(f"/api/tasks/{t['task_id']}", json={"status": "completed"},
                             headers=ws.outsider["headers"])).status_code == 404
    assert (await client.get("/api/tasks", headers=ws.outsider["headers"])).json() == []
    assert (await client.delete(f"/api/tasks/{t['task_id']}", headers=ws.outsider["headers"])).status_code == 404


async def test_team_member_cannot_delete_tasks(ws, client):
    p = await make_project(client, ws.pm, team_members=[ws.member["id"]])
    t = await make_task(client, ws.pm, p["project_id"], assigned_to=ws.member["id"])
    assert (await client.delete(f"/api/tasks/{t['task_id']}", headers=ws.member["headers"])).status_code == 403


async def test_completion_timestamp_and_unassign(ws, client):
    p = await make_project(client, ws.pm)
    t = await make_task(client, ws.pm, p["project_id"], assigned_to=ws.member["id"])
    r = await client.put(f"/api/tasks/{t['task_id']}", json={"status": "completed"}, headers=ws.pm["headers"])
    assert r.json()["completed_at"]
    r = await client.put(f"/api/tasks/{t['task_id']}", json={"status": "todo", "assigned_to": None},
                         headers=ws.pm["headers"])
    assert r.json()["completed_at"] is None
    assert r.json()["assigned_to"] is None


async def test_overdue_filter_my_work_and_project_health(ws, client):
    today = date.today()
    p = await make_project(client, ws.pm, team_members=[ws.member["id"]],
                           start_date=(today - timedelta(days=20)).isoformat(),
                           end_date=(today + timedelta(days=10)).isoformat())
    late = await make_task(client, ws.pm, p["project_id"], assigned_to=ws.member["id"],
                           due_date=(today - timedelta(days=1)).isoformat())
    await make_task(client, ws.pm, p["project_id"], title="Due today", assigned_to=ws.member["id"],
                    due_date=today.isoformat())

    overdue = (await client.get("/api/tasks", params={"due": "overdue"}, headers=ws.pm["headers"])).json()
    assert [t["task_id"] for t in overdue] == [late["task_id"]]
    assert overdue[0]["overdue"] is True

    work = (await client.get("/api/tasks/my-work", headers=ws.member["headers"])).json()
    assert len(work["groups"]["overdue"]) == 1
    assert len(work["groups"]["today"]) == 1

    proj = (await client.get(f"/api/projects/{p['project_id']}", headers=ws.pm["headers"])).json()
    # 0% done with two-thirds of the schedule gone → off track
    assert proj["health"] == "off_track"
    assert proj["task_stats"]["overdue"] == 1


async def test_delete_project_cleans_up(ws, client):
    p = await make_project(client, ws.pm)
    t = await make_task(client, ws.pm, p["project_id"])
    await client.post("/api/users/comments", json={"content": "hi", "entity_type": "task", "entity_id": t["task_id"]},
                      headers=ws.pm["headers"])
    assert (await client.delete(f"/api/projects/{p['project_id']}", headers=ws.pm["headers"])).status_code == 200
    assert await database.db.tasks.count_documents({}) == 0
    assert await database.db.comments.count_documents({}) == 0
    assert await database.db.chat_channels.count_documents({}) == 0


async def test_my_work_review_queue_for_managers(ws, client):
    p = await make_project(client, ws.pm, team_members=[ws.member["id"]])
    t = await make_task(client, ws.pm, p["project_id"], assigned_to=ws.member["id"])
    await client.put(f"/api/tasks/{t['task_id']}", json={"status": "in_review"}, headers=ws.member["headers"])
    pm_work = (await client.get("/api/tasks/my-work", headers=ws.pm["headers"])).json()
    assert [x["task_id"] for x in pm_work["groups"]["review"]] == [t["task_id"]]
    member_work = (await client.get("/api/tasks/my-work", headers=ws.member["headers"])).json()
    assert member_work["groups"]["review"] == []
