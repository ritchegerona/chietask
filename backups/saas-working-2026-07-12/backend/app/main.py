import json
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles

from .config import APP_NAME, BASE_DIR, CORS_ORIGINS, DATA_DIR
from .database import Base, SessionLocal, engine, ensure_schema
from .models import Category, Task, User, Workspace, WorkspaceMember
from .auth import hash_password
from .routers import auth_routes, billing, tasks, workspaces

APP_VERSION = "2.2.0"


@asynccontextmanager
async def lifespan(_app: FastAPI):
    Base.metadata.create_all(bind=engine)
    ensure_schema()
    migrate_legacy_data()
    yield


app = FastAPI(
    title=APP_NAME,
    version=APP_VERSION,
    description="ChieTask — multi-user SaaS task tracker",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS if CORS_ORIGINS != ["*"] else ["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_routes.router)
app.include_router(billing.router)
app.include_router(workspaces.router)
app.include_router(tasks.router)

FRONTEND = BASE_DIR / "frontend"
LEGACY_JSON = DATA_DIR / "tasks.json"


def migrate_legacy_data():
    """One-time import of storage/tasks.json into a demo user if DB is empty."""
    db = SessionLocal()
    try:
        if db.query(User).count() > 0:
            return
        if not LEGACY_JSON.exists():
            return
        with open(LEGACY_JSON) as f:
            legacy = json.load(f)
        if not legacy:
            return

        user = User(
            email="demo@chietask.app",
            name="Demo User",
            hashed_password=hash_password("demo1234"),
            plan="pro",
        )
        db.add(user)
        db.flush()

        ws = Workspace(name="Imported Workspace", slug="imported-workspace", owner_id=user.id)
        db.add(ws)
        db.flush()
        db.add(WorkspaceMember(workspace_id=ws.id, user_id=user.id, role="owner"))

        cats = set()
        for item in legacy:
            cats.add(item.get("category") or "General")
        for name in sorted(cats):
            db.add(Category(workspace_id=ws.id, name=name, color="#7bcba3"))

        for item in legacy:
            completed = bool(item.get("completed"))
            completed_at = None
            if item.get("completedDate"):
                try:
                    from datetime import datetime

                    completed_at = datetime.fromisoformat(item["completedDate"].replace("Z", "+00:00"))
                except Exception:
                    completed_at = None
            created_at = None
            if item.get("createdAt"):
                try:
                    from datetime import datetime

                    created_at = datetime.fromisoformat(item["createdAt"].replace("Z", "+00:00"))
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
        print(f"✓ Migrated {len(legacy)} legacy tasks → demo@chietask.app / demo1234")
    except Exception as e:
        db.rollback()
        print(f"⚠ Legacy migration skipped: {e}")
    finally:
        db.close()


@app.get("/api/health")
def health():
    return {"status": "ok", "app": APP_NAME, "version": APP_VERSION}


# User avatars (uploaded media)
AVATAR_MEDIA = DATA_DIR / "avatars"
AVATAR_MEDIA.mkdir(parents=True, exist_ok=True)
app.mount("/media/avatars", StaticFiles(directory=str(AVATAR_MEDIA)), name="avatars")

# Static frontend
if FRONTEND.exists():
    app.mount("/static", StaticFiles(directory=str(FRONTEND)), name="static")

    @app.get("/")
    def landing():
        return FileResponse(FRONTEND / "index.html")

    @app.get("/login")
    def login_page():
        return FileResponse(FRONTEND / "login.html")

    @app.get("/register")
    def register_page():
        return FileResponse(FRONTEND / "register.html")

    @app.get("/app")
    def app_page():
        return FileResponse(FRONTEND / "app.html")

    @app.get("/pricing")
    def pricing_page():
        return FileResponse(FRONTEND / "pricing.html")

    @app.get("/checkout")
    def checkout_page():
        return FileResponse(FRONTEND / "checkout.html")
else:

    @app.get("/")
    def no_frontend():
        return RedirectResponse("/docs")
