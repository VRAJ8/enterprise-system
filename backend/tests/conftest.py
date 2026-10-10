"""Test setup: an in-memory MongoDB (mongomock) swapped in before the app is imported."""
import os
import sys
from pathlib import Path

os.environ.setdefault("JWT_SECRET", "test-secret-" + "x" * 40)
os.environ["GROQ_API_KEY"] = ""
os.environ["RESEND_API_KEY"] = ""
os.environ["ALLOW_OPEN_REGISTRATION"] = "true"
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import logging
import bcrypt
import pytest
import httpx
from mongomock_motor import AsyncMongoMockClient

import database

# Cheap password hashing keeps the suite fast
_gensalt = bcrypt.gensalt
bcrypt.gensalt = lambda rounds=4, prefix=b"2b": _gensalt(4, prefix)
logging.getLogger("httpx").setLevel(logging.WARNING)

database.client = AsyncMongoMockClient()
database.db = database.client["test_db"]

from server import app  # noqa: E402  (must import after patching the database)


@pytest.fixture(autouse=True)
async def clean_db():
    for name in await database.db.list_collection_names():
        await database.db.drop_collection(name)
    yield


@pytest.fixture
async def client():
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as c:
        yield c


class Workspace:
    """Helper that creates users with given roles and returns auth headers."""

    def __init__(self, client):
        self.client = client

    async def register(self, name, email, password="password123"):
        r = await self.client.post("/api/auth/register", json={"name": name, "email": email, "password": password})
        assert r.status_code == 200, r.text
        return r.json()

    async def user(self, name, role):
        """Creates a user; the first one is the bootstrap admin."""
        email = f"{name.lower()}@example.com"
        data = await self.register(name, email)
        uid = data["user"]["user_id"]
        if role != data["user"]["role"]:
            await database.db.users.update_one({"user_id": uid}, {"$set": {"role": role}})
        token = (await self.client.post("/api/auth/login", json={"email": email, "password": "password123"})).json()["access_token"]
        return {"id": uid, "name": name, "headers": {"Authorization": f"Bearer {token}"}}


@pytest.fixture
async def ws(client):
    w = Workspace(client)
    w.admin = await w.user("Alice", "admin")
    w.pm = await w.user("Paul", "project_manager")
    w.member = await w.user("Maya", "team_member")
    w.outsider = await w.user("Oscar", "team_member")
    return w
