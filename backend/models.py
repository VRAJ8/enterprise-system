from pydantic import BaseModel, Field, ConfigDict
from typing import Optional, List
from datetime import datetime, timezone
import uuid


def gen_id(prefix=""):
    return f"{prefix}{uuid.uuid4().hex[:12]}"


# ─── Auth ───
class UserRegister(BaseModel):
    name: str
    email: str
    password: str
    role: str = "team_member"


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
    created_at: Optional[str] = None


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserResponse


# ─── Projects ───
class ProjectCreate(BaseModel):
    name: str
    description: str = ""
    priority: str = "medium"
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    team_members: List[str] = []


class ProjectUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    priority: Optional[str] = None
    status: Optional[str] = None
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    team_members: Optional[List[str]] = None


# ─── Tasks ───
class TaskCreate(BaseModel):
    title: str
    description: str = ""
    project_id: str
    assigned_to: Optional[str] = None
    priority: str = "medium"
    due_date: Optional[str] = None


class TaskUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    status: Optional[str] = None
    assigned_to: Optional[str] = None
    priority: Optional[str] = None
    due_date: Optional[str] = None


# ─── Milestones ───
class MilestoneCreate(BaseModel):
    title: str
    description: str = ""
    due_date: str


# ─── Comments ───
class CommentCreate(BaseModel):
    content: str
    entity_type: str
    entity_id: str


# ─── Chat ───
class MessageCreate(BaseModel):
    content: str
    channel_id: str
