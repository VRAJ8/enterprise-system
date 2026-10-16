"""@mentions in markdown bodies (comments, descriptions, updates).

The editor inserts a mention as the token ``@[Display Name](user:<uuid>)``. The display name is only
for rendering; the uuid decides who is mentioned. Only people who can view the project count, so a
mention never leaks a task to someone outside it.
"""

import re
import uuid
from collections.abc import Iterable

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Project, User, WorkspaceMember
from app.services import permissions

MENTION_RE = re.compile(
    r"@\[(?P<name>[^\[\]\n]{1,200})\]"
    r"\(user:(?P<id>[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\)"
)
EXCERPT_LENGTH = 140


def parse_mentions(body: str | None) -> set[uuid.UUID]:
    """Ids of every user mentioned in `body` (unverified: see `mentionable`)."""
    return {uuid.UUID(m.group("id")) for m in MENTION_RE.finditer(body or "")}


def plain_text(body: str | None) -> str:
    """`body` with mention tokens rendered as ``@Display Name``."""
    return MENTION_RE.sub(lambda m: "@" + m.group("name").strip(), body or "")


def excerpt(body: str | None, limit: int = EXCERPT_LENGTH) -> str:
    """Single-line preview of `body` (mentions rendered), at most `limit` characters."""
    flat = " ".join(plain_text(body).split())
    return flat if len(flat) <= limit else flat[: limit - 1].rstrip() + "…"


async def mentionable(db: AsyncSession, project: Project, user_ids: Iterable[uuid.UUID]) -> set[uuid.UUID]:
    """The subset of `user_ids` who are active and can view `project` (the only ones to notify)."""
    ids = set(user_ids)
    if not ids:
        return set()
    # One query loads the candidates' memberships into the identity map, so the per-user
    # access checks below only hit the database for project memberships.
    candidates = list(
        await db.scalars(
            select(WorkspaceMember)
            .join(User, User.id == WorkspaceMember.user_id)
            .where(
                WorkspaceMember.workspace_id == project.workspace_id,
                WorkspaceMember.user_id.in_(ids),
                User.is_active.is_(True),
            )
        )
    )
    return {m.user_id for m in candidates if await permissions.project_access(db, m.user_id, project) is not None}
