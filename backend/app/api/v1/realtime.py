"""WebSocket endpoint for live updates."""

import contextlib
import logging
import uuid

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.core.db import session_factory
from app.core.deps import user_from_token
from app.core.errors import AppError
from app.services.realtime import broker

logger = logging.getLogger(__name__)

router = APIRouter(tags=["realtime"])

# Close codes. 4401 tells the client to refresh its access token and reconnect.
CLOSE_UNAUTHORIZED = 4401
CLOSE_INTERNAL_ERROR = 1011


async def _authenticate(token: str | None) -> uuid.UUID | None:
    """User id for a valid access token, or None. Uses its own short-lived session (not held while connected)."""
    if not token:
        return None
    async with session_factory()() as db:
        try:
            user = await user_from_token(db, token)
        except AppError:
            return None
        return user.id


@router.websocket("/ws")
async def realtime_socket(websocket: WebSocket, token: str | None = None) -> None:
    """Live events for the signed-in user: `?token=<access token>`; send "ping" to get "pong"."""
    # Accept before rejecting: a close before the handshake becomes an HTTP 403, and browsers never see the code.
    await websocket.accept()
    try:
        user_id = await _authenticate(token)
    except Exception:
        logger.exception("WebSocket authentication failed")
        await websocket.close(code=CLOSE_INTERNAL_ERROR)
        return
    if user_id is None:
        await websocket.close(code=CLOSE_UNAUTHORIZED, reason="Invalid or expired access token")
        return

    broker.connect(user_id, websocket)
    try:
        await websocket.send_json({"type": "hello", "user_id": str(user_id)})
        while True:
            message = await websocket.receive()
            if message["type"] == "websocket.disconnect":
                break
            if message.get("text") == "ping":
                await websocket.send_text("pong")
            # Anything else from the client is ignored.
    except WebSocketDisconnect:
        pass
    except Exception:
        logger.exception("WebSocket connection for user %s failed", user_id)
        with contextlib.suppress(Exception):  # the socket may already be gone
            await websocket.close(code=CLOSE_INTERNAL_ERROR)
    finally:
        broker.disconnect(user_id, websocket)
