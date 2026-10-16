"""Insights: project health/forecast, portfolio, workload, time report, home dashboard and search."""

from datetime import UTC, date, datetime, timedelta

from app.models import ProjectVisibility, TimeEntry
from app.services import insights as calc
from tests.factories import make_project, make_task


async def test_project_insights_flags_overdue_and_blocked_work(db, team):
    today = date.today()
    project, st = await make_project(
        db,
        team.workspace_id,
        members={team.member.id: "member"},
        start_date=today - timedelta(days=30),
        target_date=today + timedelta(days=30),
    )
    late = await make_task(
        db, project, st["todo"], title="Late", assignee_id=team.member.id, due_date=today - timedelta(days=2)
    )
    blocker = await make_task(db, project, st["in_progress"], title="Blocker")
    blocked = await make_task(db, project, st["todo"], title="Blocked")
    for weeks_ago in range(1, 5):
        await make_task(
            db, project, st["done"], completed_at=datetime.now(UTC) - timedelta(weeks=weeks_ago), estimate_hours=None
        )
    await db.commit()
    r = await team.member.post(f"/api/v1/tasks/{blocked.id}/dependencies/{blocker.id}")
    assert r.status_code in (200, 201), r.text

    r = await team.member.get(f"/api/v1/projects/{project.id}/insights")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["scope"]["overdue"] == 1
    assert body["scope"]["blocked"] == 1
    assert body["health"]["status"] in ("at_risk", "off_track")
    assert any("overdue" in reason for reason in body["health"]["reasons"])
    assert {t["title"] for t in body["at_risk_tasks"]} >= {"Late", "Blocked"}
    assert body["forecast"]["weekly_throughput"] > 0
    assert body["forecast"]["completion_date"] is not None
    assert body["burnup"][-1]["completed"] == 4
    assert body["people"][0]["user"]["id"] == team.member.id
    assert str(late.id) in {t["id"] for t in body["at_risk_tasks"]}


async def test_project_insights_hidden_from_outsiders(db, team):
    project, _ = await make_project(db, team.workspace_id, visibility=ProjectVisibility.private)
    await db.commit()
    r = await team.member.get(f"/api/v1/projects/{project.id}/insights")
    assert r.status_code == 404


def test_health_rules():
    class P:
        status = "active"
        start_date = date(2026, 1, 1)
        target_date = date(2026, 1, 31)
        created_at = datetime(2026, 1, 1, tzinfo=UTC)

    def s(done, total, **kw):
        base = dict(open=total - done, done=done, canceled=0, overdue=0, blocked=0, unassigned=0, unestimated=0)
        base |= dict(estimate_total_hours=0, estimate_done_hours=0, total=total) | kw
        return calc.ScopeOut(**base)

    mid = date(2026, 1, 16)  # 50% of the schedule elapsed
    assert calc.health(P, s(5, 10), mid).status == "on_track"
    assert calc.health(P, s(3, 10), mid).status == "at_risk"
    assert calc.health(P, s(1, 10), mid).status == "off_track"
    assert calc.health(P, s(5, 10), date(2026, 2, 5)).status == "off_track"
    assert calc.health(P, s(10, 10), mid).status == "done"
    assert calc.health(P, s(0, 0), mid).status == "no_data"


async def test_portfolio_only_lists_visible_projects(db, team):
    await make_project(db, team.workspace_id, name="Public")
    await make_project(db, team.workspace_id, name="Secret", key="SEC", visibility=ProjectVisibility.private)
    await db.commit()
    r = await team.member.get(f"/api/v1/workspaces/{team.workspace_id}/insights/portfolio")
    assert r.status_code == 200, r.text
    assert [p["project"]["name"] for p in r.json()["projects"]] == ["Public"]
    r = await team.owner.get(f"/api/v1/workspaces/{team.workspace_id}/insights/portfolio")
    assert len(r.json()["projects"]) == 2


async def test_workload_spreads_estimates_over_working_days(db, team):
    today = date.today()
    monday = today - timedelta(days=today.weekday())
    project, st = await make_project(db, team.workspace_id, members={team.member.id: "member"})
    # 10h spread Mon..Fri of next week → all of it lands in next week.
    await make_task(
        db,
        project,
        st["todo"],
        assignee_id=team.member.id,
        estimate_hours=10,
        start_date=monday + timedelta(days=7),
        due_date=monday + timedelta(days=11),
    )
    await make_task(db, project, st["todo"], assignee_id=team.member.id, estimate_hours=3)  # unscheduled
    await make_task(db, project, st["todo"], assignee_id=team.member.id)  # unestimated
    await db.commit()

    r = await team.member.get(f"/api/v1/workspaces/{team.workspace_id}/insights/workload?weeks=3")
    assert r.status_code == 200, r.text
    person = next(p for p in r.json()["people"] if p["user"]["id"] == team.member.id)
    assert [w["planned_hours"] for w in person["weeks"]] == [0, 10, 0]
    assert person["unscheduled_hours"] == 3
    assert person["unestimated_tasks"] == 1
    assert (await team.guest.get(f"/api/v1/workspaces/{team.workspace_id}/insights/workload")).status_code == 403


async def test_home_and_time_report(db, team):
    today = date.today()
    project, st = await make_project(db, team.workspace_id, members={team.member.id: "member"})
    overdue = await make_task(db, project, st["todo"], assignee_id=team.member.id, due_date=today - timedelta(days=1))
    await make_task(db, project, st["in_progress"], assignee_id=team.member.id, due_date=today)
    now = datetime.now(UTC)
    db.add(
        TimeEntry(
            workspace_id=project.workspace_id,
            task_id=overdue.id,
            user_id=team.member.id,
            started_at=now - timedelta(minutes=90),
            ended_at=now,
            minutes=90,
        )
    )
    await db.commit()

    r = await team.member.get(f"/api/v1/workspaces/{team.workspace_id}/home")
    assert r.status_code == 200, r.text
    home = r.json()
    assert home["open_count"] == 2
    assert [t["id"] for t in home["overdue"]] == [str(overdue.id)]
    assert len(home["due_today"]) == 1 and len(home["in_progress"]) == 1
    assert home["time_this_week_minutes"] == 90
    assert home["projects"][0]["my_open_tasks"] == 2

    r = await team.member.get(f"/api/v1/workspaces/{team.workspace_id}/insights/time")
    assert r.status_code == 200, r.text
    report = r.json()
    assert report["total_minutes"] == 90
    assert report["by_user"][0]["user"]["id"] == team.member.id
    assert sum(d["minutes"] for d in report["by_day"]) == 90


async def test_search_by_title_ref_and_person(db, team):
    project, st = await make_project(db, team.workspace_id, name="Website", key="WEB")
    task = await make_task(db, project, st["todo"], title="Fix checkout bug")
    hidden, hst = await make_project(
        db, team.workspace_id, name="Hidden", key="HID", visibility=ProjectVisibility.private
    )
    await make_task(db, hidden, hst["todo"], title="Checkout secret")
    await db.commit()

    url = f"/api/v1/workspaces/{team.workspace_id}/search"
    r = await team.member.get(url, params={"q": "checkout"})
    assert [t["title"] for t in r.json()["tasks"]] == ["Fix checkout bug"]
    r = await team.member.get(url, params={"q": f"web-{task.number}"})
    assert r.json()["tasks"][0]["id"] == str(task.id)
    r = await team.member.get(url, params={"q": "mia"})
    assert r.json()["people"][0]["id"] == team.member.id
    r = await team.member.get(url, params={"q": "web"})
    assert r.json()["projects"][0]["key"] == "WEB"
