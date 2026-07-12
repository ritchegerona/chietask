# Working SaaS Backup — ChieTask

**Created:** 2026-07-12 09:22 UTC  
**Verified:** API tests **14 passed**; health `{"status":"ok","app":"ChieTask","version":"2.2.0"}`  
**Purpose:** Complete snapshot of the **working multi-user SaaS** app before further changes.

## What is included

| Path | Description |
|------|-------------|
| `backend/` | FastAPI app, routers, models, tests |
| `frontend/` | Landing, auth, app UI (local SaaS) |
| `public/` | GitHub Pages MSR free web edition |
| `scripts/` | Legacy migrate helper |
| `storage/chietask.db` | SQLite data at backup time (if present) |
| `storage/tasks.json` | Legacy import source |
| `run.py`, `Makefile`, `Dockerfile`, `docker-compose.yml` | Run / deploy |
| `README.md`, `DOCUMENTATION.md` | Docs |
| `.env.example`, `.gitignore` | Config templates |

**Not included:** `.venv/` (reinstall deps), `.git/`, secrets `.env`, uploaded avatars binary files.

## Restore & run (verified path)

```bash
# From project root or a clean folder:
mkdir -p restore-saas && cp -R backups/saas-working-2026-07-12/* restore-saas/
cd restore-saas

python3 -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r backend/requirements.txt

# Optional: copy .env.example → .env and set SECRET_KEY
python run.py
# → http://localhost:8765
# → http://localhost:8765/docs
```

Or:

```bash
make install && make run
```

### Docker restore

```bash
cd restore-saas
docker compose up --build
```

### Tests after restore

```bash
source .venv/bin/activate
pytest backend/tests -q
```

## GitHub

Source repo: https://github.com/ritchegerona/chietask  
MSR free web: https://ritchegerona.github.io/chietask/msr.html  

## Notes

- Pre-SaaS original remains at `backups/pre-saas-original-2026-07-12/`.
- This backup is the **working SaaS** baseline for safe rollback.
