#!/usr/bin/env python3
"""
Idempotent demo seeder.

Creates demo@chietask.app / demo1234 with a sample workspace and tasks if missing.
Safe to re-run: skips user/workspace creation when already present; only adds
sample tasks when the demo workspace has none.

Usage (from repo root):
  .venv/bin/python -m backend.seed_demo
  # or
  .venv/bin/python backend/seed_demo.py
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.app.auth import hash_password  # noqa: E402
from backend.app.database import Base, SessionLocal, engine  # noqa: E402
from backend.app.models import Category, Task, User, Workspace, WorkspaceMember  # noqa: E402

DEMO_EMAIL = "demo@chietask.app"
DEMO_PASSWORD = "demo1234"
DEMO_NAME = "Demo User"
DEMO_PLAN = "pro"
WS_SLUG = "demo-workspace"

DEFAULT_CATEGORIES = [
    ("Meetings", "#89c4e8"),
    ("Reports", "#f4d4a7"),
    ("Emails", "#b9d8e8"),
    ("Admin", "#c0c0c0"),
    ("Client", "#e895a8"),
    ("General", "#7bcba3"),
]

SAMPLE_TASKS = [
    {
        "text": "Review Q2 hiring pipeline",
        "category": "Recruitment",
        "priority": "high",
        "due_date": "2026-07-15",
        "notes": "Focus on open senior roles",
    },
    {
        "text": "Send weekly status email",
        "category": "Emails",
        "priority": "normal",
        "due_date": "2026-07-14",
        "notes": "",
    },
    {
        "text": "Prepare client kickoff deck",
        "category": "Client",
        "priority": "urgent",
        "due_date": "2026-07-13",
        "notes": "Include timeline and owners",
    },
    {
        "text": "Update team wiki documentation",
        "category": "Documentation",
        "priority": "low",
        "due_date": None,
        "notes": "Onboarding section",
        "completed": True,
        "progress": 100,
    },
    {
        "text": "Schedule 1:1s for next week",
        "category": "Meetings",
        "priority": "normal",
        "due_date": "2026-07-18",
        "notes": "",
    },
]


def seed() -> None:
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        user = db.query(User).filter(User.email == DEMO_EMAIL).first()
        created_user = False
        if not user:
            user = User(
                email=DEMO_EMAIL,
                name=DEMO_NAME,
                hashed_password=hash_password(DEMO_PASSWORD),
                plan=DEMO_PLAN,
            )
            db.add(user)
            db.flush()
            created_user = True
            print(f"✓ Created user {DEMO_EMAIL}")
        else:
            print(f"· User {DEMO_EMAIL} already exists (id={user.id})")

        ws = (
            db.query(Workspace)
            .filter(Workspace.owner_id == user.id, Workspace.slug == WS_SLUG)
            .first()
        )
        if not ws:
            # Prefer any owned workspace if slug taken by someone else
            existing_slug = db.query(Workspace).filter(Workspace.slug == WS_SLUG).first()
            slug = WS_SLUG if not existing_slug else f"{WS_SLUG}-{user.id}"
            ws = Workspace(name="Demo Workspace", slug=slug, owner_id=user.id)
            db.add(ws)
            db.flush()
            db.add(WorkspaceMember(workspace_id=ws.id, user_id=user.id, role="owner"))
            for name, color in DEFAULT_CATEGORIES:
                exists = (
                    db.query(Category)
                    .filter(Category.workspace_id == ws.id, Category.name == name)
                    .first()
                )
                if not exists:
                    db.add(Category(workspace_id=ws.id, name=name, color=color))
            print(f"✓ Created workspace '{ws.name}' (slug={ws.slug})")
        else:
            # Ensure membership
            m = (
                db.query(WorkspaceMember)
                .filter(WorkspaceMember.workspace_id == ws.id, WorkspaceMember.user_id == user.id)
                .first()
            )
            if not m:
                db.add(WorkspaceMember(workspace_id=ws.id, user_id=user.id, role="owner"))
            print(f"· Workspace already exists (id={ws.id}, slug={ws.slug})")

        task_count = db.query(Task).filter(Task.workspace_id == ws.id).count()
        if task_count == 0:
            for item in SAMPLE_TASKS:
                completed = bool(item.get("completed", False))
                task = Task(
                    workspace_id=ws.id,
                    created_by=user.id,
                    text=item["text"],
                    notes=item.get("notes") or "",
                    category=item.get("category") or "General",
                    priority=item.get("priority") or "normal",
                    due_date=item.get("due_date"),
                    completed=completed,
                    progress=int(item.get("progress") or (100 if completed else 0)),
                )
                db.add(task)
            print(f"✓ Added {len(SAMPLE_TASKS)} sample tasks")
        else:
            print(f"· Workspace already has {task_count} task(s); skipped sample tasks")

        db.commit()
        print()
        print(f"Demo login: {DEMO_EMAIL} / {DEMO_PASSWORD}")
        if created_user:
            print("(new account)")
        else:
            print("(existing account; password unchanged)")
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    seed()
