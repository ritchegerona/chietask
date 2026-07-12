# ChieTask — Full Project Documentation

**Version:** 2.2 (finalized SaaS)  
**Repository:** https://github.com/ritchegerona/chietask (public)  
**MSR free web:** https://ritchegerona.github.io/chietask/msr.html  
**Stack:** FastAPI · SQLAlchemy · SQLite · Vanilla JS frontend · Docker  

This document describes architecture, features, APIs, data model, configuration, security, **backups**, and operations for ChieTask.

---

## 1. Overview

ChieTask is a multi-user **Software-as-a-Service task tracker** for office and personal productivity. It evolved from a single-file local app into a multi-tenant product with:

- User registration and JWT authentication  
- Workspace isolation (multi-tenant)  
- Tasks with priorities, categories, due dates, progress, and notes  
- Multi-task timers and a daily work log  
- Plan limits (Free / Pro / Team) with a demo checkout flow  
- Profile management including custom profile photos  
- Themes (Ocean, Aurora, Slate, Sunset) with light and dark modes  

**Primary use case:** Track office work, time spent, and completion status across one or more workspaces.

---

## 2. Architecture

```
Browser (frontend/*.html + css + js)
        │  JWT Bearer token
        ▼
FastAPI (backend/app)
        │
        ├── Auth router        /api/auth/*
        ├── Workspaces router  /api/workspaces/*
        ├── Tasks router       /api/workspaces/{id}/tasks/*
        └── Billing router     /api/billing/*
        │
        ▼
SQLAlchemy ORM → SQLite (default) or Postgres (via DATABASE_URL)
```

| Layer | Technology | Location |
|-------|------------|----------|
| API | FastAPI + Uvicorn | `backend/app/` |
| ORM / DB | SQLAlchemy 2.x | `backend/app/models.py`, `database.py` |
| Auth | bcrypt + JWT (python-jose) | `backend/app/auth.py` |
| Frontend | Static HTML/CSS/JS | `frontend/` |
| Process entry | `run.py`, `start.command`, Docker | project root |

The frontend is served by FastAPI as static files (`/static/*`) and HTML routes (`/`, `/app`, `/login`, etc.).

---

## 3. Directory map

```
task-tracker/
├── backend/
│   ├── app/
│   │   ├── main.py           # App factory, lifespan, static routes
│   │   ├── config.py         # Env, plan limits, prices
│   │   ├── database.py       # Engine, WAL pragmas, schema ensure
│   │   ├── models.py         # User, Workspace, Task, Category, …
│   │   ├── schemas.py        # Pydantic request/response models
│   │   ├── auth.py           # Password hash, JWT, current user
│   │   ├── user_out.py       # User → UserOut with avatar_url
│   │   └── routers/
│   │       ├── auth_routes.py
│   │       ├── workspaces.py
│   │       ├── tasks.py
│   │       └── billing.py
│   ├── tests/                # pytest + TestClient
│   ├── requirements.txt
│   ├── requirements.lock.txt
│   └── seed_demo.py
├── frontend/
│   ├── index.html            # Landing
│   ├── login.html / register.html
│   ├── pricing.html
│   ├── app.html              # Main dashboard
│   ├── checkout.html         # Plan payment dashboard (demo)
│   ├── css/styles.css
│   └── js/api.js, app.js
├── scripts/migrate_legacy.py
├── storage/                  # Runtime DB + avatars (gitignored data)
├── backups/
│   ├── pre-saas-original-2026-07-12/   # Original single-file app
│   └── saas-working-2026-07-12/        # Verified working multi-user SaaS
├── Dockerfile
├── docker-compose.yml
├── Makefile
├── run.py
├── start.command
├── README.md                 # Quick start
└── DOCUMENTATION.md          # This file
```

---

## 4. Features (user-facing)

### 4.1 Tasks
- Create, edit, complete, reopen, delete  
- Priority: urgent, high, normal, low  
- Category (dropdown of all workspace categories + custom)  
- Due date, progress (0–100%), notes  
- Filters: Pending / Done / All, category, priority, search  
- Completing a task stays on the current tab (does not dump the full Done list)

### 4.2 Categories
- Workspace-scoped  
- Create, rename, recolor, delete (tasks reassigned to General)  
- Auto-create when a new name is used on a task  

### 4.3 Time tracking
- **Multiple timers** can run at once (▶ on each task)  
- Auto-start timer when a task is added  
- Persist every 15s + flush on stop / tab hide / logout  
- Today’s Work Log shows timed + completed work  

### 4.4 Workspaces
- Personal workspace on register  
- Create more workspaces (plan limits apply)  
- Invite existing users by email (Team plan member limits)  

### 4.5 Plans & billing
| Plan | Max tasks | Workspaces | Members | Price |
|------|-----------|------------|---------|-------|
| Free | 100 | 1 | 1 | $0 |
| Pro | 5,000 | 5 | 1 | $9/mo |
| Team | 50,000 | 20 | 25 | $29/mo |

- Upgrade to Pro/Team → redirects to `/checkout` payment dashboard  
- Checkout is **demo mode** by default (`BILLING_MODE=demo`)  
- Set `BILLING_MODE=live` to refuse demo confirm until a real PSP is integrated  

### 4.6 Profile
- Display name, password change  
- Profile photo upload (JPEG/PNG/WebP/GIF, max 2MB) → `storage/avatars/`  

### 4.7 UI / UX
- Palettes: Ocean (default), Aurora, Slate, Sunset  
- Light / dark mode with readable contrast  
- Focus mode, keyboard shortcuts (N, F, E, T, /)  
- Responsive layout with mobile sidebar  

---

## 5. Data model

### User
- `id`, `email` (unique), `name`, `hashed_password`  
- `plan` (`free` | `pro` | `team`)  
- `avatar_path` (relative under `storage/`)  
- `is_active`, `created_at`  

### Workspace
- `id`, `name`, `slug` (unique), `owner_id`, `created_at`  

### WorkspaceMember
- `workspace_id`, `user_id`, `role` (`owner` | `admin` | `member`)  

### Category
- `workspace_id`, `name` (unique per workspace), `color`  

### Task
- `workspace_id`, `created_by`, `text`, `notes`  
- `completed`, `progress`, `category`, `priority`  
- `due_date` (ISO `YYYY-MM-DD`), `time_spent` (seconds)  
- `completed_at`, `created_at`, `updated_at`  

Default database: `storage/chietask.db` (SQLite, WAL mode).

---

## 6. API reference (summary)

All protected routes require:

```http
Authorization: Bearer <access_token>
```

### Auth
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/auth/register` | Register + personal workspace |
| POST | `/api/auth/login` | Login → JWT + user |
| GET | `/api/auth/me` | Current user |
| PATCH | `/api/auth/me` | Update name / password |
| POST | `/api/auth/me/avatar` | Upload avatar (multipart) |
| DELETE | `/api/auth/me/avatar` | Remove avatar |

### Workspaces
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/workspaces` | List mine |
| POST | `/api/workspaces` | Create |
| GET | `/api/workspaces/{id}/members` | Members |
| POST | `/api/workspaces/{id}/invite` | Invite by email |
| GET/POST | `/api/workspaces/{id}/categories` | List / create |
| PATCH/DELETE | `/api/workspaces/{id}/categories/{cid}` | Update / delete |
| GET | `/api/workspaces/{id}/plan` | Usage vs limits |

### Tasks
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/workspaces/{id}/tasks` | List (`completed`, `category`, `priority`, `q`, due filters) |
| POST | `/api/workspaces/{id}/tasks` | Create |
| GET | `/api/workspaces/{id}/tasks/stats` | Dashboard stats |
| GET/PATCH/DELETE | `/api/workspaces/{id}/tasks/{tid}` | Read / update / delete |
| POST | `/api/workspaces/{id}/tasks/{tid}/time` | Add seconds to timer |

### Billing
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/billing/plans` | Catalog + current plan |
| POST | `/api/billing/checkout/session` | Start paid upgrade session |
| GET | `/api/billing/checkout/session/{id}` | Session details |
| POST | `/api/billing/checkout/confirm` | Confirm demo payment |
| POST | `/api/billing/upgrade` | Free / downgrade only (paid → 402) |

### Health
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/health` | `{ status, app, version }` |

Interactive docs: **http://localhost:8765/docs**

---

## 7. Frontend pages

| Path | File | Purpose |
|------|------|---------|
| `/` | `index.html` | Marketing landing |
| `/pricing` | `pricing.html` | Plan overview |
| `/register` | `register.html` | Sign up |
| `/login` | `login.html` | Sign in (`?next=` supported) |
| `/app` | `app.html` | Main application |
| `/checkout` | `checkout.html` | Demo subscription payment |
| `/static/*` | `frontend/*` | CSS, JS, assets |
| `/media/avatars/*` | `storage/avatars/*` | Uploaded avatars |

Client state uses `localStorage` keys: `chie_token`, `chie_user`, `chie_workspace`, theme keys.

---

## 8. Configuration

Copy `.env.example` to `.env` (gitignored):

| Variable | Default | Description |
|----------|---------|-------------|
| `SECRET_KEY` | Dev fallback | JWT signing key — **change in production** |
| `DATABASE_URL` | `sqlite:///./storage/chietask.db` | DB URL |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | `10080` (7 days) | Token lifetime |
| `HOST` | `0.0.0.0` | Bind host |
| `PORT` | `8765` | Bind port |
| `CORS_ORIGINS` | `*` | Comma-separated origins |
| `APP_URL` | `http://localhost:8765` | Used for checkout redirect URLs |
| `BILLING_MODE` | `demo` | `demo` allows fake checkout; `live` blocks it |

---

## 9. Dependencies

### Runtime (Python 3.10+)

| Package | Role |
|---------|------|
| `fastapi` | Web framework |
| `uvicorn[standard]` | ASGI server |
| `sqlalchemy` | ORM |
| `python-jose[cryptography]` | JWT |
| `bcrypt` | Password hashing |
| `python-multipart` | File uploads |
| `email-validator` | Email validation |
| `pydantic` / `pydantic-settings` | Schemas / settings |
| `python-dotenv` | Load `.env` |

### Dev / test

| Package | Role |
|---------|------|
| `httpx` | Test client transport |
| `pytest` | Test runner |

Install:

```bash
python3 -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r backend/requirements.txt
```

Or: `make install`

**System requirements:** Python 3.10+, pip, modern browser. Optional: Docker + Docker Compose.

---

## 10. Running

### Local (recommended for daily use)

```bash
make install
make run
# open http://localhost:8765
```

macOS: double-click `start.command`.

### Tests

```bash
make test
# or: pytest backend/tests -q
```

### Docker

```bash
docker compose up --build
```

---

## 11. Security notes (current state)

| Topic | Status |
|-------|--------|
| Passwords | bcrypt hashed |
| API auth | JWT Bearer |
| Multi-tenant | Workspace membership checks |
| Avatar files | Server-generated names; path constrained on delete |
| Demo checkout | Not real payments — for UI flow only |
| Default `SECRET_KEY` | Dev only — set a strong secret for any shared deploy |
| CORS `*` | OK for local; restrict for production |
| Autofill | Task composer hardened against card-history autofill |

**Before production public launch:** strong secrets, Postgres, TLS, real billing webhooks, rate limits, shorter JWT lifetime / refresh tokens.

---

## 12. Backups (important)

ChieTask keeps **dated snapshots** under `backups/` so you can roll back the original app or the verified working SaaS at any time. These are also in the GitHub repository.

### 12.1 Working multi-user SaaS (primary restore point)

| Path | Description |
|------|-------------|
| `backups/saas-working-2026-07-12/` | Full folder snapshot of the **working SaaS** |
| `backups/saas-working-2026-07-12.zip` | Same snapshot as a portable zip |
| `backups/saas-working-2026-07-12/BACKUP_INFO.md` | Restore steps (also summarized below) |

**Verified when created:**

- API tests: **14 passed**  
- Health: `{"status":"ok","app":"ChieTask","version":"2.2.0"}`  
- Includes: `backend/`, `frontend/`, `public/` (MSR web), docs, Docker files, `run.py`, and a checkpointed `storage/chietask.db`  
- Excludes: `.venv/`, `.git/`, secret `.env` files, runtime cache  

#### Restore & run the working SaaS

```bash
# From project root (or after cloning the repo):
mkdir -p restore-saas
cp -R backups/saas-working-2026-07-12/* restore-saas/
# Or unzip: unzip backups/saas-working-2026-07-12.zip -d restore-saas && mv restore-saas/saas-working-2026-07-12/* restore-saas/

cd restore-saas
python3 -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r backend/requirements.txt

# Optional: cp .env.example .env  and set a strong SECRET_KEY
python run.py
# → http://localhost:8765
# → http://localhost:8765/docs
```

**Make / Docker after restore:**

```bash
make install && make run
# or
docker compose up --build
```

**Tests after restore:**

```bash
source .venv/bin/activate
pytest backend/tests -q
```

### 12.2 Pre-SaaS original (legacy single-file app)

| Path | Description |
|------|-------------|
| `backups/pre-saas-original-2026-07-12/` | Original local tracker before SaaS |
| `backups/pre-saas-original-2026-07-12.zip` | Zip of the same |
| `BACKUP_INFO.md` inside that folder | Restore for `server.py` + `task_tracker.html` |

Contents include original `server.py`, `task_tracker.html`, `start.command`, and `storage/tasks.json`.

### 12.3 Live data vs backup data

| Location | Role |
|----------|------|
| `storage/chietask.db` (project root) | **Live** local SaaS database while you develop/run |
| `backups/saas-working-2026-07-12/storage/chietask.db` | **Frozen** DB snapshot from backup day |
| MSR GitHub Pages app | Separate **browser localStorage** per user (not this SQLite file) |

Replacing the live DB with the backup DB will restore accounts/tasks as of the backup date (overwrites current local data).

### 12.4 Creating a new SaaS backup later

```bash
# From project root, after tests pass:
DATE=$(date +%Y-%m-%d)
rsync -a --exclude '.git/' --exclude '.venv/' --exclude '__pycache__/' \
  --exclude '.pytest_cache/' --exclude 'backups/' \
  --exclude 'storage/*.db-wal' --exclude 'storage/*.db-shm' \
  ./ "backups/saas-working-${DATE}/"
# Then copy/update BACKUP_INFO.md and optionally zip the folder
```

Always run `pytest backend/tests -q` and hit `/api/health` before relying on a new snapshot.

---

## 13. Legacy migration

If `storage/tasks.json` exists and the user table is empty, first startup may import into `demo@chietask.app` / `demo1234` (Pro).

Manual re-import:

```bash
python scripts/migrate_legacy.py
python scripts/migrate_legacy.py --force   # careful
```

Pre-SaaS source snapshot: `backups/pre-saas-original-2026-07-12/` (see §12.2).

---

## 14. Keyboard shortcuts (app)

| Key | Action |
|-----|--------|
| `N` | Focus new task |
| `F` | Focus mode |
| `E` | Export CSV |
| `T` | Toggle light/dark |
| `⇧T` | Cycle color palette |
| `/` | Focus search |
| `Esc` | Close modals / menus |

---

## 15. Roadmap ideas (post daily-use testing)

1. Real Stripe/Paddle checkout + webhooks  
2. Email due-date reminders  
3. Kanban / drag-and-drop  
4. Assignees on Team plan  
5. Activity audit log  
6. Postgres + automated backups  
7. Make repository public after confidence from real work usage  

---

## 16. License

Private / internal use unless the repository owner states otherwise.

---

*Document maintained with the ChieTask codebase. For a short install guide, see [README.md](./README.md). For backup restore details, see §12 and `backups/*/BACKUP_INFO.md`.*
