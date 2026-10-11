"""Comments and attachments on tasks."""

import uuid
from collections.abc import Sequence
from typing import Annotated

from fastapi import APIRouter, File, Query, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.db import utcnow
from app.core.deps import DB, CurrentUser
from app.core.errors import BadRequest, Forbidden, NotFound
from app.models import (
    Activity,
    Attachment,
    Comment,
    Notification,
    NotificationType,
    Project,
    ProjectRole,
    Task,
    TaskWatcher,
    User,
)
from app.schemas.collaboration import AttachmentOut, CommentCreate, CommentOut, CommentUpdate
from app.schemas.common import Ok
from app.services import activity, mentions, permissions, serializers, storage
from app.services.realtime import queue_event

router = APIRouter(tags=["collaboration"])


def _can_moderate(user: User, owner_id: uuid.UUID | None, role: ProjectRole) -> bool:
    """Authors/uploaders manage their own items; project leads (incl. workspace admins) manage everyone's."""
    return owner_id == user.id or role == ProjectRole.lead


async def _emit(db: AsyncSession, type: str, project: Project, task_id: uuid.UUID, data: dict) -> None:
    queue_event(
        db,
        type,
        await permissions.project_audience(db, project),
        workspace_id=project.workspace_id,
        project_id=project.id,
        task_id=task_id,
        data=data,
    )


# ─── Comments ───


async def _comment_outs(
    db: AsyncSession, comments: Sequence[Comment], user: User, role: ProjectRole
) -> list[CommentOut]:
    authors = await serializers.user_briefs(db, (c.author_id for c in comments))
    return [
        CommentOut(
            id=c.id,
            task_id=c.task_id,
            author=authors.get(c.author_id) if c.author_id else None,
            body=c.body,
            created_at=c.created_at,
            edited_at=c.edited_at,
            can_edit=c.author_id == user.id,
            can_delete=_can_moderate(user, c.author_id, role),
        )
        for c in comments
    ]


async def _load_comment(
    db: AsyncSession, user: User, comment_id: uuid.UUID
) -> tuple[Comment, Task, Project, ProjectRole]:
    comment = await db.get(Comment, comment_id)
    if comment is None or comment.deleted_at is not None:
        raise NotFound("Comment not found")
    try:
        task, project, role = await permissions.require_task(db, user, comment.task_id)
    except NotFound:
        raise NotFound("Comment not found") from None
    return comment, task, project, role


def _clean_body(body: str) -> str:
    body = body.strip()
    if not body:
        raise BadRequest("A comment can't be empty", code="empty_comment")
    return body


async def _notify_mentions(
    db: AsyncSession, project: Project, task: Task, comment: Comment, user_ids: set[uuid.UUID], actor: User
) -> None:
    await activity.notify(
        db,
        user_ids=user_ids,
        type=NotificationType.mentioned,
        workspace_id=project.workspace_id,
        actor_id=actor.id,
        project_id=project.id,
        task_id=task.id,
        data={"excerpt": mentions.excerpt(comment.body), "comment_id": str(comment.id)},
    )


async def _sync_comment_excerpts(db: AsyncSession, comment: Comment) -> None:
    """Keep the comment's activity entry and notifications in step with it (edited text, or scrubbed when deleted),
    so deleted text doesn't live on in feeds and inboxes."""
    key = str(comment.id)
    activities = await db.scalars(
        select(Activity).where(
            Activity.task_id == comment.task_id,
            Activity.verb == "commented",
            Activity.data["comment_id"].astext == key,
        )
    )
    notifications = await db.scalars(
        select(Notification).where(
            Notification.task_id == comment.task_id,
            Notification.type.in_([NotificationType.mentioned, NotificationType.commented]),
            Notification.data["comment_id"].astext == key,
        )
    )
    deleted = comment.deleted_at is not None
    excerpt = "" if deleted else mentions.excerpt(comment.body)
    for row in (*activities, *notifications):
        row.data = {**row.data, "excerpt": excerpt, **({"deleted": True} if deleted else {})}


@router.get("/tasks/{task_id}/comments", response_model=list[CommentOut])
async def list_comments(task_id: uuid.UUID, user: CurrentUser, db: DB):
    """Comments on a task, oldest first."""
    task, _, role = await permissions.require_task(db, user, task_id)
    comments = await db.scalars(
        select(Comment)
        .where(Comment.task_id == task.id, Comment.deleted_at.is_(None))
        .order_by(Comment.created_at, Comment.id)
    )
    return await _comment_outs(db, list(comments), user, role)


@router.post("/tasks/{task_id}/comments", response_model=CommentOut, status_code=201)
async def create_comment(task_id: uuid.UUID, data: CommentCreate, user: CurrentUser, db: DB):
    """Comment on a task (viewers too); notifies @mentioned people and the task's watchers."""
    task, project, role = await permissions.require_task(db, user, task_id)
    comment = Comment(id=uuid.uuid4(), task_id=task.id, author_id=user.id, body=_clean_body(data.body))
    db.add(comment)
    await db.execute(pg_insert(TaskWatcher).values(task_id=task.id, user_id=user.id).on_conflict_do_nothing())
    await db.flush()

    excerpt = mentions.excerpt(comment.body)
    audience = await permissions.project_audience(db, project)
    mentioned = await mentions.mentionable(db, project, mentions.parse_mentions(comment.body))
    watchers = set(await db.scalars(select(TaskWatcher.user_id).where(TaskWatcher.task_id == task.id)))
    await _notify_mentions(db, project, task, comment, mentioned, user)
    await activity.notify(
        db,
        user_ids=(watchers & audience) - mentioned - {user.id},
        type=NotificationType.commented,
        workspace_id=project.workspace_id,
        actor_id=user.id,
        project_id=project.id,
        task_id=task.id,
        data={"excerpt": excerpt, "comment_id": str(comment.id)},
    )
    activity.record(
        db,
        workspace_id=project.workspace_id,
        actor_id=user.id,
        verb="commented",
        project_id=project.id,
        task_id=task.id,
        data={"excerpt": excerpt, "comment_id": str(comment.id)},
    )
    queue_event(
        db,
        "comment.created",
        audience,
        workspace_id=project.workspace_id,
        project_id=project.id,
        task_id=task.id,
        data={"comment_id": str(comment.id)},
    )
    await db.commit()
    return (await _comment_outs(db, [comment], user, role))[0]


@router.patch("/comments/{comment_id}", response_model=CommentOut)
async def update_comment(comment_id: uuid.UUID, data: CommentUpdate, user: CurrentUser, db: DB):
    """Edit your own comment; only people newly @mentioned are notified."""
    comment, task, project, role = await _load_comment(db, user, comment_id)
    if comment.author_id != user.id:
        raise Forbidden("Only the author can edit a comment", code="not_comment_author")
    body = _clean_body(data.body)
    if body != comment.body:
        previously_mentioned = mentions.parse_mentions(comment.body)
        comment.body = body
        comment.edited_at = utcnow()
        added = await mentions.mentionable(db, project, mentions.parse_mentions(body) - previously_mentioned)
        await _notify_mentions(db, project, task, comment, added, user)
        await _sync_comment_excerpts(db, comment)
        await _emit(db, "comment.updated", project, task.id, {"comment_id": str(comment.id)})
        await db.commit()
    return (await _comment_outs(db, [comment], user, role))[0]


@router.delete("/comments/{comment_id}", response_model=Ok)
async def delete_comment(comment_id: uuid.UUID, user: CurrentUser, db: DB):
    """Delete a comment (author, project lead or workspace admin)."""
    comment, task, project, role = await _load_comment(db, user, comment_id)
    if not _can_moderate(user, comment.author_id, role):
        raise Forbidden(
            "Only the author, a project lead or a workspace admin can delete this comment", code="cannot_delete_comment"
        )
    comment.deleted_at = utcnow()
    await _sync_comment_excerpts(db, comment)
    await _emit(db, "comment.deleted", project, task.id, {"comment_id": str(comment.id)})
    await db.commit()
    return Ok()


# ─── Attachments ───


async def _attachment_outs(
    db: AsyncSession, attachments: Sequence[Attachment], user: User, role: ProjectRole
) -> list[AttachmentOut]:
    uploaders = await serializers.user_briefs(db, (a.uploader_id for a in attachments))
    return [
        AttachmentOut(
            id=a.id,
            task_id=a.task_id,
            uploader=uploaders.get(a.uploader_id) if a.uploader_id else None,
            filename=a.filename,
            content_type=a.content_type,
            size_bytes=a.size_bytes,
            created_at=a.created_at,
            is_image=storage.is_image(a.content_type),
            can_delete=_can_moderate(user, a.uploader_id, role),
        )
        for a in attachments
    ]


async def _load_attachment(
    db: AsyncSession, user: User, attachment_id: uuid.UUID
) -> tuple[Attachment, Task, Project, ProjectRole]:
    attachment = await db.get(Attachment, attachment_id)
    if attachment is None:
        raise NotFound("Attachment not found")
    try:
        task, project, role = await permissions.require_task(db, user, attachment.task_id)
    except NotFound:
        raise NotFound("Attachment not found") from None
    return attachment, task, project, role


@router.get("/tasks/{task_id}/attachments", response_model=list[AttachmentOut])
async def list_attachments(task_id: uuid.UUID, user: CurrentUser, db: DB):
    """Files attached to a task, newest first."""
    task, _, role = await permissions.require_task(db, user, task_id)
    attachments = await db.scalars(
        select(Attachment)
        .where(Attachment.task_id == task.id)
        .order_by(Attachment.created_at.desc(), Attachment.id.desc())
    )
    return await _attachment_outs(db, list(attachments), user, role)


@router.post("/tasks/{task_id}/attachments", response_model=AttachmentOut, status_code=201)
async def upload_attachment(
    task_id: uuid.UUID,
    file: Annotated[UploadFile, File(description="The file to attach (multipart field `file`)")],
    user: CurrentUser,
    db: DB,
):
    """Attach a file to a task (project members; size limited by MAX_UPLOAD_MB)."""
    task, project, role = await permissions.require_task(db, user, task_id, ProjectRole.member)
    filename = storage.clean_filename(file.filename)
    content_type = storage.detect_content_type(file.content_type, filename)
    store = storage.get_storage()
    key, size = await store.save(file, settings.max_upload_mb * 1024 * 1024)
    try:
        attachment = Attachment(
            id=uuid.uuid4(),
            task_id=task.id,
            uploader_id=user.id,
            filename=filename,
            content_type=content_type,
            size_bytes=size,
            storage_key=key,
        )
        db.add(attachment)
        activity.record(
            db,
            workspace_id=project.workspace_id,
            actor_id=user.id,
            verb="attached",
            project_id=project.id,
            task_id=task.id,
            data={"filename": filename, "attachment_id": str(attachment.id)},
        )
        await _emit(db, "attachment.created", project, task.id, {"attachment_id": str(attachment.id)})
        await db.commit()
    except Exception:
        await store.delete(key)
        raise
    return (await _attachment_outs(db, [attachment], user, role))[0]


@router.get(
    "/attachments/{attachment_id}/download",
    response_class=FileResponse,
    response_model=None,
    responses={
        200: {
            "description": "The file contents",
            "content": {"application/octet-stream": {"schema": {"type": "string", "format": "binary"}}},
        }
    },
)
async def download_attachment(
    attachment_id: uuid.UUID,
    user: CurrentUser,
    db: DB,
    inline: Annotated[bool, Query(description="Display images inline instead of downloading them")] = False,
) -> FileResponse:
    """Download an attachment's file (anyone who can view the task)."""
    attachment, *_ = await _load_attachment(db, user, attachment_id)
    path = storage.get_storage().path(attachment.storage_key)
    if not path.is_file():
        raise NotFound("The file for this attachment is missing", code="file_missing")
    return FileResponse(
        path,
        media_type=storage.download_media_type(attachment.content_type),
        headers={
            "Content-Disposition": storage.content_disposition(
                attachment.filename, inline=inline and storage.is_image(attachment.content_type)
            ),
            "X-Content-Type-Options": "nosniff",
            "Cache-Control": "private, no-store",
        },
    )


@router.delete("/attachments/{attachment_id}", response_model=Ok)
async def delete_attachment(attachment_id: uuid.UUID, user: CurrentUser, db: DB):
    """Remove an attachment and its file (uploader, project lead or workspace admin)."""
    attachment, task, project, role = await _load_attachment(db, user, attachment_id)
    if not _can_moderate(user, attachment.uploader_id, role):
        raise Forbidden(
            "Only the uploader, a project lead or a workspace admin can remove this file",
            code="cannot_delete_attachment",
        )
    await db.delete(attachment)
    activity.record(
        db,
        workspace_id=project.workspace_id,
        actor_id=user.id,
        verb="detached",
        project_id=project.id,
        task_id=task.id,
        data={"filename": attachment.filename, "attachment_id": str(attachment.id)},
    )
    await _emit(db, "attachment.deleted", project, task.id, {"attachment_id": str(attachment.id)})
    await db.commit()
    # Only after the commit: a rolled-back delete must still have its file.
    await storage.get_storage().delete(attachment.storage_key)
    return Ok()
