#!/usr/bin/env python3
"""Start ChieTask SaaS server."""
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

# Load gitignored .env (SECRET_KEY, DATABASE_URL, etc.) before app import
try:
    from dotenv import load_dotenv

    load_dotenv(ROOT / ".env")
except ImportError:
    env_path = ROOT / ".env"
    if env_path.exists():
        for line in env_path.read_text().splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, val = line.partition("=")
            key = key.strip()
            val = val.strip().strip('"').strip("'")
            if key and key not in os.environ:
                os.environ[key] = val

import uvicorn

if __name__ == "__main__":
    port = int(os.getenv("PORT", "8765"))
    host = os.getenv("HOST", "0.0.0.0")
    print(f"✓ ChieTask SaaS → http://localhost:{port}")
    print(f"  API docs: http://localhost:{port}/docs")
    uvicorn.run("backend.app.main:app", host=host, port=port, reload=True)
