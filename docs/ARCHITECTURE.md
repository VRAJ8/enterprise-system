# ProjectHub — Architecture

This document is the contract the codebase follows. Keep it current when behaviour changes.

## 1. Product

A work-management tool for professional teams: plan projects, track tasks, see delivery risk early, and balance people's workload.

Pillars for v1:

1. **Core work management:** workspaces, projects, tasks with subtasks, custom statuses per project, labels, priorities, assignees, dates, board and list views, My Tasks, search, command palette.
2. **Planning & delivery:** timeline (Gantt) with dependencies, milestones, project health compared with schedule, forecasts, and written status updates.
3. **Capacity & time:** estimates, a running timer, manual time entries, timesheets, a workload heatmap compared with capacity, and utilisation.
4. **Collaboration:** comments with @mentions, watchers, an inbox of notifications, attachments, activity history, real-time updates over WebSocket.

## 2. Stack

| Layer | Choice |
| --- | --- |
| API | Python 3.12+, FastAPI, Pydantic v2, SQLAlchemy 2.0 (async), asyncpg |
| DB | PostgreSQL 16; schema managed by Alembic |
| Auth | Argon2 password hashing; short-lived JWT access token (memory) + rotating refresh token (httpOnly cookie, stored hashed in `sessions`) |
| Jobs | APScheduler in-process (deadline reminders) |
| Realtime | WebSocket `/api/v1/ws`; in-process broker (`services/realtime.py`) |
| Web | React 18, TypeScript (strict), Vite, Tailwind CSS, Radix UI primitives, TanStack Query, React Router, dnd-kit, Recharts, cmdk, sonner, framer-motion |
| API types | Generated from FastAPI's OpenAPI schema with `openapi-typescript` (`frontend/src/api/schema.d.ts`) and used through `openapi-fetch` |

## 3. Repository layout

```
backend/
  app/
    main.py              # app factory, router registration, lifespan
    core/                # config, db session, security (jwt/argon2), errors, deps
    models/              # SQLAlchemy models (one module per aggregate)
    schemas/             # Pydantic request/response models
    api/v1/              # one router module per resource
    services/            # permissions, activity, notifications, insights, realtime, storage, scheduler
  alembic/               # migrations
  tests/                 # pytest; each run uses its own throwaway database
  seed.py                # demo workspace
frontend/
  src/
    api/                 # generated schema types, client, query keys, hooks per resource
    app/                 # providers, router, app shell
    components/ui/       # design-system primitives
    components/          # shared domain components (pickers, avatars, task row, ...)
    features/<area>/     # pages and feature components
    lib/                 # utils (dates, format, keyboard)
    styles/
docs/
```

## 4. Domain model

All primary keys are UUIDv4. Timestamps are `timestamptz` (UTC). Calendar dates (start/due) are `date`.

```
users                id, email (unique, lower-cased), name, password_hash, avatar_color, title,
                     timezone, is_active, created_at, last_login_at
sessions             id, user_id, refresh_token_hash, user_agent, ip, created_at, expires_at, revoked_at
workspaces           id, name, slug (unique), created_at
workspace_members    workspace_id, user_id, role [owner|admin|member|guest],
                     weekly_capacity_hours (default 40), joined_at, deactivated_at
invitations          id, workspace_id, email, role, token_hash, invited_by, created_at, expires_at, accepted_at
labels               id, workspace_id, name, color
projects             id, workspace_id, key (2-6 upper letters, unique per workspace), name, description,
                     color, icon, status [planning|active|on_hold|completed|archived], priority,
                     visibility [workspace|private], lead_id, start_date, target_date,
                     task_counter, created_by, created_at, updated_at
project_members      project_id, user_id, role [lead|member|viewer], added_at
task_statuses        id, project_id, name, category [backlog|todo|in_progress|review|done|canceled],
                     color, position
milestones           id, project_id, name, description, due_date, completed_at, created_at
tasks                id, project_id, number (per project), title, description (markdown),
                     status_id, priority [urgent|high|medium|low|none], assignee_id, reporter_id,
                     parent_id (subtask), milestone_id, start_date, due_date, estimate_hours,
                     position (float, ordering within status), completed_at, created_at, updated_at,
                     deleted_at (soft delete → undo)
task_labels          task_id, label_id
task_dependencies    blocker_id, blocked_id    ("blocker must finish before blocked")
task_watchers        task_id, user_id
comments             id, task_id, author_id, body (markdown), created_at, edited_at, deleted_at
attachments          id, task_id, uploader_id, filename, content_type, size_bytes, storage_key, created_at
time_entries         id, workspace_id, task_id, user_id, started_at, ended_at (null = running timer),
                     minutes, note, created_at
project_updates      id, project_id, author_id, health [on_track|at_risk|off_track], body, created_at
activity             id, workspace_id, project_id, task_id, actor_id, verb, data (jsonb), created_at
notifications        id, user_id, workspace_id, type, actor_id, project_id, task_id, data (jsonb),
                     read_at, created_at
```

Rules:
- A task's human reference is `{project.key}-{number}` (e.g. `WEB-42`). `number` comes from `projects.task_counter`, incremented atomically.
- Status category drives behaviour: moving into `done` sets `completed_at`, and leaving it clears `completed_at`. `canceled` counts as closed but not completed.
- Each new project gets default statuses: Backlog (backlog), To Do (todo), In Progress (in_progress), In Review (review), Done (done), Canceled (canceled).
- `position` is a float. Inserting between neighbours takes the midpoint. A column is rebalanced when the gap gets smaller than 1e-6.
- One running timer per user (`ended_at IS NULL`). Starting a new one stops the previous one.
- A dependency must not create a cycle and must stay within one workspace.

## 5. Permissions

Workspace roles:

| Role | Can |
| --- | --- |
| owner | everything; transfer ownership; delete workspace |
| admin | manage members, invitations, labels; full access to every project |
| member | create projects; see `workspace`-visible projects (read + comment); full access to projects they're a member of per project role |
| guest | only projects they're explicitly added to |

Project roles (`project_members.role`), for non-admins:

| Role | Can |
| --- | --- |
| lead | edit project settings, statuses, members, milestones; everything a member can |
| member | create / edit / move / delete tasks, log time, post updates |
| viewer | read and comment |

Effective project access for a user:
1. Workspace owner or admin → `lead`.
2. Explicit project membership → that role.
3. Workspace `member` and project visibility `workspace` → `viewer`.
4. Otherwise → no access. Respond 404, not 403, so IDs can't be probed.

The single source of truth is `services/permissions.py` (`project_access(user, project) -> Role | None`, `require_project(...)`, `require_workspace(...)`). Every endpoint goes through it. A deactivated workspace membership counts as no membership.

## 6. API conventions

- Base path `/api/v1`. JSON only. Errors: `{"detail": str, "code": str}` with a matching HTTP status. Validation errors are 422 (FastAPI default).
- Authentication: `Authorization: Bearer <access_token>` (15 min). `POST /auth/refresh` rotates the refresh cookie (`ph_refresh`, httpOnly, path `/api/v1/auth`, 30 days) and returns a new access token.
- Lists are returned as JSON arrays unless paginated. Paginated endpoints take `limit` and `cursor` and return `{items, next_cursor}`.
- Partial updates use `PATCH` with only the changed fields. An explicit `null` clears nullable fields.
- Every mutation writes an `activity` row (where meaningful), emits a realtime event, and creates notifications.

### Endpoint map

```
auth            POST /auth/register | /auth/login | /auth/refresh | /auth/logout
                GET /auth/me   PATCH /auth/me   POST /auth/change-password
workspaces      GET /workspaces   POST /workspaces   GET|PATCH /workspaces/{wid}
members         GET /workspaces/{wid}/members   PATCH|DELETE /workspaces/{wid}/members/{uid}
invitations     GET|POST /workspaces/{wid}/invitations   DELETE /invitations/{id}
                GET /invitations/lookup?token=   POST /invitations/accept
labels          GET|POST /workspaces/{wid}/labels   PATCH|DELETE /labels/{id}
projects        GET|POST /workspaces/{wid}/projects   GET|PATCH|DELETE /projects/{pid}
                GET|POST /projects/{pid}/members   PATCH|DELETE /projects/{pid}/members/{uid}
statuses        GET|POST /projects/{pid}/statuses   PATCH|DELETE /statuses/{id}   POST /projects/{pid}/statuses/reorder
milestones      GET|POST /projects/{pid}/milestones   PATCH|DELETE /milestones/{id}
tasks           GET /workspaces/{wid}/tasks (filters)   GET|POST /projects/{pid}/tasks
                GET|PATCH|DELETE /tasks/{tid}   POST /tasks/{tid}/restore   POST /tasks/{tid}/move
                GET /tasks/by-ref/{wid}/{ref}   PATCH /tasks/bulk
                POST|DELETE /tasks/{tid}/dependencies/{other}   POST|DELETE /tasks/{tid}/watch
comments        GET|POST /tasks/{tid}/comments   PATCH|DELETE /comments/{id}
attachments     GET|POST /tasks/{tid}/attachments   GET /attachments/{id}/download   DELETE /attachments/{id}
time            GET /workspaces/{wid}/time-entries   POST /tasks/{tid}/time-entries
                PATCH|DELETE /time-entries/{id}   GET /timer   POST /tasks/{tid}/timer/start   POST /timer/stop
updates         GET|POST /projects/{pid}/updates
activity        GET /projects/{pid}/activity   GET /tasks/{tid}/activity
notifications   GET /notifications   GET /notifications/unread-count   POST /notifications/mark-read
insights        GET /workspaces/{wid}/insights/portfolio   GET /projects/{pid}/insights
                GET /workspaces/{wid}/insights/workload   GET /workspaces/{wid}/insights/time
                GET /workspaces/{wid}/home
search          GET /workspaces/{wid}/search?q=
realtime        WS  /ws?token=<access_token>
```

## 7. Insights (computed, no ML)

- **Project health:** `on_track | at_risk | off_track | not_started | done`, compares `% scope done` (estimate-weighted when estimates exist, otherwise by count) against `% schedule elapsed`. The project is off track when it's past its target date with open work, or progress trails the schedule by more than 25 points; at risk when it trails by more than 10 points, or has overdue or blocked work. Health always comes with human-readable `reasons[]`.
- **Forecast:** projects the completion date at the median weekly throughput over the last 6 weeks, plus a confidence range.
- **Burn-up:** daily cumulative scope vs. completed since project start.
- **Cycle time:** median days from first move to `in_progress` until `done`, over the last 30 days.
- **Workload:** for each person and week, sums open estimate hours spread evenly across working days between `start_date` (or today) and `due_date`, and compares them with `weekly_capacity_hours`.
- **Time:** logged minutes per person, project and day, and utilisation (logged ÷ capacity).

## 8. Realtime

Clients connect to `/api/v1/ws?token=...`. The server sends `{"type": "<entity>.<verb>", "workspace_id", "project_id", "task_id", "data"}`. Events go only to users with access to the project; notifications go only to their recipient. The frontend maps events to TanStack Query invalidations, so screens update live. Broker interface: `publish(event, audience_user_ids)`. The in-process implementation can be swapped for Postgres `LISTEN/NOTIFY` when running several API instances.

## 9. Frontend UX principles

- Premium, calm, information-dense (Linear / Height class). Dark and light themes, Inter typography, 4 px spacing grid, subtle depth.
- Optimistic updates for every task mutation, with toast undo for destructive actions.
- Keyboard first: `⌘K` palette, `C` create task, `/` search, `G` then `H`/`P`/`M`/`I` to navigate, `Esc` closes panels, `J`/`K` move in lists.
- Task peek panel (`?task=WEB-42`) opens over any view; a full-page route exists for sharing.
- Skeletons instead of spinners; meaningful empty states; no layout shift.
- Every number on screen should answer a question, such as "am I on track?", "who is overloaded?" or "what's blocking us?".
