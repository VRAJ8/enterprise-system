"""Tasks: CRUD, filtering, drag & drop ordering, bulk edits, subtasks, dependencies, watchers, labels."""

from fastapi import APIRouter

router = APIRouter(tags=["tasks"])
