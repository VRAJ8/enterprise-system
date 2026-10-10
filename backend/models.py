from pydantic import BaseModel, ConfigDict, EmailStr, Field, BeforeValidator
from typing import Optional, List, Literal, Annotated
from datetime import date
import uuid


def gen_id(prefix=""):
    return f"{prefix}{uuid.uuid4().hex[:12]}"


Role = Literal["admin", "project_manager", "team_member"]
Priority = Literal["low", "medium", "high", "critical"]
TaskStatus = Literal["todo", "in_progress", "in_review", "completed"]
ProjectStatus = Literal["planning", "active", "on_hold", "completed", "cancelled"]

ROLES = list(Role.__args__)
TASK_STATUSES = list(TaskStatus.__args__)
PROJECT_STATUSES = list(ProjectStatus.__args__)
PRIORITIES = list(Priority.__args__)


def _parse_date(v):
    """Accept 'YYYY-MM-DD' (or a full ISO timestamp, truncated); empty means unset."""
    if v is None or v == "":
        return None
    if not isinstance(v, str):
        raise ValueError("date must be a string in YYYY-MM-DD format")
    v = v[:10]
    date.fromisoformat(v)
    return v


DateStr = Annotated[Optional[str], BeforeValidator(_parse_date)]
NonEmptyStr = Annotated[str, Field(min_length=1, max_length=200)]
LongText = Annotated[str, Field(max_length=10000)]


# ─── Auth ───
class UserRegister(BaseModel):
    name: NonEmptyStr
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)


class UserLogin(BaseModel):
    email: str
    password: str


class UserResponse(BaseModel):
    model_config = ConfigDict(extra="ignore")
    user_id: str
    name: str
    email: str
    role: str
    picture: Optional[str] = None
    department: Optional[str] = None
    title: Optional[str] = None
    created_at: Optional[str] = None


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserResponse


# ─── Users ───
class UserCreate(BaseModel):
    """Admin-created account (invite)."""
    name: NonEmptyStr
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    role: Role = "team_member"
    department: Optional[str] = None
    title: Optional[str] = None


class UserUpdate(BaseModel):
    name: Optional[NonEmptyStr] = None
    department: Optional[str] = Field(default=None, max_length=100)
    title: Optional[str] = Field(default=None, max_length=100)
    picture: Optional[str] = Field(default=None, max_length=2000)
    role: Optional[Role] = None
    weekly_capacity_hours: Optional[float] = Field(default=None, ge=0, le=168)
    # Password change: users changing their own password must supply current_password.
    password: Optional[str] = Field(default=None, min_length=8, max_length=128)
    current_password: Optional[str] = None


# ─── Projects ───
class ProjectCreate(BaseModel):
    name: NonEmptyStr
    description: LongText = ""
    priority: Priority = "medium"
    status: ProjectStatus = "active"
    start_date: DateStr = None
    end_date: DateStr = None
    team_members: List[str] = []


class ProjectUpdate(BaseModel):
    name: Optional[NonEmptyStr] = None
    description: Optional[LongText] = None
    priority: Optional[Priority] = None
    status: Optional[ProjectStatus] = None
    start_date: DateStr = None
    end_date: DateStr = None
    team_members: Optional[List[str]] = None


# ─── Tasks ───
class ChecklistItem(BaseModel):
    id: str = Field(default_factory=lambda: gen_id("chk_"))
    text: Annotated[str, Field(min_length=1, max_length=500)]
    done: bool = False


class TaskCreate(BaseModel):
    title: NonEmptyStr
    description: LongText = ""
    project_id: str
    assigned_to: Optional[str] = None
    priority: Priority = "medium"
    status: TaskStatus = "todo"
    start_date: DateStr = None
    due_date: DateStr = None
    estimate_hours: Optional[float] = Field(default=None, ge=0, le=1000)
    checklist: List[ChecklistItem] = []


class TaskUpdate(BaseModel):
    title: Optional[NonEmptyStr] = None
    description: Optional[LongText] = None
    status: Optional[TaskStatus] = None
    assigned_to: Optional[str] = None
    priority: Optional[Priority] = None
    start_date: DateStr = None
    due_date: DateStr = None
    estimate_hours: Optional[float] = Field(default=None, ge=0, le=1000)
    checklist: Optional[List[ChecklistItem]] = None


# ─── Milestones ───
class MilestoneCreate(BaseModel):
    title: NonEmptyStr
    description: LongText = ""
    due_date: Annotated[str, BeforeValidator(_parse_date)]


# ─── Comments ───
class CommentCreate(BaseModel):
    content: Annotated[str, Field(min_length=1, max_length=5000)]
    entity_type: Literal["project", "task"]
    entity_id: str


# ─── Chat ───
class MessageCreate(BaseModel):
    content: Annotated[str, Field(min_length=1, max_length=5000)]
    channel_id: str


# ─── AI ───
class AIChatRequest(BaseModel):
    message: Annotated[str, Field(min_length=1, max_length=4000)]
    history: List[dict] = Field(default_factory=list, max_length=20)
