# ProjectHub

A work-management platform for professional teams: plan projects, track work, see delivery risk early, and balance people's workload, all live in real time.

**Stack:** FastAPI · PostgreSQL · SQLAlchemy 2 (async) · React 18 + TypeScript · Vite · Tailwind · Radix UI · TanStack Query

## What it does

| Area | Highlights |
| --- | --- |
| **Work** | Workspaces and projects with custom statuses · tasks with subtasks, labels, priorities, estimates and dependencies · board (drag & drop), list (bulk edit, keyboard navigation) and timeline (Gantt) views · My Tasks · `⌘K` command palette and search · task peek panel you can open from anywhere |
| **Planning** | Milestones · project health compared with schedule, with human-readable reasons · completion forecast from team throughput · burn-up · written status updates (on track / at risk / off track) |
| **Capacity & time** | Running timer and manual time entries · weekly timesheets · workload heatmap of planned hours against capacity per person and week · utilisation reports |
| **Collaboration** | Comments with @mentions · watchers · inbox notifications · attachments · full activity history · live updates over WebSocket |
| **Admin** | Roles (owner / admin / member / guest) · project roles (lead / member / viewer) · private projects · invitation links · deactivation that frees up open work · device sessions you can revoke |

Architecture, domain model, permission model and API conventions are in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Quick start (Docker)

```bash
JWT_SECRET=$(python3 -c "import secrets; print(secrets.token_urlsafe(48))") docker compose up --build
docker compose exec api python seed.py --reset   # optional: demo workspace
```

Open http://localhost:8080. Demo accounts after seeding all use the password `demo1234`:

- `alex@acme.test` (owner)
- `priya@acme.test` (admin and project lead)
- `sofia@acme.test` (member)
- `gus@partner.test` (guest)

## Local development

Prerequisites: Python 3.12+, Node 22+, PostgreSQL 16 (or `docker run -d -p 5432:5432 -e POSTGRES_USER=pm -e POSTGRES_PASSWORD=pm postgres:16-alpine`).

```bash
# API → http://localhost:8000 (docs at /api/docs)
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements-dev.txt
cp .env.example .env
alembic upgrade head
python seed.py            # optional demo data
uvicorn app.main:app --reload

# Web → http://localhost:5173 (proxies /api to :8000)
cd frontend
npm install
npm run dev
```

### Everyday commands

| Task | Command |
| --- | --- |
| Backend tests (each run uses its own throwaway database) | `cd backend && pytest` |
| Lint / format | `cd backend && ruff check app tests && ruff format app tests` |
| New migration after changing models | `cd backend && alembic revision --autogenerate -m "..." && alembic upgrade head` |
| Frontend typecheck / tests / build | `cd frontend && npx tsc -b --noEmit && npx vitest run && npm run build` |
| Regenerate frontend API types after API changes | `scripts/gen-api-types.sh` (CI fails if they drift) |

## Project layout

```
backend/
  app/
    api/v1/        one router per resource (auth, workspaces, projects, tasks, comments, time, notifications, insights, realtime)
    core/          settings, database, security, errors, dependencies
    models/        SQLAlchemy models
    schemas/       Pydantic request/response models (the API contract)
    services/      permissions, insights, realtime broker, activity & notifications, storage, reminders
  alembic/         migrations
  tests/
  seed.py
frontend/
  src/
    api/           generated OpenAPI types, typed client, query keys, data hooks
    app/           providers, router, shell, realtime, UI state
    components/    design system (ui/) and shared domain components
    features/      one folder per screen/area
docs/ARCHITECTURE.md
```

## Security notes

- Passwords are hashed with Argon2. Access tokens are short-lived (15 minutes) and kept in memory. Refresh tokens rotate on every use, live in an httpOnly cookie, and are stored hashed per device session.
- Every request is authorised through one permissions module. Resources you can't access return 404, so IDs can't be probed.
- In production, set `ENV=production`, a strong `JWT_SECRET`, `COOKIE_SECURE=true` behind HTTPS, and explicit `CORS_ORIGINS`.
- Hosting the web app separately from the API (e.g. Netlify, configured by `netlify.toml`): set `VITE_API_URL` to the API's origin in the site's build environment, and on the API set `CORS_ORIGINS` to the site's origin plus `COOKIE_SAMESITE=none` and `COOKIE_SECURE=true` so the refresh cookie works across sites.
- The realtime broker is in-process. To run more than one API instance, swap it for Postgres `LISTEN/NOTIFY` or Redis (see the architecture doc).
