"""Workspace helpers: creation, slugs, avatar colours."""

import hashlib
import re
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Label, User, Workspace, WorkspaceMember, WorkspaceRole

AVATAR_COLORS = [
    "#6366f1", "#8b5cf6", "#ec4899", "#f43f5e", "#f97316", "#eab308",
    "#22c55e", "#14b8a6", "#06b6d4", "#3b82f6", "#a855f7", "#64748b",
]  # fmt: skip

DEFAULT_LABELS = [("Bug", "#ef4444"), ("Feature", "#6366f1"), ("Improvement", "#14b8a6"), ("Design", "#ec4899")]


def pick_avatar_color(seed: str) -> str:
    digest = hashlib.sha256(seed.encode()).digest()
    return AVATAR_COLORS[digest[0] % len(AVATAR_COLORS)]


def slugify(text: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")
    return (slug or "workspace")[:40].strip("-") or "workspace"


async def unique_slug(db: AsyncSession, base: str, exclude_id: uuid.UUID | None = None) -> str:
    base = slugify(base)
    candidate, n = base, 1
    while True:
        q = select(Workspace.id).where(Workspace.slug == candidate)
        if exclude_id:
            q = q.where(Workspace.id != exclude_id)
        if not await db.scalar(q):
            return candidate
        n += 1
        candidate = f"{base}-{n}"


async def create_workspace(db: AsyncSession, *, owner: User, name: str, slug: str | None = None) -> Workspace:
    """Create a workspace with `owner` as its owner and a few starter labels. Caller commits."""
    ws = Workspace(id=uuid.uuid4(), name=name, slug=await unique_slug(db, slug or name))
    db.add(ws)
    await db.flush()
    db.add(WorkspaceMember(workspace_id=ws.id, user_id=owner.id, role=WorkspaceRole.owner))
    for label_name, color in DEFAULT_LABELS:
        db.add(Label(workspace_id=ws.id, name=label_name, color=color))
    await db.flush()
    return ws
