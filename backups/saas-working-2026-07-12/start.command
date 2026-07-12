#!/bin/bash
cd "$(dirname "$0")"

if [ ! -d ".venv" ]; then
  echo "Creating virtualenv…"
  python3 -m venv .venv
  source .venv/bin/activate
  pip install -r backend/requirements.txt
else
  source .venv/bin/activate
fi

# Fix bcrypt/passlib if needed
pip install -q "bcrypt>=4.0.0,<5.0.0" 2>/dev/null

echo "✓ Starting ChieTask SaaS…"
echo "  App:  http://localhost:8765"
echo "  Docs: http://localhost:8765/docs"
python run.py
