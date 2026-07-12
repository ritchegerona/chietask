# Pre-SaaS Backup — Chie-Task_Tracker

**Created:** 2026-07-12  
**Purpose:** Snapshot of the original local single-user task tracker **before / as of** conversion to ChieTask SaaS.

## Contents

| File | Description |
|------|-------------|
| `server.py` | Original Python `http.server` backend |
| `task_tracker.html` | Original single-file UI |
| `start.command` | Original macOS launcher |
| `storage/tasks.json` | Original task data |
| `Archive.zip` | Earlier installer/patch history (pre-project folder) |

## Restore the original local app

```bash
# From project root:
mkdir -p restore-original && cp -R backups/pre-saas-original-2026-07-12/* restore-original/
cd restore-original
chmod +x start.command
# Then run: python3 server.py
# Or open start.command
```

## Notes

- SaaS code lives in `backend/`, `frontend/`, `run.py`, etc.
- This backup is independent of the SaaS SQLite DB (`storage/chietask.db`).
- Demo SaaS login imported from `tasks.json` once; original JSON remains here unchanged.
