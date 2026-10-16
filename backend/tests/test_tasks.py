import asyncio
import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import select

from app.models import (
    Activity,
    Milestone,
    Notification,
    NotificationType,
    Priority,
    ProjectMember,
    ProjectRole,
    ProjectVisibility,
    StatusCategory,
    Task,
    TaskDependency,
    TaskLabel,
    TaskStatus,
    TaskWatcher,
    TimeEntry,
)
from app.services import realtime
from tests.conftest import signup
from tests.factories import make_project, make_task

API = "/api/v1"


def uid(value) -> uuid.UUID:
    return uuid.UUID(str(value))


def today():
    return datetime.now(UTC).date()


async def web_project(db, team, **kw):
    """Workspace-visible project: `member` is a project member, `member2` only an implicit viewer."""
    kw.setdefault("members", {team.member.id: "member"})
    return await make_project(db, team.workspace_id, name="Website", key="WEB", **kw)


async def make_milestone(db, project, name="Beta") -> Milestone:
    m = Milestone(id=uuid.uuid4(), project_id=project.id, name=name)
    db.add(m)
    await db.commit()
    return m


async def labels_by_name(actor, workspace_id) -> dict[str, str]:
    return {lb["name"]: lb["id"] for lb in (await actor.get(f"{API}/workspaces/{workspace_id}/labels")).json()}


async def fresh_task(db, task_id) -> Task:
    return await db.get(Task, uid(task_id), populate_existing=True)


async def activities(db, task_id, verb=None) -> list[Activity]:
    q = select(Activity).where(Activity.task_id == uid(task_id)).order_by(Activity.created_at)
    if verb:
        q = q.where(Activity.verb == verb)
    return list(await db.scalars(q))


async def notifications(db, user_id, type_: NotificationType) -> list[Notification]:
    return list(
        await db.scalars(select(Notification).where(Notification.user_id == uid(user_id), Notification.type == type_))
    )


def titles(response) -> list[str]:
    assert response.status_code == 200, response.text
    return [t["title"] for t in response.json()["items"]]


def capture_events(monkeypatch) -> list[tuple[dict, set]]:
    events: list[tuple[dict, set]] = []

    async def fake_publish(message, audience):
        events.append((message, set(audience)))

    monkeypatch.setattr(realtime.broker, "publish", fake_publish)
    return events


# ─── Create ───


async def test_create_task_defaults(team, db):
    project, st = await web_project(db, team)
    r = await team.member.post(f"{API}/projects/{project.id}/tasks", {"title": "  Build landing page  "})
    assert r.status_code == 201, r.text
    t = r.json()
    assert t["title"] == "Build landing page"
    assert (t["ref"], t["number"]) == ("WEB-1", 1)
    assert t["status"]["id"] == str(st["todo"]) and t["status"]["name"] == "To Do"
    assert t["project"]["key"] == "WEB" and t["priority"] == "none"
    assert t["reporter"]["id"] == team.member.id
    assert [w["id"] for w in t["watchers"]] == [team.member.id] and t["is_watching"] is True
    assert t["can_edit"] is True
    assert t["started_at"] is None and t["completed_at"] is None
    assert t["subtasks"] == [] and t["blocked_by"] == [] and t["time_logged_minutes"] == 0
    assert t["parent"] is None and t["milestone"] is None and t["assignee"] is None

    r2 = await team.member.post(f"{API}/projects/{project.id}/tasks", {"title": "Second"})
    assert r2.json()["ref"] == "WEB-2"
    created = await activities(db, t["id"])
    assert [a.verb for a in created] == ["created"]
    assert created[0].data == {"ref": "WEB-1", "title": "Build landing page"}


async def test_create_task_with_every_field(team, db):
    project, st = await web_project(db, team)
    milestone = await make_milestone(db, project)
    parent = await make_task(db, project, st["todo"], title="Parent")
    labels = await labels_by_name(team.member, team.workspace_id)
    body = {
        "title": "Child",
        "description": "Some **markdown**",
        "status_id": str(st["in_progress"]),
        "priority": "high",
        "assignee_id": team.member2.id,
        "parent_id": str(parent.id),
        "milestone_id": str(milestone.id),
        "start_date": "2026-01-01",
        "due_date": "2026-01-10",
        "estimate_hours": 4.5,
        "label_ids": [labels["Feature"], labels["Bug"], labels["Bug"]],
    }
    r = await team.member.post(f"{API}/projects/{project.id}/tasks", body)
    assert r.status_code == 201, r.text
    t = r.json()
    assert t["status"]["category"] == "in_progress" and t["started_at"] is not None and t["completed_at"] is None
    assert t["assignee"]["id"] == team.member2.id
    assert t["parent"]["ref"] == "WEB-1" and t["parent_id"] == str(parent.id)
    assert t["milestone"]["name"] == "Beta" and t["milestone_id"] == str(milestone.id)
    assert [lb["name"] for lb in t["labels"]] == ["Bug", "Feature"]
    assert t["estimate_hours"] == 4.5 and t["description"] == "Some **markdown**"
    assert (t["start_date"], t["due_date"]) == ("2026-01-01", "2026-01-10")
    assert {w["id"] for w in t["watchers"]} == {team.member.id, team.member2.id}

    # member2 already sees the workspace-visible project, so no explicit membership is added
    assert await db.get(ProjectMember, (project.id, uid(team.member2.id))) is None
    assigned = await notifications(db, team.member2.id, NotificationType.assigned)
    assert len(assigned) == 1 and assigned[0].task_id == uid(t["id"])

    detail = (await team.member.get(f"{API}/tasks/{parent.id}")).json()
    assert [s["id"] for s in detail["subtasks"]] == [t["id"]] and detail["subtask_count"] == 1


async def test_create_done_sets_completed_and_self_assign_no_notification(team, db):
    project, st = await web_project(db, team)
    r = await team.member.post(
        f"{API}/projects/{project.id}/tasks",
        {"title": "Done already", "status_id": str(st["done"]), "assignee_id": team.member.id},
    )
    t = r.json()
    assert t["completed_at"] is not None and t["started_at"] is None
    assert await notifications(db, team.member.id, NotificationType.assigned) == []


async def test_create_placement(team, db):
    project, _ = await web_project(db, team)
    base = f"{API}/projects/{project.id}/tasks"
    first = (await team.member.post(base, {"title": "First"})).json()
    top = (await team.member.post(base, {"title": "Top", "placement": "top"})).json()
    bottom = (await team.member.post(base, {"title": "Bottom"})).json()
    assert top["position"] < first["position"] < bottom["position"]
    assert titles(await team.member.get(base)) == ["Top", "First", "Bottom"]


async def test_create_validation(team, db, client):
    project, st = await web_project(db, team)
    other, other_st = await make_project(db, team.workspace_id, name="Ops", key="OPS")
    other_milestone = await make_milestone(db, other)
    other_task = await make_task(db, other, other_st["todo"])
    parent = await make_task(db, project, st["todo"], title="Parent")
    subtask = await make_task(db, project, st["todo"], title="Sub", parent_id=parent.id)
    trashed = await make_task(db, project, st["todo"], title="Trashed")
    trashed.deleted_at = datetime.now(UTC)
    await db.commit()
    outsider = await signup(client, "Out Sider", workspace_name="Elsewhere")
    foreign_label = next(
        iter((await labels_by_name(outsider, outsider.user["workspaces"][0]["workspace_id"])).values())
    )
    base = f"{API}/projects/{project.id}/tasks"

    async def check(body, status, code=None):
        r = await team.member.post(base, {"title": "X", **body})
        assert r.status_code == status, (body, r.text)
        if code:
            assert r.json()["code"] == code

    await check({"status_id": str(other_st["todo"])}, 400, "invalid_status")
    await check({"label_ids": [foreign_label]}, 400, "invalid_label")
    await check({"milestone_id": str(other_milestone.id)}, 400, "invalid_milestone")
    await check({"parent_id": str(subtask.id)}, 400, "nested_subtask")
    await check({"parent_id": str(other_task.id)}, 400, "invalid_parent")
    await check({"parent_id": str(trashed.id)}, 400, "invalid_parent")
    await check({"assignee_id": outsider.id}, 400, "invalid_assignee")
    await check({"start_date": "2026-02-02", "due_date": "2026-02-01"}, 422)
    await check({"estimate_hours": -1}, 422)
    await check({"title": "   "}, 422)
    await check({"placement": "middle"}, 422)
    # nothing was created by the failed attempts (only Parent and Sub exist)
    assert (await team.member.get(base)).json()["total"] == 2


async def test_deactivated_member_cannot_be_assigned(team, db):
    project, _ = await web_project(db, team)
    r = await team.admin.patch(f"{API}/workspaces/{team.workspace_id}/members/{team.member2.id}", {"deactivated": True})
    assert r.status_code == 200
    r = await team.member.post(f"{API}/projects/{project.id}/tasks", {"title": "X", "assignee_id": team.member2.id})
    assert r.status_code == 400 and r.json()["code"] == "invalid_assignee"


async def test_create_permissions(team, db, client):
    project, _ = await web_project(db, team, members={team.member.id: "member", team.guest.id: "member"})
    viewer_project, _ = await make_project(
        db, team.workspace_id, name="Docs", key="DOC", members={team.member2.id: "viewer"}
    )
    outsider = await signup(client, "Out Sider", workspace_name="Elsewhere")
    url = f"{API}/projects/{project.id}/tasks"
    assert (await team.member2.post(url, {"title": "x"})).status_code == 403  # implicit viewer
    assert (await outsider.post(url, {"title": "x"})).status_code == 404
    assert (await team.guest.post(url, {"title": "x"})).status_code == 201  # guest added as project member
    assert (await team.admin.post(url, {"title": "x"})).status_code == 201  # admins act as leads
    viewer_url = f"{API}/projects/{viewer_project.id}/tasks"
    assert (await team.member2.post(viewer_url, {"title": "x"})).status_code == 403
    assert (await team.guest.post(viewer_url, {"title": "x"})).status_code == 404
    assert (await team.member.post(f"{API}/projects/{uuid.uuid4()}/tasks", {"title": "x"})).status_code == 404


async def test_assigning_someone_without_access_adds_them_to_project(team, db):
    project, _ = await make_project(
        db,
        team.workspace_id,
        name="Secret",
        key="SEC",
        visibility=ProjectVisibility.private,
        members={team.member.id: "member"},
    )
    r = await team.member.post(f"{API}/projects/{project.id}/tasks", {"title": "For Gus", "assignee_id": team.guest.id})
    assert r.status_code == 201, r.text
    task_id = r.json()["id"]
    pm = await db.get(ProjectMember, (project.id, uid(team.guest.id)))
    assert pm is not None and pm.role == ProjectRole.member
    assert (await team.guest.get(f"{API}/tasks/{task_id}")).status_code == 200
    added = list(await db.scalars(select(Activity).where(Activity.verb == "member_added")))
    assert len(added) == 1 and added[0].data["user"] == "Gus Guest"

    # Same through PATCH for a workspace member who can't see the private project
    assert (await team.member2.get(f"{API}/tasks/{task_id}")).status_code == 404
    r = await team.member.patch(f"{API}/tasks/{task_id}", {"assignee_id": team.member2.id})
    assert r.status_code == 200, r.text
    assert (await team.member2.get(f"{API}/tasks/{task_id}")).status_code == 200


async def test_create_publishes_realtime_to_project_audience_only(team, db, monkeypatch):
    events = capture_events(monkeypatch)
    project, _ = await make_project(
        db,
        team.workspace_id,
        name="Secret",
        key="SEC",
        visibility=ProjectVisibility.private,
        members={team.member.id: "member"},
    )
    r = await team.member.post(f"{API}/projects/{project.id}/tasks", {"title": "Hidden"})
    assert r.status_code == 201
    await asyncio.sleep(0.01)
    created = [(m, a) for m, a in events if m["type"] == "task.created"]
    assert len(created) == 1
    message, audience = created[0]
    assert message["task_id"] == uid(r.json()["id"]) and message["project_id"] == project.id
    assert audience == {uid(team.owner.id), uid(team.admin.id), uid(team.member.id)}


# ─── Read ───


async def test_task_detail(team, db):
    project, st = await web_project(db, team)
    task = await make_task(db, project, st["todo"], title="Main", assignee_id=team.member.id)
    second = await make_task(db, project, st["done"], title="Sub B", parent_id=task.id, position=5000)
    first = await make_task(db, project, st["todo"], title="Sub A", parent_id=task.id, position=100)
    gone = await make_task(db, project, st["todo"], title="Sub gone", parent_id=task.id)
    gone.deleted_at = datetime.now(UTC)
    blocker = await make_task(db, project, st["todo"], title="Blocker")
    blocked = await make_task(db, project, st["todo"], title="Blocked")
    db.add_all(
        [
            TaskDependency(blocker_id=blocker.id, blocked_id=task.id),
            TaskDependency(blocker_id=task.id, blocked_id=blocked.id),
        ]
    )
    now = datetime.now(UTC)
    db.add_all(
        [
            TimeEntry(
                workspace_id=project.workspace_id,
                task_id=task.id,
                user_id=uid(team.member.id),
                started_at=now - timedelta(hours=2),
                ended_at=now - timedelta(hours=1),
                minutes=30,
            ),
            TimeEntry(
                workspace_id=project.workspace_id,
                task_id=task.id,
                user_id=uid(team.member2.id),
                started_at=now - timedelta(hours=3),
                ended_at=now - timedelta(hours=2),
                minutes=15,
            ),
            TimeEntry(
                workspace_id=project.workspace_id,
                task_id=task.id,
                user_id=uid(team.member.id),
                started_at=now,
                ended_at=None,
                minutes=99,
            ),  # running timer doesn't count
            TaskWatcher(task_id=task.id, user_id=uid(team.member.id)),
        ]
    )
    await db.commit()

    r = await team.member2.get(f"{API}/tasks/{task.id}")  # implicit viewer
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["can_edit"] is False and d["is_watching"] is False
    assert [s["title"] for s in d["subtasks"]] == ["Sub A", "Sub B"]
    assert (d["subtask_count"], d["subtask_done_count"]) == (2, 1)
    assert [b["id"] for b in d["blocked_by"]] == [str(blocker.id)] and d["blocked_by_count"] == 1
    assert [b["id"] for b in d["blocking"]] == [str(blocked.id)]
    assert d["blocked_by"][0]["ref"] == f"WEB-{blocker.number}"
    assert [w["name"] for w in d["watchers"]] == ["Mia Member"]
    assert d["time_logged_minutes"] == 45
    assert d["assignee"]["id"] == team.member.id
    assert str(gone.id) not in {s["id"] for s in d["subtasks"]} and d["subtasks"][1]["id"] == str(second.id)

    sub = (await team.member.get(f"{API}/tasks/{first.id}")).json()
    assert sub["parent"]["title"] == "Main" and sub["can_edit"] is True


async def test_detail_hides_dependencies_in_invisible_projects(team, db):
    project, st = await web_project(db, team)
    secret, secret_st = await make_project(
        db, team.workspace_id, name="Secret", key="SEC", visibility=ProjectVisibility.private
    )
    task = await make_task(db, project, st["todo"])
    hidden_blocker = await make_task(db, secret, secret_st["todo"], title="Classified")
    db.add(TaskDependency(blocker_id=hidden_blocker.id, blocked_id=task.id))
    await db.commit()
    assert (await team.member.get(f"{API}/tasks/{task.id}")).json()["blocked_by"] == []
    assert [b["title"] for b in (await team.owner.get(f"{API}/tasks/{task.id}")).json()["blocked_by"]] == ["Classified"]


async def test_get_task_access(team, db, client):
    project, st = await web_project(db, team)
    secret, secret_st = await make_project(
        db, team.workspace_id, name="Secret", key="SEC", visibility=ProjectVisibility.private
    )
    task = await make_task(db, project, st["todo"])
    secret_task = await make_task(db, secret, secret_st["todo"])
    outsider = await signup(client, "Out Sider", workspace_name="Elsewhere")
    assert (await team.guest.get(f"{API}/tasks/{task.id}")).status_code == 404
    assert (await outsider.get(f"{API}/tasks/{task.id}")).status_code == 404
    assert (await team.member.get(f"{API}/tasks/{secret_task.id}")).status_code == 404
    assert (await team.admin.get(f"{API}/tasks/{secret_task.id}")).status_code == 200
    assert (await team.member.get(f"{API}/tasks/{uuid.uuid4()}")).status_code == 404


async def test_get_by_ref(team, db, client):
    project, st = await web_project(db, team)
    task = await make_task(db, project, st["todo"], title="Ref me")
    trashed = await make_task(db, project, st["todo"])
    trashed.deleted_at = datetime.now(UTC)
    await db.commit()
    base = f"{API}/tasks/by-ref/{team.workspace_id}"
    r = await team.member.get(f"{base}/web-1")
    assert r.status_code == 200 and r.json()["id"] == str(task.id)
    assert (await team.member.get(f"{base}/WEB-1")).json()["title"] == "Ref me"
    assert (await team.member.get(f"{base}/WEB-2")).status_code == 404  # trashed
    assert (await team.member.get(f"{base}/WEB-99")).status_code == 404
    assert (await team.member.get(f"{base}/not-a-ref")).status_code == 404
    assert (await team.guest.get(f"{base}/WEB-1")).status_code == 404

    outsider = await signup(client, "Out Sider", workspace_name="Elsewhere")
    other_ws = outsider.user["workspaces"][0]["workspace_id"]
    other_project, other_st = await make_project(db, other_ws, name="Website", key="WEB")
    await make_task(db, other_project, other_st["todo"])
    assert (await outsider.get(f"{base}/WEB-1")).status_code == 404  # not their workspace
    assert (await team.member.get(f"{API}/tasks/by-ref/{other_ws}/WEB-1")).status_code == 404


# ─── Lists ───


async def test_project_task_list(team, db, client):
    project, st = await web_project(db, team)
    last = await make_task(db, project, st["todo"], title="Last", position=3000)
    await make_task(db, project, st["done"], title="First", position=1000)
    await make_task(db, project, st["todo"], title="Middle sub", position=2000, parent_id=last.id)
    trashed = await make_task(db, project, st["todo"], title="Trashed", position=500)
    trashed.deleted_at = datetime.now(UTC)
    await db.commit()
    url = f"{API}/projects/{project.id}/tasks"

    r = await team.member2.get(url)  # viewers can read
    assert titles(r) == ["First", "Middle sub", "Last"]
    assert r.json()["total"] == 3 and r.json()["next_cursor"] is None
    assert titles(await team.member.get(url, params={"top_level": True})) == ["First", "Last"]
    assert titles(await team.member.get(url, params={"state": "open"})) == ["Middle sub", "Last"]
    paged = await team.member.get(url, params={"limit": 2})
    assert titles(paged) == ["First", "Middle sub"] and paged.json()["next_cursor"]
    rest = await team.member.get(url, params={"limit": 2, "cursor": paged.json()["next_cursor"]})
    assert titles(rest) == ["Last"] and rest.json()["next_cursor"] is None

    outsider = await signup(client, "Out Sider", workspace_name="Elsewhere")
    assert (await team.guest.get(url)).status_code == 404
    assert (await outsider.get(url)).status_code == 404
    assert (await team.member.get(url, params={"limit": 2001})).status_code == 422


async def _workspace_fixture(team, db):
    web, web_st = await web_project(db, team, members={team.member.id: "member", team.guest.id: "viewer"})
    ops, ops_st = await make_project(
        db,
        team.workspace_id,
        name="Ops",
        key="OPS",
        visibility=ProjectVisibility.private,
        members={team.member2.id: "member"},
    )
    milestone = await make_milestone(db, web)
    labels = await labels_by_name(team.member, team.workspace_id)
    d = today()
    a = await make_task(
        db,
        web,
        web_st["todo"],
        title="Landing page",
        assignee_id=team.member.id,
        priority=Priority.urgent,
        due_date=d - timedelta(days=1),
    )
    b = await make_task(
        db, web, web_st["done"], title="Analytics", assignee_id=team.member2.id, priority=Priority.low, due_date=d
    )
    c = await make_task(
        db, web, web_st["in_progress"], title="Checkout", priority=Priority.high, due_date=d + timedelta(days=3)
    )
    dd = await make_task(db, web, web_st["backlog"], title="Docs 100%", parent_id=c.id)
    e = await make_task(
        db, ops, ops_st["todo"], title="Ops runbook", assignee_id=team.member2.id, due_date=d + timedelta(days=10)
    )
    trashed = await make_task(db, web, web_st["todo"], title="Landing trash")
    trashed.deleted_at = datetime.now(UTC)
    c.milestone_id = milestone.id
    db.add_all(
        [
            TaskLabel(task_id=a.id, label_id=uid(labels["Bug"])),
            TaskLabel(task_id=c.id, label_id=uid(labels["Feature"])),
        ]
    )
    await db.commit()
    return {"web": web, "ops": ops, "milestone": milestone, "labels": labels, "tasks": (a, b, c, dd, e)}


async def test_workspace_task_filters(team, db):
    fx = await _workspace_fixture(team, db)
    url = f"{API}/workspaces/{team.workspace_id}/tasks"

    async def ls(**params):
        return titles(await team.member.get(url, params=params))

    all_web = ["Landing page", "Analytics", "Checkout", "Docs 100%"]
    assert await ls() == all_web  # private Ops project and trashed tasks are hidden
    assert await ls(assignee="me") == ["Landing page"]
    assert await ls(assignee="unassigned") == ["Checkout", "Docs 100%"]
    assert await ls(assignee=team.member2.id) == ["Analytics"]
    assert await ls(state="open") == ["Landing page", "Checkout", "Docs 100%"]
    assert await ls(state="closed") == ["Analytics"]
    assert await ls(status_category=["todo", "in_progress"]) == ["Landing page", "Checkout"]
    assert await ls(priority=["urgent", "high"]) == ["Landing page", "Checkout"]
    assert await ls(label_id=fx["labels"]["Bug"]) == ["Landing page"]
    assert await ls(label_id=[fx["labels"]["Bug"], fx["labels"]["Feature"]]) == ["Landing page", "Checkout"]
    assert await ls(milestone_id=str(fx["milestone"].id)) == ["Checkout"]
    assert await ls(due="overdue") == ["Landing page"]
    assert await ls(due="today") == ["Analytics"]
    assert await ls(due="week") == ["Analytics", "Checkout"]
    assert await ls(due="none") == ["Docs 100%"]
    assert await ls(due="scheduled") == ["Landing page", "Analytics", "Checkout"]
    assert await ls(q="LANDING") == ["Landing page"]
    assert await ls(q="web-3") == ["Checkout"]
    assert await ls(q="100%") == ["Docs 100%"]
    assert await ls(q="%") == ["Docs 100%"]  # LIKE wildcards are escaped
    assert await ls(q="_") == []
    assert await ls(top_level=True) == ["Landing page", "Analytics", "Checkout"]
    assert await ls(project_id=str(fx["ops"].id)) == []  # can't see it
    assert await ls(project_id=str(fx["web"].id), assignee="me") == ["Landing page"]

    r = await team.member.get(url, params={"assignee": "nobody"})
    assert r.status_code == 400 and r.json()["code"] == "invalid_filter"
    assert (await team.member.get(url, params={"due": "someday"})).status_code == 422
    assert (await team.member.get(url, params={"limit": 501})).status_code == 422


async def test_workspace_task_sorting(team, db):
    await _workspace_fixture(team, db)
    url = f"{API}/workspaces/{team.workspace_id}/tasks"

    async def ls(sort):
        return titles(await team.member.get(url, params={"sort": sort}))

    assert await ls("due_date") == ["Landing page", "Analytics", "Checkout", "Docs 100%"]
    assert await ls("priority") == ["Landing page", "Checkout", "Analytics", "Docs 100%"]
    assert await ls("title") == ["Analytics", "Checkout", "Docs 100%", "Landing page"]
    assert await ls("created") == ["Docs 100%", "Checkout", "Analytics", "Landing page"]
    landing = (await team.member.get(url, params={"q": "landing"})).json()["items"][0]
    await team.member.patch(f"{API}/tasks/{landing['id']}", {"title": "Landing page v2"})
    assert (await ls("updated"))[0] == "Landing page v2"
    assert (await team.member.get(url, params={"sort": "random"})).status_code == 422


async def test_workspace_task_visibility_and_pagination(team, db, client):
    await _workspace_fixture(team, db)
    url = f"{API}/workspaces/{team.workspace_id}/tasks"
    assert (await team.member2.get(url)).json()["total"] == 5  # web (viewer) + ops (member)
    assert titles(await team.member2.get(url, params={"assignee": "me"})) == ["Ops runbook", "Analytics"]
    assert (await team.guest.get(url)).json()["total"] == 4  # only the project they were added to
    assert (await team.admin.get(url)).json()["total"] == 5

    seen = []
    cursor = None
    for _ in range(3):
        params = {"limit": 2, **({"cursor": cursor} if cursor else {})}
        page = (await team.admin.get(url, params=params)).json()
        assert page["total"] == 5
        seen += [t["title"] for t in page["items"]]
        cursor = page["next_cursor"]
        if cursor is None:
            break
    assert len(seen) == 5 and len(set(seen)) == 5 and cursor is None

    r = await team.admin.get(url, params={"cursor": "!!garbage!!"})
    assert r.status_code == 400 and r.json()["code"] == "invalid_cursor"
    outsider = await signup(client, "Out Sider", workspace_name="Elsewhere")
    assert (await outsider.get(url)).status_code == 404


# ─── Update ───


async def test_status_transitions_and_notifications(team, db):
    project, st = await web_project(db, team)
    shipped = TaskStatus(
        id=uuid.uuid4(),
        project_id=project.id,
        name="Shipped",
        category=StatusCategory.done,
        color="#000000",
        position=9,
    )
    db.add(shipped)
    await db.commit()
    task = (await team.member.post(f"{API}/projects/{project.id}/tasks", {"title": "Flow"})).json()
    url = f"{API}/tasks/{task['id']}"
    assert (await team.member2.post(f"{url}/watch")).status_code == 200

    r = await team.member.patch(url, {"status_id": str(st["in_progress"])})
    assert r.status_code == 200, r.text
    started = r.json()["started_at"]
    assert started is not None and r.json()["completed_at"] is None

    done = (await team.member.patch(url, {"status_id": str(st["done"])})).json()
    assert done["completed_at"] is not None and done["started_at"] == started
    still_done = (await team.member.patch(url, {"status_id": str(shipped.id)})).json()
    assert still_done["completed_at"] == done["completed_at"]  # done → done keeps the timestamp
    reopened = (await team.member.patch(url, {"status_id": str(st["todo"])})).json()
    assert reopened["completed_at"] is None and reopened["started_at"] == started
    again = (await team.member.patch(url, {"status_id": str(st["review"])})).json()
    assert again["started_at"] == started  # only the first entry stamps started_at

    updates = await activities(db, task["id"], "updated")
    assert updates[0].data == {"changes": {"status": {"from": "To Do", "to": "In Progress"}}}
    assert updates[2].data["changes"]["status"] == {"from": "Done", "to": "Shipped"}
    watched = await notifications(db, team.member2.id, NotificationType.status_changed)
    assert len(watched) == 5 and {"from": "To Do", "to": "In Progress"} in [n.data for n in watched]
    assert await notifications(db, team.member.id, NotificationType.status_changed) == []  # actor

    r = await team.member.patch(url, {"status_id": str(uuid.uuid4())})
    assert r.status_code == 400 and r.json()["code"] == "invalid_status"


async def test_status_change_moves_task_to_bottom_of_new_column(team, db):
    project, st = await web_project(db, team)
    await make_task(db, project, st["done"], position=50_000)
    task = await make_task(db, project, st["todo"], position=10)
    r = await team.member.patch(f"{API}/tasks/{task.id}", {"status_id": str(st["done"])})
    assert r.json()["position"] > 50_000


async def test_assignee_change_notifies_and_watches(team, db):
    project, st = await web_project(db, team)
    task = await make_task(db, project, st["todo"])
    url = f"{API}/tasks/{task.id}"
    r = await team.member.patch(url, {"assignee_id": team.member2.id})
    assert r.status_code == 200 and r.json()["assignee"]["name"] == "Max Member"
    assert team.member2.id in {w["id"] for w in r.json()["watchers"]}
    assert len(await notifications(db, team.member2.id, NotificationType.assigned)) == 1

    r = await team.member.patch(url, {"assignee_id": None})
    assert r.json()["assignee"] is None
    changes = [a.data["changes"]["assignee"] for a in await activities(db, task.id, "updated")]
    assert changes == [{"from": None, "to": "Max Member"}, {"from": "Max Member", "to": None}]

    r = await team.member.patch(url, {"assignee_id": str(uuid.uuid4())})
    assert r.status_code == 400 and r.json()["code"] == "invalid_assignee"


async def test_update_fields_and_explicit_nulls(team, db):
    project, st = await web_project(db, team)
    milestone = await make_milestone(db, project, "GA")
    task = await make_task(db, project, st["todo"], title="Old title")
    url = f"{API}/tasks/{task.id}"
    r = await team.member.patch(
        url,
        {
            "title": " New title ",
            "description": "Details",
            "priority": "urgent",
            "milestone_id": str(milestone.id),
            "start_date": "2026-03-01",
            "due_date": "2026-03-05",
            "estimate_hours": 3,
        },
    )
    assert r.status_code == 200, r.text
    t = r.json()
    assert (t["title"], t["description"], t["priority"]) == ("New title", "Details", "urgent")
    assert t["milestone"]["name"] == "GA" and t["estimate_hours"] == 3
    changes = (await activities(db, task.id, "updated"))[0].data["changes"]
    assert changes["title"] == {"from": "Old title", "to": "New title"}
    assert changes["milestone"] == {"from": None, "to": "GA"}
    assert changes["due_date"] == {"from": None, "to": "2026-03-05"}
    assert changes["priority"] == {"from": "none", "to": "urgent"}

    # Dates must stay ordered, taking the stored values into account
    r = await team.member.patch(url, {"due_date": "2026-02-01"})
    assert r.status_code == 400 and r.json()["code"] == "invalid_dates"
    r = await team.member.patch(url, {"start_date": None, "due_date": "2026-02-01"})
    assert r.status_code == 200 and r.json()["start_date"] is None

    r = await team.member.patch(url, {"milestone_id": None, "due_date": None, "estimate_hours": None})
    t = r.json()
    assert t["milestone"] is None and t["due_date"] is None and t["estimate_hours"] is None

    # non-nullable fields can't be cleared
    r = await team.member.patch(url, {"title": None})
    assert r.status_code == 400 and r.json()["code"] == "field_required"
    assert (await team.member.patch(url, {"title": ""})).status_code == 422

    # a no-op PATCH records nothing
    before = len(await activities(db, task.id))
    assert (await team.member.patch(url, {"title": "New title"})).status_code == 200
    assert len(await activities(db, task.id)) == before


async def test_update_labels_replace_set(team, db, client):
    project, st = await web_project(db, team)
    task = await make_task(db, project, st["todo"])
    labels = await labels_by_name(team.member, team.workspace_id)
    url = f"{API}/tasks/{task.id}"
    r = await team.member.patch(url, {"label_ids": [labels["Feature"], labels["Bug"]]})
    assert [lb["name"] for lb in r.json()["labels"]] == ["Bug", "Feature"]
    r = await team.member.patch(url, {"label_ids": [labels["Design"]]})
    assert [lb["name"] for lb in r.json()["labels"]] == ["Design"]
    assert (await activities(db, task.id, "updated"))[1].data["changes"]["labels"] == {
        "from": ["Bug", "Feature"],
        "to": ["Design"],
    }
    assert (await team.member.patch(url, {"label_ids": []})).json()["labels"] == []

    outsider = await signup(client, "Out Sider", workspace_name="Elsewhere")
    foreign = next(iter((await labels_by_name(outsider, outsider.user["workspaces"][0]["workspace_id"])).values()))
    r = await team.member.patch(url, {"label_ids": [foreign]})
    assert r.status_code == 400 and r.json()["code"] == "invalid_label"


async def test_update_parent_rules(team, db):
    project, st = await web_project(db, team)
    other, other_st = await make_project(db, team.workspace_id, name="Ops", key="OPS")
    parent = await make_task(db, project, st["todo"], title="Parent")
    child = await make_task(db, project, st["todo"], title="Child", parent_id=parent.id)
    loose = await make_task(db, project, st["todo"], title="Loose")
    foreign = await make_task(db, other, other_st["todo"])

    async def set_parent(task, parent_id):
        return await team.member.patch(f"{API}/tasks/{task.id}", {"parent_id": parent_id and str(parent_id)})

    r = await set_parent(loose, child.id)
    assert r.status_code == 400 and r.json()["code"] == "nested_subtask"
    r = await set_parent(parent, loose.id)  # parent has subtasks
    assert r.status_code == 400 and r.json()["code"] == "nested_subtask"
    assert (await set_parent(loose, loose.id)).json()["code"] == "invalid_parent"
    assert (await set_parent(loose, foreign.id)).json()["code"] == "invalid_parent"

    r = await set_parent(loose, parent.id)
    assert r.status_code == 200 and r.json()["parent"]["title"] == "Parent"
    assert (await activities(db, loose.id, "updated"))[0].data["changes"]["parent"] == {"from": None, "to": "WEB-1"}
    r = await set_parent(child, None)
    assert r.status_code == 200 and r.json()["parent"] is None and r.json()["parent_id"] is None


async def test_update_permissions(team, db, client):
    project, st = await web_project(db, team)
    task = await make_task(db, project, st["todo"])
    outsider = await signup(client, "Out Sider", workspace_name="Elsewhere")
    url = f"{API}/tasks/{task.id}"
    assert (await team.member2.patch(url, {"title": "x"})).status_code == 403
    assert (await team.guest.patch(url, {"title": "x"})).status_code == 404
    assert (await outsider.patch(url, {"title": "x"})).status_code == 404
    assert (await team.owner.patch(url, {"title": "Owner edit"})).status_code == 200


# ─── Delete / restore ───


async def test_delete_and_restore(team, db):
    project, st = await web_project(db, team)
    parent = await make_task(db, project, st["todo"], title="Parent")
    kept = await make_task(db, project, st["todo"], title="Kept", parent_id=parent.id)
    earlier = await make_task(db, project, st["todo"], title="Earlier", parent_id=parent.id)
    assert (await team.member.delete(f"{API}/tasks/{earlier.id}")).status_code == 200
    r = await team.member.delete(f"{API}/tasks/{parent.id}")
    assert r.status_code == 200 and r.json() == {"ok": True}

    assert (await team.member.get(f"{API}/tasks/{parent.id}")).status_code == 404
    assert (await team.member.get(f"{API}/tasks/{kept.id}")).status_code == 404
    assert (await team.member.get(f"{API}/projects/{project.id}/tasks")).json()["total"] == 0
    assert (await team.member.delete(f"{API}/tasks/{parent.id}")).status_code == 404
    assert (await activities(db, parent.id, "deleted"))[0].data["subtasks"] == 1

    # A subtask can't come back before its parent
    r = await team.member.post(f"{API}/tasks/{kept.id}/restore")
    assert r.status_code == 400 and r.json()["code"] == "parent_deleted"

    r = await team.member.post(f"{API}/tasks/{parent.id}/restore")
    assert r.status_code == 200, r.text
    assert [s["title"] for s in r.json()["subtasks"]] == ["Kept"]  # "Earlier" was trashed separately
    assert len(await activities(db, parent.id, "restored")) == 1
    r = await team.member.post(f"{API}/tasks/{earlier.id}/restore")
    assert r.status_code == 200
    assert (await team.member.post(f"{API}/tasks/{earlier.id}/restore")).status_code == 200  # idempotent
    assert (await team.member.get(f"{API}/projects/{project.id}/tasks")).json()["total"] == 3


async def test_delete_restore_permissions(team, db):
    project, st = await web_project(db, team)
    task = await make_task(db, project, st["todo"])
    assert (await team.member2.delete(f"{API}/tasks/{task.id}")).status_code == 403
    assert (await team.guest.delete(f"{API}/tasks/{task.id}")).status_code == 404
    await team.member.delete(f"{API}/tasks/{task.id}")
    assert (await team.member2.post(f"{API}/tasks/{task.id}/restore")).status_code == 403
    assert (await team.guest.post(f"{API}/tasks/{task.id}/restore")).status_code == 404


# ─── Move ───


async def test_move_within_and_across_columns(team, db, monkeypatch):
    project, st = await web_project(db, team)
    t1 = await make_task(db, project, st["todo"], title="T1", position=1024)
    t2 = await make_task(db, project, st["todo"], title="T2", position=2048)
    t3 = await make_task(db, project, st["todo"], title="T3", position=3072)
    url = f"{API}/projects/{project.id}/tasks"

    r = await team.member.post(f"{API}/tasks/{t3.id}/move", {"after_id": str(t1.id), "before_id": str(t2.id)})
    assert r.status_code == 200, r.text
    assert r.json()["position"] == 1536 and r.json()["ref"] == "WEB-3"
    assert titles(await team.member.get(url)) == ["T1", "T3", "T2"]

    # Only after_id: lands directly below T1, never past the next task
    r = await team.member.post(f"{API}/tasks/{t2.id}/move", {"after_id": str(t1.id)})
    assert 1024 < r.json()["position"] < 1536
    # Only before_id: lands directly above T1
    r = await team.member.post(f"{API}/tasks/{t3.id}/move", {"before_id": str(t1.id)})
    assert r.json()["position"] < 1024
    assert titles(await team.member.get(url)) == ["T3", "T1", "T2"]

    events = capture_events(monkeypatch)
    r = await team.member.post(f"{API}/tasks/{t1.id}/move", {"status_id": str(st["in_progress"])})
    assert r.status_code == 200
    moved = r.json()
    assert moved["status"]["category"] == "in_progress" and moved["started_at"] is not None
    assert (await activities(db, t1.id, "updated"))[0].data["changes"]["status"] == {
        "from": "To Do",
        "to": "In Progress",
    }
    await asyncio.sleep(0.01)
    assert any(m["type"] == "task.updated" and m["data"]["moved"] for m, _ in events)

    r = await team.member.post(f"{API}/tasks/{t2.id}/move", {"status_id": str(st["in_progress"])})
    assert r.json()["position"] > moved["position"]  # no neighbours → bottom of the column


async def test_move_validation(team, db):
    project, st = await web_project(db, team)
    other, other_st = await make_project(db, team.workspace_id, name="Ops", key="OPS")
    t1 = await make_task(db, project, st["todo"])
    t2 = await make_task(db, project, st["todo"])
    doing = await make_task(db, project, st["in_progress"])
    foreign = await make_task(db, other, other_st["todo"])
    url = f"{API}/tasks/{t1.id}/move"

    for body in (
        {"after_id": str(doing.id)},  # neighbour in another column
        {"status_id": str(st["in_progress"]), "after_id": str(t2.id)},
        {"after_id": str(foreign.id)},
        {"before_id": str(t1.id)},  # itself
        {"after_id": str(uuid.uuid4())},
    ):
        r = await team.member.post(url, body)
        assert r.status_code == 400 and r.json()["code"] == "invalid_neighbor", body
    r = await team.member.post(url, {"status_id": str(other_st["todo"])})
    assert r.status_code == 400 and r.json()["code"] == "invalid_status"
    r = await team.member.post(url, {"after_id": str(t2.id), "before_id": str(t2.id)})
    assert r.status_code == 400
    assert (await team.member2.post(url, {})).status_code == 403
    assert (await team.guest.post(url, {})).status_code == 404


async def test_move_rebalances_tight_column(team, db):
    project, st = await web_project(db, team)
    a = await make_task(db, project, st["todo"], title="A", position=1.0)
    b = await make_task(db, project, st["todo"], title="B", position=1.0 + 1e-7)
    c = await make_task(db, project, st["todo"], title="C", position=5.0)
    r = await team.member.post(f"{API}/tasks/{c.id}/move", {"after_id": str(a.id), "before_id": str(b.id)})
    assert r.status_code == 200, r.text
    items = (await team.member.get(f"{API}/projects/{project.id}/tasks")).json()["items"]
    assert [t["title"] for t in items] == ["A", "C", "B"]
    positions = [t["position"] for t in items]
    assert positions == sorted(positions) and len(set(positions)) == 3
    assert positions[1] - positions[0] > 1


# ─── Bulk ───


async def test_bulk_update(team, db):
    project, st = await web_project(db, team)
    milestone = await make_milestone(db, project)
    labels = await labels_by_name(team.member, team.workspace_id)
    t1 = await make_task(db, project, st["todo"], title="One")
    t2 = await make_task(db, project, st["in_progress"], title="Two")
    t3 = await make_task(db, project, st["done"], title="Three", completed_at=datetime.now(UTC))
    db.add(TaskLabel(task_id=t1.id, label_id=uid(labels["Feature"])))
    await db.commit()
    ids = [str(t1.id), str(t2.id), str(t3.id)]

    r = await team.member.patch(
        f"{API}/tasks/bulk",
        {
            "task_ids": ids,
            "status_id": str(st["done"]),
            "priority": "high",
            "assignee_id": team.member2.id,
            "milestone_id": str(milestone.id),
            "due_date": "2026-12-01",
            "add_label_ids": [labels["Bug"]],
            "remove_label_ids": [labels["Feature"]],
        },
    )
    assert r.status_code == 200, r.text
    assert r.json() == {"updated": 3, "task_ids": ids}
    for tid in ids:
        d = (await team.member.get(f"{API}/tasks/{tid}")).json()
        assert d["status"]["category"] == "done" and d["completed_at"] is not None
        assert d["priority"] == "high" and d["assignee"]["id"] == team.member2.id
        assert d["milestone"]["id"] == str(milestone.id) and d["due_date"] == "2026-12-01"
        assert [lb["name"] for lb in d["labels"]] == ["Bug"]
        assert team.member2.id in {w["id"] for w in d["watchers"]}
    assert len(await notifications(db, team.member2.id, NotificationType.assigned)) == 3
    one = (await activities(db, t1.id, "updated"))[0].data["changes"]
    assert one["status"] == {"from": "To Do", "to": "Done"}
    assert one["labels"] == {"from": ["Feature"], "to": ["Bug"]}
    assert "status" not in (await activities(db, t3.id, "updated"))[0].data["changes"]  # already done

    # Explicit nulls clear; clear_assignee unassigns
    r = await team.member.patch(
        f"{API}/tasks/bulk", {"task_ids": ids, "clear_assignee": True, "due_date": None, "milestone_id": None}
    )
    assert r.json()["updated"] == 3
    t = await fresh_task(db, t1.id)
    assert t.assignee_id is None and t.due_date is None and t.milestone_id is None

    # Nothing to change → nothing reported
    r = await team.member.patch(f"{API}/tasks/bulk", {"task_ids": ids, "priority": "high"})
    assert r.json() == {"updated": 0, "task_ids": []}


async def test_bulk_validation_is_all_or_nothing(team, db):
    project, st = await web_project(db, team)
    other, other_st = await make_project(
        db, team.workspace_id, name="Ops", key="OPS", visibility=ProjectVisibility.private
    )
    other_milestone = await make_milestone(db, other)
    t1 = await make_task(db, project, st["todo"], title="One", start_date=today())
    hidden = await make_task(db, other, other_st["todo"])
    url = f"{API}/tasks/bulk"

    async def check(body, status, code=None, actor=None):
        r = await (actor or team.member).patch(url, {"task_ids": [str(t1.id)], **body})
        assert r.status_code == status, (body, r.text)
        if code:
            assert r.json()["code"] == code
        t = await fresh_task(db, t1.id)
        assert t.priority == Priority.none and t.status_id == st["todo"]  # untouched

    await check({"task_ids": [str(t1.id), str(hidden.id)], "priority": "high"}, 404, "tasks_not_found")
    await check({"task_ids": [str(t1.id), str(uuid.uuid4())], "priority": "high"}, 404)
    await check({"status_id": str(other_st["done"]), "priority": "high"}, 400, "status_project_mismatch")
    await check({"milestone_id": str(other_milestone.id), "priority": "high"}, 400, "milestone_project_mismatch")
    await check({"assignee_id": team.member2.id, "clear_assignee": True, "priority": "high"}, 400)
    await check({"due_date": (today() - timedelta(days=1)).isoformat(), "priority": "high"}, 400, "invalid_dates")
    await check({"add_label_ids": [str(uuid.uuid4())], "priority": "high"}, 400, "invalid_label")
    await check({"priority": "high"}, 403, actor=team.member2)  # view-only
    await check({"priority": "high"}, 404, actor=team.guest)
    await check({"task_ids": [], "priority": "high"}, 422)
    # Admin sees both projects, but the status still has to fit every task
    r = await team.admin.patch(url, {"task_ids": [str(t1.id), str(hidden.id)], "status_id": str(st["done"])})
    assert r.status_code == 400 and r.json()["code"] == "status_project_mismatch"


async def test_bulk_across_projects_and_delete(team, db, monkeypatch):
    web, web_st = await web_project(db, team)
    ops, ops_st = await make_project(db, team.workspace_id, name="Ops", key="OPS", members={team.member.id: "lead"})
    a = await make_task(db, web, web_st["todo"], title="A")
    sub = await make_task(db, web, web_st["todo"], title="A.1", parent_id=a.id)
    b = await make_task(db, ops, ops_st["todo"], title="B")
    events = capture_events(monkeypatch)

    r = await team.member.patch(f"{API}/tasks/bulk", {"task_ids": [str(a.id), str(b.id)], "priority": "urgent"})
    assert r.json()["updated"] == 2
    await asyncio.sleep(0.01)
    updated = [m for m, _ in events if m["type"] == "task.updated"]
    assert {m["project_id"] for m in updated} == {web.id, ops.id}

    r = await team.member.patch(f"{API}/tasks/bulk", {"task_ids": [str(a.id), str(b.id)], "delete": True})
    assert r.status_code == 200 and r.json()["updated"] == 2
    for t in (a, sub, b):
        assert (await fresh_task(db, t.id)).deleted_at is not None
    assert len(await activities(db, a.id, "deleted")) == 1
    r = await team.member.patch(f"{API}/tasks/bulk", {"task_ids": [str(a.id)], "priority": "low"})
    assert r.status_code == 404


async def test_bulk_assigning_guest_adds_project_access(team, db):
    project, st = await web_project(db, team)
    t1 = await make_task(db, project, st["todo"])
    r = await team.member.patch(f"{API}/tasks/bulk", {"task_ids": [str(t1.id)], "assignee_id": team.guest.id})
    assert r.status_code == 200, r.text
    assert (await db.get(ProjectMember, (project.id, uid(team.guest.id)))).role == ProjectRole.member
    assert (await team.guest.get(f"{API}/tasks/{t1.id}")).status_code == 200


# ─── Dependencies ───


async def test_dependencies(team, db):
    project, st = await web_project(db, team)
    a = await make_task(db, project, st["todo"], title="A")
    b = await make_task(db, project, st["todo"], title="B")
    c = await make_task(db, project, st["todo"], title="C")

    r = await team.member.post(f"{API}/tasks/{a.id}/dependencies/{b.id}")  # B blocks A
    assert r.status_code == 201, r.text
    assert [t["title"] for t in r.json()["blocked_by"]] == ["B"] and r.json()["blocked_by_count"] == 1
    assert [t["title"] for t in (await team.member.get(f"{API}/tasks/{b.id}")).json()["blocking"]] == ["A"]

    r = await team.member.post(f"{API}/tasks/{a.id}/dependencies/{b.id}")
    assert r.status_code == 409 and r.json()["code"] == "dependency_exists"
    r = await team.member.post(f"{API}/tasks/{a.id}/dependencies/{a.id}")
    assert r.status_code == 400 and r.json()["code"] == "self_dependency"
    r = await team.member.post(f"{API}/tasks/{b.id}/dependencies/{a.id}")  # A blocks B: direct cycle
    assert r.status_code == 400 and r.json()["code"] == "dependency_cycle"
    assert (await team.member.post(f"{API}/tasks/{b.id}/dependencies/{c.id}")).status_code == 201  # C blocks B
    r = await team.member.post(f"{API}/tasks/{c.id}/dependencies/{a.id}")  # A blocks C: C→B→A→C
    assert r.status_code == 400 and r.json()["code"] == "dependency_cycle"

    added = await activities(db, a.id, "dependency_added")
    assert added[0].data["blocker"]["ref"] == "WEB-2" and added[0].data["blocked"]["ref"] == "WEB-1"

    # Finishing the blocker clears the open-blocker count
    await team.member.patch(f"{API}/tasks/{b.id}", {"status_id": str(st["done"])})
    assert (await team.member.get(f"{API}/tasks/{a.id}")).json()["blocked_by_count"] == 0

    r = await team.member.delete(f"{API}/tasks/{a.id}/dependencies/{b.id}")
    assert r.status_code == 200 and r.json() == {"ok": True}
    assert (await team.member.get(f"{API}/tasks/{a.id}")).json()["blocked_by"] == []
    r = await team.member.delete(f"{API}/tasks/{a.id}/dependencies/{b.id}")
    assert r.status_code == 404 and r.json()["code"] == "dependency_not_found"
    assert len(await activities(db, a.id, "dependency_removed")) == 1


async def test_dependency_permissions(team, db):
    project, st = await web_project(db, team)
    readable, readable_st = await make_project(db, team.workspace_id, name="Docs", key="DOC")  # member: viewer
    secret, secret_st = await make_project(
        db, team.workspace_id, name="Secret", key="SEC", visibility=ProjectVisibility.private
    )
    task = await make_task(db, project, st["todo"])
    readable_task = await make_task(db, readable, readable_st["todo"])
    secret_task = await make_task(db, secret, secret_st["todo"])

    # viewer+ on the blocker's project is enough
    assert (await team.member.post(f"{API}/tasks/{task.id}/dependencies/{readable_task.id}")).status_code == 201
    # but member+ is needed on the blocked task's project
    r = await team.member.post(f"{API}/tasks/{readable_task.id}/dependencies/{task.id}")
    assert r.status_code == 403
    assert (await team.member.post(f"{API}/tasks/{task.id}/dependencies/{secret_task.id}")).status_code == 404
    assert (await team.guest.post(f"{API}/tasks/{task.id}/dependencies/{readable_task.id}")).status_code == 404
    assert (await team.member2.delete(f"{API}/tasks/{task.id}/dependencies/{readable_task.id}")).status_code == 403


async def test_dependency_must_stay_in_workspace(team, db):
    project, st = await web_project(db, team)
    task = await make_task(db, project, st["todo"])
    r = await team.owner.post(f"{API}/workspaces", {"name": "Second"})
    other_ws = r.json()["id"]
    other, other_st = await make_project(db, other_ws, name="Other", key="OTH")
    foreign = await make_task(db, other, other_st["todo"])
    # the owner can see both tasks, but they live in different workspaces
    assert (await team.owner.get(f"{API}/tasks/{foreign.id}")).status_code == 200
    assert (await team.owner.post(f"{API}/tasks/{task.id}/dependencies/{foreign.id}")).status_code == 404
    assert (await team.owner.post(f"{API}/tasks/{foreign.id}/dependencies/{task.id}")).status_code == 404


# ─── Watchers ───


async def test_watch_and_unwatch(team, db):
    project, st = await web_project(db, team)
    task = await make_task(db, project, st["todo"])
    url = f"{API}/tasks/{task.id}/watch"
    for _ in range(2):
        r = await team.member2.post(url)  # viewers can watch
        assert r.status_code == 200 and r.json() == {"ok": True}
    d = (await team.member2.get(f"{API}/tasks/{task.id}")).json()
    assert d["is_watching"] is True and [w["id"] for w in d["watchers"]] == [team.member2.id]
    for _ in range(2):
        assert (await team.member2.delete(url)).status_code == 200
    assert (await team.member2.get(f"{API}/tasks/{task.id}")).json()["is_watching"] is False
    rows = list(await db.scalars(select(TaskWatcher).where(TaskWatcher.task_id == task.id)))
    assert rows == []
    assert (await team.guest.post(url)).status_code == 404
    assert (await team.guest.delete(url)).status_code == 404
