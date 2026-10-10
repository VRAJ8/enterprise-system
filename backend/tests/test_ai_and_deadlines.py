import json
from datetime import date, timedelta
from types import SimpleNamespace
import agent_service
import database
from tests.test_projects_tasks import make_project, make_task


def _tool_call(name, args, call_id="call_1"):
    return SimpleNamespace(id=call_id, function=SimpleNamespace(name=name, arguments=json.dumps(args)))


class FakeGroq:
    """Replays scripted model responses and records what it was sent."""

    def __init__(self, script):
        self.script = list(script)
        self.calls = []
        self.chat = SimpleNamespace(completions=SimpleNamespace(create=self._create))

    async def _create(self, **kwargs):
        self.calls.append(kwargs)
        content, tool_calls = self.script.pop(0)
        msg = SimpleNamespace(content=content, tool_calls=tool_calls)
        return SimpleNamespace(choices=[SimpleNamespace(message=msg)])


async def test_ai_requires_login(client):
    assert (await client.post("/api/ai/chat", json={"message": "hi"})).status_code == 401


async def test_ai_not_configured_returns_503(ws, client):
    r = await client.post("/api/ai/chat", json={"message": "hi"}, headers=ws.member["headers"])
    assert r.status_code == 503
    assert "GROQ_API_KEY" in r.json()["detail"]


async def test_ai_actions_respect_user_permissions(ws, client, monkeypatch):
    p = await make_project(client, ws.pm, team_members=[ws.member["id"]])
    t = await make_task(client, ws.pm, p["project_id"])  # not assigned to Maya

    fake = FakeGroq([
        (None, [_tool_call("update_task", {"task_id": t["task_id"], "status": "completed"})]),
        ("I couldn't complete that task — it isn't assigned to you.", None),
    ])
    monkeypatch.setattr(agent_service, "_get_client", lambda: fake)

    r = await client.post("/api/ai/chat", json={"message": "mark it done"}, headers=ws.member["headers"])
    assert r.status_code == 200
    body = r.json()
    assert body["actions"][0]["ok"] is False
    assert (await database.db.tasks.find_one({"task_id": t["task_id"]}))["status"] == "todo"
    # The tool result was fed back to the model for the final answer
    assert fake.calls[1]["messages"][-1]["role"] == "tool"


async def test_ai_creates_task_as_manager(ws, client, monkeypatch):
    p = await make_project(client, ws.pm, team_members=[ws.member["id"]])
    fake = FakeGroq([
        (None, [_tool_call("create_task", {"title": "Write launch email", "project_id": p["project_id"],
                                           "assigned_to": ws.member["id"], "due_date": "2030-01-15"})]),
        ("Created 'Write launch email' for Maya, due Jan 15.", None),
    ])
    monkeypatch.setattr(agent_service, "_get_client", lambda: fake)
    r = await client.post("/api/ai/chat", json={"message": "add a task"}, headers=ws.pm["headers"])
    assert r.status_code == 200
    assert r.json()["actions"][0]["ok"] is True
    task = await database.db.tasks.find_one({"title": "Write launch email"})
    assert task["created_by"] == ws.pm["id"]  # attributed to the real user, not "system_ai"
    assert task["assigned_to_name"] == "Maya"


async def test_ai_context_only_includes_visible_data(ws, client, monkeypatch):
    secret = await make_project(client, ws.pm, name="Secret Merger")
    await make_task(client, ws.pm, secret["project_id"], title="Due diligence")
    fake = FakeGroq([("Nothing to report.", None)])
    monkeypatch.setattr(agent_service, "_get_client", lambda: fake)
    await client.post("/api/ai/chat", json={"message": "what's going on?"}, headers=ws.outsider["headers"])
    system_prompt = fake.calls[0]["messages"][0]["content"]
    assert "Secret Merger" not in system_prompt
    assert "Due diligence" not in system_prompt


async def test_deadline_scan_notifies_once(ws, client):
    today = date.today()
    p = await make_project(client, ws.pm, team_members=[ws.member["id"]])
    await make_task(client, ws.pm, p["project_id"], title="Soon", assigned_to=ws.member["id"],
                    due_date=(today + timedelta(days=1)).isoformat())
    await make_task(client, ws.pm, p["project_id"], title="Late", assigned_to=ws.member["id"],
                    due_date=(today - timedelta(days=2)).isoformat())
    await make_task(client, ws.pm, p["project_id"], title="Far", assigned_to=ws.member["id"],
                    due_date=(today + timedelta(days=30)).isoformat())

    r = await client.post("/api/ai/trigger-scan", headers=ws.admin["headers"])
    assert r.status_code == 200
    # Soon → assignee; Late → assignee + PM (task creator)
    assert r.json()["notifications_sent"] == 3

    again = await agent_service.run_deadline_check()
    assert again["notifications_sent"] == 0

    assert (await client.post("/api/ai/trigger-scan", headers=ws.member["headers"])).status_code == 403
