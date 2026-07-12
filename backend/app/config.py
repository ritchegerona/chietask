import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent.parent
DATA_DIR = BASE_DIR / "storage"
DATA_DIR.mkdir(exist_ok=True)

SECRET_KEY = os.getenv("SECRET_KEY", "chie-task-dev-secret-change-in-production-2026")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "10080"))  # 7 days

DATABASE_URL = os.getenv("DATABASE_URL", f"sqlite:///{DATA_DIR / 'chietask.db'}")

APP_NAME = "ChieTask"
APP_URL = os.getenv("APP_URL", "http://localhost:8765")
CORS_ORIGINS = os.getenv("CORS_ORIGINS", "*").split(",")

# Plans: free | pro | team
PLAN_LIMITS = {
    "free": {"max_tasks": 100, "max_workspaces": 1, "max_members": 1},
    "pro": {"max_tasks": 5000, "max_workspaces": 5, "max_members": 1},
    "team": {"max_tasks": 50000, "max_workspaces": 20, "max_members": 25},
}

PLAN_PRICES_CENTS = {
    "free": 0,
    "pro": 900,  # $9.00/mo
    "team": 2900,  # $29.00/mo
}

PLAN_PRICE_LABELS = {
    "free": "$0/mo",
    "pro": "$9/mo",
    "team": "$29/mo",
}
