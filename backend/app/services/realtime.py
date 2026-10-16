"""Realtime fan-out over WebSockets.

Handlers *queue* events on the DB session (`queue_event`). They are published only after the
transaction commits (SQLAlchemy `after_commit` hook), so clients never see data that was rolled back.

The broker is in-process. To run several API instances, replace `Broker.publish` with a
Postgres LISTEN/NOTIFY (or Redis) backed implementation — the interface stays the same.
"""

import asyncio
import json
import logging
import uuid
from collections import defaultdict
from collections.abc import Iterable
from typing import Any

from fastapi import WebSocket
from sqlalchemy import event
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import Session as SyncSession

logger = logging.getLogger(__name__)

_PENDING_KEY = "pending_realtime_events"


class Broker:
    def __init__(self) -> None:
        self._connections: dict[uuid.UUID, set[WebSocket]] = defaultdict(set)

    def connect(self, user_id: uuid.UUID, ws: WebSocket) -> None:
        self._connections[user_id].add(ws)

    def disconnect(self, user_id: uuid.UUID, ws: WebSocket) -> None:
        conns = self._connections.get(user_id)
        if conns:
            conns.discard(ws)
            if not conns:
                self._connections.pop(user_id, None)

    def online_user_ids(self) -> set[uuid.UUID]:
        return set(self._connections)

    async def publish(self, message: dict[str, Any], audience: Iterable[uuid.UUID]) -> None:
        payload = json.dumps(message, default=str)
        for uid in set(audience):
            for ws in list(self._connections.get(uid, ())):
                try:
                    await ws.send_text(payload)
                except Exception:  # connection went away mid-send
                    self.disconnect(uid, ws)


broker = Broker()


def queue_event(
    db: AsyncSession,
    type: str,
    audience: Iterable[uuid.UUID],
    *,
    workspace_id: uuid.UUID | None = None,
    project_id: uuid.UUID | None = None,
    task_id: uuid.UUID | None = None,
    data: dict[str, Any] | None = None,
) -> None:
    """Publish `{type, workspace_id, project_id, task_id, data}` to `audience` once the session commits."""
    message = {
        "type": type,
        "workspace_id": workspace_id,
        "project_id": project_id,
        "task_id": task_id,
        "data": data or {},
    }
    db.sync_session.info.setdefault(_PENDING_KEY, []).append((message, set(audience)))


@event.listens_for(SyncSession, "after_commit")
def _publish_after_commit(session: SyncSession) -> None:
    pending = session.info.pop(_PENDING_KEY, None)
    if not pending:
        return
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:  # no loop (e.g. sync scripts) — nothing is listening anyway
        return
    for message, audience in pending:
        loop.create_task(broker.publish(message, audience))


@event.listens_for(SyncSession, "after_rollback")
def _drop_after_rollback(session: SyncSession) -> None:
    session.info.pop(_PENDING_KEY, None)
