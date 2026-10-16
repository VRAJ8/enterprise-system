"""Create a realistic demo workspace with ~8 weeks of history.

    python seed.py            # refuses if the database already has users
    python seed.py --reset    # wipes ALL data first

Sign in with any demo account (password: demo1234):
    alex@acme.test (owner) · priya@acme.test (project lead) · sofia@acme.test (member) · gus@partner.test (guest)
"""

import asyncio
import random
import sys
import uuid
from datetime import UTC, date, datetime, time, timedelta
from decimal import Decimal

from sqlalchemy import delete, func, select

import app.models  # noqa: F401
from app.core.db import Base, session_factory
from app.core.security import hash_password
from app.models import (
    Activity,
    Comment,
    Health,
    Label,
    Milestone,
    Notification,
    NotificationType,
    Priority,
    Project,
    ProjectMember,
    ProjectRole,
    ProjectStatus,
    ProjectUpdate,
    ProjectVisibility,
    Task,
    TaskDependency,
    TaskLabel,
    TaskStatus,
    TaskWatcher,
    TimeEntry,
    User,
    Workspace,
    WorkspaceMember,
    WorkspaceRole,
)
from app.services import reminders
from app.services.projects import DEFAULT_STATUSES
from app.services.workspaces import pick_avatar_color

PASSWORD = "demo1234"
rng = random.Random(42)
TODAY = date.today()
NOW = datetime.now(UTC)


def d(offset: int) -> date:
    return TODAY + timedelta(days=offset)


def at(day: date, hour: int = 10, minute: int = 0) -> datetime:
    return datetime.combine(day, time(hour, minute), tzinfo=UTC)


def workday(offset: int) -> date:
    """Nearest weekday on/before today+offset."""
    day = d(offset)
    while day.weekday() >= 5:
        day -= timedelta(days=1)
    return day


PEOPLE = [
    # name, email, role, title, capacity, timezone
    ("Alex Morgan", "alex@acme.test", WorkspaceRole.owner, "Head of Delivery", 40, "Europe/London"),
    ("Priya Shah", "priya@acme.test", WorkspaceRole.admin, "Senior Product Manager", 40, "Asia/Kolkata"),
    ("Daniel Kim", "daniel@acme.test", WorkspaceRole.member, "Marketing Lead", 40, "America/New_York"),
    ("Sofia Rossi", "sofia@acme.test", WorkspaceRole.member, "Frontend Engineer", 40, "Europe/Rome"),
    ("Liam Chen", "liam@acme.test", WorkspaceRole.member, "Backend Engineer", 40, "America/Los_Angeles"),
    ("Amara Okafor", "amara@acme.test", WorkspaceRole.member, "Product Designer", 32, "Europe/London"),
    ("Noah Fischer", "noah@acme.test", WorkspaceRole.member, "Content Strategist", 24, "Europe/Berlin"),
    ("Mei Tanaka", "mei@acme.test", WorkspaceRole.member, "QA Engineer", 40, "Asia/Tokyo"),
    ("Gus Partner", "gus@partner.test", WorkspaceRole.guest, "Agency Contractor", 20, "UTC"),
]

LABELS = [
    ("Bug", "#ef4444"), ("Feature", "#6366f1"), ("Improvement", "#14b8a6"), ("Design", "#ec4899"),
    ("Tech debt", "#f59e0b"), ("Customer", "#0ea5e9"), ("Blocked by vendor", "#a855f7"),
]  # fmt: skip

# Each project: (key, name, icon, color, description, status, priority, lead, members, start, target, health_profile)
PROJECTS = [
    ("WEB", "Customer Portal v2", "code", "#6366f1",
     "Rebuild the customer self-service portal: billing history, invoices, SSO and support tickets in one place.\n\n"
     "**Success:** 30% fewer billing support tickets within one quarter of launch.",
     ProjectStatus.active, Priority.high, "Priya Shah",
     ["Sofia Rossi", "Liam Chen", "Amara Okafor", "Mei Tanaka"], -49, 20, "behind"),
    ("MKT", "Q4 Launch Campaign", "megaphone", "#ec4899",
     "Integrated launch for the Q4 release: landing page, email sequence, webinar, press and paid social.",
     ProjectStatus.active, Priority.urgent, "Daniel Kim",
     ["Noah Fischer", "Amara Okafor", "Gus Partner"], -28, 12, "risky"),
    ("DATA", "Data Warehouse Migration", "layers", "#14b8a6",
     "Move reporting from the legacy warehouse to the new cloud warehouse with zero downtime.",
     ProjectStatus.active, Priority.medium, "Liam Chen",
     ["Mei Tanaka", "Priya Shah"], -35, 55, "healthy"),
    ("MOB", "Mobile App Refresh", "smartphone", "#f97316",
     "Refresh navigation and onboarding of the iOS/Android app based on Q3 research.",
     ProjectStatus.planning, Priority.medium, "Amara Okafor",
     ["Sofia Rossi", "Mei Tanaka"], 7, 84, "future"),
    ("OPS", "Hiring & Onboarding", "briefcase", "#8b5cf6",
     "Structured 30-60-90 onboarding plan and hiring pipeline for the platform team.",
     ProjectStatus.active, Priority.low, "Alex Morgan",
     ["Priya Shah", "Noah Fischer"], -21, 40, "healthy"),
]  # fmt: skip

# Tasks per project: (title, assignee, category, priority, start_offset, due_offset, estimate, labels, subtasks)
TASKS = {
    "WEB": [
        ("Portal information architecture", "Amara Okafor", "done", Priority.high, -48, -40, 12, ["Design"], []),
        ("Design billing history screens", "Amara Okafor", "done", Priority.medium, -40, -30, 16, ["Design"], []),
        (
            "Auth service: SSO with SAML",
            "Liam Chen",
            "in_progress",
            Priority.urgent,
            -20,
            2,
            24,
            ["Feature"],
            ["Okta test tenant", "Azure AD metadata", "Session hand-off"],
        ),
        ("Invoices API endpoint", "Liam Chen", "review", Priority.high, -14, -2, 16, ["Feature"], []),
        (
            "Billing history table with filters",
            "Sofia Rossi",
            "in_progress",
            Priority.high,
            -10,
            4,
            20,
            ["Feature"],
            [],
        ),
        ("Support ticket list UI", "Sofia Rossi", "todo", Priority.medium, 3, 11, 14, ["Feature"], []),
        ("Invoice PDF download", "Sofia Rossi", "todo", Priority.low, 8, 15, 8, ["Feature", "Customer"], []),
        ("Accessibility audit (WCAG 2.2 AA)", "Mei Tanaka", "todo", Priority.medium, 9, 16, 10, ["Improvement"], []),
        ("Regression test plan", "Mei Tanaka", "in_progress", Priority.high, -5, 3, 8, [], []),
        ("Fix: date picker off-by-one in Safari", "Sofia Rossi", "done", Priority.high, -18, -16, 3, ["Bug"], []),
        (
            "Fix: session expires during checkout",
            "Liam Chen",
            "todo",
            Priority.urgent,
            -3,
            -1,
            5,
            ["Bug", "Customer"],
            [],
        ),
        ("Empty states & loading skeletons", "Amara Okafor", "review", Priority.low, -6, 1, 6, ["Design"], []),
        (
            "Load testing: 5k concurrent sessions",
            "Liam Chen",
            "backlog",
            Priority.medium,
            None,
            18,
            12,
            ["Tech debt"],
            [],
        ),
        ("Release notes & customer comms", "Priya Shah", "backlog", Priority.medium, None, 19, 4, ["Customer"], []),
        ("Remove legacy billing iframe", None, "backlog", Priority.low, None, None, 6, ["Tech debt"], []),
        ("Payment method management", "Sofia Rossi", "done", Priority.high, -30, -21, 18, ["Feature"], []),
        ("Usage-based billing breakdown", "Liam Chen", "done", Priority.medium, -35, -24, 14, ["Feature"], []),
        ("Dark mode for portal", "Amara Okafor", "canceled", Priority.low, None, None, 8, ["Design"], []),
    ],
    "MKT": [
        ("Campaign messaging brief", "Daniel Kim", "done", Priority.high, -27, -20, 6, [], []),
        ("Landing page copy", "Noah Fischer", "in_progress", Priority.high, -9, -2, 10, [], []),
        ("Landing page design", "Amara Okafor", "review", Priority.high, -12, -3, 12, ["Design"], []),
        ("Launch email sequence (3 emails)", "Noah Fischer", "todo", Priority.high, -4, -1, 12, [], []),
        ("Webinar deck", "Amara Okafor", "todo", Priority.medium, 0, 6, 14, ["Design"], []),
        ("Press list and outreach", "Daniel Kim", "in_progress", Priority.medium, -5, 5, 8, [], []),
        (
            "Paid social creatives",
            "Gus Partner",
            "in_progress",
            Priority.high,
            -6,
            2,
            16,
            ["Design", "Blocked by vendor"],
            [],
        ),
        ("Analyst briefing", "Daniel Kim", "todo", Priority.medium, 4, 9, 4, [], []),
        ("Customer case study: Northwind", "Noah Fischer", "backlog", Priority.low, None, 11, 8, ["Customer"], []),
        ("Launch day runbook", "Daniel Kim", "todo", Priority.urgent, 6, 10, 4, [], []),
        ("Pricing page update", "Noah Fischer", "done", Priority.medium, -20, -12, 6, [], []),
    ],
    "DATA": [
        ("Inventory existing reports", "Liam Chen", "done", Priority.medium, -34, -27, 8, [], []),
        ("Schema mapping document", "Liam Chen", "done", Priority.high, -26, -15, 16, [], []),
        (
            "Staging pipeline (dbt + Airflow)",
            "Liam Chen",
            "in_progress",
            Priority.high,
            -12,
            9,
            32,
            ["Feature"],
            ["Airflow DAGs", "dbt models: finance", "dbt models: product"],
        ),
        ("Data validation scripts", "Mei Tanaka", "in_progress", Priority.medium, -7, 14, 20, [], []),
        ("Backfill historical data", "Liam Chen", "todo", Priority.medium, 10, 24, 16, [], []),
        ("Dashboard parity checks", "Mei Tanaka", "todo", Priority.medium, 20, 35, 12, [], []),
        ("Cut-over plan & rollback", "Priya Shah", "todo", Priority.high, 30, 45, 6, [], []),
        ("Decommission legacy warehouse", None, "backlog", Priority.low, None, 55, 8, ["Tech debt"], []),
        ("Access control & PII masking", "Liam Chen", "done", Priority.urgent, -22, -14, 12, ["Feature"], []),
    ],
    "MOB": [
        ("Synthesize Q3 research", "Amara Okafor", "todo", Priority.high, 7, 14, 10, ["Design"], []),
        ("New navigation prototype", "Amara Okafor", "backlog", Priority.medium, 14, 28, 20, ["Design"], []),
        ("Onboarding flow redesign", "Sofia Rossi", "backlog", Priority.medium, 28, 49, 24, ["Feature"], []),
        ("Usability testing round 1", "Mei Tanaka", "backlog", Priority.medium, 30, 37, 12, [], []),
    ],
    "OPS": [
        ("Interview 5 recent hires", "Noah Fischer", "done", Priority.medium, -20, -12, 6, [], []),
        ("Draft 30-60-90 day template", "Priya Shah", "in_progress", Priority.medium, -8, 5, 8, [], []),
        ("Buddy program guidelines", "Noah Fischer", "todo", Priority.low, 3, 14, 4, [], []),
        ("Hiring scorecards for 3 roles", "Alex Morgan", "done", Priority.high, -18, -10, 6, [], []),
        ("Engineering ladder v2", "Alex Morgan", "todo", Priority.medium, 7, 30, 10, [], []),
    ],
}

# Blocked task title -> blocker titles (same workspace)
DEPENDENCIES = {
    "Support ticket list UI": ["Invoices API endpoint"],
    "Invoice PDF download": ["Invoices API endpoint"],
    "Accessibility audit (WCAG 2.2 AA)": ["Billing history table with filters"],
    "Launch email sequence (3 emails)": ["Landing page copy"],
    "Launch day runbook": ["Press list and outreach", "Paid social creatives"],
    "Backfill historical data": ["Staging pipeline (dbt + Airflow)"],
    "Dashboard parity checks": ["Backfill historical data"],
    "Cut-over plan & rollback": ["Dashboard parity checks"],
    "Onboarding flow redesign": ["New navigation prototype"],
    "New navigation prototype": ["Synthesize Q3 research"],
}

COMMENTS = [
    (
        "Auth service: SSO with SAML",
        "Priya Shah",
        "@{Liam Chen} do we still expect this by Friday? Two enterprise customers are waiting on it.",
    ),
    (
        "Auth service: SSO with SAML",
        "Liam Chen",
        "Okta works end to end. Azure AD metadata parsing is the last piece, should land tomorrow.",
    ),
    (
        "Invoices API endpoint",
        "Mei Tanaka",
        "Found an edge case: invoices with credit notes return a negative total. Added a test case.",
    ),
    (
        "Invoices API endpoint",
        "Liam Chen",
        "Good catch, fixed in the latest push. @{Mei Tanaka} can you re-run the suite?",
    ),
    (
        "Landing page copy",
        "Daniel Kim",
        "Headline v3 tested best with the sales team. Let's go with it. @{Noah Fischer}",
    ),
    ("Paid social creatives", "Gus Partner", "Waiting on final brand assets from the vendor, ETA Monday."),
    (
        "Paid social creatives",
        "Daniel Kim",
        "That puts us tight against launch. @{Amara Okafor} could you cover two of the formats?",
    ),
    (
        "Staging pipeline (dbt + Airflow)",
        "Priya Shah",
        "Nice progress! Let's demo the finance models in Thursday's review.",
    ),
    (
        "Fix: session expires during checkout",
        "Sofia Rossi",
        "Repro'd: refresh token isn't rotated when the tab is backgrounded on iOS.",
    ),
]

UPDATES = [
    (
        "WEB",
        "Priya Shah",
        Health.at_risk,
        6,
        "SSO is taking longer than planned (Azure AD edge cases). Billing history and payments are done.\n\n"
        "**Risk:** the support ticket UI depends on the invoices API, which is still in review.\n\n"
        "**Next:** land SSO, unblock tickets UI, start the accessibility audit.",
    ),
    (
        "WEB",
        "Priya Shah",
        Health.on_track,
        20,
        "Payments shipped to beta customers, feedback is positive. On track for the target date.",
    ),
    (
        "MKT",
        "Daniel Kim",
        Health.at_risk,
        2,
        "Creatives are blocked on vendor brand assets. Landing page copy slipped two days. "
        "Launch date holds if creatives land by Monday.",
    ),
    (
        "DATA",
        "Liam Chen",
        Health.on_track,
        4,
        "Staging pipeline is running nightly. Validation scripts cover 60% of reports.",
    ),
    (
        "OPS",
        "Alex Morgan",
        Health.on_track,
        9,
        "Scorecards are live for all three roles; interviews scheduled through the month.",
    ),
]


def mention(text: str, users: dict[str, User]) -> str:
    out = text
    for name, u in users.items():
        out = out.replace("@{" + name + "}", f"@[{name}](user:{u.id})")
    return out


async def main(reset: bool) -> None:
    async with session_factory()() as db:
        if reset:
            for table in reversed(Base.metadata.sorted_tables):
                await db.execute(delete(table))
            await db.commit()
        elif await db.scalar(select(func.count()).select_from(User)):
            print(
                "Database already has users. Run `python seed.py --reset` to replace ALL data with the demo workspace."
            )
            return

        pw = hash_password(PASSWORD)
        ws = Workspace(id=uuid.uuid4(), name="Acme Inc", slug="acme")
        db.add(ws)
        await db.flush()

        users: dict[str, User] = {}
        for name, email, role, title, capacity, tz in PEOPLE:
            u = User(
                id=uuid.uuid4(),
                email=email,
                name=name,
                password_hash=pw,
                title=title,
                timezone=tz,
                avatar_color=pick_avatar_color(email),
                last_login_at=NOW - timedelta(hours=rng.randint(1, 72)),
            )
            db.add(u)
            users[name] = u
        await db.flush()
        for name, _email, role, _title, capacity, _tz in PEOPLE:
            db.add(
                WorkspaceMember(
                    workspace_id=ws.id, user_id=users[name].id, role=role, weekly_capacity_hours=Decimal(capacity)
                )
            )

        labels = {n: Label(id=uuid.uuid4(), workspace_id=ws.id, name=n, color=c) for n, c in LABELS}
        db.add_all(labels.values())
        await db.flush()

        tasks_by_title: dict[str, Task] = {}
        statuses_by_project: dict[str, dict[str, TaskStatus]] = {}

        def act(project: Project, task: Task | None, actor: str, verb: str, when: datetime, data: dict | None = None):
            db.add(
                Activity(
                    workspace_id=ws.id,
                    project_id=project.id,
                    task_id=task.id if task else None,
                    actor_id=users[actor].id,
                    verb=verb,
                    data=data or {},
                    created_at=when,
                )
            )

        for key, name, icon, color, desc, pstatus, prio, lead, members, start, target, profile in PROJECTS:
            p = Project(
                id=uuid.uuid4(),
                workspace_id=ws.id,
                key=key,
                name=name,
                description=desc,
                color=color,
                icon=icon,
                status=pstatus,
                priority=prio,
                visibility=ProjectVisibility.workspace if key != "OPS" else ProjectVisibility.private,
                lead_id=users[lead].id,
                start_date=d(start),
                target_date=d(target),
                created_by=users[lead].id,
                created_at=at(d(min(start, 0) - 2)),
            )
            db.add(p)
            await db.flush()
            db.add(ProjectMember(project_id=p.id, user_id=users[lead].id, role=ProjectRole.lead))
            for m in members:
                db.add(ProjectMember(project_id=p.id, user_id=users[m].id, role=ProjectRole.member))
            sts = {}
            for i, (sname, cat, scolor) in enumerate(DEFAULT_STATUSES):
                s = TaskStatus(
                    id=uuid.uuid4(), project_id=p.id, name=sname, category=cat, color=scolor, position=float(i)
                )
                db.add(s)
                sts[cat.value] = s
            statuses_by_project[key] = sts
            await db.flush()
            act(p, None, lead, "created", p.created_at)

            # Milestones at ~1/3, 2/3 and the target date
            span = target - start
            for i, mname in enumerate(["Alpha", "Beta", "Launch"]):
                due = d(start + span * (i + 1) // 3)
                db.add(
                    Milestone(
                        project_id=p.id,
                        name=mname,
                        due_date=due,
                        completed_at=at(due) if due < TODAY - timedelta(days=3) else None,
                        description=f"{mname} milestone for {name}",
                    )
                )
            await db.flush()
            milestones = list(
                await db.scalars(select(Milestone).where(Milestone.project_id == p.id).order_by(Milestone.due_date))
            )

            number = 0
            for pos, (title, assignee, cat, tprio, s_off, due_off, est, tlabels, subtasks) in enumerate(TASKS[key]):
                number += 1
                created = at(d(min(s_off if s_off is not None else -3, -1) - rng.randint(1, 6)), rng.randint(8, 17))
                created = max(created, p.created_at)
                started = completed = None
                if cat in ("in_progress", "review", "done"):
                    started = created + timedelta(days=rng.randint(0, 3), hours=rng.randint(1, 6))
                if cat == "done":
                    due_day = d(due_off) if due_off is not None else TODAY - timedelta(days=5)
                    completed = at(min(due_day + timedelta(days=rng.randint(-2, 1)), TODAY - timedelta(days=1)), 16)
                    completed = max(completed, (started or created) + timedelta(hours=6))
                milestone = None
                if due_off is not None and milestones:
                    due_day = d(due_off)
                    milestone = next((m for m in milestones if m.due_date and due_day <= m.due_date), milestones[-1])
                t = Task(
                    id=uuid.uuid4(),
                    project_id=p.id,
                    number=number,
                    title=title,
                    description=f"Context and acceptance criteria for **{title.lower()}**.\n\n- [ ] Spec reviewed\n- [ ] Implemented\n- [ ] Verified",
                    status_id=sts[cat].id,
                    priority=tprio,
                    assignee_id=users[assignee].id if assignee else None,
                    reporter_id=users[lead].id,
                    milestone_id=milestone.id if milestone else None,
                    start_date=d(s_off) if s_off is not None else None,
                    due_date=d(due_off) if due_off is not None else None,
                    estimate_hours=Decimal(est) if est else None,
                    position=(pos + 1) * 1024.0,
                    started_at=started,
                    completed_at=completed,
                    created_at=created,
                    updated_at=completed or started or created,
                )
                db.add(t)
                tasks_by_title[title] = t
                await db.flush()
                for ln in tlabels:
                    db.add(TaskLabel(task_id=t.id, label_id=labels[ln].id))
                for w in {assignee, lead} - {None}:
                    db.add(TaskWatcher(task_id=t.id, user_id=users[w].id))
                act(p, t, lead, "created", created)
                if started:
                    act(
                        p,
                        t,
                        assignee or lead,
                        "status_changed",
                        started,
                        {"changes": {"status": {"from": "To Do", "to": "In Progress"}}},
                    )
                if completed:
                    act(
                        p,
                        t,
                        assignee or lead,
                        "status_changed",
                        completed,
                        {"changes": {"status": {"from": "In Review", "to": "Done"}}},
                    )

                for j, sub in enumerate(subtasks):
                    number += 1
                    sub_done = j == 0 and cat != "todo"
                    st = Task(
                        id=uuid.uuid4(),
                        project_id=p.id,
                        number=number,
                        title=sub,
                        status_id=sts["done" if sub_done else "todo"].id,
                        priority=Priority.none,
                        assignee_id=t.assignee_id,
                        reporter_id=t.reporter_id,
                        parent_id=t.id,
                        due_date=t.due_date,
                        estimate_hours=Decimal(est // max(1, len(subtasks))),
                        position=(j + 1) * 1024.0,
                        completed_at=at(TODAY - timedelta(days=2)) if sub_done else None,
                        created_at=created,
                    )
                    db.add(st)
            p.task_counter = number

        await db.flush()

        for blocked, blockers in DEPENDENCIES.items():
            for b in blockers:
                db.add(TaskDependency(blocker_id=tasks_by_title[b].id, blocked_id=tasks_by_title[blocked].id))

        # Comments + mention notifications
        for i, (title, author, body) in enumerate(COMMENTS):
            t = tasks_by_title[title]
            when = NOW - timedelta(hours=(len(COMMENTS) - i) * 5)
            text = mention(body, users)
            db.add(Comment(task_id=t.id, author_id=users[author].id, body=text, created_at=when))
            project = await db.get(Project, t.project_id)
            act(project, t, author, "commented", when, {"excerpt": body[:140].replace("@{", "@").replace("}", "")})
            for name, u in users.items():
                if "@{" + name + "}" in body:
                    db.add(
                        Notification(
                            user_id=u.id,
                            workspace_id=ws.id,
                            type=NotificationType.mentioned,
                            actor_id=users[author].id,
                            project_id=t.project_id,
                            task_id=t.id,
                            data={"excerpt": body.replace("@{", "@").replace("}", "")[:140]},
                            created_at=when,
                            read_at=when + timedelta(hours=1) if i < 3 else None,
                        )
                    )

        # Assignment / due-soon notifications for Sofia (so her inbox is lively)
        sofia = users["Sofia Rossi"]
        for t in [tasks_by_title["Support ticket list UI"], tasks_by_title["Invoice PDF download"]]:
            db.add(
                Notification(
                    user_id=sofia.id,
                    workspace_id=ws.id,
                    type=NotificationType.assigned,
                    actor_id=users["Priya Shah"].id,
                    project_id=t.project_id,
                    task_id=t.id,
                    data={},
                    created_at=NOW - timedelta(hours=rng.randint(2, 30)),
                )
            )

        # Time entries: last 3 weeks on started/done tasks
        for title, t in tasks_by_title.items():
            if not t.assignee_id or not t.started_at or t.estimate_hours is None:
                continue
            user = next(u for u in users.values() if u.id == t.assignee_id)
            logged_target = float(t.estimate_hours) * (1.0 if t.completed_at else rng.uniform(0.3, 0.8)) * 60
            day = max(t.started_at.date(), TODAY - timedelta(days=21))
            end = t.completed_at.date() if t.completed_at else TODAY
            logged = 0
            while day <= end and logged < logged_target:
                if day.weekday() < 5 and rng.random() < 0.7:
                    minutes = rng.choice([30, 45, 60, 90, 120, 150, 180])
                    start = at(day, rng.randint(9, 14))
                    db.add(
                        TimeEntry(
                            workspace_id=ws.id,
                            task_id=t.id,
                            user_id=user.id,
                            started_at=start,
                            ended_at=start + timedelta(minutes=minutes),
                            minutes=minutes,
                            note=rng.choice(["", "", "Pairing session", "Review feedback", "Implementation"]),
                        )
                    )
                    logged += minutes
                day += timedelta(days=1)

        # A running timer for Sofia
        db.add(
            TimeEntry(
                workspace_id=ws.id,
                task_id=tasks_by_title["Billing history table with filters"].id,
                user_id=sofia.id,
                started_at=NOW - timedelta(minutes=47),
                ended_at=None,
                minutes=0,
                note="",
            )
        )

        for key, author, health, days_ago, body in UPDATES:
            project = await db.scalar(select(Project).where(Project.workspace_id == ws.id, Project.key == key))
            when = NOW - timedelta(days=days_ago)
            db.add(
                ProjectUpdate(
                    project_id=project.id, author_id=users[author].id, health=health, body=body, created_at=when
                )
            )
            act(project, None, author, "posted_update", when, {"health": health.value})

        await db.flush()
        # Same pass the scheduler runs, so every inbox starts with realistic deadline reminders.
        await reminders.send_deadline_reminders(db)
        await db.commit()

    print(
        "Seeded workspace 'Acme Inc' (/acme) with",
        len(PEOPLE),
        "people,",
        len(PROJECTS),
        "projects,",
        sum(len(v) for v in TASKS.values()),
        "top-level tasks.",
    )
    print(f"Sign in as alex@acme.test, priya@acme.test, sofia@acme.test or gus@partner.test — password: {PASSWORD}")


if __name__ == "__main__":
    asyncio.run(main("--reset" in sys.argv))
