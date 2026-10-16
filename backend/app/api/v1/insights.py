"""Computed insights (health, forecast, workload, time reports), home dashboard and search."""

import re
import uuid
from collections import defaultdict
from datetime import date, timedelta

from fastapi import APIRouter, Query
from sqlalchemy import func, or_, select

from app.core.db import utcnow
from app.core.deps import DB, CurrentUser
from app.core.errors import BadRequest
from app.models import (
    Milestone,
    Project,
    ProjectMember,
    ProjectRole,
    ProjectStatus,
    ProjectUpdate,
    StatusCategory,
    Task,
    TaskStatus,
    TimeEntry,
    User,
    WorkspaceMember,
    WorkspaceRole,
)
from app.schemas.insights import (
    HomeOut,
    HomeProject,
    MilestoneRisk,
    PersonLoad,
    PortfolioOut,
    PortfolioProject,
    ProjectInsightsOut,
    SearchOut,
    StatusCount,
    TimeByDay,
    TimeByProject,
    TimeByUser,
    TimeReportOut,
    WorkloadOut,
    WorkloadPerson,
    WorkloadWeek,
)
from app.schemas.project import MilestoneOut, ProjectUpdateOut
from app.services import insights as calc
from app.services import permissions, serializers
from app.services import time as time_svc

router = APIRouter(tags=["insights"])

REF_RE = re.compile(r"^([A-Za-z][A-Za-z0-9]{0,5})-(\d+)$")


async def _latest_updates(db: DB, project_ids: list[uuid.UUID]) -> dict[uuid.UUID, ProjectUpdate]:
    if not project_ids:
        return {}
    newest = (
        select(ProjectUpdate.project_id, func.max(ProjectUpdate.created_at).label("at"))
        .where(ProjectUpdate.project_id.in_(project_ids))
        .group_by(ProjectUpdate.project_id)
        .subquery()
    )
    rows = await db.scalars(
        select(ProjectUpdate).join(
            newest, (newest.c.project_id == ProjectUpdate.project_id) & (newest.c.at == ProjectUpdate.created_at)
        )
    )
    return {u.project_id: u for u in rows}


async def _visible_projects(db: DB, user: User, workspace_id: uuid.UUID, *, include_archived=False) -> list[Project]:
    ids = await permissions.visible_project_ids(db, user.id, workspace_id)
    if not ids:
        return []
    q = select(Project).where(Project.id.in_(ids)).order_by(Project.name)
    if not include_archived:
        q = q.where(Project.status != ProjectStatus.archived)
    return list(await db.scalars(q))


@router.get("/projects/{project_id}/insights", response_model=ProjectInsightsOut)
async def project_insights(project_id: uuid.UUID, user: CurrentUser, db: DB):
    project, _ = await permissions.require_project(db, user, project_id)
    today = serializers.user_today(user)
    rows = await calc.load_rows(db, [project.id])
    blocked = await calc.blocked_ids(db, [r.id for r in rows if not r.closed])
    scope = calc.scope(rows, blocked, today)
    weeks = calc.weekly(rows, today)

    statuses = list(
        await db.scalars(select(TaskStatus).where(TaskStatus.project_id == project.id).order_by(TaskStatus.position))
    )
    per_status: dict[uuid.UUID, int] = defaultdict(int)
    for status_id in await db.scalars(
        select(Task.status_id).where(Task.project_id == project.id, Task.deleted_at.is_(None))
    ):
        per_status[status_id] += 1

    load: dict[uuid.UUID, PersonLoad] = {}
    people = await serializers.user_briefs(db, (r.assignee_id for r in rows if not r.closed))
    for r in rows:
        if r.closed or r.assignee_id is None or r.assignee_id not in people:
            continue
        p = load.setdefault(
            r.assignee_id, PersonLoad(user=people[r.assignee_id], open_tasks=0, estimate_hours=0, overdue=0)
        )
        p.open_tasks += 1
        p.estimate_hours = round(p.estimate_hours + (r.estimate or 0), 1)
        p.overdue += bool(r.due_date and r.due_date < today)

    milestones = list(
        await db.scalars(
            select(Milestone).where(Milestone.project_id == project.id).order_by(Milestone.due_date.nulls_last())
        )
    )
    milestone_out = await _milestones_with_risk(db, milestones, today)

    risky_ids = [r.id for r in rows if calc.at_risk(r, blocked, today)]
    risky = list(
        await db.scalars(select(Task).where(Task.id.in_(risky_ids)).order_by(Task.due_date.nulls_last()).limit(12))
    )
    updates = await _latest_updates(db, [project.id])
    latest = updates.get(project.id)
    authors = await serializers.user_briefs(db, [latest.author_id] if latest else [])

    return ProjectInsightsOut(
        project_id=project.id,
        health=calc.health(project, scope, today),
        scope=scope,
        forecast=calc.forecast(project, scope, weeks, today),
        burnup=calc.burnup(project, rows, today),
        status_breakdown=[
            StatusCount(status_id=s.id, name=s.name, category=s.category, color=s.color, count=per_status[s.id])
            for s in statuses
        ],
        weekly=weeks,
        cycle_time_days=calc.cycle_time(rows, today),
        people=sorted(load.values(), key=lambda p: -p.estimate_hours),
        milestones=milestone_out,
        at_risk_tasks=await serializers.tasks_out(db, risky, today),
        latest_update=ProjectUpdateOut(
            id=latest.id,
            project_id=latest.project_id,
            author=authors.get(latest.author_id) if latest.author_id else None,
            health=latest.health,
            body=latest.body,
            created_at=latest.created_at,
        )
        if latest
        else None,
    )


async def _milestones_with_risk(db: DB, milestones: list[Milestone], today: date) -> list[MilestoneRisk]:
    if not milestones:
        return []
    counts = {
        mid: (total, done)
        for mid, total, done in (
            await db.execute(
                select(
                    Task.milestone_id,
                    func.count(),
                    func.count().filter(TaskStatus.category == StatusCategory.done),
                )
                .join(TaskStatus, TaskStatus.id == Task.status_id)
                .where(Task.milestone_id.in_([m.id for m in milestones]), Task.deleted_at.is_(None))
                .group_by(Task.milestone_id)
            )
        ).all()
    }
    out = []
    for m in milestones:
        total, done = counts.get(m.id, (0, 0))
        reason = None
        if m.completed_at is None and m.due_date and total > done:
            if m.due_date < today:
                reason = f"Past due with {total - done} open tasks"
            elif m.due_date <= today + timedelta(days=7) and total and done / total < 0.7:
                reason = f"Due {m.due_date:%b %-d}, only {round(done / total * 100)}% done"
        base = MilestoneOut.model_validate(m, from_attributes=True).model_copy(
            update={"task_total": total, "task_done": done}
        )
        out.append(MilestoneRisk(**base.model_dump(), at_risk=reason is not None, risk_reason=reason))
    return out


@router.get("/workspaces/{workspace_id}/insights/portfolio", response_model=PortfolioOut)
async def portfolio(workspace_id: uuid.UUID, user: CurrentUser, db: DB):
    await permissions.require_workspace(db, user, workspace_id)
    today = serializers.user_today(user)
    projects = await _visible_projects(db, user, workspace_id)
    rows = await calc.load_rows(db, [p.id for p in projects])
    blocked = await calc.blocked_ids(db, [r.id for r in rows if not r.closed])
    by_project: dict[uuid.UUID, list[calc.TaskRow]] = defaultdict(list)
    for r in rows:
        by_project[r.project_id].append(r)
    briefs = await serializers.project_briefs(db, (p.id for p in projects))
    leads = await serializers.user_briefs(db, (p.lead_id for p in projects))
    updates = await _latest_updates(db, [p.id for p in projects])

    out, summary = [], defaultdict(int)
    for p in projects:
        prow = by_project[p.id]
        s = calc.scope(prow, blocked, today)
        h = calc.health(p, s, today)
        summary[h.status] += 1
        out.append(
            PortfolioProject(
                project=briefs[p.id],
                lead=leads.get(p.lead_id) if p.lead_id else None,
                target_date=p.target_date,
                health=h,
                open=s.open,
                overdue=s.overdue,
                forecast_date=calc.forecast(p, s, calc.weekly(prow, today), today).completion_date,
                latest_update_health=updates[p.id].health if p.id in updates else None,
            )
        )
    order = {"off_track": 0, "at_risk": 1, "on_track": 2, "not_started": 3, "no_data": 4, "done": 5}
    out.sort(key=lambda x: (order[x.health.status], x.project.name.lower()))
    return PortfolioOut(projects=out, summary=dict(summary))


async def _active_members(db: DB, workspace_id: uuid.UUID) -> list[tuple[WorkspaceMember, User]]:
    rows = await db.execute(
        select(WorkspaceMember, User)
        .join(User, User.id == WorkspaceMember.user_id)
        .where(
            WorkspaceMember.workspace_id == workspace_id,
            WorkspaceMember.deactivated_at.is_(None),
            WorkspaceMember.role != WorkspaceRole.guest,
            User.is_active.is_(True),
        )
        .order_by(User.name)
    )
    return list(rows.tuples())


@router.get("/workspaces/{workspace_id}/insights/workload", response_model=WorkloadOut)
async def workload(
    workspace_id: uuid.UUID,
    user: CurrentUser,
    db: DB,
    weeks: int = Query(default=8, ge=1, le=26),
    project_id: uuid.UUID | None = None,
):
    await permissions.require_workspace(db, user, workspace_id, WorkspaceRole.member)
    today = serializers.user_today(user)
    first = calc.week_start(today)
    week_list = [first + timedelta(weeks=i) for i in range(weeks)]
    project_ids = await permissions.visible_project_ids(db, user.id, workspace_id)
    if project_id is not None:
        project_ids = [pid for pid in project_ids if pid == project_id]
    rows = [r for r in await calc.load_rows(db, project_ids) if not r.closed and r.assignee_id]
    members = await _active_members(db, workspace_id)
    briefs = await serializers.user_briefs(db, (u.id for _, u in members))

    people = []
    for m, u in members:
        mine = [r for r in rows if r.assignee_id == u.id]
        hours: dict[date, float] = defaultdict(float)
        tasks_in_week: dict[date, int] = defaultdict(int)
        for r in mine:
            for w, h in calc.spread_hours(r, today).items():
                hours[w] += h
                tasks_in_week[w] += 1
        cap = float(m.weekly_capacity_hours)
        people.append(
            WorkloadPerson(
                user=briefs[u.id],
                capacity_hours=cap,
                weeks=[
                    WorkloadWeek(
                        week_start=w,
                        planned_hours=round(hours[w], 1),
                        capacity_hours=cap,
                        task_count=tasks_in_week[w],
                        utilization=round(hours[w] / cap, 2) if cap else 0,
                    )
                    for w in week_list
                ],
                unscheduled_hours=round(sum(r.estimate or 0 for r in mine if not r.due_date), 1),
                unestimated_tasks=sum(1 for r in mine if not r.estimate),
                overdue_tasks=sum(1 for r in mine if r.due_date and r.due_date < today),
            )
        )
    return WorkloadOut(weeks=week_list, people=people)


@router.get("/workspaces/{workspace_id}/insights/time", response_model=TimeReportOut)
async def time_report(
    workspace_id: uuid.UUID,
    user: CurrentUser,
    db: DB,
    date_from: date | None = None,
    date_to: date | None = None,
):
    await permissions.require_workspace(db, user, workspace_id)
    today = serializers.user_today(user)
    date_from = date_from or calc.week_start(today)
    date_to = date_to or date_from + timedelta(days=6)
    if date_to < date_from or (date_to - date_from).days > 366:
        raise BadRequest("Pick a range of at most one year", code="invalid_range")
    tz = time_svc.user_tz(user)
    start, end = time_svc.day_bounds(date_from, date_to, tz)
    scope = await time_svc.time_scope(db, user.id, workspace_id)
    entries = list(
        (
            await db.execute(
                select(TimeEntry, Task.project_id)
                .join(Task, Task.id == TimeEntry.task_id)
                .where(scope.condition(), TimeEntry.started_at >= start, TimeEntry.started_at < end)
            )
        ).tuples()
    )

    by_user: dict[uuid.UUID, int] = defaultdict(int)
    by_project: dict[uuid.UUID, int] = defaultdict(int)
    by_day: dict[date, int] = defaultdict(int)
    for e, pid in entries:
        minutes = time_svc.entry_minutes(e)
        by_user[e.user_id] += minutes
        by_project[pid] += minutes
        by_day[time_svc.local_date(e.started_at, tz)] += minutes

    capacities = {
        m.user_id: float(m.weekly_capacity_hours)
        for m in await db.scalars(
            select(WorkspaceMember).where(
                WorkspaceMember.workspace_id == workspace_id, WorkspaceMember.user_id.in_(list(by_user))
            )
        )
    }
    workdays = len(calc.working_days(date_from, date_to))
    users = await serializers.user_briefs(db, by_user)
    projects = await serializers.project_briefs(db, by_project)

    def capacity_minutes(uid):
        return round(capacities.get(uid, 40) * 60 * workdays / 5)

    days = [date_from + timedelta(days=i) for i in range((date_to - date_from).days + 1)]
    return TimeReportOut(
        date_from=date_from,
        date_to=date_to,
        total_minutes=sum(by_user.values()),
        by_user=sorted(
            (
                TimeByUser(
                    user=users[uid],
                    minutes=m,
                    capacity_minutes=capacity_minutes(uid),
                    utilization=round(m / capacity_minutes(uid), 2) if capacity_minutes(uid) else 0,
                )
                for uid, m in by_user.items()
            ),
            key=lambda x: -x.minutes,
        ),
        by_project=sorted(
            (TimeByProject(project=projects[pid], minutes=m) for pid, m in by_project.items()), key=lambda x: -x.minutes
        ),
        by_day=[TimeByDay(date=d, minutes=by_day[d]) for d in days],
    )


@router.get("/workspaces/{workspace_id}/home", response_model=HomeOut)
async def home(workspace_id: uuid.UUID, user: CurrentUser, db: DB):
    membership = await permissions.require_workspace(db, user, workspace_id)
    today = serializers.user_today(user)
    projects = await _visible_projects(db, user, workspace_id)
    project_ids = [p.id for p in projects]

    mine = (
        list(
            await db.scalars(
                select(Task)
                .join(TaskStatus, TaskStatus.id == Task.status_id)
                .where(
                    Task.project_id.in_(project_ids),
                    Task.assignee_id == user.id,
                    Task.deleted_at.is_(None),
                    TaskStatus.category.notin_([StatusCategory.done.value, StatusCategory.canceled.value]),
                )
                .order_by(Task.due_date.nulls_last(), Task.priority)
            )
        )
        if project_ids
        else []
    )
    outs = await serializers.tasks_out(db, mine, today)
    week_end = today + timedelta(days=7)

    led = (
        set(await db.scalars(select(Project.id).where(Project.id.in_(project_ids), Project.lead_id == user.id)))
        if project_ids
        else set()
    )
    led |= (
        set(
            await db.scalars(
                select(ProjectMember.project_id).where(
                    ProjectMember.user_id == user.id,
                    ProjectMember.role == ProjectRole.lead,
                    ProjectMember.project_id.in_(project_ids),
                )
            )
        )
        if project_ids
        else set()
    )
    review = (
        list(
            await db.scalars(
                select(Task)
                .join(TaskStatus, TaskStatus.id == Task.status_id)
                .where(
                    Task.project_id.in_(list(led)),
                    Task.deleted_at.is_(None),
                    TaskStatus.category == StatusCategory.review,
                )
                .order_by(Task.updated_at.desc())
                .limit(10)
            )
        )
        if led
        else []
    )

    week_start = calc.week_start(today)
    tz = time_svc.user_tz(user)
    start, end = time_svc.day_bounds(week_start, week_start + timedelta(days=6), tz)
    my_entries = (
        list(
            await db.scalars(
                select(TimeEntry)
                .join(Task, Task.id == TimeEntry.task_id)
                .where(
                    TimeEntry.user_id == user.id,
                    Task.project_id.in_(project_ids),
                    TimeEntry.started_at >= start,
                    TimeEntry.started_at < end,
                )
            )
        )
        if project_ids
        else []
    )
    completed_7 = (
        await db.scalar(
            select(func.count())
            .select_from(Task)
            .join(TaskStatus, TaskStatus.id == Task.status_id)
            .where(
                Task.assignee_id == user.id,
                Task.project_id.in_(project_ids),
                Task.deleted_at.is_(None),
                TaskStatus.category == StatusCategory.done,
                Task.completed_at >= utcnow() - timedelta(days=7),
            )
        )
        if project_ids
        else 0
    )

    running = await time_svc.running_entry(db, user.id)
    timer = None
    if running:
        task = await db.get(Task, running.task_id)
        if task and task.project_id in project_ids:
            timer = (await time_svc.entries_out(db, [running]))[0]

    open_per_project: dict[uuid.UUID, int] = defaultdict(int)
    for t in mine:
        open_per_project[t.project_id] += 1
    relevant = [p for p in projects if p.id in open_per_project or p.id in led][:8]
    rows = await calc.load_rows(db, [p.id for p in relevant])
    blocked = await calc.blocked_ids(db, [r.id for r in rows if not r.closed])
    by_project: dict[uuid.UUID, list[calc.TaskRow]] = defaultdict(list)
    for r in rows:
        by_project[r.project_id].append(r)
    briefs = await serializers.project_briefs(db, (p.id for p in relevant))

    return HomeOut(
        open_count=len(outs),
        overdue=[t for t in outs if t.due_date and t.due_date < today],
        due_today=[t for t in outs if t.due_date == today],
        due_this_week=[t for t in outs if t.due_date and today < t.due_date <= week_end],
        in_progress=[t for t in outs if t.status.category in (StatusCategory.in_progress, StatusCategory.review)],
        review_queue=await serializers.tasks_out(db, review, today),
        completed_last_7_days=completed_7 or 0,
        time_this_week_minutes=sum(time_svc.entry_minutes(e) for e in my_entries),
        capacity_hours=float(membership.weekly_capacity_hours),
        timer=timer,
        projects=[
            HomeProject(
                project=briefs[p.id],
                health=calc.health(p, calc.scope(by_project[p.id], blocked, today), today),
                my_open_tasks=open_per_project[p.id],
            )
            for p in relevant
        ],
    )


@router.get("/workspaces/{workspace_id}/search", response_model=SearchOut)
async def search(workspace_id: uuid.UUID, user: CurrentUser, db: DB, q: str = Query(min_length=1, max_length=200)):
    await permissions.require_workspace(db, user, workspace_id)
    term = q.strip()
    like = f"%{term.replace('%', r'\%').replace('_', r'\_')}%"
    projects = await _visible_projects(db, user, workspace_id, include_archived=True)
    project_ids = [p.id for p in projects]

    task_conditions = [Task.title.ilike(like)]
    if m := REF_RE.match(term):
        key_project = next((p for p in projects if p.key.upper() == m.group(1).upper()), None)
        if key_project:
            task_conditions.append((Task.project_id == key_project.id) & (Task.number == int(m.group(2))))
    elif term.isdigit():
        task_conditions.append(Task.number == int(term))
    tasks = (
        list(
            await db.scalars(
                select(Task)
                .where(Task.project_id.in_(project_ids), Task.deleted_at.is_(None), or_(*task_conditions))
                .order_by(Task.updated_at.desc())
                .limit(10)
            )
        )
        if project_ids
        else []
    )

    lowered = term.lower()
    matching_projects = [p for p in projects if lowered in p.name.lower() or lowered in p.key.lower()][:6]
    people = list(
        await db.scalars(
            select(User)
            .join(WorkspaceMember, WorkspaceMember.user_id == User.id)
            .where(
                WorkspaceMember.workspace_id == workspace_id,
                WorkspaceMember.deactivated_at.is_(None),
                or_(User.name.ilike(like), User.email.ilike(like)),
            )
            .order_by(User.name)
            .limit(6)
        )
    )
    project_out = await serializers.project_briefs(db, (p.id for p in matching_projects))
    user_out = await serializers.user_briefs(db, (u.id for u in people))
    return SearchOut(
        tasks=await serializers.task_briefs(db, tasks),
        projects=[project_out[p.id] for p in matching_projects],
        people=[user_out[u.id] for u in people],
    )
