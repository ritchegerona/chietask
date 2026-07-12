#!/usr/bin/env python3
"""
Re-import storage/tasks.json into the database.

By default this only runs when the DB has no users (same as app startup).
Pass --force to create (or reuse) the demo user and import tasks into a new workspace.

Usage:
  source .venv/bin/activate
  python scripts/migrate_legacy.py
  python scripts/migrate_legacy.py --force
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from backend.app.auth import hash_password  # noqa: E402
from backend.app.config import DATA_DIR  # noqa: E402
from backend.app.database import Base, SessionLocal, engine  # noqa: E402
from backend.app.models import Category, Task, User, Workspace, WorkspaceMember  # noqa: E402

LEGACY_JSON = DATA_DIR / "tasks.json"
DEMO_EMAIL = "demo@chietask.app"
DEMO_PASSWORD = "demo1234"


def import_legacy(*, force: bool = False) -> int:
    Base.metadata.create_all(bind=engine)
    if not LEGACY_JSON.exists():
        print(f"No legacy file at {LEGACY_JSON}")
        return 1

    with open(LEGACY_JSON) as f:
        legacy = json.load(f)
    if not legacy:
        print("Legacy file is empty; nothing to import.")
        return 0

    db = SessionLocal()
    try:
        user_count = db.query(User).count()
        if user_count > 0 and not force:
            print(
                f"Database already has {user_count} user(s). "
                "Startup migration is skipped. Use --force to import into demo user."
            )
            return 0

        user = db.query(User).filter(User.email == DEMO_EMAIL).first()
        if not user:
            user = User(
                email=DEMO_EMAIL,
                name="Demo User",
                hashed_password=hash_password(DEMO_PASSWORD),
                plan="pro",
            )
            db.add(user)
            db.flush()
            print(f"Created demo user {DEMO_EMAIL} / {DEMO_PASSWORD}")
        else:
            print(f"Using existing demo user {DEMO_EMAIL}")

        # Always create a fresh workspace for force re-import
        slug_base = "imported-workspace"
        slug = slug_base
        n = 1
        while db.query(Workspace).filter(Workspace.slug == slug).first():
            slug = f"{slug_base}-{n}"
            n += 1

        ws = Workspace(name="Imported Workspace", slug=slug, owner_id=user.id)
        db.add(ws)
        db.flush()
        db.add(WorkspaceMember(workspace_id=ws.id, user_id=user.id, role="owner"))

        cats = {item.get("category") or "General" for item in legacy}
        for name in sorted(cats):
            db.add(Category(workspace_id=ws.id, name=name, color="#7bcba3"))

        for item in legacy:
            completed = bool(item.get("completed"))
            completed_at = None
            if item.get("completedDate"):
                try:
                    completed_at = datetime.fromisoformat(
                        item["completedDate"].replace("Z", "+00:00")
                    )
                except Exception:
                    completed_at = None
            created_at = None
            if item.get("createdAt"):
                try:
                    created_at = datetime.fromisoformat(
                        item["createdAt"].replace("Z", "+00:00")
                    )
                except Exception:
                    created_at = None

            task = Task(
                workspace_id=ws.id,
                created_by=user.id,
                text=item.get("text") or "Untitled",
                completed=completed,
                progress=int(item.get("progress") or (100 if completed else 0)),
                category=item.get("category") or "General",
                priority=item.get("priority") or "normal",
                due_date=item.get("dueDate"),
                time_spent=int(item.get("timeSpent") or 0),
                completed_at=completed_at,
            )
            if created_at:
                task.created_at = created_at
            db.add(task)

        db.commit()
        print(f"✓ Imported {len(legacy)} tasks → workspace '{ws.name}' (slug={slug})")
        print(f"  Login: {DEMO_EMAIL} / {DEMO_PASSWORD}")
        return 0
    except Exception as e:
        db.rollback()
        print(f"Import failed: {e}")
        return 1
    finally:
        db.close()


def main() -> None:
    parser = argparse.ArgumentParser(description="Import storage/tasks.json into SQLite")
    parser.add_argument(
        "--force",
        action="store_true",
        help="Import even if users already exist (creates a new imported workspace)",
    )
    args = parser.parse_args()
    raise SystemExit(import_legacy(force=args.force))


if __name__ == "__main__":
    main()
