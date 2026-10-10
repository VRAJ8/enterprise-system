"""Populate the database with a realistic demo workspace.

    python seed.py            # add demo data (refuses if users already exist)
    python seed.py --reset    # wipe the database first

Every demo account uses the password: demo1234
"""
import asyncio
import random
import sys
from datetime import date, datetime, timedelta, timezone

from database import client, db, ensure_indexes
from auth_utils import hash_password
from models import gen_id

PASSWORD = "demo1234"
TODAY = date.today()


def d(offset_days: int) -> str:
    return (TODAY + timedelta(days=offset_days)).isoformat()


def ts(offset_days: float) -> str:
    return (datetime.now(timezone.utc) + timedelta(days=offset_days)).isoformat()


PEOPLE = [
    ("Alex Morgan", "admin", "Operations", "Head of Operations"),
    ("Priya Shah", "project_manager", "Product", "Senior Product Manager"),
    ("Daniel Kim", "project_manager", "Marketing", "Marketing Lead"),
    ("Sofia Rossi", "team_member", "Engineering", "Frontend Engineer"),
    ("Liam Chen", "team_member", "Engineering", "Backend Engineer"),
    ("Amara Okafor", "team_member", "Design", "Product Designer"),
    ("Noah Fischer", "team_member", "Marketing", "Content Strategist"),
    ("Mei Tanaka", "team_member", "Engineering", "QA Engineer"),
]

# (name, owner, members, priority, status, start offset, end offset, description, tasks)
# task: (title, assignee, status, priority, due offset, estimate hours)
PROJECTS = [
    ("Customer Portal v2", "Priya Shah", ["Sofia Rossi", "Liam Chen", "Amara Okafor", "Mei Tanaka"], "high", "active", -40, 25,
     "Rebuild the customer self-service portal: billing history, invoices and support tickets in one place.",
     [("Finalize portal information architecture", "Amara Okafor", "completed", "high", -30, 8),
      ("Design billing history screens", "Amara Okafor", "completed", "medium", -20, 12),
      ("Billing API: invoices endpoint", "Liam Chen", "in_review", "high", -2, 16),
      ("Support ticket list UI", "Sofia Rossi", "in_progress", "medium", 3, 14),
      ("SSO login integration", "Liam Chen", "in_progress", "critical", 1, 20),
      ("Accessibility audit", "Mei Tanaka", "todo", "medium", 12, 10),
      ("Regression test plan", "Mei Tanaka", "todo", "high", 8, 6),
      ("Invoice PDF download", "Sofia Rossi", "todo", "low", 18, 8)]),
    ("Q4 Product Launch Campaign", "Daniel Kim", ["Noah Fischer", "Amara Okafor"], "critical", "active", -21, 9,
     "Integrated campaign for the Q4 release: landing page, email sequence, webinar and press outreach.",
     [("Campaign messaging brief", "Daniel Kim", "completed", "high", -14, 6),
      ("Landing page copy", "Noah Fischer", "in_progress", "high", -3, 8),
      ("Launch email sequence (3 emails)", "Noah Fischer", "todo", "high", -1, 10),
      ("Webinar deck", "Amara Okafor", "todo", "medium", 4, 12),
      ("Press list and outreach", "Daniel Kim", "todo", "medium", 6, 6),
      ("Paid social creatives", "Amara Okafor", "todo", "high", 2, 14)]),
    ("Data Warehouse Migration", "Priya Shah", ["Liam Chen", "Mei Tanaka"], "medium", "active", -10, 60,
     "Move reporting from the legacy warehouse to the new cloud warehouse with zero downtime.",
     [("Inventory existing reports", "Liam Chen", "completed", "medium", -5, 6),
      ("Schema mapping document", "Liam Chen", "in_progress", "high", 7, 10),
      ("Set up staging pipeline", None, "todo", "medium", 20, 16),
      ("Data validation scripts", "Mei Tanaka", "todo", "medium", 30, 12)]),
    ("Employee Onboarding Revamp", "Alex Morgan", ["Noah Fischer", "Priya Shah"], "low", "planning", 5, 75,
     "Shorten time-to-productivity for new hires with a structured 30-60-90 day plan.",
     [("Interview 5 recent hires", "Noah Fischer", "todo", "medium", 14, 5),
      ("Draft 30-60-90 day template", None, "todo", "low", 30, 4)]),
]


async def main(reset: bool):
    if reset:
        for name in await db.list_collection_names():
            await db.drop_collection(name)
    elif await db.users.count_documents({}) > 0:
        print("Database already has users. Run with --reset to replace everything with demo data.")
        return

    await ensure_indexes()
    pw = hash_password(PASSWORD)
    users = {}
    for name, role, dept, title in PEOPLE:
        uid = gen_id("user_")
        email = name.split()[0].lower() + "@example.com"
        users[name] = {"user_id": uid, "name": name, "email": email}
        await db.users.insert_one({
            "user_id": uid, "name": name, "email": email, "password": pw, "role": role,
            "department": dept, "title": title, "picture": None, "weekly_capacity_hours": 40,
            "created_at": ts(-60),
        })

    for pname, owner, members, prio, status, s_off, e_off, desc, tasks in PROJECTS:
        pid = gen_id("proj_")
        owner_u = users[owner]
        team = list({owner_u["user_id"], *[users[m]["user_id"] for m in members]})
        await db.projects.insert_one({
            "project_id": pid, "name": pname, "description": desc, "priority": prio, "status": status,
            "start_date": d(s_off), "end_date": d(e_off), "team_members": team,
            "created_by": owner_u["user_id"], "created_by_name": owner, "created_at": ts(s_off), "updated_at": ts(-1),
        })
        await db.chat_channels.insert_one({
            "channel_id": f"proj_{pid}", "name": pname, "type": "project", "project_id": pid,
            "members": team, "created_at": ts(s_off),
        })
        await db.activity_logs.insert_one({
            "activity_id": gen_id("act_"), "user_id": owner_u["user_id"], "user_name": owner, "action": "created",
            "entity_type": "project", "entity_id": pid, "entity_name": pname, "project_id": pid, "details": "",
            "created_at": ts(s_off),
        })

        for i, (title, assignee, t_status, t_prio, due_off, est) in enumerate(tasks):
            tid = gen_id("task_")
            a = users.get(assignee) if assignee else None
            completed_at = ts(due_off - random.randint(0, 3)) if t_status == "completed" else None
            checklist = []
            if i % 3 == 0:
                checklist = [{"id": gen_id("chk_"), "text": t, "done": j < 1 or t_status == "completed"}
                             for j, t in enumerate(["Draft", "Review with stakeholders", "Finalize"])]
            await db.tasks.insert_one({
                "task_id": tid, "title": title, "description": "", "project_id": pid, "project_name": pname,
                "assigned_to": a["user_id"] if a else None, "assigned_to_name": a["name"] if a else None,
                "priority": t_prio, "status": t_status, "start_date": None, "due_date": d(due_off),
                "estimate_hours": est, "checklist": checklist,
                "created_by": owner_u["user_id"], "created_by_name": owner,
                "created_at": ts(s_off + i), "updated_at": ts(-random.random() * 3), "completed_at": completed_at,
            })
            await db.activity_logs.insert_one({
                "activity_id": gen_id("act_"), "user_id": (a or owner_u)["user_id"], "user_name": (a or owner_u)["name"],
                "action": "moved to Completed" if t_status == "completed" else "created",
                "entity_type": "task", "entity_id": tid, "entity_name": title, "project_id": pid, "details": "",
                "created_at": completed_at or ts(s_off + i),
            })

        for m_title, m_off, done in [("Kickoff", s_off, s_off < 0), ("Beta / review", (s_off + e_off) // 2, False),
                                     ("Launch", e_off, False)]:
            await db.milestones.insert_one({
                "milestone_id": gen_id("ms_"), "project_id": pid, "title": m_title, "description": "",
                "due_date": d(m_off), "completed": done, "created_by": owner_u["user_id"], "created_at": ts(s_off),
            })

        await db.chat_messages.insert_one({
            "message_id": gen_id("msg_"), "channel_id": f"proj_{pid}", "sender_id": owner_u["user_id"],
            "sender_name": owner, "sender_picture": "", "content": f"Welcome to the {pname} channel! Post blockers here.",
            "created_at": ts(-2),
        })

    print(f"Seeded {len(PEOPLE)} users and {len(PROJECTS)} projects.")
    print(f"Sign in as alex@example.com (admin), priya@example.com (PM) or sofia@example.com (member); password: {PASSWORD}")
    client.close()


if __name__ == "__main__":
    asyncio.run(main("--reset" in sys.argv))
