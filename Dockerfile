FROM python:3.12-slim

WORKDIR /app

# Dependencies first (better layer caching)
COPY backend/requirements.txt /app/backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt \
    && useradd --create-home --uid 1000 --shell /usr/sbin/nologin appuser

COPY backend /app/backend
COPY frontend /app/frontend
COPY run.py /app/run.py

# Empty storage dir; production mounts a volume here
RUN mkdir -p /app/storage \
    && chown -R appuser:appuser /app

USER appuser

ENV HOST=0.0.0.0 \
    PORT=8765 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

EXPOSE 8765

# Do not bake a real SECRET_KEY; set via compose / env at runtime
CMD ["uvicorn", "backend.app.main:app", "--host", "0.0.0.0", "--port", "8765"]
