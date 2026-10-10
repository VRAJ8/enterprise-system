"""Activity log + notification helpers. Both only *add* rows; the caller commits."""

import uuid
from collections.abc import Iterable
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Activity, Notification, NotificationType
from app.services.realtime import queue_event


def record(
    db: AsyncSession,
    *,
    workspace_id: uuid.UUID,
    actor_id: uuid.UUID | None,
    verb: str,
    project_id: uuid.UUID | None = None,
    task_id: uuid.UUID | None = None,
    data: dict[str, Any] | None = None,
) -> Activity:
    """Append an activity entry. Verbs: created, updated, moved, deleted, restored, commented, ...

    For field changes use data={"changes": {"<field>": {"from": <display>, "to": <display>}}}
    with human-readable values (status names, people's names), so the feed can render directly.
    """
    entry = Activity(
        workspace_id=workspace_id,
        actor_id=actor_id,
        verb=verb,
        project_id=project_id,
        task_id=task_id,
        data=data or {},
    )
    db.add(entry)
    return entry


async def notify(
    db: AsyncSession,
    *,
    user_ids: Iterable[uuid.UUID | None],
    type: NotificationType,
    workspace_id: uuid.UUID,
    actor_id: uuid.UUID | None,
    project_id: uuid.UUID | None = None,
    task_id: uuid.UUID | None = None,
    data: dict[str, Any] | None = None,
    dedupe_key: str | None = None,
) -> list[Notification]:
    """Create notifications for each recipient (never the actor themself) and push them live.

    With `dedupe_key`, a recipient who already has a notification with that key gets nothing new.
    """
    recipients = {u for u in user_ids if u is not None and u != actor_id}
    if dedupe_key and recipients:
        existing = set(
            await db.scalars(
                select(Notification.user_id).where(
                    Notification.dedupe_key == dedupe_key, Notification.user_id.in_(recipients)
                )
            )
        )
        recipients -= existing
    created = []
    for uid in recipients:
        n = Notification(
            id=uuid.uuid4(),
            user_id=uid,
            type=type,
            workspace_id=workspace_id,
            actor_id=actor_id,
            project_id=project_id,
            task_id=task_id,
            data=data or {},
            dedupe_key=dedupe_key,
        )
        db.add(n)
        created.append(n)
        queue_event(
            db,
            "notification.created",
            [uid],
            workspace_id=workspace_id,
            project_id=project_id,
            task_id=task_id,
            data={"id": str(n.id), "type": type.value},
        )
    return created
