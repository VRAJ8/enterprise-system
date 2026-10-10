import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, String, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base
from app.models.enums import NotificationType
from app.models.workspace import str_enum


class Activity(Base):
    """Audit trail. `verb` examples: created, updated, moved, commented, deleted, restored.
    `data` holds structured detail, e.g. {"changes": {"status": {"from": "To Do", "to": "Done"}}}."""

    __tablename__ = "activity"
    __table_args__ = (
        Index("ix_activity_project_created", "project_id", "created_at"),
        Index("ix_activity_task_created", "task_id", "created_at"),
        Index("ix_activity_workspace_created", "workspace_id", "created_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    project_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"))
    task_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("tasks.id", ondelete="CASCADE"))
    actor_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    verb: Mapped[str] = mapped_column(String(48))
    data: Mapped[dict] = mapped_column(JSONB, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Notification(Base):
    __tablename__ = "notifications"
    __table_args__ = (Index("ix_notifications_user_created", "user_id", "created_at"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    type: Mapped[NotificationType] = mapped_column(str_enum(NotificationType, "notification_type"))
    actor_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    project_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"))
    task_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("tasks.id", ondelete="CASCADE"))
    # Free-form context for rendering, e.g. {"excerpt": "...", "due_date": "2026-10-12"}
    data: Mapped[dict] = mapped_column(JSONB, default=dict)
    # Deduplication key for system notifications (e.g. "due_soon:<task>:<date>")
    dedupe_key: Mapped[str | None] = mapped_column(String(160))
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
