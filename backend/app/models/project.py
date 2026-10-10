import uuid
from datetime import date, datetime

from sqlalchemy import (
    Date,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base
from app.models.enums import (
    Health,
    Priority,
    ProjectRole,
    ProjectStatus,
    ProjectVisibility,
    StatusCategory,
)
from app.models.workspace import str_enum


class Project(Base):
    __tablename__ = "projects"
    __table_args__ = (UniqueConstraint("workspace_id", "key", name="uq_projects_workspace_key"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"), index=True)
    key: Mapped[str] = mapped_column(String(6))
    name: Mapped[str] = mapped_column(String(120))
    description: Mapped[str] = mapped_column(Text, default="")
    color: Mapped[str] = mapped_column(String(16), default="#6366f1")
    icon: Mapped[str] = mapped_column(String(32), default="folder")
    status: Mapped[ProjectStatus] = mapped_column(
        str_enum(ProjectStatus, "project_status"), default=ProjectStatus.active
    )
    priority: Mapped[Priority] = mapped_column(str_enum(Priority, "project_priority"), default=Priority.medium)
    visibility: Mapped[ProjectVisibility] = mapped_column(
        str_enum(ProjectVisibility, "project_visibility"), default=ProjectVisibility.workspace
    )
    lead_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    start_date: Mapped[date | None] = mapped_column(Date)
    target_date: Mapped[date | None] = mapped_column(Date)
    task_counter: Mapped[int] = mapped_column(Integer, default=0)
    created_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class ProjectMember(Base):
    __tablename__ = "project_members"

    project_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True, index=True)
    role: Mapped[ProjectRole] = mapped_column(str_enum(ProjectRole, "project_role"))
    added_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class TaskStatus(Base):
    __tablename__ = "task_statuses"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(48))
    category: Mapped[StatusCategory] = mapped_column(str_enum(StatusCategory, "status_category"))
    color: Mapped[str] = mapped_column(String(16))
    position: Mapped[float] = mapped_column(Float)


class Milestone(Base):
    __tablename__ = "milestones"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(120))
    description: Mapped[str] = mapped_column(Text, default="")
    due_date: Mapped[date | None] = mapped_column(Date)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class ProjectUpdate(Base):
    """A written status report ("we're at risk because…")."""

    __tablename__ = "project_updates"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    author_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    health: Mapped[Health] = mapped_column(str_enum(Health, "update_health"))
    body: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
