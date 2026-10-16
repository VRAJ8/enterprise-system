"""Import every model so Base.metadata is complete (Alembic and tests rely on this)."""

from app.models.activity import Activity, Notification
from app.models.enums import (
    CLOSED_CATEGORIES,
    PRIORITY_RANK,
    STARTED_CATEGORIES,
    Health,
    NotificationType,
    Priority,
    ProjectRole,
    ProjectStatus,
    ProjectVisibility,
    StatusCategory,
    WorkspaceRole,
)
from app.models.project import (
    Milestone,
    Project,
    ProjectMember,
    ProjectUpdate,
    TaskStatus,
)
from app.models.task import (
    Attachment,
    Comment,
    Task,
    TaskDependency,
    TaskLabel,
    TaskWatcher,
)
from app.models.time_entry import TimeEntry
from app.models.user import Session, User
from app.models.workspace import Invitation, Label, Workspace, WorkspaceMember

__all__ = [
    "Activity",
    "Attachment",
    "CLOSED_CATEGORIES",
    "Comment",
    "Health",
    "Invitation",
    "Label",
    "Milestone",
    "Notification",
    "NotificationType",
    "PRIORITY_RANK",
    "Priority",
    "Project",
    "ProjectMember",
    "ProjectRole",
    "ProjectStatus",
    "ProjectUpdate",
    "ProjectVisibility",
    "STARTED_CATEGORIES",
    "Session",
    "StatusCategory",
    "Task",
    "TaskDependency",
    "TaskLabel",
    "TaskStatus",
    "TaskWatcher",
    "TimeEntry",
    "User",
    "Workspace",
    "WorkspaceMember",
    "WorkspaceRole",
]
