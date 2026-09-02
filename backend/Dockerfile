# backend/Dockerfile
# Multi-stage build: keeps the final image lean (no build tools)

# ── Stage 1: dependency installer ─────────────────────────────────────────────
FROM python:3.12-slim AS builder

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir --upgrade pip \
    && pip install --no-cache-dir --prefix=/install -r requirements.txt


# ── Stage 2: runtime image ────────────────────────────────────────────────────
FROM python:3.12-slim AS runtime

WORKDIR /app

# Copy installed packages from builder
COPY --from=builder /install /usr/local

# Copy application source
COPY . .

# Non-root user for security
RUN addgroup --system appgroup && adduser --system --ingroup appgroup appuser
USER appuser

EXPOSE 8000

# Default: run the FastAPI API server
# Workers override this CMD in docker-compose.yml
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
