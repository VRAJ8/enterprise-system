"""Time tracking: manual entries, the running timer, visibility and editing rules."""

import asyncio
import uuid
from datetime import UTC, date, datetime, time, timedelta
from zoneinfo import ZoneInfo

import pytest
from sqlalchemy import func, select

from app.api.v1 import time_tracking
from app.core.db import utcnow
from app.models import Activity, ProjectMember, ProjectRole, ProjectVisibility, TimeEntry, User
from app.services import time as svc
from tests.conftest import signup
from tests.factories import make_project, make_task

LA = ZoneInfo("America/Los_Angeles")


# ─── Helpers ───


def _ts(value: str) -> datetime:
    return datetime.fromisoformat(value)


async def _set_tz(actor, tz: str) -> None:
    r = await actor.patch("/api/v1/auth/me", {"timezone": tz})
    assert r.status_code == 200, r.text


async def _log(actor, task_id, minutes: int = 30, **body) -> dict:
    r = await actor.post(f"/api/v1/tasks/{task_id}/time-entries", {"minutes": minutes, **body})
    assert r.status_code == 201, r.text
    return r.json()


async def _list(actor, workspace_id, **params) -> list[dict]:
    r = await actor.get(f"/api/v1/workspaces/{workspace_id}/time-entries", params=params)
    assert r.status_code == 200, r.text
    return r.json()


async def _start(actor, task_id, **body) -> dict:
    r = await actor.post(f"/api/v1/tasks/{task_id}/timer/start", body or None)
    assert r.status_code == 201, r.text
    return r.json()["entry"]


async def _timer(actor) -> dict | None:
    r = await actor.get("/api/v1/timer")
    assert r.status_code == 200, r.text
    return r.json()["entry"]


async def _add_running(db, project, task, user_id, *, started_at: datetime) -> TimeEntry:
    """Insert a timer that has been running since `started_at` (the API always starts timers 'now')."""
    entry = TimeEntry(
        id=uuid.uuid4(),
        workspace_id=project.workspace_id,
        task_id=task.id,
        user_id=uuid.UUID(str(user_id)),
        started_at=started_at,
        ended_at=None,
        minutes=0,
    )
    db.add(entry)
    await db.commit()
    return entry


async def _activities(db, task_id, verb: str) -> list[Activity]:
    rows = await db.scalars(
        select(Activity).where(Activity.task_id == task_id, Activity.verb == verb).order_by(Activity.created_at)
    )
    return list(rows)


async def _running_count(db, user_id) -> int:
    return await db.scalar(
        select(func.count())
        .select_from(TimeEntry)
        .where(TimeEntry.user_id == uuid.UUID(str(user_id)), TimeEntry.ended_at.is_(None))
    )


@pytest.fixture
def events(monkeypatch) -> list[dict]:
    """Realtime events queued by the time router: {type, audience (str ids), workspace_id, project_id, task_id, data}."""
    captured: list[dict] = []
    original = time_tracking.queue_event

    def spy(db, type, audience, **kw):
        audience = set(audience)
        captured.append({"type": type, "audience": {str(u) for u in audience}, **kw})
        original(db, type, audience, **kw)

    monkeypatch.setattr(time_tracking, "queue_event", spy)
    return captured


# ─── Manual entries ───


async def test_log_time_defaults_to_nine_am_today_in_user_timezone(team, db, events):
    project, st = await make_project(db, team.workspace_id, members={team.member.id: "member"})
    task = await make_task(db, project, st["todo"], title="Build login")
    await _set_tz(team.member, "America/Los_Angeles")

    entry = await _log(team.member, task.id, 90, note="  Pairing with Max  ")

    expected = datetime.combine(datetime.now(LA).date(), time(9), tzinfo=LA).astimezone(UTC)
    assert _ts(entry["started_at"]) == expected
    assert _ts(entry["ended_at"]) == expected + timedelta(minutes=90)
    assert entry["minutes"] == 90 and entry["running"] is False
    assert entry["note"] == "Pairing with Max"
    assert entry["task"]["id"] == str(task.id) and entry["task"]["ref"] == "WEB-1"
    assert entry["task"]["status"]["category"] == "todo"
    assert entry["project"] == {
        "id": str(project.id),
        "key": "WEB",
        "name": "Website",
        "color": project.color,
        "icon": project.icon,
        "status": "active",
    }
    assert entry["user"]["id"] == team.member.id and entry["user"]["name"] == "Mia Member"

    [act] = await _activities(db, task.id, "logged_time")
    assert act.data == {"minutes": 90}
    assert str(act.actor_id) == team.member.id and act.project_id == project.id
    [ev] = [e for e in events if e["type"] == "time_entry.created"]
    assert ev["audience"] == {team.member.id}
    assert ev["task_id"] == task.id and ev["project_id"] == project.id
    assert ev["data"] == {"id": entry["id"], "minutes": 90}


async def test_log_time_on_a_date_starts_at_nine_local_across_dst(team, db):
    project, st = await make_project(db, team.workspace_id, members={team.member.id: "member"})
    task = await make_task(db, project, st["todo"])
    await _set_tz(team.member, "America/Los_Angeles")

    winter = await _log(team.member, task.id, 60, date="2026-01-15")  # PST, UTC-8
    assert _ts(winter["started_at"]) == datetime(2026, 1, 15, 17, tzinfo=UTC)
    assert _ts(winter["ended_at"]) == datetime(2026, 1, 15, 18, tzinfo=UTC)
    summer = await _log(team.member, task.id, 60, date="2025-07-15")  # PDT, UTC-7
    assert _ts(summer["started_at"]) == datetime(2025, 7, 15, 16, tzinfo=UTC)

    # Admins have lead access everywhere and are in UTC by default.
    utc_entry = await _log(team.admin, task.id, 60, date="2026-01-15")
    assert _ts(utc_entry["started_at"]) == datetime(2026, 1, 15, 9, tzinfo=UTC)


async def test_log_time_with_explicit_start(team, db):
    project, st = await make_project(db, team.workspace_id, members={team.member.id: "member"})
    task = await make_task(db, project, st["todo"])
    await _set_tz(team.member, "America/Los_Angeles")

    naive = await _log(team.member, task.id, 45, started_at="2026-02-02T14:30:00")  # read in the user's timezone
    assert _ts(naive["started_at"]) == datetime(2026, 2, 2, 22, 30, tzinfo=UTC)
    assert _ts(naive["ended_at"]) == datetime(2026, 2, 2, 23, 15, tzinfo=UTC)
    aware = await _log(team.member, task.id, 45, started_at="2026-02-02T14:30:00+02:00")
    assert _ts(aware["started_at"]) == datetime(2026, 2, 2, 12, 30, tzinfo=UTC)
    # `started_at` overrides `date`
    both = await _log(team.member, task.id, 45, date="2026-01-01", started_at="2026-02-03T08:00:00Z")
    assert _ts(both["started_at"]) == datetime(2026, 2, 3, 8, tzinfo=UTC)

    url = f"/api/v1/tasks/{task.id}/time-entries"
    r = await team.member.post(url, {"minutes": 30, "started_at": (utcnow() + timedelta(hours=2)).isoformat()})
    assert r.status_code == 400 and r.json()["code"] == "future_entry"
    tomorrow = datetime.now(LA).date() + timedelta(days=1)
    r = await team.member.post(url, {"minutes": 30, "date": tomorrow.isoformat()})
    assert r.status_code == 400 and r.json()["code"] == "future_entry"


async def test_minutes_must_be_between_1_and_1440(team, db):
    project, st = await make_project(db, team.workspace_id, members={team.member.id: "member"})
    task = await make_task(db, project, st["todo"])
    url = f"/api/v1/tasks/{task.id}/time-entries"

    for bad in (0, -5, 1441):
        assert (await team.member.post(url, {"minutes": bad})).status_code == 422
    assert (await team.member.post(url, {"note": "no minutes"})).status_code == 422
    assert (await team.member.post(url, {"minutes": 10, "note": "x" * 2001})).status_code == 422
    assert (await _log(team.member, task.id, 1))["minutes"] == 1
    assert (await _log(team.member, task.id, 1440))["minutes"] == 1440


async def test_only_project_members_can_log_time(team, db, client):
    open_project, st = await make_project(
        db, team.workspace_id, members={team.member.id: "member", team.guest.id: "viewer"}
    )
    open_task = await make_task(db, open_project, st["todo"])
    private, pst = await make_project(
        db,
        team.workspace_id,
        name="Secret",
        key="SEC",
        visibility=ProjectVisibility.private,
        members={team.member.id: "member"},
    )
    private_task = await make_task(db, private, pst["todo"])
    outsider = await signup(client, "Out Sider", workspace_name="Elsewhere")

    log_open = f"/api/v1/tasks/{open_task.id}/time-entries"
    log_private = f"/api/v1/tasks/{private_task.id}/time-entries"
    start_open = f"/api/v1/tasks/{open_task.id}/timer/start"
    start_private = f"/api/v1/tasks/{private_task.id}/timer/start"

    # member2 is an implicit viewer of the workspace-visible project; the guest is an explicit viewer
    for viewer in (team.member2, team.guest):
        r = await viewer.post(log_open, {"minutes": 30})
        assert r.status_code == 403 and r.json()["code"] == "forbidden"
        assert (await viewer.post(start_open)).status_code == 403
    # no access at all → 404, so IDs can't be probed
    for stranger in (team.member2, team.guest, outsider):
        assert (await stranger.post(log_private, {"minutes": 30})).status_code == 404
        assert (await stranger.post(start_private)).status_code == 404
    assert (await outsider.post(log_open, {"minutes": 30})).status_code == 404
    assert (await team.member.post(f"/api/v1/tasks/{uuid.uuid4()}/time-entries", {"minutes": 5})).status_code == 404

    await _log(team.member, private_task.id)
    await _log(team.admin, private_task.id)  # workspace admins act as leads everywhere
    assert await db.scalar(select(func.count()).select_from(TimeEntry)) == 2


# ─── Listing and visibility ───


async def test_list_defaults_to_last_7_days_in_viewer_timezone(team, db):
    project, st = await make_project(db, team.workspace_id, members={team.member.id: "member"})
    task = await make_task(db, project, st["todo"])
    await _set_tz(team.member, "America/Los_Angeles")
    today = datetime.now(LA).date()
    for days_ago, minutes in ((7, 40), (0, 10), (6, 30), (3, 20)):
        await _log(team.member, task.id, minutes, date=(today - timedelta(days=days_ago)).isoformat())

    # newest first; the entry from 7 days ago is outside the default window
    assert [e["minutes"] for e in await _list(team.member, team.workspace_id)] == [10, 20, 30]
    listed = await _list(
        team.member,
        team.workspace_id,
        date_from=(today - timedelta(days=7)).isoformat(),
        date_to=(today - timedelta(days=3)).isoformat(),
    )
    assert [e["minutes"] for e in listed] == [20, 30, 40]  # both ends inclusive


async def test_list_reads_days_in_viewer_timezone(team, db):
    project, st = await make_project(db, team.workspace_id, members={team.member.id: "member"})
    task = await make_task(db, project, st["todo"])
    await _set_tz(team.member, "America/Los_Angeles")
    # 2026-01-10 05:00 UTC is 21:00 on Jan 9 in Los Angeles
    await _log(team.member, task.id, 25, started_at="2026-01-10T05:00:00Z")

    def day(d: str) -> dict:
        return {"date_from": d, "date_to": d}

    assert len(await _list(team.member, team.workspace_id, **day("2026-01-09"))) == 1
    assert await _list(team.member, team.workspace_id, **day("2026-01-10")) == []
    assert await _list(team.admin, team.workspace_id, **day("2026-01-09")) == []  # admin reads days in UTC
    assert len(await _list(team.admin, team.workspace_id, **day("2026-01-10"))) == 1


async def test_list_visibility_rules(team, db, client):
    web, st = await make_project(
        db,
        team.workspace_id,
        members={team.member.id: "member", team.member2.id: "lead", team.guest.id: "member"},
    )
    web_task = await make_task(db, web, st["todo"])
    secret, sst = await make_project(
        db,
        team.workspace_id,
        name="Secret",
        key="SEC",
        visibility=ProjectVisibility.private,
        members={team.member.id: "member"},
    )
    secret_task = await make_task(db, secret, sst["todo"])
    await _log(team.member, web_task.id, 30)
    await _log(team.member, secret_task.id, 40)
    await _log(team.member2, web_task.id, 50)
    await _log(team.guest, web_task.id, 60)
    await _log(team.admin, web_task.id, 70)

    async def minutes(actor, **params) -> set[int]:
        return {e["minutes"] for e in await _list(actor, team.workspace_id, **params)}

    # members see only their own entries
    assert await minutes(team.member) == {30, 40}
    # the lead of Web sees everyone's entries on Web, but not entries on a project they can't view
    assert await minutes(team.member2) == {30, 50, 60, 70}
    # guests see only their own
    assert await minutes(team.guest) == {60}
    # workspace owner/admin see everything
    assert await minutes(team.admin) == {30, 40, 50, 60, 70}
    assert await minutes(team.owner) == {30, 40, 50, 60, 70}

    # asking for someone else's entries silently narrows to what's visible
    assert await minutes(team.member, user_id=team.member2.id) == set()
    assert await minutes(team.member2, user_id=team.member.id) == {30}
    assert await minutes(team.admin, user_id=team.member.id) == {30, 40}
    assert await minutes(team.member2, project_id=str(secret.id)) == set()
    assert await minutes(team.admin, project_id=str(secret.id)) == {40}
    assert await minutes(team.admin, task_id=str(web_task.id)) == {30, 50, 60, 70}

    # outsiders can't list the workspace; their own workspace never shows this one's entries
    outsider = await signup(client, "Out Sider", workspace_name="Elsewhere")
    other_ws = outsider.user["workspaces"][0]["workspace_id"]
    r = await outsider.get(f"/api/v1/workspaces/{team.workspace_id}/time-entries")
    assert r.status_code == 404
    assert await _list(outsider, other_ws, project_id=str(web.id)) == []
    assert (await team.admin.get(f"/api/v1/workspaces/{other_ws}/time-entries")).status_code == 404


async def test_lead_sees_team_entries_only_while_lead(team, db):
    project, st = await make_project(
        db, team.workspace_id, members={team.member.id: "member", team.member2.id: "lead"}
    )
    task = await make_task(db, project, st["todo"])
    await _log(team.member, task.id, 30)
    assert len(await _list(team.member2, team.workspace_id)) == 1

    pm = await db.get(ProjectMember, (project.id, uuid.UUID(team.member2.id)))
    pm.role = ProjectRole.member
    await db.commit()
    assert await _list(team.member2, team.workspace_id) == []


async def test_list_validation(team):
    url = f"/api/v1/workspaces/{team.workspace_id}/time-entries"
    r = await team.member.get(url, params={"date_from": "2026-02-02", "date_to": "2026-02-01"})
    assert r.status_code == 400 and r.json()["code"] == "invalid_range"
    r = await team.member.get(url, params={"date_from": "2024-01-01", "date_to": "2026-01-01"})
    assert r.status_code == 400 and r.json()["code"] == "range_too_large"
    assert (await team.member.get(url, params={"date_from": "not-a-date"})).status_code == 422
    # a guest without projects simply sees nothing
    assert await _list(team.guest, team.workspace_id) == []


async def test_entries_on_trashed_tasks_are_hidden(team, db):
    project, st = await make_project(db, team.workspace_id, members={team.member.id: "member"})
    task = await make_task(db, project, st["todo"])
    entry = await _log(team.member, task.id, 30)

    task.deleted_at = utcnow()
    await db.commit()
    assert await _list(team.member, team.workspace_id) == []
    assert (await team.member.patch(f"/api/v1/time-entries/{entry['id']}", {"minutes": 5})).status_code == 404
    assert (await team.member.post(f"/api/v1/tasks/{task.id}/time-entries", {"minutes": 5})).status_code == 404


# ─── Timer ───


async def test_timer_start_and_stop(team, db, events):
    project, st = await make_project(db, team.workspace_id, members={team.member.id: "member"})
    task = await make_task(db, project, st["todo"], title="Fix checkout")

    assert await _timer(team.member) is None
    started = await _start(team.member, task.id, note="  Deep work ")
    assert started["running"] is True and started["minutes"] == 0 and started["ended_at"] is None
    assert started["note"] == "Deep work" and started["task"]["id"] == str(task.id)
    assert started["user"]["id"] == team.member.id

    assert (await _timer(team.member))["id"] == started["id"]
    [listed] = await _list(team.member, team.workspace_id)
    assert listed["id"] == started["id"] and listed["running"] is True
    assert await _timer(team.member2) is None  # timers are per person

    r = await team.member.post("/api/v1/timer/stop")
    assert r.status_code == 200, r.text
    stopped = r.json()
    assert stopped["id"] == started["id"] and stopped["running"] is False
    assert stopped["minutes"] == 1  # a stopped timer always counts at least a minute
    assert _ts(stopped["ended_at"]) >= _ts(stopped["started_at"])
    assert await _timer(team.member) is None

    r = await team.member.post("/api/v1/timer/stop")
    assert r.status_code == 404 and r.json()["code"] == "no_timer"

    [act] = await _activities(db, task.id, "logged_time")
    assert act.data == {"minutes": 1} and str(act.actor_id) == team.member.id
    timer_events = [e for e in events if e["type"] == "timer.updated"]
    assert [e["audience"] for e in timer_events] == [{team.member.id}, {team.member.id}]
    assert timer_events[0]["data"]["running"] is True and timer_events[0]["data"]["entry_id"] == started["id"]
    assert timer_events[1]["data"] == {
        "running": False,
        "entry_id": None,
        "stopped_entry_id": started["id"],
        "stopped_minutes": 1,
    }
    assert timer_events[1]["task_id"] == task.id


async def test_start_timer_without_body(team, db):
    project, st = await make_project(db, team.workspace_id, members={team.member.id: "member"})
    task = await make_task(db, project, st["todo"])
    r = await team.member.post(f"/api/v1/tasks/{task.id}/timer/start")
    assert r.status_code == 201 and r.json()["entry"]["note"] == ""


async def test_starting_on_another_task_stops_the_running_timer(team, db, events):
    project, st = await make_project(db, team.workspace_id, members={team.member.id: "member"})
    first = await make_task(db, project, st["todo"], title="First")
    second = await make_task(db, project, st["todo"], title="Second")

    e1 = await _start(team.member, first.id)
    e2 = await _start(team.member, second.id)

    assert e2["id"] != e1["id"] and e2["task"]["id"] == str(second.id) and e2["running"] is True
    assert await _running_count(db, team.member.id) == 1
    assert (await _timer(team.member))["id"] == e2["id"]
    by_id = {e["id"]: e for e in await _list(team.member, team.workspace_id)}
    assert by_id[e1["id"]]["running"] is False and by_id[e1["id"]]["minutes"] == 1
    assert by_id[e1["id"]]["ended_at"] is not None
    assert [a.data for a in await _activities(db, first.id, "logged_time")] == [{"minutes": 1}]
    assert await _activities(db, second.id, "logged_time") == []
    switch = [e for e in events if e["type"] == "timer.updated"][-1]
    assert switch["task_id"] == second.id
    assert switch["data"]["entry_id"] == e2["id"] and switch["data"]["stopped_entry_id"] == e1["id"]


async def test_starting_a_timer_stops_one_running_in_another_workspace(team, db):
    r = await team.member.post("/api/v1/workspaces", {"name": "Side gig"})
    assert r.status_code == 201, r.text
    side_ws = r.json()["id"]
    side_project, sst = await make_project(db, side_ws, name="Side", key="SID")
    side_task = await make_task(db, side_project, sst["todo"])
    project, st = await make_project(db, team.workspace_id, members={team.member.id: "member"})
    task = await make_task(db, project, st["todo"])

    side_entry = await _start(team.member, side_task.id)
    entry = await _start(team.member, task.id)

    assert (await _timer(team.member))["id"] == entry["id"]
    [stopped] = await _list(team.member, side_ws)
    assert stopped["id"] == side_entry["id"] and stopped["running"] is False
    # each workspace only lists its own entries
    assert [e["id"] for e in await _list(team.member, team.workspace_id)] == [entry["id"]]
    [act] = await _activities(db, side_task.id, "logged_time")
    assert str(act.workspace_id) == side_ws


async def test_restarting_the_same_task_keeps_the_running_timer(team, db):
    project, st = await make_project(db, team.workspace_id, members={team.member.id: "member"})
    task = await make_task(db, project, st["todo"])
    first = await _start(team.member, task.id)
    again = await _start(team.member, task.id)
    assert again["id"] == first["id"] and again["running"] is True
    assert await _running_count(db, team.member.id) == 1
    assert await _activities(db, task.id, "logged_time") == []


async def test_running_minutes_and_stop_rounding(team, db):
    project, st = await make_project(db, team.workspace_id, members={team.member.id: "member"})
    task = await make_task(db, project, st["todo"])

    await _add_running(db, project, task, team.member.id, started_at=utcnow() - timedelta(minutes=5, seconds=50))
    timer = await _timer(team.member)
    assert timer["running"] is True and timer["minutes"] == 5  # whole minutes elapsed so far
    assert (await _list(team.member, team.workspace_id))[0]["minutes"] == 5
    assert (await team.member.post("/api/v1/timer/stop")).json()["minutes"] == 6  # nearest minute

    cases = (
        (timedelta(seconds=20), 1),
        (timedelta(minutes=10, seconds=20), 10),
        (timedelta(minutes=10, seconds=40), 11),
        (timedelta(hours=2, minutes=59, seconds=40), 180),
    )
    for elapsed, expected in cases:
        await _add_running(db, project, task, team.member.id, started_at=utcnow() - elapsed)
        r = await team.member.post("/api/v1/timer/stop")
        assert r.status_code == 200 and r.json()["minutes"] == expected, (elapsed, r.text)
    assert await _running_count(db, team.member.id) == 0


async def test_one_running_timer_race_is_a_conflict(team, db, monkeypatch):
    project, st = await make_project(db, team.workspace_id, members={team.member.id: "member"})
    first = await make_task(db, project, st["todo"])
    second = await make_task(db, project, st["todo"])
    running = await _start(team.member, first.id)

    async def stale_lookup(db, user_id, *, lock=False):  # a concurrent request that hasn't seen the timer yet
        return None

    with monkeypatch.context() as m:
        m.setattr(svc, "running_entry", stale_lookup)
        r = await team.member.post(f"/api/v1/tasks/{second.id}/timer/start")
    assert r.status_code == 409 and r.json()["code"] == "timer_running"
    assert (await _timer(team.member))["id"] == running["id"]
    assert await _running_count(db, team.member.id) == 1


async def test_concurrent_starts_leave_one_running_timer(team, db):
    project, st = await make_project(db, team.workspace_id, members={team.member.id: "member"})
    tasks = [await make_task(db, project, st["todo"], title=f"T{i}") for i in range(4)]

    for pair in (tasks[:2], tasks[2:]):  # first with no timer running, then with one running
        responses = await asyncio.gather(
            *(team.member.post(f"/api/v1/tasks/{t.id}/timer/start") for t in pair)
        )
        codes = sorted(r.status_code for r in responses)
        assert codes in ([201, 201], [201, 409]), [r.text for r in responses]
        assert await _running_count(db, team.member.id) == 1


# ─── Editing and deleting ───


async def test_owner_or_workspace_admin_edits_entries(team, db, client, events):
    project, st = await make_project(
        db, team.workspace_id, members={team.member.id: "member", team.member2.id: "lead"}
    )
    task = await make_task(db, project, st["todo"])
    entry = await _log(team.member, task.id, 30, note="Draft")
    url = f"/api/v1/time-entries/{entry['id']}"
    outsider = await signup(client, "Out Sider", workspace_name="Elsewhere")

    # the project lead can see the entry but not change it; others can't see it at all
    r = await team.member2.patch(url, {"minutes": 10})
    assert r.status_code == 403 and r.json()["code"] == "forbidden"
    assert (await team.guest.patch(url, {"minutes": 10})).status_code == 404
    assert (await outsider.patch(url, {"minutes": 10})).status_code == 404
    assert (await team.member.patch(f"/api/v1/time-entries/{uuid.uuid4()}", {"minutes": 10})).status_code == 404

    r = await team.member.patch(url, {"minutes": 45, "note": "  Final  "})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["minutes"] == 45 and body["note"] == "Final" and body["running"] is False
    assert _ts(body["ended_at"]) == _ts(body["started_at"]) + timedelta(minutes=45)

    r = await team.admin.patch(url, {"minutes": 50})
    assert r.status_code == 200 and r.json()["minutes"] == 50 and r.json()["user"]["id"] == team.member.id
    assert [a.data for a in await _activities(db, task.id, "updated_time")] == [
        {"changes": {"minutes": {"from": 30, "to": 45}}},
        {"changes": {"minutes": {"from": 45, "to": 50}}},
    ]
    updated = [e for e in events if e["type"] == "time_entry.updated"]
    assert updated[-1]["audience"] == {team.member.id, team.admin.id}

    # a note-only edit isn't an activity-worthy change
    assert (await team.member.patch(url, {"note": "Final notes"})).json()["note"] == "Final notes"
    assert len(await _activities(db, task.id, "updated_time")) == 2

    for bad in (0, 1441):
        assert (await team.member.patch(url, {"minutes": bad})).status_code == 422
    assert (await team.member.patch(url, {"note": "x" * 2001})).status_code == 422


async def test_moving_an_entry_to_another_day_keeps_the_local_start_time(team, db):
    project, st = await make_project(db, team.workspace_id, members={team.member.id: "member"})
    task = await make_task(db, project, st["todo"])
    await _set_tz(team.member, "America/Los_Angeles")
    entry = await _log(team.member, task.id, 60, date="2026-01-15")
    url = f"/api/v1/time-entries/{entry['id']}"

    r = await team.member.patch(url, {"date": "2025-07-15"})
    assert r.status_code == 200, r.text
    assert _ts(r.json()["started_at"]) == datetime(2025, 7, 15, 16, tzinfo=UTC)  # still 09:00 local (PDT)
    assert _ts(r.json()["ended_at"]) == datetime(2025, 7, 15, 17, tzinfo=UTC)
    [act] = await _activities(db, task.id, "updated_time")
    assert act.data == {"changes": {"date": {"from": "2026-01-15", "to": "2025-07-15"}}}

    tomorrow = datetime.now(LA).date() + timedelta(days=1)
    r = await team.member.patch(url, {"date": tomorrow.isoformat()})
    assert r.status_code == 400 and r.json()["code"] == "future_entry"


async def test_running_entry_only_accepts_a_new_note(team, db):
    project, st = await make_project(db, team.workspace_id, members={team.member.id: "member"})
    task = await make_task(db, project, st["todo"])
    running = await _start(team.member, task.id)
    url = f"/api/v1/time-entries/{running['id']}"

    r = await team.member.patch(url, {"minutes": 30})
    assert r.status_code == 400 and r.json()["code"] == "timer_running"
    r = await team.member.patch(url, {"date": date.today().isoformat()})
    assert r.status_code == 400 and r.json()["code"] == "timer_running"
    r = await team.member.patch(url, {"note": "Investigating flaky test"})
    assert r.status_code == 200
    assert r.json()["note"] == "Investigating flaky test" and r.json()["running"] is True
    assert r.json()["ended_at"] is None


async def test_delete_entry_rules(team, db, events):
    project, st = await make_project(
        db, team.workspace_id, members={team.member.id: "member", team.member2.id: "lead"}
    )
    task = await make_task(db, project, st["todo"])
    a = await _log(team.member, task.id, 30)
    b = await _log(team.member, task.id, 40)

    assert (await team.member2.delete(f"/api/v1/time-entries/{a['id']}")).status_code == 403
    assert (await team.guest.delete(f"/api/v1/time-entries/{a['id']}")).status_code == 404
    r = await team.member.delete(f"/api/v1/time-entries/{a['id']}")
    assert r.status_code == 200 and r.json() == {"ok": True}
    assert (await team.member.delete(f"/api/v1/time-entries/{a['id']}")).status_code == 404
    assert (await team.admin.delete(f"/api/v1/time-entries/{b['id']}")).status_code == 200
    assert [x.data for x in await _activities(db, task.id, "deleted_time")] == [{"minutes": 30}, {"minutes": 40}]
    deleted = [e for e in events if e["type"] == "time_entry.deleted"]
    assert deleted[-1]["audience"] == {team.member.id, team.admin.id}

    # deleting a running timer discards it without logging time
    running = await _start(team.member, task.id)
    assert (await team.member.delete(f"/api/v1/time-entries/{running['id']}")).status_code == 200
    assert await _timer(team.member) is None
    assert len(await _activities(db, task.id, "deleted_time")) == 2
    assert await _list(team.member, team.workspace_id) == []
    assert events[-1]["type"] == "timer.updated" and events[-1]["data"]["running"] is False


# ─── Service helpers (shared with insights) ───


def test_day_bounds_follow_the_timezone_across_dst():
    # 2026-03-08 is the spring-forward day in Los Angeles: a 23-hour local day
    start, end = svc.day_bounds(date(2026, 3, 8), date(2026, 3, 8), LA)
    assert start == datetime(2026, 3, 8, 8, tzinfo=UTC)
    assert end == datetime(2026, 3, 9, 7, tzinfo=UTC)
    start, end = svc.day_bounds(date(2026, 1, 1), date(2026, 1, 7), ZoneInfo("UTC"))
    assert (start, end) == (datetime(2026, 1, 1, tzinfo=UTC), datetime(2026, 1, 8, tzinfo=UTC))


def test_timezone_helpers():
    assert svc.manual_start(date(2026, 7, 1), LA) == datetime(2026, 7, 1, 16, tzinfo=UTC)
    assert svc.manual_start(date(2026, 12, 1), LA) == datetime(2026, 12, 1, 17, tzinfo=UTC)
    assert svc.as_utc(datetime(2026, 2, 2, 14, 30), LA) == datetime(2026, 2, 2, 22, 30, tzinfo=UTC)
    aware = datetime(2026, 2, 2, 14, 30, tzinfo=UTC)
    assert svc.as_utc(aware, LA) == aware
    assert svc.local_date(datetime(2026, 1, 10, 5, tzinfo=UTC), LA) == date(2026, 1, 9)
    assert svc.user_tz(User(timezone="America/Los_Angeles")) == LA
    assert svc.user_tz(User(timezone="Mars/Olympus_Mons")) == ZoneInfo("UTC")
    assert svc.user_tz(None) == ZoneInfo("UTC")


def test_duration_helpers():
    start = datetime(2026, 1, 1, 9, tzinfo=UTC)
    assert svc.elapsed_minutes(start, start + timedelta(minutes=5, seconds=59)) == 5
    assert svc.elapsed_minutes(start, start - timedelta(seconds=5)) == 0
    assert svc.stopped_minutes(start, start + timedelta(seconds=20)) == 1
    assert svc.stopped_minutes(start, start + timedelta(seconds=89)) == 1
    assert svc.stopped_minutes(start, start + timedelta(seconds=90)) == 2

    entry = TimeEntry(started_at=start, ended_at=None, minutes=0)
    assert svc.entry_minutes(entry, start + timedelta(minutes=7)) == 7
    assert svc.finalize(entry, start + timedelta(minutes=7, seconds=31)) == 8
    assert entry.ended_at == start + timedelta(minutes=7, seconds=31)
    assert svc.entry_minutes(entry) == 8


def test_time_scope_allows():
    me, other = uuid.uuid4(), uuid.uuid4()
    led, viewed, hidden = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    scope = svc.TimeScope(viewer_id=me, project_ids=frozenset({led, viewed}), team_project_ids=frozenset({led}))
    assert scope.allows(me, viewed) and scope.allows(other, led)
    assert not scope.allows(other, viewed)
    assert not scope.allows(me, hidden)
