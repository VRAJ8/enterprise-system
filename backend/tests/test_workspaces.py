from sqlalchemy import select

from app.models import Task
from tests.conftest import signup
from tests.factories import make_project, make_task


async def test_list_and_get_workspace(team):
    ws = (await team.member.get("/api/v1/workspaces")).json()
    assert len(ws) == 1 and ws[0]["role"] == "member" and ws[0]["member_count"] == 5
    r = await team.member.get(f"/api/v1/workspaces/{team.workspace_id}")
    assert r.status_code == 200


async def test_outsider_cannot_see_workspace(team, client):
    outsider = await signup(client, "Out Sider", workspace_name="Elsewhere")
    assert (await outsider.get(f"/api/v1/workspaces/{team.workspace_id}")).status_code == 404
    assert (await outsider.get(f"/api/v1/workspaces/{team.workspace_id}/members")).status_code == 404


async def test_only_admins_rename_workspace(team):
    url = f"/api/v1/workspaces/{team.workspace_id}"
    assert (await team.member.patch(url, {"name": "Nope"})).status_code == 403
    r = await team.admin.patch(url, {"name": "Acme Inc", "slug": "acme-inc"})
    assert r.status_code == 200 and r.json()["slug"] == "acme-inc"


async def test_create_second_workspace(team):
    r = await team.member.post("/api/v1/workspaces", {"name": "Side Project"})
    assert r.status_code == 201 and r.json()["role"] == "owner"
    assert len((await team.member.get("/api/v1/workspaces")).json()) == 2


async def test_role_changes_rules(team):
    base = f"/api/v1/workspaces/{team.workspace_id}/members"
    # members can't change roles
    assert (await team.member.patch(f"{base}/{team.member2.id}", {"role": "admin"})).status_code == 403
    # admin can promote a member
    assert (await team.admin.patch(f"{base}/{team.member.id}", {"role": "admin"})).status_code == 200
    # admin can't touch the owner role
    assert (await team.admin.patch(f"{base}/{team.member2.id}", {"role": "owner"})).status_code == 403
    # last owner can't be demoted
    r = await team.owner.patch(f"{base}/{team.owner.id}", {"role": "admin"})
    assert r.status_code == 400 and r.json()["code"] == "last_owner"


async def test_capacity_self_or_admin(team):
    base = f"/api/v1/workspaces/{team.workspace_id}/members"
    r = await team.member.patch(f"{base}/{team.member.id}", {"weekly_capacity_hours": 32})
    assert r.status_code == 200 and r.json()["weekly_capacity_hours"] == 32
    assert (await team.member.patch(f"{base}/{team.member2.id}", {"weekly_capacity_hours": 10})).status_code == 403


async def test_deactivate_member_unassigns_open_work(team, db):
    project, st = await make_project(db, team.workspace_id, members={team.member.id: "member"})
    open_task = await make_task(db, project, st["todo"], assignee_id=team.member.id)
    done_task = await make_task(db, project, st["done"], assignee_id=team.member.id)

    r = await team.admin.patch(
        f"/api/v1/workspaces/{team.workspace_id}/members/{team.member.id}", {"deactivated": True}
    )
    assert r.status_code == 200 and r.json()["deactivated"] is True
    # deactivated member loses access
    assert (await team.member.get(f"/api/v1/workspaces/{team.workspace_id}")).status_code == 404
    open_id, done_id = open_task.id, done_task.id
    db.expire_all()
    assert (await db.get(Task, open_id)).assignee_id is None
    assert str((await db.get(Task, done_id)).assignee_id) == team.member.id
    # hidden from default list, visible to admins with include_deactivated
    ids = [m["user"]["id"] for m in (await team.admin.get(f"/api/v1/workspaces/{team.workspace_id}/members")).json()]
    assert team.member.id not in ids
    all_ids = [
        m["user"]["id"]
        for m in (
            await team.admin.get(
                f"/api/v1/workspaces/{team.workspace_id}/members", params={"include_deactivated": True}
            )
        ).json()
    ]
    assert team.member.id in all_ids


async def test_leave_and_remove(team):
    base = f"/api/v1/workspaces/{team.workspace_id}/members"
    assert (await team.member.delete(f"{base}/{team.member2.id}")).status_code == 403
    assert (await team.member.delete(f"{base}/{team.member.id}")).status_code == 200  # leave
    assert (await team.admin.delete(f"{base}/{team.member2.id}")).status_code == 200
    r = await team.owner.delete(f"{base}/{team.owner.id}")
    assert r.status_code == 400


async def test_invitations_admin_only_and_revocable(team):
    base = f"/api/v1/workspaces/{team.workspace_id}/invitations"
    assert (await team.member.post(base, {"email": "x@example.com"})).status_code == 403
    r = await team.admin.post(base, {"email": "x@example.com"})
    assert r.status_code == 201 and "/invite/" in r.json()["invite_url"]
    # admins can't invite owners
    assert (await team.admin.post(base, {"email": "y@example.com", "role": "owner"})).status_code == 403
    # can't invite an existing member
    r = await team.admin.post(base, {"email": team.member.email})
    assert r.status_code == 409
    listed = (await team.admin.get(base)).json()
    assert [i["email"] for i in listed] == ["x@example.com"]
    assert "invite_url" not in listed[0] or listed[0]["invite_url"] is None
    assert (await team.admin.delete(f"/api/v1/invitations/{listed[0]['id']}")).status_code == 200
    assert (await team.admin.get(base)).json() == []


async def test_labels_crud(team):
    base = f"/api/v1/workspaces/{team.workspace_id}/labels"
    defaults = (await team.member.get(base)).json()
    assert {lb["name"] for lb in defaults} >= {"Bug", "Feature"}
    r = await team.member.post(base, {"name": "Urgent fix", "color": "#ff0000"})
    assert r.status_code == 201
    assert (await team.member.post(base, {"name": "urgent FIX", "color": "#ff0000"})).status_code == 409
    assert (await team.guest.post(base, {"name": "G", "color": "#ff0000"})).status_code == 403
    lid = r.json()["id"]
    assert (await team.member.patch(f"/api/v1/labels/{lid}", {"color": "#00ff00"})).json()["color"] == "#00ff00"
    assert (await team.member.patch(f"/api/v1/labels/{lid}", {"color": "green"})).status_code == 422
    assert (await team.member.delete(f"/api/v1/labels/{lid}")).status_code == 200


async def test_factories_work(team, db):
    project, st = await make_project(db, team.workspace_id)
    t1 = await make_task(db, project, st["todo"])
    t2 = await make_task(db, project, st["todo"])
    assert (t1.number, t2.number) == (1, 2)
    assert len(list(await db.scalars(select(Task)))) == 2
