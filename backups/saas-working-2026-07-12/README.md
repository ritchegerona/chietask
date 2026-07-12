# ChieTask — SaaS Task Tracker

Multi-user task tracker for office teams and personal productivity: auth, workspaces, plans, multi-task timers, themes, and a modern dashboard.

**Repository:** Public · **Team access via GitHub Pages** (same pattern as AI Awareness Course).

| | |
|--|--|
| **GitHub Pages home** | https://ritchegerona.github.io/chietask/ |
| **🏢 MSR full SaaS app (free, no install)** | https://ritchegerona.github.io/chietask/msr.html |
| **Register** | https://ritchegerona.github.io/chietask/register.html |
| **Login** | https://ritchegerona.github.io/chietask/login.html |
| **App dashboard** | https://ritchegerona.github.io/chietask/app.html |
| **Docs** | https://ritchegerona.github.io/chietask/docs.html |
| **Install server SaaS** | https://ritchegerona.github.io/chietask/install.html |
| **Source repo** | https://github.com/ritchegerona/chietask |
| **Share text** | [public/SHARE.md](./public/SHARE.md) |

### Share with all MSR workmates

Exact copy of the working SaaS tracker UI (tasks, multi-timers, categories, workspaces, settings, themes) — **free for MSR**, pure web:

```
https://ritchegerona.github.io/chietask/msr.html
```

Each workmate creates an account in their browser; tasks stay on **their device only**.
**Full documentation (in repo):** [DOCUMENTATION.md](./DOCUMENTATION.md)
---

## Requirements (dependencies)

### System

| Requirement | Notes |
|-------------|--------|
| **Python 3.10+** | 3.11 / 3.12 / 3.14 tested paths |
| **pip** | Comes with Python |
| **Modern browser** | Chrome, Firefox, Safari, Edge |
| **Git** | To clone this repo |
| **Docker** (optional) | For containerized run |

### Python packages

Declared in `backend/requirements.txt`:

**Runtime**

- `fastapi` — API framework  
- `uvicorn[standard]` — ASGI server  
- `sqlalchemy` — ORM / database  
- `python-jose[cryptography]` — JWT auth  
- `bcrypt` — password hashing  
- `python-multipart` — file uploads (avatars)  
- `email-validator` — email validation  
- `pydantic` / `pydantic-settings` — request schemas  
- `python-dotenv` — load `.env` config  

**Dev / test**

- `httpx` — HTTP client for tests  
- `pytest` — test runner  

No Node.js build step is required (vanilla HTML/CSS/JS frontend).

---

## Install

### 1. Clone (private repo)

```bash
git clone https://github.com/ritchegerona/chietask.git
cd chietask
```

Use SSH if you prefer:

```bash
git clone git@github.com:ritchegerona/chietask.git
cd chietask
```

### 2. Create virtual environment & install dependencies

```bash
python3 -m venv .venv
source .venv/bin/activate          # macOS / Linux
# .venv\Scripts\activate           # Windows

pip install --upgrade pip
pip install -r backend/requirements.txt
```

**Or with Make:**

```bash
make install
```

### 3. Environment (optional for local dev)

```bash
cp .env.example .env
# Edit .env if needed (SECRET_KEY, PORT, DATABASE_URL, …)
```

Defaults work out of the box with SQLite under `storage/`.

---

## Run

### Development server

```bash
source .venv/bin/activate   # if not already active
python run.py
```

**Or:**

```bash
make run
```

**macOS:** double-click `start.command`.

Then open:

| URL | Page |
|-----|------|
| http://localhost:8765 | Landing |
| http://localhost:8765/register | Create account |
| http://localhost:8765/login | Sign in |
| http://localhost:8765/app | App dashboard |
| http://localhost:8765/docs | Interactive API docs |

### Docker

```bash
docker compose up --build
# App: http://localhost:8765
```

### Tests

```bash
source .venv/bin/activate
pytest backend/tests -q
# or
make test
```

---

## First use

1. Open http://localhost:8765/register  
2. Create an account (a personal workspace is created automatically)  
3. Add tasks, use categories, start timers (multiple timers allowed)  
4. Optional: Settings → plan → paid plan → demo checkout  

If legacy data was imported once:

- Email: `demo@chietask.app`  
- Password: `demo1234`  

---

## Features (short)

- Tasks, priorities, categories, due dates, progress, notes  
- Multi-task timers + work log  
- Workspaces + member invites (Team plan)  
- Free / Pro / Team limits  
- Profile photo, themes, dark mode  
- CSV export, focus mode, keyboard shortcuts  

See [DOCUMENTATION.md](./DOCUMENTATION.md) for architecture, API, data model, and security notes.

---

## Project structure

```
chietask/
├── backend/app/       # FastAPI application
├── backend/tests/     # pytest suite
├── frontend/          # Static UI
├── scripts/           # Legacy JSON migrate helper
├── storage/           # Local SQLite + avatars (runtime data)
├── backups/           # Pre-SaaS original snapshot
├── DOCUMENTATION.md   # Full project docs
├── Dockerfile
├── docker-compose.yml
├── Makefile
├── run.py
└── README.md
```

---

## Production checklist (later)

1. Strong `SECRET_KEY` (never commit it)  
2. Postgres via `DATABASE_URL`  
3. Restrict `CORS_ORIGINS`  
4. TLS reverse proxy  
5. Real billing (Stripe/Paddle) — replace demo checkout  
6. Database backups  
7. Switch this GitHub repo to **public** only after daily-use confidence  

---

## License

Private / internal use unless otherwise specified by the repository owner.
