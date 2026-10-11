import asyncio
import uuid
from datetime import UTC, date, datetime, timedelta

import pytest
from sqlalchemy import select

from app.api.v1.projects import derive_key
from app.models import (
    Activity,
    Milestone,
    Notification,
    NotificationType,
    ProjectVisibility,
    Task,
    TaskStatus,
)
from app.services import realtime
from tests.conftest import signup
from tests.factories import make_project, make_task

API = "/api/v1"


def projects_url(team) -> str:
    return f"{API}/workspaces/{team.workspace_id}/projects"


async def create(actor, workspace_id, **body):
    body.setdefault("name", "Website")
    r = await actor.post(f"{API}/workspaces/{workspace_id}/projects", body)
    assert r.status_code == 201, r.text
    return r.json()


async def fresh(db, model, *where):
    """Re-read rows from the database (the test session may hold stale copies)."""
    return list(await db.scalars(select(model).where(*where).execution_options(populate_existing=True)))


@pytest.fixture
def events(monkeypatch):
    """Capture realtime events published after commit: list of (type, audience, message)."""
    published: list[tuple[str, set[str], dict]] = []

    async def capture(message, audience):
        published.append((message["type"], {str(u) for u in audience}, message))

    monkeypatch.setattr(realtime.broker, "publish", capture)
    return published


async def settle():
    """Let the post-commit publish tasks run."""
    for _ in range(3):
        await asyncio.sleep(0)


# ─── Key derivation ───


@pytest.mark.parametrize(
    ("name", "key"),
    [
        ("Website", "WEB"),
        ("Website Redesign", "WR"),
        ("mobile app v2", "MAV"),
        ("Q4 Marketing Launch", "QML"),
        ("2024 Roadmap", "P2R"),
        ("Équipe Été", "EE"),
        ("A very long project name with many words", "AVLPNW"),
        ("Q", "QX"),
        ("🚀🚀", "PRJ"),
    ],
)
def test_derive_key(name, key):
    assert derive_key(name) == key


# ─── Create ───


async def test_create_project_with_defaults(team, events):
    r = await team.member.post(projects_url(team), {"name": "  Website Redesign  ", "description": "New site"})
    assert r.status_code == 201, r.text
    p = r.json()
    assert p["name"] == "Website Redesign" and p["key"] == "WR"
    assert p["status"] == "active" and p["visibility"] == "workspace" and p["priority"] == "medium"
    assert p["my_role"] == "lead" and p["lead"]["id"] == team.member.id
    assert p["member_count"] == 1
    assert p["stats"] == {"total": 0, "open": 0, "completed": 0, "overdue": 0, "progress": 0.0}

    statuses = (await team.member.get(f"{API}/projects/{p['id']}/statuses")).json()
    assert [s["name"] for s in statuses] == ["Backlog", "To Do", "In Progress", "In Review", "Done", "Canceled"]
    assert all(s["task_count"] == 0 for s in statuses)

    await settle()
    created = [e for e in events if e[0] == "project.created"]
    assert len(created) == 1
    _, audience, message = created[0]
    # workspace-visible project: owner, admin and members, but not the guest
    assert audience == {team.owner.id, team.admin.id, team.member.id, team.member2.id}
    assert str(message["project_id"]) == p["id"] and str(message["workspace_id"]) == team.workspace_id


async def test_create_derives_unique_keys(team):
    keys = [(await create(team.member, team.workspace_id, name="Website"))["key"] for _ in range(3)]
    assert keys == ["WEB", "WEB2", "WEB3"]
    long_one = await create(team.member, team.workspace_id, name="Alpha Beta Gamma Delta Epsilon Zeta")
    again = await create(team.member, team.workspace_id, name="Alpha Beta Gamma Delta Epsilon Zeta")
    assert (long_one["key"], again["key"]) == ("ABGDEZ", "ABGDE2")


async def test_create_with_explicit_key(team):
    p = await create(team.member, team.workspace_id, name="Website", key=" web ")
    assert p["key"] == "WEB"
    r = await team.member.post(projects_url(team), {"name": "Other", "key": "WEB"})
    assert r.status_code == 409 and r.json()["code"] == "key_taken"
    for bad in ["1AB", "A", "TOOLONGX", "AB-1"]:
        assert (await team.member.post(projects_url(team), {"name": "X", "key": bad})).status_code == 422
    # the same key is fine in another workspace
    other = await signup(team.owner.client, "Other Owner", workspace_name="Other")
    other_ws = other.user["workspaces"][0]["workspace_id"]
    assert (await create(other, other_ws, name="Website", key="WEB"))["key"] == "WEB"


async def test_create_validation(team):
    url = projects_url(team)
    assert (await team.member.post(url, {"name": ""})).status_code == 422
    assert (await team.member.post(url, {"name": "X", "color": "red"})).status_code == 422
    r = await team.member.post(url, {"name": "X", "start_date": "2026-05-10", "target_date": "2026-05-01"})
    assert r.status_code == 422


async def test_create_permissions(team, client):
    assert (await team.guest.post(projects_url(team), {"name": "Nope"})).status_code == 403
    outsider = await signup(client, "Out Sider", workspace_name="Elsewhere")
    assert (await outsider.post(projects_url(team), {"name": "Nope"})).status_code == 404
    assert (await team.admin.post(projects_url(team), {"name": "Admin Project"})).status_code == 201
    assert (await team.owner.post(projects_url(team), {"name": "Owner Project"})).status_code == 201


async def test_create_with_lead_and_members_notifies_them(team, db):
    p = await create(
        team.owner,
        team.workspace_id,
        name="Launch",
        lead_id=team.member.id,
        member_ids=[team.member2.id, team.guest.id, team.owner.id],
        visibility="private",
    )
    assert p["lead"]["id"] == team.member.id and p["member_count"] == 4 and p["my_role"] == "lead"
    members = {m["user"]["id"]: m["role"] for m in (await team.owner.get(f"{API}/projects/{p['id']}/members")).json()}
    assert members == {
        team.owner.id: "lead",
        team.member.id: "lead",
        team.member2.id: "member",
        team.guest.id: "member",
    }
    notes = await fresh(db, Notification, Notification.type == NotificationType.added_to_project)
    assert {str(n.user_id): n.data["role"] for n in notes} == {
        team.member.id: "lead",
        team.member2.id: "member",
        team.guest.id: "member",
    }
    assert all(str(n.project_id) == p["id"] and n.data["project_name"] == "Launch" for n in notes)
    # the guest can now see the private project
    assert (await team.guest.get(f"{API}/projects/{p['id']}")).json()["my_role"] == "member"
    entries = await fresh(db, Activity, Activity.verb == "created")
    assert len(entries) == 1 and entries[0].data == {"name": "Launch", "key": "LAU"}


async def test_create_rejects_people_outside_workspace(team, client):
    outsider = await signup(client, "Out Sider", workspace_name="Elsewhere")
    url = projects_url(team)
    r = await team.member.post(url, {"name": "X", "lead_id": outsider.id})
    assert r.status_code == 400 and r.json()["code"] == "not_workspace_member"
    r = await team.member.post(url, {"name": "X", "member_ids": [team.member2.id, outsider.id]})
    assert r.status_code == 400 and r.json()["code"] == "not_workspace_member"
    r = await team.member.post(url, {"name": "X", "member_ids": [str(uuid.uuid4())]})
    assert r.status_code == 400
    # deactivated members don't count
    await team.admin.patch(f"{API}/workspaces/{team.workspace_id}/members/{team.member2.id}", {"deactivated": True})
    r = await team.member.post(url, {"name": "X", "lead_id": team.member2.id})
    assert r.status_code == 400 and r.json()["code"] == "not_workspace_member"


# ─── List / get ───


async def test_list_respects_visibility_and_roles(team, db, client):
    public, _ = await make_project(db, team.workspace_id, name="Public", key="PUB")
    secret, _ = await make_project(
        db,
        team.workspace_id,
        name="Secret",
        key="SEC",
        visibility=ProjectVisibility.private,
        members={team.member2.id: "member"},
    )
    guest_proj, _ = await make_project(
        db,
        team.workspace_id,
        name="Guest Work",
        key="GW",
        visibility=ProjectVisibility.private,
        members={team.guest.id: "viewer"},
    )

    async def visible(actor):
        return {p["key"]: p["my_role"] for p in (await actor.get(projects_url(team))).json()}

    assert await visible(team.owner) == {"PUB": "lead", "SEC": "lead", "GW": "lead"}
    assert await visible(team.admin) == {"PUB": "lead", "SEC": "lead", "GW": "lead"}
    assert await visible(team.member) == {"PUB": "viewer"}
    assert await visible(team.member2) == {"PUB": "viewer", "SEC": "member"}
    assert await visible(team.guest) == {"GW": "viewer"}

    outsider = await signup(client, "Out Sider", workspace_name="Elsewhere")
    assert (await outsider.get(projects_url(team))).status_code == 404
    assert (await outsider.get(f"{API}/projects/{public.id}")).status_code == 404

    # direct access follows the same rules (404, never 403, for no access)
    assert (await team.member.get(f"{API}/projects/{secret.id}")).status_code == 404
    assert (await team.guest.get(f"{API}/projects/{public.id}")).status_code == 404
    assert (await team.member2.get(f"{API}/projects/{secret.id}")).json()["my_role"] == "member"
    assert (await team.guest.get(f"{API}/projects/{guest_proj.id}")).status_code == 200
    assert (await team.member.get(f"{API}/projects/{uuid.uuid4()}")).status_code == 404


async def test_list_stats(team, db):
    project, st = await make_project(db, team.workspace_id, members={team.member.id: "lead"})
    other, other_st = await make_project(db, team.workspace_id, name="Other", key="OTH")
    yesterday = date.today() - timedelta(days=2)
    tomorrow = date.today() + timedelta(days=2)
    parent = await make_task(db, project, st["todo"], due_date=yesterday)  # open + overdue
    await make_task(db, project, st["in_progress"], due_date=tomorrow, parent_id=parent.id)  # open subtask
    await make_task(db, project, st["done"], due_date=yesterday)  # completed, not overdue
    await make_task(db, project, st["done"])
    await make_task(db, project, st["canceled"], due_date=yesterday)  # closed, not completed
    deleted = await make_task(db, project, st["todo"], due_date=yesterday)
    deleted.deleted_at = datetime.now(UTC)
    await db.commit()
    await make_task(db, other, other_st["done"])

    listed = {p["key"]: p for p in (await team.member.get(projects_url(team))).json()}
    stats = listed["WEB"]["stats"]
    assert stats == {"total": 5, "open": 2, "completed": 2, "overdue": 1, "progress": 0.5}
    assert listed["WEB"]["member_count"] == 1 and listed["WEB"]["my_role"] == "lead"
    assert listed["OTH"]["stats"] == {"total": 1, "open": 0, "completed": 1, "overdue": 0, "progress": 1.0}
    assert listed["OTH"]["member_count"] == 0
    # same numbers on the single-project endpoint
    assert (await team.member.get(f"{API}/projects/{project.id}")).json()["stats"] == stats


async def test_list_sort_order_and_archived(team, db):
    specs = [
        ("Zeta", "ZET", "active"),
        ("alpha", "ALP", "planning"),
        ("Beta", "BET", "completed"),
        ("Archive", "ARC", "archived"),
        ("Gamma", "GAM", "on_hold"),
        ("Delta", "DEL", "active"),
    ]
    for name, key, status in specs:
        project, _ = await make_project(db, team.workspace_id, name=name, key=key)
        project.status = status
    await db.commit()
    keys = [p["key"] for p in (await team.member.get(projects_url(team))).json()]
    assert keys == ["ALP", "DEL", "ZET", "BET", "GAM"]
    keys = [p["key"] for p in (await team.member.get(projects_url(team), params={"include_archived": True})).json()]
    assert keys == ["ALP", "DEL", "ZET", "BET", "GAM", "ARC"]


# ─── Update ───


async def test_update_requires_lead(team, db):
    project, _ = await make_project(db, team.workspace_id, members={team.member2.id: "member"})
    url = f"{API}/projects/{project.id}"
    assert (await team.member.patch(url, {"name": "X"})).status_code == 403  # workspace viewer
    assert (await team.member2.patch(url, {"name": "X"})).status_code == 403  # project member
    assert (await team.guest.patch(url, {"name": "X"})).status_code == 404  # no access
    assert (await team.admin.patch(url, {"name": "Admin edit"})).json()["name"] == "Admin edit"


async def test_update_project_fields_and_activity(team, db, events):
    p = await create(team.member, team.workspace_id, name="Website", start_date="2026-01-01")
    url = f"{API}/projects/{p['id']}"
    r = await team.member.patch(
        url,
        {"name": "Website 2.0", "status": "on_hold", "target_date": "2026-03-01", "color": "#22c55e", "key": "site"},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert (body["name"], body["status"], body["target_date"], body["key"]) == (
        "Website 2.0",
        "on_hold",
        "2026-03-01",
        "SITE",
    )
    assert body["updated_at"] >= p["updated_at"]

    entry = (await fresh(db, Activity, Activity.verb == "updated"))[0]
    assert entry.data["changes"]["name"] == {"from": "Website", "to": "Website 2.0"}
    assert entry.data["changes"]["status"] == {"from": "active", "to": "on_hold"}
    assert entry.data["changes"]["target_date"] == {"from": None, "to": "2026-03-01"}
    assert entry.data["changes"]["key"] == {"from": "WEB", "to": "SITE"}
    await settle()
    assert [e[0] for e in events].count("project.updated") == 1

    # a no-op patch records nothing
    assert (await team.member.patch(url, {"name": "Website 2.0"})).status_code == 200
    assert len(await fresh(db, Activity, Activity.verb == "updated")) == 1
    # explicit null on a required field is ignored rather than clearing it
    assert (await team.member.patch(url, {"name": None})).json()["name"] == "Website 2.0"


async def test_update_dates_and_key_validation(team, db):
    await create(team.member, team.workspace_id, name="Taken", key="TAKEN")
    p = await create(team.member, team.workspace_id, name="Website", start_date="2026-05-01")
    url = f"{API}/projects/{p['id']}"
    r = await team.member.patch(url, {"target_date": "2026-04-01"})
    assert r.status_code == 400 and r.json()["code"] == "invalid_dates"
    r = await team.member.patch(url, {"start_date": "2026-06-01", "target_date": "2026-05-15"})
    assert r.status_code == 400 and r.json()["code"] == "invalid_dates"
    # clearing the start date makes an earlier target valid
    r = await team.member.patch(url, {"start_date": None, "target_date": "2026-04-01"})
    assert r.status_code == 200 and r.json()["start_date"] is None
    r = await team.member.patch(url, {"key": "taken"})
    assert r.status_code == 409 and r.json()["code"] == "key_taken"
    assert (await team.member.patch(url, {"key": "WEB"})).status_code == 200  # own key is fine
    assert (await team.member.patch(url, {"key": "9X"})).status_code == 422


async def test_update_lead(team, db, client):
    p = await create(team.member, team.workspace_id, name="Website")
    url = f"{API}/projects/{p['id']}"
    r = await team.member.patch(url, {"lead_id": team.member2.id})
    assert r.status_code == 200 and r.json()["lead"]["id"] == team.member2.id
    members = {m["user"]["id"]: m["role"] for m in (await team.member.get(f"{url}/members")).json()}
    assert members == {team.member.id: "lead", team.member2.id: "lead"}
    note = await fresh(db, Notification, Notification.user_id == uuid.UUID(team.member2.id))
    assert len(note) == 1 and note[0].type == NotificationType.added_to_project
    entry = (await fresh(db, Activity, Activity.verb == "updated"))[0]
    assert entry.data["changes"]["lead"] == {"from": "Mia Member", "to": "Max Member"}

    # explicit null clears the lead but keeps memberships
    r = await team.member.patch(url, {"lead_id": None})
    assert r.status_code == 200 and r.json()["lead"] is None
    assert len((await team.member.get(f"{url}/members")).json()) == 2

    outsider = await signup(client, "Out Sider", workspace_name="Elsewhere")
    r = await team.member.patch(url, {"lead_id": outsider.id})
    assert r.status_code == 400 and r.json()["code"] == "not_workspace_member"


async def test_making_project_private_hides_it_and_notifies_former_viewers(team, events):
    p = await create(team.member2, team.workspace_id, name="Website")
    assert (await team.member.get(f"{API}/projects/{p['id']}")).status_code == 200
    events.clear()
    r = await team.member2.patch(f"{API}/projects/{p['id']}", {"visibility": "private"})
    assert r.status_code == 200
    assert (await team.member.get(f"{API}/projects/{p['id']}")).status_code == 404
    await settle()
    updated = [aud for t, aud, _ in events if t == "project.updated"]
    assert updated and team.member.id in updated[0]


# ─── Delete ───


async def test_delete_project_permissions_and_cascade(team, db, events):
    project, st = await make_project(db, team.workspace_id, members={team.member.id: "lead", team.member2.id: "member"})
    parent = await make_task(db, project, st["todo"])
    await make_task(db, project, st["done"], parent_id=parent.id)
    url = f"{API}/projects/{project.id}"
    assert (await team.member2.delete(url)).status_code == 403
    assert (await team.guest.delete(url)).status_code == 404

    r = await team.member.delete(url)
    assert r.status_code == 200 and r.json() == {"ok": True}
    assert (await team.member.get(url)).status_code == 404
    assert await fresh(db, Task, Task.project_id == project.id) == []
    assert await fresh(db, TaskStatus, TaskStatus.project_id == project.id) == []
    entry = await fresh(db, Activity, Activity.verb == "project_deleted")
    assert len(entry) == 1 and entry[0].project_id is None and entry[0].data["key"] == "WEB"
    await settle()
    deleted = [aud for t, aud, _ in events if t == "project.deleted"]
    assert deleted and {team.member.id, team.member2.id, team.owner.id} <= deleted[0]


async def test_admin_can_delete_any_project(team, db):
    project, _ = await make_project(
        db, team.workspace_id, visibility=ProjectVisibility.private, members={team.member.id: "lead"}
    )
    assert (await team.admin.delete(f"{API}/projects/{project.id}")).status_code == 200


# ─── Members ───


async def test_project_member_management(team, db):
    p = await create(team.member, team.workspace_id, name="Website", visibility="private")
    url = f"{API}/projects/{p['id']}/members"

    r = await team.member.post(url, {"user_id": team.guest.id, "role": "viewer"})
    assert r.status_code == 201
    assert r.json()["user"]["id"] == team.guest.id and r.json()["role"] == "viewer" and r.json()["added_at"]
    note = await fresh(db, Notification, Notification.user_id == uuid.UUID(team.guest.id))
    assert len(note) == 1 and note[0].type == NotificationType.added_to_project
    assert (await team.guest.get(f"{API}/projects/{p['id']}")).json()["my_role"] == "viewer"

    r = await team.member.post(url, {"user_id": team.guest.id})
    assert r.status_code == 409 and r.json()["code"] == "already_member"

    r = await team.member.patch(f"{url}/{team.guest.id}", {"role": "member"})
    assert r.status_code == 200 and r.json()["role"] == "member"
    assert (await team.member.patch(f"{url}/{team.member2.id}", {"role": "member"})).status_code == 404

    members = (await team.guest.get(url)).json()
    assert [(m["user"]["id"], m["role"]) for m in members] == [(team.member.id, "lead"), (team.guest.id, "member")]
    verbs = [a.verb for a in await fresh(db, Activity, Activity.project_id == uuid.UUID(p["id"]))]
    assert "member_added" in verbs and "member_role_changed" in verbs


async def test_member_endpoints_require_lead(team, db, client):
    project, _ = await make_project(db, team.workspace_id, members={team.member.id: "lead", team.member2.id: "member"})
    url = f"{API}/projects/{project.id}/members"
    # viewers (workspace members) can list
    assert (await team.owner.get(url)).status_code == 200
    assert (await team.guest.get(url)).status_code == 404
    assert (await team.member2.post(url, {"user_id": team.guest.id})).status_code == 403
    assert (await team.member2.patch(f"{url}/{team.member.id}", {"role": "viewer"})).status_code == 403
    assert (await team.member2.delete(f"{url}/{team.member.id}")).status_code == 403

    outsider = await signup(client, "Out Sider", workspace_name="Elsewhere")
    r = await team.member.post(url, {"user_id": outsider.id})
    assert r.status_code == 400 and r.json()["code"] == "not_workspace_member"
    assert (await outsider.get(url)).status_code == 404
    # workspace admins act as leads
    assert (await team.admin.post(url, {"user_id": team.guest.id})).status_code == 201


async def test_last_lead_is_protected(team, db):
    p = await create(team.member, team.workspace_id, name="Website", member_ids=[team.member2.id])
    url = f"{API}/projects/{p['id']}/members"
    r = await team.member.patch(f"{url}/{team.member.id}", {"role": "member"})
    assert r.status_code == 400 and r.json()["code"] == "last_lead"
    r = await team.member.delete(f"{url}/{team.member.id}")
    assert r.status_code == 400 and r.json()["code"] == "last_lead"
    r = await team.admin.delete(f"{url}/{team.member.id}")
    assert r.status_code == 400 and r.json()["code"] == "last_lead"

    # with a second lead, the first may step down; the project lead field follows
    assert (await team.member.patch(f"{url}/{team.member2.id}", {"role": "lead"})).status_code == 200
    assert (await team.member.patch(f"{url}/{team.member.id}", {"role": "viewer"})).json()["role"] == "viewer"
    project = (await team.member.get(f"{API}/projects/{p['id']}")).json()
    assert project["lead"] is None and project["my_role"] == "viewer"


async def test_leave_and_remove_members(team, db, events):
    p = await create(
        team.member,
        team.workspace_id,
        name="Website",
        visibility="private",
        member_ids=[team.member2.id, team.guest.id],
    )
    url = f"{API}/projects/{p['id']}/members"
    # a non-lead can leave
    assert (await team.guest.delete(f"{url}/{team.guest.id}")).status_code == 200
    assert (await team.guest.get(f"{API}/projects/{p['id']}")).status_code == 404
    await settle()
    removed = [aud for t, aud, _ in events if t == "project_member.deleted"]
    assert removed and team.guest.id in removed[0]  # the leaver is told, too
    # leads remove others
    assert (await team.member.delete(f"{url}/{team.member2.id}")).status_code == 200
    assert (await team.member.delete(f"{url}/{team.member2.id}")).status_code == 404
    verbs = [a.verb for a in await fresh(db, Activity, Activity.project_id == uuid.UUID(p["id"]))]
    assert "member_left" in verbs and "member_removed" in verbs
    assert (await team.member.get(f"{API}/projects/{p['id']}")).json()["member_count"] == 1


# ─── Statuses ───


async def test_status_create_and_list(team, db):
    project, st = await make_project(db, team.workspace_id, members={team.member.id: "lead"})
    await make_task(db, project, st["todo"])
    await make_task(db, project, st["todo"])
    gone = await make_task(db, project, st["todo"])
    gone.deleted_at = datetime.now(UTC)
    await db.commit()
    url = f"{API}/projects/{project.id}/statuses"

    r = await team.member.post(url, {"name": "Blocked", "category": "in_progress", "color": "#ef4444"})
    assert r.status_code == 201
    assert r.json()["position"] == 6.0 and r.json()["task_count"] == 0
    r = await team.member.post(url, {"name": "blocked", "category": "todo", "color": "#ef4444"})
    assert r.status_code == 409 and r.json()["code"] == "status_exists"
    assert (await team.member.post(url, {"name": "X", "category": "nope", "color": "#ef4444"})).status_code == 422

    listed = (await team.member2.get(url)).json()  # workspace viewer can read
    assert [s["name"] for s in listed][-1] == "Blocked"
    assert {s["name"]: s["task_count"] for s in listed}["To Do"] == 2
    assert (await team.member2.post(url, {"name": "Y", "category": "todo", "color": "#000000"})).status_code == 403
    assert (await team.guest.get(url)).status_code == 404


async def test_status_category_change_syncs_completion(team, db):
    project, st = await make_project(db, team.workspace_id, members={team.member.id: "lead"})
    t1 = await make_task(db, project, st["review"])
    done_at = datetime(2026, 1, 1, tzinfo=UTC)
    t2 = await make_task(db, project, st["review"], completed_at=done_at)
    url = f"{API}/statuses/{st['review']}"

    r = await team.member.patch(url, {"category": "done", "name": "Shipped"})
    assert r.status_code == 200 and r.json()["category"] == "done" and r.json()["name"] == "Shipped"
    tasks = {t.id: t for t in await fresh(db, Task, Task.project_id == project.id)}
    assert tasks[t1.id].completed_at is not None and tasks[t2.id].completed_at == done_at
    assert (await team.member.get(f"{API}/projects/{project.id}")).json()["stats"]["completed"] == 2

    r = await team.member.patch(url, {"category": "canceled"})
    assert r.status_code == 200
    assert all(t.completed_at is None for t in await fresh(db, Task, Task.project_id == project.id))
    entry = await fresh(db, Activity, Activity.verb == "status_updated")
    assert entry[0].data["changes"]["category"] == {"from": "review", "to": "done"}

    assert (await team.member.patch(url, {"name": "To Do"})).json()["code"] == "status_exists"
    assert (await team.member2.patch(url, {"name": "Z"})).status_code == 403
    assert (await team.guest.patch(url, {"name": "Z"})).status_code == 404


async def test_delete_status_moves_tasks(team, db):
    project, st = await make_project(db, team.workspace_id, members={team.member.id: "lead"})
    a = await make_task(db, project, st["done"], completed_at=datetime.now(UTC), position=10.0)
    b = await make_task(db, project, st["done"], completed_at=datetime.now(UTC), position=20.0)
    existing = await make_task(db, project, st["todo"], position=500.0)
    url = f"{API}/statuses/{st['done']}"

    r = await team.member.delete(url)
    assert r.status_code == 400 and r.json()["code"] == "move_to_required"
    r = await team.member.delete(url, params={"move_to": str(st["done"])})
    assert r.status_code == 400 and r.json()["code"] == "invalid_move_to"
    other, other_st = await make_project(db, team.workspace_id, name="Other", key="OTH")
    r = await team.member.delete(url, params={"move_to": str(other_st["todo"])})
    assert r.status_code == 400 and r.json()["code"] == "invalid_move_to"
    assert (await team.member2.delete(url, params={"move_to": str(st["todo"])})).status_code == 403

    r = await team.member.delete(url, params={"move_to": str(st["todo"])})
    assert r.status_code == 200
    tasks = {t.id: t for t in await fresh(db, Task, Task.project_id == project.id)}
    assert {tasks[a.id].status_id, tasks[b.id].status_id} == {st["todo"]}
    # moved below the existing column, relative order kept, no longer completed
    assert tasks[existing.id].position < tasks[a.id].position < tasks[b.id].position
    assert tasks[a.id].completed_at is None and tasks[b.id].completed_at is None
    statuses = (await team.member.get(f"{API}/projects/{project.id}/statuses")).json()
    assert "Done" not in [s["name"] for s in statuses]
    assert {s["name"]: s["task_count"] for s in statuses}["To Do"] == 3
    entry = (await fresh(db, Activity, Activity.verb == "status_deleted"))[0]
    assert entry.data == {"status": "Done", "moved_to": "To Do", "moved_tasks": 2}


async def test_delete_empty_status_and_last_status(team, db):
    project, st = await make_project(db, team.workspace_id, members={team.member.id: "lead"})
    # an empty status (only a soft-deleted task) goes without move_to
    ghost = await make_task(db, project, st["backlog"])
    ghost.deleted_at = datetime.now(UTC)
    await db.commit()
    assert (await team.member.delete(f"{API}/statuses/{st['backlog']}")).status_code == 200
    assert (await fresh(db, Task, Task.id == ghost.id))[0].status_id != st["backlog"]

    for category in ["todo", "in_progress", "review", "done"]:
        assert (await team.member.delete(f"{API}/statuses/{st[category]}")).status_code == 200
    r = await team.member.delete(f"{API}/statuses/{st['canceled']}")
    assert r.status_code == 400 and r.json()["code"] == "last_status"
    assert (await team.member.delete(f"{API}/statuses/{uuid.uuid4()}")).status_code == 404


async def test_reorder_statuses(team, db, client):
    project, st = await make_project(db, team.workspace_id, members={team.member.id: "lead"})
    url = f"{API}/projects/{project.id}/statuses"
    ids = [s["id"] for s in (await team.member.get(url)).json()]
    new_order = list(reversed(ids))
    r = await team.member.post(f"{url}/reorder", {"status_ids": new_order})
    assert r.status_code == 200
    assert [s["id"] for s in r.json()] == new_order and [s["position"] for s in r.json()] == [0, 1, 2, 3, 4, 5]
    assert [s["id"] for s in (await team.member.get(url)).json()] == new_order

    for bad in [ids[:-1], ids + [ids[0]], ids[:-1] + [str(uuid.uuid4())]]:
        r = await team.member.post(f"{url}/reorder", {"status_ids": bad})
        assert r.status_code == 400 and r.json()["code"] == "invalid_order"
    other, other_st = await make_project(db, team.workspace_id, name="Other", key="OTH")
    r = await team.member.post(f"{url}/reorder", {"status_ids": ids[:-1] + [str(other_st["todo"])]})
    assert r.status_code == 400
    assert (await team.member2.post(f"{url}/reorder", {"status_ids": ids})).status_code == 403
    outsider = await signup(client, "Out Sider", workspace_name="Elsewhere")
    assert (await outsider.post(f"{url}/reorder", {"status_ids": ids})).status_code == 404
    assert (await outsider.patch(f"{API}/statuses/{ids[0]}", {"name": "x"})).status_code == 404


# ─── Milestones ───


async def test_milestones_crud_and_progress(team, db):
    project, st = await make_project(db, team.workspace_id, members={team.member.id: "lead"})
    url = f"{API}/projects/{project.id}/milestones"
    beta = (await team.member.post(url, {"name": "Beta", "due_date": "2026-12-01"})).json()
    r = await team.member.post(url, {"name": "Someday"})
    assert r.status_code == 201 and r.json()["task_total"] == 0 and r.json()["completed_at"] is None
    alpha = (await team.member.post(url, {"name": "Alpha", "due_date": "2026-11-01", "description": "First"})).json()

    t1 = await make_task(db, project, st["done"])
    t2 = await make_task(db, project, st["todo"])
    t3 = await make_task(db, project, st["done"])
    for t in (t1, t2, t3):
        t.milestone_id = uuid.UUID(beta["id"])
    t3.deleted_at = datetime.now(UTC)
    await db.commit()

    listed = (await team.member2.get(url)).json()  # viewers can read
    assert [m["name"] for m in listed] == ["Alpha", "Beta", "Someday"]
    assert {m["name"]: (m["task_total"], m["task_done"]) for m in listed}["Beta"] == (2, 1)

    r = await team.member.patch(f"{API}/milestones/{alpha['id']}", {"completed": True})
    assert r.status_code == 200 and r.json()["completed_at"] is not None
    first_completed = r.json()["completed_at"]
    r = await team.member.patch(f"{API}/milestones/{alpha['id']}", {"completed": True, "name": "Alpha 1"})
    assert r.json()["completed_at"] == first_completed and r.json()["name"] == "Alpha 1"
    r = await team.member.patch(f"{API}/milestones/{alpha['id']}", {"completed": False, "due_date": None})
    assert r.json()["completed_at"] is None and r.json()["due_date"] is None
    verbs = [a.verb for a in await fresh(db, Activity, Activity.project_id == project.id)]
    assert {"milestone_created", "milestone_completed", "milestone_updated"} <= set(verbs)

    assert (await team.member.delete(f"{API}/milestones/{beta['id']}")).status_code == 200
    assert all(t.milestone_id is None for t in await fresh(db, Task, Task.project_id == project.id))
    assert [m["name"] for m in (await team.member.get(url)).json()] == ["Someday", "Alpha 1"]


async def test_milestone_permissions(team, db, client):
    project, _ = await make_project(
        db, team.workspace_id, visibility=ProjectVisibility.private, members={team.member.id: "member"}
    )
    url = f"{API}/projects/{project.id}/milestones"
    assert (await team.member.post(url, {"name": "M"})).status_code == 403
    assert (await team.member2.post(url, {"name": "M"})).status_code == 404  # private project
    m = (await team.admin.post(url, {"name": "M"})).json()
    assert (await team.member.get(url)).status_code == 200
    assert (await team.member.patch(f"{API}/milestones/{m['id']}", {"name": "X"})).status_code == 403
    assert (await team.member.delete(f"{API}/milestones/{m['id']}")).status_code == 403
    assert (await team.member2.patch(f"{API}/milestones/{m['id']}", {"name": "X"})).status_code == 404
    outsider = await signup(client, "Out Sider", workspace_name="Elsewhere")
    assert (await outsider.delete(f"{API}/milestones/{m['id']}")).status_code == 404
    assert (await team.admin.post(url, {"name": ""})).status_code == 422
    assert len(await fresh(db, Milestone, Milestone.project_id == project.id)) == 1


# ─── Status updates ───


async def test_project_updates(team, db, events):
    project, _ = await make_project(
        db,
        team.workspace_id,
        members={team.member.id: "member", team.member2.id: "lead", team.guest.id: "viewer"},
    )
    url = f"{API}/projects/{project.id}/updates"
    assert (await team.guest.post(url, {"health": "on_track", "body": "hi"})).status_code == 403  # viewer
    assert (await team.member.post(url, {"health": "great", "body": "hi"})).status_code == 422
    assert (await team.member.post(url, {"health": "on_track", "body": ""})).status_code == 422

    body = "We're slipping because the API work grew. " * 10
    r = await team.member.post(url, {"health": "at_risk", "body": body})
    assert r.status_code == 201
    first = r.json()
    assert first["author"]["id"] == team.member.id and first["health"] == "at_risk" and first["body"] == body
    second = (await team.member2.post(url, {"health": "on_track", "body": "Back on track"})).json()

    listed = (await team.guest.get(url)).json()
    assert [u["id"] for u in listed] == [second["id"], first["id"]]
    assert len((await team.guest.get(url, params={"limit": 1})).json()) == 1

    notes = await fresh(db, Notification, Notification.type == NotificationType.project_update)
    recipients = sorted((str(n.user_id), n.data["health"]) for n in notes)
    assert recipients == sorted(
        [
            (team.member2.id, "at_risk"),
            (team.guest.id, "at_risk"),
            (team.member.id, "on_track"),
            (team.guest.id, "on_track"),
        ]
    )
    excerpt = next(n.data["excerpt"] for n in notes if n.data["health"] == "at_risk")
    assert len(excerpt) <= 140 and excerpt.endswith("…")
    posted = await fresh(db, Activity, Activity.verb == "posted_update")
    assert len(posted) == 2
    await settle()
    assert [t for t, _, _ in events].count("project_update.created") == 2
    assert (await team.owner.get(url)).status_code == 200
    assert (await team.member.get(f"{API}/projects/{uuid.uuid4()}/updates")).status_code == 404


async def test_updates_hidden_from_outsiders(team, db, client):
    project, _ = await make_project(db, team.workspace_id, visibility=ProjectVisibility.private)
    url = f"{API}/projects/{project.id}/updates"
    assert (await team.member.get(url)).status_code == 404
    assert (await team.member.post(url, {"health": "on_track", "body": "x"})).status_code == 404
    outsider = await signup(client, "Out Sider", workspace_name="Elsewhere")
    assert (await outsider.get(url)).status_code == 404
    assert (await team.admin.post(url, {"health": "off_track", "body": "Admins lead every project"})).status_code == 201


async def test_list_uses_constant_number_of_queries(team, db):
    from sqlalchemy import event

    from app.core import db as db_module

    async def count_queries(actor) -> int:
        statements: list[str] = []

        def record(conn, cursor, statement, *args):
            statements.append(statement)

        engine = db_module.get_engine().sync_engine
        event.listen(engine, "before_cursor_execute", record)
        try:
            r = await actor.get(projects_url(team))
            assert r.status_code == 200
        finally:
            event.remove(engine, "before_cursor_execute", record)
        return len(statements)

    project, st = await make_project(db, team.workspace_id, name="First", key="FIR", members={team.member.id: "lead"})
    project.lead_id = uuid.UUID(team.member.id)
    await make_task(db, project, st["todo"])
    one = await count_queries(team.member)
    for i in range(5):
        p, s = await make_project(
            db, team.workspace_id, name=f"Extra {i}", key=f"EX{i}", members={team.member2.id: "member"}
        )
        p.lead_id = uuid.UUID(team.member2.id)
        await make_task(db, p, s["done"])
    await db.commit()
    assert await count_queries(team.member) == one
