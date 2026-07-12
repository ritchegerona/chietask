"""
Pytest fixtures for ChieTask API tests.

DATABASE_URL must be set before importing the app (engine is created at import time).
"""
from __future__ import annotations

import os
import sys
import tempfile
from pathlib import Path

# Project root on sys.path so `backend.app` imports work
ROOT = Path(__file__).resolve().parent.parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

# Temp SQLite DB — set env BEFORE any app imports
_fd, _TEST_DB = tempfile.mkstemp(suffix=".db")
os.close(_fd)
os.environ["DATABASE_URL"] = f"sqlite:///{_TEST_DB}"
os.environ["SECRET_KEY"] = "test-secret-key-for-pytest-only"
os.environ.setdefault("ACCESS_TOKEN_EXPIRE_MINUTES", "60")

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from backend.app.database import Base, SessionLocal, engine  # noqa: E402
from backend.app.main import app  # noqa: E402


def _clear_tables() -> None:
    """Wipe all rows so each test starts clean (avoids legacy migration noise)."""
    db = SessionLocal()
    try:
        for table in reversed(Base.metadata.sorted_tables):
            db.execute(table.delete())
        db.commit()
    finally:
        db.close()


@pytest.fixture()
def client():
    """HTTP client against a fresh empty database."""
    Base.metadata.create_all(bind=engine)
    with TestClient(app) as c:
        # Startup may import legacy tasks.json; clear for isolation
        _clear_tables()
        yield c
    Base.metadata.drop_all(bind=engine)


@pytest.fixture()
def auth_headers(client: TestClient) -> dict[str, str]:
    """Register a user and return Authorization headers + helper payload."""
    resp = client.post(
        "/api/auth/register",
        json={
            "email": "tester@example.com",
            "name": "Test User",
            "password": "secret12",
        },
    )
    assert resp.status_code == 201, resp.text
    data = resp.json()
    return {
        "Authorization": f"Bearer {data['access_token']}",
        "_token": data["access_token"],
        "_user": data["user"],
    }


@pytest.fixture()
def workspace_id(client: TestClient, auth_headers: dict) -> int:
    headers = {"Authorization": auth_headers["Authorization"]}
    resp = client.get("/api/workspaces", headers=headers)
    assert resp.status_code == 200, resp.text
    workspaces = resp.json()
    assert len(workspaces) >= 1
    return workspaces[0]["id"]


def pytest_sessionfinish(session, exitstatus):
    """Remove temp DB file after the suite."""
    try:
        Path(_TEST_DB).unlink(missing_ok=True)
    except OSError:
        pass
