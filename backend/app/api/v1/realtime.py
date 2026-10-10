"""WebSocket endpoint for live updates."""

from fastapi import APIRouter

router = APIRouter(tags=["realtime"])
