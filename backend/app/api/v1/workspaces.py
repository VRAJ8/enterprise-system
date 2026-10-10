"""Workspaces, members, invitations and labels."""

import uuid
from datetime import UTC, datetime, timedelta
from decimal import Decimal

from fastapi import APIRouter
from sqlalchemy import delete, func, select, update

from app.api.v1.auth import join_workspace
from app.core.config import settings
from app.core.deps import DB, CurrentUser
from app.core.errors import BadRequest, Conflict, Forbidden, NotFound
from app.core.security import hash_token, new_opaque_token
from app.models import (
    CLOSED_CATEGORIES,
    Invitation,
    Label,
    NotificationType,
    Project,
    ProjectMember,
    Task,
    TaskStatus,
    User,
    Workspace,
    WorkspaceMember,
    WorkspaceRole,
)
from app.schemas.common import Ok, UserBrief
from app.schemas.workspace import (
    AcceptInvitationIn,
    InvitationCreate,
    InvitationLookupOut,
    InvitationOut,
    LabelCreate,
    LabelOut,
    LabelUpdate,
    MemberOut,
    MemberUpdate,
    WorkspaceCreate,
    WorkspaceOut,
    WorkspaceUpdate,
)
from app.services import activity
from app.services.permissions import WS_ROLE_RANK, require_workspace
from app.services.serializers import user_briefs
from app.services.workspaces import create_workspace, unique_slug

router = APIRouter(tags=["workspaces"])

INVITATION_DAYS = 14


async def _workspace_out(db, ws: Workspace, role: WorkspaceRole) -> WorkspaceOut:
    count = await db.scalar(
        select(func.count())
        .select_from(WorkspaceMember)
        .where(WorkspaceMember.workspace_id == ws.id, WorkspaceMember.deactivated_at.is_(None))
    )
    return WorkspaceOut(id=ws.id, name=ws.name, slug=ws.slug, created_at=ws.created_at, role=role, member_count=count)


# ─── Workspaces ───


@router.get("/workspaces", response_model=list[WorkspaceOut])
async def list_workspaces(user: CurrentUser, db: DB):
    rows = (
        await db.execute(
            select(Workspace, WorkspaceMember.role)
            .join(WorkspaceMember, WorkspaceMember.workspace_id == Workspace.id)
            .where(WorkspaceMember.user_id == user.id, WorkspaceMember.deactivated_at.is_(None))
            .order_by(Workspace.name)
        )
    ).all()
    return [await _workspace_out(db, ws, role) for ws, role in rows]


@router.post("/workspaces", response_model=WorkspaceOut, status_code=201)
async def create(data: WorkspaceCreate, user: CurrentUser, db: DB):
    if data.slug and await db.scalar(select(Workspace.id).where(Workspace.slug == data.slug)):
        raise Conflict("That URL is already taken", code="slug_taken")
    ws = await create_workspace(db, owner=user, name=data.name, slug=data.slug)
    await db.commit()
    return await _workspace_out(db, ws, WorkspaceRole.owner)


@router.get("/workspaces/{workspace_id}", response_model=WorkspaceOut)
async def get_workspace(workspace_id: uuid.UUID, user: CurrentUser, db: DB):
    m = await require_workspace(db, user, workspace_id)
    return await _workspace_out(db, await db.get(Workspace, workspace_id), m.role)


@router.patch("/workspaces/{workspace_id}", response_model=WorkspaceOut)
async def update_workspace(workspace_id: uuid.UUID, data: WorkspaceUpdate, user: CurrentUser, db: DB):
    m = await require_workspace(db, user, workspace_id, WorkspaceRole.admin)
    ws = await db.get(Workspace, workspace_id)
    if data.name is not None:
        ws.name = data.name
    if data.slug is not None and data.slug != ws.slug:
        if await db.scalar(select(Workspace.id).where(Workspace.slug == data.slug)):
            raise Conflict("That URL is already taken", code="slug_taken")
        ws.slug = await unique_slug(db, data.slug, exclude_id=ws.id)
    await db.commit()
    return await _workspace_out(db, ws, m.role)


# ─── Members ───


async def _member_outs(db, workspace_id: uuid.UUID, members: list[WorkspaceMember]) -> list[MemberOut]:
    users = {u.id: u for u in await db.scalars(select(User).where(User.id.in_([m.user_id for m in members])))}
    out = []
    for m in members:
        u = users[m.user_id]
        out.append(
            MemberOut(
                user=UserBrief.model_validate(u),
                role=m.role,
                weekly_capacity_hours=float(m.weekly_capacity_hours),
                joined_at=m.joined_at,
                deactivated=m.deactivated_at is not None,
                last_login_at=u.last_login_at,
            )
        )
    return sorted(out, key=lambda x: (x.deactivated, x.user.name.lower()))


@router.get("/workspaces/{workspace_id}/members", response_model=list[MemberOut])
async def list_members(workspace_id: uuid.UUID, user: CurrentUser, db: DB, include_deactivated: bool = False):
    me = await require_workspace(db, user, workspace_id)
    q = select(WorkspaceMember).where(WorkspaceMember.workspace_id == workspace_id)
    if not (include_deactivated and me.role in (WorkspaceRole.owner, WorkspaceRole.admin)):
        q = q.where(WorkspaceMember.deactivated_at.is_(None))
    return await _member_outs(db, workspace_id, list(await db.scalars(q)))


async def _owner_count(db, workspace_id: uuid.UUID) -> int:
    return await db.scalar(
        select(func.count())
        .select_from(WorkspaceMember)
        .where(
            WorkspaceMember.workspace_id == workspace_id,
            WorkspaceMember.role == WorkspaceRole.owner,
            WorkspaceMember.deactivated_at.is_(None),
        )
    )


async def _unassign_open_work(db, workspace_id: uuid.UUID, user_id: uuid.UUID) -> None:
    """Free up a departing member's open tasks so nothing silently stalls."""
    open_task_ids = (
        select(Task.id)
        .join(Project, Project.id == Task.project_id)
        .join(TaskStatus, TaskStatus.id == Task.status_id)
        .where(
            Project.workspace_id == workspace_id,
            Task.assignee_id == user_id,
            TaskStatus.category.notin_([c.value for c in CLOSED_CATEGORIES]),
        )
    )
    await db.execute(update(Task).where(Task.id.in_(open_task_ids)).values(assignee_id=None))


@router.patch("/workspaces/{workspace_id}/members/{user_id}", response_model=MemberOut)
async def update_member(workspace_id: uuid.UUID, user_id: uuid.UUID, data: MemberUpdate, user: CurrentUser, db: DB):
    me = await require_workspace(db, user, workspace_id)
    target = await db.get(WorkspaceMember, (workspace_id, user_id))
    if target is None:
        raise NotFound("Member not found")
    is_admin = me.role in (WorkspaceRole.owner, WorkspaceRole.admin)
    is_self = user_id == user.id

    if data.weekly_capacity_hours is not None:
        if not (is_admin or is_self):
            raise Forbidden("Only admins can change other people's capacity")
        target.weekly_capacity_hours = Decimal(str(data.weekly_capacity_hours))

    if data.role is not None and data.role != target.role:
        if not is_admin:
            raise Forbidden("Only admins can change roles")
        touches_owner = WorkspaceRole.owner in (data.role, target.role)
        if touches_owner and me.role != WorkspaceRole.owner:
            raise Forbidden("Only owners can grant or remove the owner role")
        if target.role == WorkspaceRole.owner and await _owner_count(db, workspace_id) <= 1:
            raise BadRequest("A workspace needs at least one owner", code="last_owner")
        if WS_ROLE_RANK[target.role] > WS_ROLE_RANK[me.role]:
            raise Forbidden("You can't change the role of someone above you")
        old = target.role
        target.role = data.role
        activity.record(
            db,
            workspace_id=workspace_id,
            actor_id=user.id,
            verb="member_role_changed",
            data={"user_id": str(user_id), "from": old.value, "to": data.role.value},
        )

    if data.deactivated is not None and data.deactivated != (target.deactivated_at is not None):
        if not is_admin:
            raise Forbidden("Only admins can deactivate members")
        if is_self:
            raise BadRequest("You can't deactivate yourself", code="self_deactivate")
        if target.role == WorkspaceRole.owner:
            raise BadRequest("Owners can't be deactivated; transfer ownership first", code="owner_deactivate")
        target.deactivated_at = datetime.now(UTC) if data.deactivated else None
        if data.deactivated:
            await _unassign_open_work(db, workspace_id, user_id)
        activity.record(
            db,
            workspace_id=workspace_id,
            actor_id=user.id,
            verb="member_deactivated" if data.deactivated else "member_reactivated",
            data={"user_id": str(user_id)},
        )

    await db.commit()
    return (await _member_outs(db, workspace_id, [target]))[0]


@router.delete("/workspaces/{workspace_id}/members/{user_id}", response_model=Ok)
async def remove_member(workspace_id: uuid.UUID, user_id: uuid.UUID, user: CurrentUser, db: DB):
    """Admins remove people; anyone can remove themselves (leave the workspace)."""
    me = await require_workspace(db, user, workspace_id)
    target = await db.get(WorkspaceMember, (workspace_id, user_id))
    if target is None:
        raise NotFound("Member not found")
    if user_id != user.id:
        if me.role not in (WorkspaceRole.owner, WorkspaceRole.admin):
            raise Forbidden("Only admins can remove members")
        if target.role == WorkspaceRole.owner and me.role != WorkspaceRole.owner:
            raise Forbidden("Only owners can remove an owner")
    if target.role == WorkspaceRole.owner and await _owner_count(db, workspace_id) <= 1:
        raise BadRequest("A workspace needs at least one owner", code="last_owner")

    await _unassign_open_work(db, workspace_id, user_id)
    project_ids = select(Project.id).where(Project.workspace_id == workspace_id)
    await db.execute(
        delete(ProjectMember).where(ProjectMember.user_id == user_id, ProjectMember.project_id.in_(project_ids))
    )
    await db.delete(target)
    activity.record(
        db, workspace_id=workspace_id, actor_id=user.id, verb="member_removed", data={"user_id": str(user_id)}
    )
    await db.commit()
    return Ok()


# ─── Invitations ───


async def _invitation_outs(db, invitations: list[Invitation]) -> list[InvitationOut]:
    inviters = await user_briefs(db, (i.invited_by for i in invitations))
    return [
        InvitationOut(
            id=i.id,
            email=i.email,
            role=i.role,
            created_at=i.created_at,
            expires_at=i.expires_at,
            accepted_at=i.accepted_at,
            invited_by=inviters.get(i.invited_by),
        )
        for i in invitations
    ]


@router.get("/workspaces/{workspace_id}/invitations", response_model=list[InvitationOut])
async def list_invitations(workspace_id: uuid.UUID, user: CurrentUser, db: DB):
    await require_workspace(db, user, workspace_id, WorkspaceRole.admin)
    invitations = await db.scalars(
        select(Invitation)
        .where(Invitation.workspace_id == workspace_id, Invitation.accepted_at.is_(None))
        .order_by(Invitation.created_at.desc())
    )
    return await _invitation_outs(db, list(invitations))


@router.post("/workspaces/{workspace_id}/invitations", response_model=InvitationOut, status_code=201)
async def create_invitation(workspace_id: uuid.UUID, data: InvitationCreate, user: CurrentUser, db: DB):
    me = await require_workspace(db, user, workspace_id, WorkspaceRole.admin)
    if data.role == WorkspaceRole.owner and me.role != WorkspaceRole.owner:
        raise Forbidden("Only owners can invite other owners")
    email = data.email.lower()
    existing_user = await db.scalar(select(User).where(User.email == email))
    if existing_user:
        m = await db.get(WorkspaceMember, (workspace_id, existing_user.id))
        if m and m.deactivated_at is None:
            raise Conflict(f"{existing_user.name} is already a member", code="already_member")

    # Re-inviting replaces any pending invitation for the same address
    await db.execute(
        delete(Invitation).where(
            Invitation.workspace_id == workspace_id, Invitation.email == email, Invitation.accepted_at.is_(None)
        )
    )
    token = new_opaque_token()
    inv = Invitation(
        id=uuid.uuid4(),
        workspace_id=workspace_id,
        email=email,
        role=data.role,
        token_hash=hash_token(token),
        invited_by=user.id,
        expires_at=datetime.now(UTC) + timedelta(days=INVITATION_DAYS),
    )
    db.add(inv)
    if existing_user:
        await activity.notify(
            db,
            user_ids=[existing_user.id],
            type=NotificationType.invited,
            workspace_id=workspace_id,
            actor_id=user.id,
            data={"workspace_name": (await db.get(Workspace, workspace_id)).name, "token": token},
        )
    await db.commit()
    await db.refresh(inv)
    out = (await _invitation_outs(db, [inv]))[0]
    out.invite_url = f"{settings.app_url.rstrip('/')}/invite/{token}"
    return out


@router.delete("/invitations/{invitation_id}", response_model=Ok)
async def revoke_invitation(invitation_id: uuid.UUID, user: CurrentUser, db: DB):
    inv = await db.get(Invitation, invitation_id)
    if inv is None:
        raise NotFound("Invitation not found")
    await require_workspace(db, user, inv.workspace_id, WorkspaceRole.admin)
    await db.delete(inv)
    await db.commit()
    return Ok()


@router.get("/invitations/lookup", response_model=InvitationLookupOut)
async def lookup_invitation(token: str, db: DB):
    """Public: lets the invite page show who invited you before you sign in or sign up."""
    inv = await db.scalar(select(Invitation).where(Invitation.token_hash == hash_token(token)))
    if inv is None:
        raise NotFound("Invitation not found")
    ws = await db.get(Workspace, inv.workspace_id)
    inviter = await db.get(User, inv.invited_by) if inv.invited_by else None
    return InvitationLookupOut(
        workspace_name=ws.name,
        email=inv.email,
        role=inv.role,
        inviter_name=inviter.name if inviter else None,
        expired=inv.expires_at < datetime.now(UTC),
        accepted=inv.accepted_at is not None,
        account_exists=bool(await db.scalar(select(User.id).where(User.email == inv.email))),
    )


@router.post("/invitations/accept", response_model=WorkspaceOut)
async def accept_invitation(data: AcceptInvitationIn, user: CurrentUser, db: DB):
    inv = await db.scalar(select(Invitation).where(Invitation.token_hash == hash_token(data.token)))
    if inv is None:
        raise NotFound("Invitation not found")
    if inv.accepted_at is not None:
        raise Conflict("This invitation has already been used", code="invitation_used")
    if inv.expires_at < datetime.now(UTC):
        raise BadRequest("This invitation has expired. Ask for a new one.", code="invitation_expired")
    if inv.email.lower() != user.email.lower():
        raise Forbidden(f"This invitation was sent to {inv.email}", code="invitation_email_mismatch")
    await join_workspace(db, user, inv.workspace_id, inv.role)
    inv.accepted_at = datetime.now(UTC)
    activity.record(db, workspace_id=inv.workspace_id, actor_id=user.id, verb="member_joined")
    await db.commit()
    return await _workspace_out(db, await db.get(Workspace, inv.workspace_id), inv.role)


# ─── Labels ───


@router.get("/workspaces/{workspace_id}/labels", response_model=list[LabelOut])
async def list_labels(workspace_id: uuid.UUID, user: CurrentUser, db: DB):
    await require_workspace(db, user, workspace_id)
    return list(
        await db.scalars(select(Label).where(Label.workspace_id == workspace_id).order_by(func.lower(Label.name)))
    )


async def _ensure_unique_label(db, workspace_id: uuid.UUID, name: str, exclude: uuid.UUID | None = None) -> None:
    q = select(Label.id).where(Label.workspace_id == workspace_id, func.lower(Label.name) == name.lower())
    if exclude:
        q = q.where(Label.id != exclude)
    if await db.scalar(q):
        raise Conflict("A label with that name already exists", code="label_exists")


@router.post("/workspaces/{workspace_id}/labels", response_model=LabelOut, status_code=201)
async def create_label(workspace_id: uuid.UUID, data: LabelCreate, user: CurrentUser, db: DB):
    await require_workspace(db, user, workspace_id, WorkspaceRole.member)
    await _ensure_unique_label(db, workspace_id, data.name)
    label = Label(id=uuid.uuid4(), workspace_id=workspace_id, name=data.name, color=data.color)
    db.add(label)
    await db.commit()
    return label


@router.patch("/labels/{label_id}", response_model=LabelOut)
async def update_label(label_id: uuid.UUID, data: LabelUpdate, user: CurrentUser, db: DB):
    label = await db.get(Label, label_id)
    if label is None:
        raise NotFound("Label not found")
    await require_workspace(db, user, label.workspace_id, WorkspaceRole.member)
    if data.name is not None:
        await _ensure_unique_label(db, label.workspace_id, data.name, exclude=label.id)
        label.name = data.name
    if data.color is not None:
        label.color = data.color
    await db.commit()
    return label


@router.delete("/labels/{label_id}", response_model=Ok)
async def delete_label(label_id: uuid.UUID, user: CurrentUser, db: DB):
    label = await db.get(Label, label_id)
    if label is None:
        raise NotFound("Label not found")
    await require_workspace(db, user, label.workspace_id, WorkspaceRole.member)
    await db.delete(label)
    await db.commit()
    return Ok()
