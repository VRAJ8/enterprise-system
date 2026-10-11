"""Comments (with @mentions and watcher notifications) and attachments (storage, downloads, permissions)."""

import asyncio
import io
import re
import uuid
from pathlib import Path

import pytest
from sqlalchemy import select
from starlette.datastructures import Headers, UploadFile

from app.core.config import settings
from app.core.db import utcnow
from app.core.errors import BadRequest, PayloadTooLarge
from app.models import (
    Activity,
    Attachment,
    Comment,
    Notification,
    NotificationType,
    ProjectVisibility,
    Task,
    TaskWatcher,
)
from app.services import mentions, realtime, storage
from tests.conftest import Actor, invite, signup
from tests.factories import make_project, make_task

API = "/api/v1"
KEY_RE = re.compile(r"[0-9a-f]{2}/[0-9a-f]{32}(?:\.[a-z0-9]{1,10})?")
PNG = b"\x89PNG\r\n\x1a\n" + bytes(range(64))


@pytest.fixture(autouse=True)
def upload_dir(tmp_path, monkeypatch) -> Path:
    """Every test stores files in its own temporary directory."""
    path = tmp_path / "uploads"
    monkeypatch.setattr(settings, "upload_dir", path)
    previous = storage.set_storage(storage.LocalStorage(path))
    yield path
    storage.set_storage(previous)


@pytest.fixture
async def ctx(team, db):
    """A workspace-visible project. member = project member, member2 = project lead,
    viewer = workspace member without project membership (implicit viewer), guest = no access."""
    team.viewer = await invite(team.owner, team.workspace_id, "Vera Viewer", "member")
    team.project, team.statuses = await make_project(
        db, team.workspace_id, members={team.member.id: "member", team.member2.id: "lead"}
    )
    team.task = await make_task(db, team.project, team.statuses["todo"], title="Launch page")
    return team


def mention(actor: Actor) -> str:
    return f"@[{actor.name}](user:{actor.id})"


def uid(actor: Actor) -> uuid.UUID:
    return uuid.UUID(actor.id)


async def comment(actor: Actor, task_id, body: str):
    return await actor.post(f"{API}/tasks/{task_id}/comments", {"body": body})


async def upload(actor: Actor, task_id, filename: str, content: bytes = b"hello", content_type: str = "text/plain"):
    return await actor.post(f"{API}/tasks/{task_id}/attachments", files={"file": (filename, content, content_type)})


async def notifications(db, actor: Actor) -> list[Notification]:
    return list(
        await db.scalars(
            select(Notification)
            .where(Notification.user_id == uid(actor))
            .order_by(Notification.created_at)
            .execution_options(populate_existing=True)
        )
    )


async def activities(db, task_id, verb: str) -> list[Activity]:
    return list(
        await db.scalars(
            select(Activity)
            .where(Activity.task_id == task_id, Activity.verb == verb)
            .order_by(Activity.created_at)
            .execution_options(populate_existing=True)
        )
    )


def stored_files(root: Path) -> list[Path]:
    return [p for p in root.rglob("*") if p.is_file()] if root.exists() else []


# ─── Mentions service ───


def test_parse_mentions_and_excerpt():
    a, b = uuid.uuid4(), uuid.uuid4()
    body = (
        f"Hi @[Ann Lee](user:{a}), meet @[Bob](user:{str(b).upper()}). Again @[Ann Lee](user:{a}).\n"
        f"Not mentions: @[Bad](user:1234) [Plain](user:{uuid.uuid4()}) @[](user:{uuid.uuid4()})"
    )
    assert mentions.parse_mentions(body) == {a, b}
    assert mentions.parse_mentions("") == set() and mentions.parse_mentions(None) == set()
    assert mentions.plain_text(f"ping @[Ann Lee](user:{a})") == "ping @Ann Lee"

    assert mentions.excerpt(f"Hello\n\n  @[Ann Lee](user:{a})   there") == "Hello @Ann Lee there"
    long = mentions.excerpt("word " * 100)
    assert len(long) == 140 and long.endswith("…")


async def test_mentionable_only_counts_people_who_can_view_the_project(ctx, db, client):
    outsider = await signup(client, "Out Sider", workspace_name="Elsewhere")
    private, _ = await make_project(
        db, ctx.workspace_id, name="Secret", key="SEC", visibility=ProjectVisibility.private
    )
    candidates = {uid(a) for a in (ctx.member, ctx.member2, ctx.viewer, ctx.admin, ctx.guest, outsider)}
    candidates.add(uuid.uuid4())

    visible = await mentions.mentionable(db, ctx.project, candidates)
    assert visible == {uid(ctx.member), uid(ctx.member2), uid(ctx.viewer), uid(ctx.admin)}
    # private project: only admins/owners (no explicit members)
    assert await mentions.mentionable(db, private, candidates) == {uid(ctx.admin)}
    assert await mentions.mentionable(db, ctx.project, []) == set()


# ─── Comments ───


async def test_create_and_list_comments_with_flags(ctx, db):
    r = await comment(ctx.member, ctx.task.id, "  First!  ")
    assert r.status_code == 201, r.text
    first = r.json()
    assert first["body"] == "First!"
    assert first["author"]["id"] == ctx.member.id and first["task_id"] == str(ctx.task.id)
    assert first["can_edit"] is True and first["can_delete"] is True and first["edited_at"] is None
    assert (await comment(ctx.viewer, ctx.task.id, "Second")).status_code == 201

    url = f"{API}/tasks/{ctx.task.id}/comments"
    as_member = (await ctx.member.get(url)).json()
    assert [c["body"] for c in as_member] == ["First!", "Second"]  # oldest first
    assert [(c["can_edit"], c["can_delete"]) for c in as_member] == [(True, True), (False, False)]
    as_lead = (await ctx.member2.get(url)).json()
    assert [(c["can_edit"], c["can_delete"]) for c in as_lead] == [(False, True), (False, True)]
    as_admin = (await ctx.admin.get(url)).json()
    assert [(c["can_edit"], c["can_delete"]) for c in as_admin] == [(False, True), (False, True)]
    as_viewer = (await ctx.viewer.get(url)).json()
    assert [(c["can_edit"], c["can_delete"]) for c in as_viewer] == [(False, False), (True, True)]

    # activity, auto-watch and the task's comment count
    logged = await activities(db, ctx.task.id, "commented")
    assert [a.data["excerpt"] for a in logged] == ["First!", "Second"]
    assert logged[0].data["comment_id"] == first["id"] and str(logged[0].actor_id) == ctx.member.id
    watchers = set(await db.scalars(select(TaskWatcher.user_id).where(TaskWatcher.task_id == ctx.task.id)))
    assert watchers == {uid(ctx.member), uid(ctx.viewer)}


async def test_comment_validation(ctx):
    url = f"{API}/tasks/{ctx.task.id}/comments"
    assert (await ctx.member.post(url, {"body": ""})).status_code == 422
    assert (await ctx.member.post(url, {"body": "x" * 20001})).status_code == 422
    assert (await ctx.member.post(url, {})).status_code == 422
    r = await ctx.member.post(url, {"body": " \n\t "})
    assert r.status_code == 400 and r.json()["code"] == "empty_comment"
    assert (await ctx.member.post(f"{API}/tasks/{uuid.uuid4()}/comments", {"body": "hi"})).status_code == 404


async def test_mentions_notify_people_with_access_only(ctx, db, client):
    outsider = await signup(client, "Out Sider", workspace_name="Elsewhere")
    body = (
        f"Can {mention(ctx.member2)} and {mention(ctx.guest)} review? cc {mention(outsider)} "
        f"{mention(ctx.member)} @[Ghost](user:{uuid.uuid4()})"
    )
    r = await comment(ctx.member, ctx.task.id, body)
    assert r.status_code == 201

    [n] = await notifications(db, ctx.member2)
    assert n.type == NotificationType.mentioned and str(n.actor_id) == ctx.member.id
    assert n.task_id == ctx.task.id and n.project_id == ctx.project.id
    assert n.data["comment_id"] == r.json()["id"]
    assert n.data["excerpt"].startswith("Can @Max Member and @Gus Guest review?")
    assert await notifications(db, ctx.guest) == []  # can't see the project
    assert await notifications(db, outsider) == []  # another workspace
    assert await notifications(db, ctx.member) == []  # never notified about your own comment


async def test_watchers_get_commented_notifications(ctx, db):
    # admin and member2 watch; the guest watches from before losing access; the viewer will auto-watch
    db.add_all([TaskWatcher(task_id=ctx.task.id, user_id=uid(a)) for a in (ctx.admin, ctx.member2, ctx.guest)])
    await db.commit()

    assert (await comment(ctx.member, ctx.task.id, f"Thoughts, {mention(ctx.member2)}?")).status_code == 201
    [admin_note] = await notifications(db, ctx.admin)
    assert admin_note.type == NotificationType.commented
    assert admin_note.data["excerpt"] == "Thoughts, @Max Member?"
    # a mentioned watcher gets the mention only, not a second "commented"
    assert [n.type for n in await notifications(db, ctx.member2)] == [NotificationType.mentioned]
    assert await notifications(db, ctx.guest) == []  # watcher without access hears nothing
    assert await notifications(db, ctx.member) == []  # the author

    # the viewer comments (auto-watches), then hears about the next comment
    assert (await comment(ctx.viewer, ctx.task.id, "Looks good")).status_code == 201
    assert [n.type for n in await notifications(db, ctx.member)] == [NotificationType.commented]
    assert (await comment(ctx.member, ctx.task.id, "Thanks")).status_code == 201
    assert [n.data["excerpt"] for n in await notifications(db, ctx.viewer)] == ["Thanks"]


async def test_edit_comment(ctx, db):
    r = await comment(ctx.member, ctx.task.id, f"Ping {mention(ctx.admin)}")
    cid = r.json()["id"]
    url = f"{API}/comments/{cid}"

    r = await ctx.member2.patch(url, {"body": "hijack"})  # project lead, but not the author
    assert r.status_code == 403 and r.json()["code"] == "not_comment_author"
    assert (await ctx.admin.patch(url, {"body": "hijack"})).status_code == 403
    assert (await ctx.member.patch(url, {"body": "  "})).status_code == 400
    assert (await ctx.member.patch(url, {"body": ""})).status_code == 422

    new_body = f"Ping {mention(ctx.admin)} and {mention(ctx.member2)} and {mention(ctx.guest)}"
    r = await ctx.member.patch(url, {"body": new_body})
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["body"] == new_body and out["edited_at"] is not None and out["can_edit"] is True

    # only the newly mentioned (and visible) person is notified; the admin isn't pinged twice
    assert [n.type for n in await notifications(db, ctx.member2)] == [NotificationType.mentioned]
    assert len(await notifications(db, ctx.admin)) == 1
    assert await notifications(db, ctx.guest) == []
    # the activity entry and existing notifications follow the edited text
    [logged] = await activities(db, ctx.task.id, "commented")
    assert logged.data["excerpt"] == "Ping @Adam Admin and @Max Member and @Gus Guest"
    assert (await notifications(db, ctx.admin))[0].data["excerpt"] == logged.data["excerpt"]

    # saving the same text again is a no-op
    edited_at = out["edited_at"]
    r = await ctx.member.patch(url, {"body": new_body})
    assert r.status_code == 200 and r.json()["edited_at"] == edited_at
    assert len(await notifications(db, ctx.member2)) == 1


async def test_delete_comment_permissions_and_soft_delete(ctx, db):
    ids = [
        (await comment(ctx.member, ctx.task.id, f"Note {i} for {mention(ctx.member2)}")).json()["id"] for i in range(3)
    ]

    r = await ctx.viewer.delete(f"{API}/comments/{ids[0]}")
    assert r.status_code == 403 and r.json()["code"] == "cannot_delete_comment"
    assert (await ctx.member2.delete(f"{API}/comments/{ids[0]}")).status_code == 200  # project lead
    assert (await ctx.admin.delete(f"{API}/comments/{ids[1]}")).status_code == 200  # workspace admin
    assert (await ctx.member.delete(f"{API}/comments/{ids[2]}")).status_code == 200  # author

    assert (await ctx.member.get(f"{API}/tasks/{ctx.task.id}/comments")).json() == []
    assert (await ctx.member.patch(f"{API}/comments/{ids[2]}", {"body": "back"})).status_code == 404
    assert (await ctx.member.delete(f"{API}/comments/{ids[2]}")).status_code == 404
    rows = list(await db.scalars(select(Comment).execution_options(populate_existing=True)))
    assert len(rows) == 3 and all(c.deleted_at is not None for c in rows)  # soft delete

    # deleted text doesn't live on in the feed or the inbox
    logged = await activities(db, ctx.task.id, "commented")
    assert len(logged) == 3 and all(a.data["excerpt"] == "" and a.data["deleted"] is True for a in logged)
    inbox = await notifications(db, ctx.member2)
    assert len(inbox) == 3 and all(n.data["excerpt"] == "" for n in inbox)


async def test_comment_access_boundaries(ctx, db, client):
    outsider = await signup(client, "Out Sider", workspace_name="Elsewhere")
    cid = (await comment(ctx.member, ctx.task.id, "internal")).json()["id"]
    for actor in (ctx.guest, outsider):
        assert (await actor.get(f"{API}/tasks/{ctx.task.id}/comments")).status_code == 404
        assert (await comment(actor, ctx.task.id, "hi")).status_code == 404
        assert (await actor.patch(f"{API}/comments/{cid}", {"body": "x"})).status_code == 404
        assert (await actor.delete(f"{API}/comments/{cid}")).status_code == 404

    # a guest explicitly added as viewer can read and comment
    private, st = await make_project(
        db,
        ctx.workspace_id,
        name="Client",
        key="CLI",
        visibility=ProjectVisibility.private,
        members={ctx.guest.id: "viewer"},
    )
    private_task = await make_task(db, private, st["todo"])
    assert (await comment(ctx.guest, private_task.id, "From the client")).status_code == 201
    # ...while a workspace member who isn't in the private project can't see it
    assert (await ctx.member.get(f"{API}/tasks/{private_task.id}/comments")).status_code == 404

    # cross-workspace: the outsider's own comment is invisible to the other workspace's owner
    other_ws = outsider.user["workspaces"][0]["workspace_id"]
    other_project, other_st = await make_project(db, other_ws, name="Other", key="OTH")
    other_task = await make_task(db, other_project, other_st["todo"])
    other_cid = (await comment(outsider, other_task.id, "mine")).json()["id"]
    assert (await ctx.owner.patch(f"{API}/comments/{other_cid}", {"body": "x"})).status_code == 404
    assert (await ctx.owner.delete(f"{API}/comments/{other_cid}")).status_code == 404
    assert (await ctx.owner.get(f"{API}/tasks/{other_task.id}/comments")).status_code == 404


async def test_comments_on_trashed_task_are_hidden(ctx, db):
    cid = (await comment(ctx.member, ctx.task.id, "before trash")).json()["id"]
    task = await db.get(Task, ctx.task.id)
    task.deleted_at = utcnow()
    await db.commit()
    assert (await ctx.member.get(f"{API}/tasks/{ctx.task.id}/comments")).status_code == 404
    assert (await comment(ctx.member, ctx.task.id, "after")).status_code == 404
    assert (await ctx.member.patch(f"{API}/comments/{cid}", {"body": "x"})).status_code == 404


async def test_realtime_events_reach_the_project_audience(ctx, monkeypatch):
    published: list[tuple[dict, set]] = []

    async def capture(message, audience):
        published.append((message, set(audience)))

    monkeypatch.setattr(realtime.broker, "publish", capture)

    cid = (await comment(ctx.member, ctx.task.id, f"Hey {mention(ctx.member2)}")).json()["id"]
    await ctx.member.patch(f"{API}/comments/{cid}", {"body": "edited"})
    await ctx.member.delete(f"{API}/comments/{cid}")
    aid = (await upload(ctx.member, ctx.task.id, "a.txt")).json()["id"]
    await ctx.member.delete(f"{API}/attachments/{aid}")
    await asyncio.sleep(0)

    events = {m["type"]: (m, audience) for m, audience in published}
    expected_audience = {uid(a) for a in (ctx.owner, ctx.admin, ctx.member, ctx.member2, ctx.viewer)}
    for type_, key, value in [
        ("comment.created", "comment_id", cid),
        ("comment.updated", "comment_id", cid),
        ("comment.deleted", "comment_id", cid),
        ("attachment.created", "attachment_id", aid),
        ("attachment.deleted", "attachment_id", aid),
    ]:
        message, audience = events[type_]
        assert message["data"] == {key: value}
        assert message["task_id"] == ctx.task.id and message["project_id"] == ctx.project.id
        assert audience == expected_audience  # never the guest
    note, audience = events["notification.created"]
    assert audience == {uid(ctx.member2)} and note["data"]["type"] == "mentioned"


# ─── Attachments ───


async def test_upload_list_download_delete(ctx, db, upload_dir):
    r = await upload(ctx.member, ctx.task.id, "screen.png", PNG, "image/png")
    assert r.status_code == 201, r.text
    image = r.json()
    assert image["filename"] == "screen.png" and image["content_type"] == "image/png"
    assert image["size_bytes"] == len(PNG) and image["is_image"] is True and image["can_delete"] is True
    assert image["uploader"]["id"] == ctx.member.id and image["task_id"] == str(ctx.task.id)

    note = (await upload(ctx.member, ctx.task.id, "notes.txt", b"plain notes")).json()
    assert note["is_image"] is False

    # stored under random keys, never under the user's filename
    row = await db.get(Attachment, uuid.UUID(image["id"]))
    assert KEY_RE.fullmatch(row.storage_key) and "screen" not in row.storage_key
    assert (upload_dir / row.storage_key).read_bytes() == PNG
    assert len(stored_files(upload_dir)) == 2

    listed = (await ctx.viewer.get(f"{API}/tasks/{ctx.task.id}/attachments")).json()
    assert [a["filename"] for a in listed] == ["notes.txt", "screen.png"]  # newest first
    assert all(a["can_delete"] is False for a in listed)
    lead_view = (await ctx.member2.get(f"{API}/tasks/{ctx.task.id}/attachments")).json()
    assert all(a["can_delete"] is True for a in lead_view)

    r = await ctx.viewer.get(f"{API}/attachments/{image['id']}/download")
    assert r.status_code == 200 and r.content == PNG
    assert r.headers["content-type"] == "image/png"
    assert r.headers["content-disposition"] == "attachment; filename=\"screen.png\"; filename*=UTF-8''screen.png"
    assert r.headers["x-content-type-options"] == "nosniff"
    r = await ctx.viewer.get(f"{API}/attachments/{image['id']}/download", params={"inline": True})
    assert r.headers["content-disposition"].startswith("inline;")

    r = await ctx.viewer.get(f"{API}/attachments/{note['id']}/download", params={"inline": True})
    assert r.content == b"plain notes" and r.headers["content-type"].startswith("text/plain")
    assert r.headers["content-disposition"].startswith("attachment;")  # only images go inline

    # unauthenticated downloads are refused
    assert (await ctx.member.client.get(f"{API}/attachments/{image['id']}/download")).status_code == 401

    assert (await ctx.member.delete(f"{API}/attachments/{image['id']}")).status_code == 200
    assert not (upload_dir / row.storage_key).exists()
    assert (await ctx.member.get(f"{API}/attachments/{image['id']}/download")).status_code == 404
    assert [a["id"] for a in (await ctx.member.get(f"{API}/tasks/{ctx.task.id}/attachments")).json()] == [note["id"]]

    assert [a.data["filename"] for a in await activities(db, ctx.task.id, "attached")] == ["screen.png", "notes.txt"]
    assert [a.data["filename"] for a in await activities(db, ctx.task.id, "detached")] == ["screen.png"]


async def test_upload_size_limit(ctx, db, upload_dir, monkeypatch):
    monkeypatch.setattr(settings, "max_upload_mb", 1)
    limit = 1024 * 1024
    r = await upload(ctx.member, ctx.task.id, "big.bin", b"x" * (limit + 1), "application/octet-stream")
    assert r.status_code == 413 and r.json()["code"] == "file_too_large"
    assert stored_files(upload_dir) == []
    assert list(await db.scalars(select(Attachment))) == []

    r = await upload(ctx.member, ctx.task.id, "exact.bin", b"x" * limit, "application/octet-stream")
    assert r.status_code == 201 and r.json()["size_bytes"] == limit


async def test_empty_and_missing_file(ctx, upload_dir):
    r = await upload(ctx.member, ctx.task.id, "empty.txt", b"")
    assert r.status_code == 400 and r.json()["code"] == "empty_file"
    assert stored_files(upload_dir) == []
    assert (await ctx.member.post(f"{API}/tasks/{ctx.task.id}/attachments")).status_code == 422


async def test_filenames_are_sanitized_and_never_touch_the_disk(ctx, db, upload_dir):
    long_name = "a" * 300 + ".pdf"
    cases = {
        "../../etc/passwd": "passwd",
        "..\\..\\windows\\evil.exe": "evil.exe",
        "/abs/path/report.txt": "report.txt",
        "invoice‮fdp.exe": "invoicefdp.exe",  # right-to-left override stripped
        "..": "file",
        long_name: "a" * 251 + ".pdf",
    }
    for raw, expected in cases.items():
        r = await upload(ctx.member, ctx.task.id, raw, b"data")
        assert r.status_code == 201, (raw, r.text)
        assert r.json()["filename"] == expected

    rows = list(await db.scalars(select(Attachment)))
    assert len(rows) == len(cases)
    for row in rows:
        assert KEY_RE.fullmatch(row.storage_key)
    files = stored_files(upload_dir)
    assert len(files) == len(cases)
    assert all(upload_dir.resolve() in f.resolve().parents for f in files)
    assert not (upload_dir.parent / "etc").exists()


async def test_download_headers_neutralize_active_content(ctx):
    html = (await upload(ctx.member, ctx.task.id, "page.html", b"<script>alert(1)</script>", "text/html")).json()
    svg = (await upload(ctx.member, ctx.task.id, "logo.svg", b"<svg onload='alert(1)'/>", "image/svg+xml")).json()
    pdf = (await upload(ctx.member, ctx.task.id, "Résumé 2026 ü.pdf", b"%PDF-1.7", "application/pdf")).json()
    spoofed = (await upload(ctx.member, ctx.task.id, "x.txt", b"x", "text/html; charset=utf-8")).json()

    assert html["content_type"] == "text/html" and spoofed["content_type"] == "text/html"
    assert svg["is_image"] is False  # SVG can carry script: never previewed inline
    for item in (html, svg, spoofed):
        r = await ctx.member.get(f"{API}/attachments/{item['id']}/download", params={"inline": True})
        assert r.headers["content-type"] == "application/octet-stream"
        assert r.headers["content-disposition"].startswith("attachment;")
        assert r.headers["x-content-type-options"] == "nosniff"

    r = await ctx.member.get(f"{API}/attachments/{pdf['id']}/download")
    assert r.headers["content-type"] == "application/pdf"
    assert r.headers["content-disposition"] == (
        "attachment; filename=\"Resume 2026 u.pdf\"; filename*=UTF-8''R%C3%A9sum%C3%A9%202026%20%C3%BC.pdf"
    )


async def test_download_of_missing_file(ctx, db, upload_dir):
    aid = (await upload(ctx.member, ctx.task.id, "gone.txt")).json()["id"]
    row = await db.get(Attachment, uuid.UUID(aid))
    (upload_dir / row.storage_key).unlink()
    r = await ctx.member.get(f"{API}/attachments/{aid}/download")
    assert r.status_code == 404 and r.json()["code"] == "file_missing"


async def test_attachment_permissions(ctx, db, client, upload_dir):
    outsider = await signup(client, "Out Sider", workspace_name="Elsewhere")
    # viewers can read and comment but not upload
    r = await upload(ctx.viewer, ctx.task.id, "nope.txt")
    assert r.status_code == 403
    assert (await comment(ctx.viewer, ctx.task.id, "but I can comment")).status_code == 201

    aid = (await upload(ctx.member, ctx.task.id, "spec.txt")).json()["id"]
    for actor in (ctx.guest, outsider):
        assert (await actor.get(f"{API}/tasks/{ctx.task.id}/attachments")).status_code == 404
        assert (await upload(actor, ctx.task.id, "x.txt")).status_code == 404
        assert (await actor.get(f"{API}/attachments/{aid}/download")).status_code == 404
        assert (await actor.delete(f"{API}/attachments/{aid}")).status_code == 404
    assert (await ctx.member.get(f"{API}/attachments/{uuid.uuid4()}/download")).status_code == 404
    assert len(stored_files(upload_dir)) == 1

    # a guest added as a project member can upload, but not remove someone else's file
    shared_project, shared_st = await make_project(
        db, ctx.workspace_id, name="Shared", key="SHR", members={ctx.guest.id: "member", ctx.member.id: "member"}
    )
    shared_task = await make_task(db, shared_project, shared_st["todo"])
    guest_file = (await upload(ctx.guest, shared_task.id, "guest.txt")).json()
    member_file = (await upload(ctx.member, shared_task.id, "member.txt")).json()
    r = await ctx.guest.delete(f"{API}/attachments/{member_file['id']}")
    assert r.status_code == 403 and r.json()["code"] == "cannot_delete_attachment"
    assert (await ctx.member.delete(f"{API}/attachments/{guest_file['id']}")).status_code == 403
    assert (await ctx.guest.delete(f"{API}/attachments/{guest_file['id']}")).status_code == 200  # uploader
    assert (await ctx.admin.delete(f"{API}/attachments/{member_file['id']}")).status_code == 200  # workspace admin

    # the project lead can remove anyone's file on their project
    r = await ctx.viewer.delete(f"{API}/attachments/{aid}")
    assert r.status_code == 403
    assert (await ctx.member2.delete(f"{API}/attachments/{aid}")).status_code == 200
    assert stored_files(upload_dir) == []

    # cross-workspace: the outsider's attachment can't be fetched by the other workspace's owner
    other_ws = outsider.user["workspaces"][0]["workspace_id"]
    o_project, o_st = await make_project(db, other_ws, name="Other", key="OTH")
    o_task = await make_task(db, o_project, o_st["todo"])
    o_aid = (await upload(outsider, o_task.id, "private.txt")).json()["id"]
    assert (await ctx.owner.get(f"{API}/attachments/{o_aid}/download")).status_code == 404
    assert (await ctx.owner.delete(f"{API}/attachments/{o_aid}")).status_code == 404


# ─── Storage service ───


def test_clean_filename_and_content_type_rules():
    assert storage.clean_filename("a\x00b\x1f\x7fc.txt") == "abc.txt"
    assert storage.clean_filename("  dir/sub\\name.md  ") == "name.md"
    assert storage.clean_filename(None) == "file" and storage.clean_filename("...") == "file"
    assert storage.clean_filename("x" * 400) == "x" * 255

    assert storage.safe_extension("photo.JPG") == ".jpg"
    assert storage.safe_extension("archive.tar.gz") == ".gz"
    assert storage.safe_extension("weird.ext with space") == ""
    assert storage.safe_extension(".bashrc") == ""

    assert storage.detect_content_type("Image/PNG; foo=bar", "a.png") == "image/png"
    assert storage.detect_content_type(None, "report.pdf") == "application/pdf"
    assert storage.detect_content_type("application/octet-stream", "a.csv") == "text/csv"
    assert storage.detect_content_type("not a type", "noext") == "application/octet-stream"

    assert storage.download_media_type("application/x-msdownload") == "application/octet-stream"
    assert storage.download_media_type("image/webp") == "image/webp"
    assert (
        storage.content_disposition("日本.txt")
        == "attachment; filename=\"download.txt\"; filename*=UTF-8''%E6%97%A5%E6%9C%AC.txt"
    )
    assert storage.content_disposition('a"b.png', inline=True).startswith('inline; filename="a_b.png"')


async def test_local_storage_streams_and_rejects_bad_keys(tmp_path):
    store = storage.LocalStorage(tmp_path / "files")
    for bad in ("../../etc/passwd", "/etc/passwd", "ab/../../x", "AB/" + "0" * 32, "ab/" + "z" * 32):
        with pytest.raises(ValueError):
            store.path(bad)

    # size unknown up front: the limit is enforced while streaming and the partial file removed
    big = UploadFile(io.BytesIO(b"x" * 100), filename="big.txt", headers=Headers({}))
    with pytest.raises(PayloadTooLarge):
        await store.save(big, max_bytes=10)
    with pytest.raises(BadRequest):
        await store.save(UploadFile(io.BytesIO(b""), filename="e.txt"), max_bytes=10)
    assert stored_files(tmp_path / "files") == []

    key, size = await store.save(UploadFile(io.BytesIO(b"hello"), filename="../Notes.TXT"), max_bytes=10)
    assert size == 5 and re.fullmatch(r"[0-9a-f]{2}/[0-9a-f]{32}\.txt", key)
    assert store.path(key).read_bytes() == b"hello"
    await store.delete(key)
    await store.delete(key)  # already gone: no error
    assert not store.path(key).exists()


def test_storage_is_swappable(tmp_path):
    custom = storage.LocalStorage(tmp_path)
    previous = storage.set_storage(custom)
    try:
        assert storage.get_storage() is custom
    finally:
        storage.set_storage(previous)
