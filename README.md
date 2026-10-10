# ProjectHub: Enterprise Project Management

A project and work-management app for teams: plan projects, assign work with clear owners and deadlines, see which projects are slipping, and balance workload across people.

**Stack:** React 19 + Tailwind + shadcn/ui · FastAPI · MongoDB · optional Groq (AI assistant) and Resend (email)

## What it does

| For | Features |
| --- | --- |
| Everyone | **My Work** queue (overdue, today, next 7 days) · Kanban board with drag & drop and list view · task drawer with checklist, comments with @mentions, attachments and history · project chat and DMs with unread counts · notifications that link to the item · `Ctrl/⌘ K` quick search |
| Project managers | **Portfolio health** (on track / at risk / off track, based on progress against schedule) · **review queue** with approve / send back · team **workload vs. capacity** · milestones · CSV export · project edit and team management |
| Admins | Invite, deactivate and re-role users · closed registration mode · last sign-in |
| AI assistant (optional) | Answers questions about deadlines and workload, and creates or updates tasks, acting **with the signed-in user's permissions** |

Automatic reminders: a background job notifies assignees about tasks due within two days, and notifies assignees and owners about overdue tasks (once per due date).

## Roles and access

- **Admin:** everything, including user management.
- **Project manager:** creates projects, and manages projects they own or belong to.
- **Team member:** sees projects they're on, and updates the status and checklist of tasks assigned to them.

The first account created in a fresh database becomes the admin. Later sign-ups join as team members (or set `ALLOW_OPEN_REGISTRATION=false` so only admins can add people).

## Run locally

Prerequisites: Python 3.11+, Node 18+ with Yarn, and MongoDB (or Docker).

```bash
# 1. MongoDB (skip if you already have one running)
docker run -d --name mongo -p 27017:27017 mongo:7

# 2. API
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements-dev.txt
cp .env.example .env                # then set JWT_SECRET
python seed.py                      # optional: demo workspace (password: demo1234)
uvicorn server:app --reload --port 8000

# 3. Web app (new terminal)
cd frontend
cp .env.example .env
yarn install
yarn start                          # http://localhost:3000
```

Demo accounts after `python seed.py`: `alex@example.com` (admin), `priya@example.com` (project manager), and `sofia@example.com` (team member). All use the password `demo1234`.

Or run MongoDB and the API together with `docker compose up --build`, then start the frontend as above.

## Configuration

All backend settings live in `backend/.env`. See [`backend/.env.example`](backend/.env.example) for the full list. The important ones:

| Variable | Purpose |
| --- | --- |
| `MONGO_URL`, `DB_NAME` | Database connection |
| `JWT_SECRET` | **Required in production** (`ENV=production` refuses to start without it) |
| `CORS_ORIGINS` | Frontend origins allowed to call the API |
| `ALLOW_OPEN_REGISTRATION` | `false` = invite-only |
| `GROQ_API_KEY` | Enables the AI assistant |
| `RESEND_API_KEY`, `SENDER_EMAIL` | Enables assignment emails |

Frontend: `REACT_APP_API_URL` (defaults to `http://localhost:8000/api`).

## Tests

```bash
cd backend && pytest
```

The suite uses an in-memory MongoDB (mongomock), so it needs no running database. It covers authentication, role and project-level access control, task workflows, chat membership, file handling, the AI tool permissions and the deadline scanner.

## Project layout

```
backend/
  server.py          app setup, AI endpoints, scheduler
  config.py          environment settings
  permissions.py     who can see / change what
  insights.py        task stats, overdue logic, project health
  agent_service.py   AI assistant + deadline scanner
  routes/            auth, projects, tasks, chat, notifications, dashboard, users (+comments, files)
  seed.py            demo data
  tests/
frontend/src/
  pages/             MyWork, Dashboard, Projects, ProjectDetail, Tasks, Chat, ...
  components/        TaskDrawer, NewTaskDialog, ProjectFormDialog, CommandPalette, AIAssistant, ui/
  lib/               api client, shared constants and date helpers
```
