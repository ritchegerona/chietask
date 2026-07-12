"""API integration tests for ChieTask SaaS endpoints."""
from __future__ import annotations

from fastapi.testclient import TestClient


def test_health(client: TestClient):
    r = client.get("/api/health")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok"
    assert body["app"] == "ChieTask"


def test_register(client: TestClient):
    r = client.post(
        "/api/auth/register",
        json={
            "email": "alice@example.com",
            "name": "Alice",
            "password": "password1",
        },
    )
    assert r.status_code == 201
    data = r.json()
    assert "access_token" in data
    assert data["token_type"] == "bearer"
    assert data["user"]["email"] == "alice@example.com"
    assert data["user"]["name"] == "Alice"
    assert data["user"]["plan"] == "free"


def test_register_duplicate_email(client: TestClient):
    payload = {
        "email": "dup@example.com",
        "name": "Dup",
        "password": "password1",
    }
    assert client.post("/api/auth/register", json=payload).status_code == 201
    r = client.post("/api/auth/register", json=payload)
    assert r.status_code == 400
    assert "already" in r.json()["detail"].lower()


def test_login(client: TestClient):
    client.post(
        "/api/auth/register",
        json={
            "email": "bob@example.com",
            "name": "Bob",
            "password": "password1",
        },
    )
    r = client.post(
        "/api/auth/login",
        json={"email": "bob@example.com", "password": "password1"},
    )
    assert r.status_code == 200
    data = r.json()
    assert "access_token" in data
    assert data["user"]["email"] == "bob@example.com"


def test_login_invalid_password(client: TestClient):
    client.post(
        "/api/auth/register",
        json={
            "email": "carol@example.com",
            "name": "Carol",
            "password": "password1",
        },
    )
    r = client.post(
        "/api/auth/login",
        json={"email": "carol@example.com", "password": "wrong-pass"},
    )
    assert r.status_code == 401


def test_me(client: TestClient, auth_headers: dict):
    headers = {"Authorization": auth_headers["Authorization"]}
    r = client.get("/api/auth/me", headers=headers)
    assert r.status_code == 200
    assert r.json()["email"] == "tester@example.com"


def test_unauthorized_access(client: TestClient):
    assert client.get("/api/auth/me").status_code == 401
    assert client.get("/api/workspaces").status_code == 401
    assert client.get("/api/workspaces/1/tasks").status_code == 401
    assert client.post(
        "/api/workspaces/1/tasks",
        json={"text": "Nope"},
    ).status_code == 401


def test_create_and_list_tasks(client: TestClient, auth_headers: dict, workspace_id: int):
    headers = {"Authorization": auth_headers["Authorization"]}

    # empty list
    r = client.get(f"/api/workspaces/{workspace_id}/tasks", headers=headers)
    assert r.status_code == 200
    assert r.json() == []

    # create
    r = client.post(
        f"/api/workspaces/{workspace_id}/tasks",
        headers=headers,
        json={
            "text": "Write tests",
            "category": "General",
            "priority": "high",
            "notes": "pytest + TestClient",
        },
    )
    assert r.status_code == 201
    task = r.json()
    assert task["text"] == "Write tests"
    assert task["priority"] == "high"
    assert task["completed"] is False
    assert task["workspace_id"] == workspace_id
    task_id = task["id"]

    # list
    r = client.get(f"/api/workspaces/{workspace_id}/tasks", headers=headers)
    assert r.status_code == 200
    tasks = r.json()
    assert len(tasks) == 1
    assert tasks[0]["id"] == task_id


def test_plan_usage(client: TestClient, auth_headers: dict, workspace_id: int):
    """Plan usage endpoint (billing upgrade is stubbed; this reports limits)."""
    headers = {"Authorization": auth_headers["Authorization"]}
    r = client.get(f"/api/workspaces/{workspace_id}/plan", headers=headers)
    assert r.status_code == 200
    body = r.json()
    assert body["plan"] == "free"
    assert "max_tasks" in body["limits"]
    assert body["limits"]["max_tasks"] == 100
    assert body["usage"]["tasks"] == 0
    assert body["usage"]["workspaces"] >= 1


def test_workspace_limit_on_free_plan(client: TestClient, auth_headers: dict):
    """Free plan allows 1 workspace (created at register); second should 403."""
    headers = {"Authorization": auth_headers["Authorization"]}
    r = client.post(
        "/api/workspaces",
        headers=headers,
        json={"name": "Second Workspace"},
    )
    assert r.status_code == 403
    assert "limit" in r.json()["detail"].lower()


def test_update_profile_and_password(client: TestClient, auth_headers: dict):
    headers = {"Authorization": auth_headers["Authorization"]}
    r = client.patch(
        "/api/auth/me",
        headers=headers,
        json={"name": "Tester Updated"},
    )
    assert r.status_code == 200
    assert r.json()["name"] == "Tester Updated"

    r = client.patch(
        "/api/auth/me",
        headers=headers,
        json={"current_password": "wrong", "new_password": "newpass1"},
    )
    assert r.status_code == 400

    r = client.patch(
        "/api/auth/me",
        headers=headers,
        json={"current_password": "secret12", "new_password": "newpass1"},
    )
    assert r.status_code == 200

    # Login with new password
    r = client.post(
        "/api/auth/login",
        json={"email": "tester@example.com", "password": "newpass1"},
    )
    assert r.status_code == 200


def test_billing_plans_and_checkout(client: TestClient, auth_headers: dict):
    headers = {"Authorization": auth_headers["Authorization"]}
    r = client.get("/api/billing/plans", headers=headers)
    assert r.status_code == 200
    body = r.json()
    assert body["current_plan"] == "free"
    assert any(p["id"] == "pro" for p in body["plans"])

    # Paid upgrade must go through checkout (402 if using legacy upgrade)
    r = client.post(
        "/api/billing/upgrade",
        headers=headers,
        json={"plan": "pro"},
    )
    assert r.status_code == 402

    r = client.post(
        "/api/billing/checkout/session",
        headers=headers,
        json={"plan": "pro"},
    )
    assert r.status_code == 200
    session = r.json()
    assert session["session_id"]
    assert "checkout" in session["checkout_url"]

    r = client.post(
        "/api/billing/checkout/confirm",
        headers=headers,
        json={
            "session_id": session["session_id"],
            "cardholder_name": "Test User",
            "card_last4": "4242",
            "payment_token": "demo_test_token",
        },
    )
    assert r.status_code == 200
    assert r.json()["plan"] == "pro"

    # Downgrade to free still allowed via upgrade endpoint
    r = client.post(
        "/api/billing/upgrade",
        headers=headers,
        json={"plan": "free"},
    )
    assert r.status_code == 200
    assert r.json()["plan"] == "free"

    r = client.post(
        "/api/billing/upgrade",
        headers=headers,
        json={"plan": "enterprise"},
    )
    assert r.status_code == 400


def test_category_crud_and_rename_cascade(client: TestClient, auth_headers: dict, workspace_id: int):
    headers = {"Authorization": auth_headers["Authorization"]}
    r = client.post(
        f"/api/workspaces/{workspace_id}/categories",
        headers=headers,
        json={"name": "Alpha", "color": "#ff00aa"},
    )
    assert r.status_code == 201
    cat_id = r.json()["id"]

    r = client.post(
        f"/api/workspaces/{workspace_id}/tasks",
        headers=headers,
        json={"text": "In Alpha", "category": "Alpha"},
    )
    assert r.status_code == 201

    r = client.patch(
        f"/api/workspaces/{workspace_id}/categories/{cat_id}",
        headers=headers,
        json={"name": "Beta", "color": "#00aaff"},
    )
    assert r.status_code == 200
    assert r.json()["name"] == "Beta"

    tasks = client.get(f"/api/workspaces/{workspace_id}/tasks", headers=headers).json()
    assert any(t["text"] == "In Alpha" and t["category"] == "Beta" for t in tasks)

    # free-text category auto-creates
    r = client.post(
        f"/api/workspaces/{workspace_id}/tasks",
        headers=headers,
        json={"text": "New bucket task", "category": "BrandNew"},
    )
    assert r.status_code == 201
    cats = client.get(f"/api/workspaces/{workspace_id}/categories", headers=headers).json()
    assert any(c["name"] == "BrandNew" for c in cats)


def test_task_search(client: TestClient, auth_headers: dict, workspace_id: int):
    headers = {"Authorization": auth_headers["Authorization"]}
    client.post(
        f"/api/workspaces/{workspace_id}/tasks",
        headers=headers,
        json={"text": "Alpha unique search token", "category": "IT"},
    )
    client.post(
        f"/api/workspaces/{workspace_id}/tasks",
        headers=headers,
        json={"text": "Beta other item", "category": "Admin"},
    )
    r = client.get(
        f"/api/workspaces/{workspace_id}/tasks",
        headers=headers,
        params={"q": "unique search"},
    )
    assert r.status_code == 200
    tasks = r.json()
    assert len(tasks) == 1
    assert "unique" in tasks[0]["text"].lower()
