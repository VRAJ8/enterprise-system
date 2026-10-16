"""Test harness.

Every pytest run creates its own throwaway PostgreSQL database (so parallel runs never collide),
builds the schema from the models, and truncates all tables between tests.

Requires a reachable PostgreSQL. Configure with TEST_DATABASE_URL (default:
postgresql+asyncpg://pm:pm@localhost:5432/pm) — the *database* in that URL is only used to
create/drop the throwaway one.
"""

import os
import uuid

os.environ["ENV"] = "test"
os.environ.setdefault("JWT_SECRET", "test-secret-" + "x" * 40)

import asyncpg  # noqa: E402
import httpx  # noqa: E402
import pytest  # noqa: E402
from sqlalchemy import text  # noqa: E402
from sqlalchemy.engine import make_url  # noqa: E402

import app.models  # noqa: E402,F401
from app.core import db as db_module  # noqa: E402
from app.core.db import Base  # noqa: E402

BASE_URL = os.environ.get("TEST_DATABASE_URL", "postgresql+asyncpg://pm:pm@localhost:5432/pm")
TEST_DB_NAME = f"pm_test_{uuid.uuid4().hex[:10]}"


def _dsn(url, database: str) -> str:
    u = make_url(url).set(drivername="postgresql", database=database)
    return u.render_as_string(hide_password=False)


@pytest.fixture(scope="session", autouse=True)
async def _database():
    admin = await asyncpg.connect(_dsn(BASE_URL, make_url(BASE_URL).database or "postgres"))
    await admin.execute(f'CREATE DATABASE "{TEST_DB_NAME}"')
    await admin.close()

    url = make_url(BASE_URL).set(database=TEST_DB_NAME).render_as_string(hide_password=False)
    engine = db_module.configure(url)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield
    await engine.dispose()

    admin = await asyncpg.connect(_dsn(BASE_URL, make_url(BASE_URL).database or "postgres"))
    await admin.execute(f'DROP DATABASE IF EXISTS "{TEST_DB_NAME}" WITH (FORCE)')
    await admin.close()


@pytest.fixture(autouse=True)
async def _clean_tables(_database):
    yield
    tables = ", ".join(f'"{t.name}"' for t in Base.metadata.sorted_tables)
    async with db_module.get_engine().begin() as conn:
        await conn.execute(text(f"TRUNCATE {tables} RESTART IDENTITY CASCADE"))


@pytest.fixture
async def db():
    """A session for arranging data directly / asserting on the database."""
    async with db_module.session_factory()() as session:
        yield session


@pytest.fixture
async def client():
    from app.main import app

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as c:
        yield c


class Actor:
    """A signed-up user with helpers that call the API as them."""

    def __init__(self, client: httpx.AsyncClient, data: dict):
        self.client = client
        self.token = data["access_token"]
        self.user = data["user"]
        self.id = data["user"]["id"]
        self.name = data["user"]["name"]
        self.email = data["user"]["email"]

    @property
    def headers(self) -> dict:
        return {"Authorization": f"Bearer {self.token}"}

    async def get(self, url, **kw):
        return await self.client.get(url, headers=self.headers, **kw)

    async def post(self, url, json=None, **kw):
        return await self.client.post(url, json=json, headers=self.headers, **kw)

    async def patch(self, url, json=None, **kw):
        return await self.client.patch(url, json=json, headers=self.headers, **kw)

    async def put(self, url, json=None, **kw):
        return await self.client.put(url, json=json, headers=self.headers, **kw)

    async def delete(self, url, **kw):
        return await self.client.delete(url, headers=self.headers, **kw)


async def signup(client, name: str, email: str | None = None, workspace_name: str | None = "Acme", invite_token=None):
    body = {"name": name, "email": email or f"{name.lower().replace(' ', '.')}@example.com", "password": "password123"}
    if invite_token:
        body["invite_token"] = invite_token
    else:
        body["workspace_name"] = workspace_name
    r = await client.post("/api/v1/auth/register", json=body)
    assert r.status_code == 201, r.text
    return Actor(client, r.json())


async def invite(owner: Actor, workspace_id: str, name: str, role: str = "member") -> Actor:
    """Invite a new person into the workspace with `role` and return them signed in."""
    email = f"{name.lower().replace(' ', '.')}@example.com"
    r = await owner.post(f"/api/v1/workspaces/{workspace_id}/invitations", {"email": email, "role": role})
    assert r.status_code == 201, r.text
    token = r.json()["invite_url"].rsplit("/", 1)[1]
    return await signup(owner.client, name, email, invite_token=token)


@pytest.fixture
async def team(client):
    """A workspace with an owner, an admin, two members and a guest."""

    class Team:
        pass

    t = Team()
    t.owner = await signup(client, "Olivia Owner", workspace_name="Acme")
    t.workspace_id = t.owner.user["workspaces"][0]["workspace_id"]
    t.admin = await invite(t.owner, t.workspace_id, "Adam Admin", "admin")
    t.member = await invite(t.owner, t.workspace_id, "Mia Member", "member")
    t.member2 = await invite(t.owner, t.workspace_id, "Max Member", "member")
    t.guest = await invite(t.owner, t.workspace_id, "Gus Guest", "guest")
    return t
