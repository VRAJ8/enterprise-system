from enum import StrEnum


class WorkspaceRole(StrEnum):
    owner = "owner"
    admin = "admin"
    member = "member"
    guest = "guest"


class ProjectRole(StrEnum):
    lead = "lead"
    member = "member"
    viewer = "viewer"


class ProjectStatus(StrEnum):
    planning = "planning"
    active = "active"
    on_hold = "on_hold"
    completed = "completed"
    archived = "archived"


class ProjectVisibility(StrEnum):
    workspace = "workspace"
    private = "private"


class StatusCategory(StrEnum):
    backlog = "backlog"
    todo = "todo"
    in_progress = "in_progress"
    review = "review"
    done = "done"
    canceled = "canceled"


CLOSED_CATEGORIES = (StatusCategory.done, StatusCategory.canceled)
STARTED_CATEGORIES = (StatusCategory.in_progress, StatusCategory.review)


class Priority(StrEnum):
    urgent = "urgent"
    high = "high"
    medium = "medium"
    low = "low"
    none = "none"


PRIORITY_RANK = {Priority.urgent: 0, Priority.high: 1, Priority.medium: 2, Priority.low: 3, Priority.none: 4}


class Health(StrEnum):
    on_track = "on_track"
    at_risk = "at_risk"
    off_track = "off_track"


class NotificationType(StrEnum):
    assigned = "assigned"  # you were assigned a task
    mentioned = "mentioned"  # @mentioned in a comment or description
    commented = "commented"  # comment on a task you watch
    status_changed = "status_changed"  # task you watch changed status
    due_soon = "due_soon"  # your task is due within 2 days
    overdue = "overdue"  # your task is overdue
    added_to_project = "added_to_project"
    project_update = "project_update"  # new status update on a project you're in
    invited = "invited"
