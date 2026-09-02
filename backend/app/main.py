"""
backend/app/main.py
────────────────────
FastAPI application entry point.

Lifespan context manager handles startup/shutdown of shared resources:
- Kafka producer
- Database tables (dev mode auto-create)
"""
import logging
from contextlib import asynccontextmanager
from typing import AsyncGenerator

import structlog
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.config import get_settings
from app.database import engine
from app.kafka_client import close_producer, get_producer
from app.models import Base
from app.routers import dashboard, orders, websocket
from app.schemas import HealthResponse

settings = get_settings()

# ── Structured logging setup ──────────────────────────────────────────────────
structlog.configure(
    processors=[
        structlog.stdlib.filter_by_level,
        structlog.stdlib.add_logger_name,
        structlog.stdlib.add_log_level,
        structlog.stdlib.PositionalArgumentsFormatter(),
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.processors.StackInfoRenderer(),
        structlog.processors.format_exc_info,
        structlog.processors.JSONRenderer(),
    ],
    context_class=dict,
    logger_factory=structlog.stdlib.LoggerFactory(),
    wrapper_class=structlog.stdlib.BoundLogger,
    cache_logger_on_first_use=True,
)
logging.basicConfig(level=getattr(logging, settings.log_level.upper(), logging.INFO))


# ── Lifespan ──────────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    # Startup
    # Auto-create tables in development (production uses Alembic migrations).
    if settings.environment == "development":
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)

    # Warm up the Kafka producer so the first order creation is fast.
    try:
        await get_producer()
        logging.getLogger(__name__).info("Kafka producer started")
    except Exception as exc:
        logging.getLogger(__name__).warning(f"Kafka producer not available at startup: {exc}")

    yield  # ← application runs here

    # Shutdown
    await close_producer()
    await engine.dispose()


# ── App factory ───────────────────────────────────────────────────────────────

app = FastAPI(
    title="Real-Time Order Processing API",
    version="1.0.0",
    description=(
        "Production-style event-driven order processing system.\n\n"
        "Demonstrates: FastAPI · PostgreSQL · Kafka · Transactional Outbox · "
        "WebSocket · Angular 21"
    ),
    lifespan=lifespan,
)

# CORS — allow the Angular dev server and production origin.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:4200", "http://localhost:80", "http://frontend"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Routers ───────────────────────────────────────────────────────────────────

app.include_router(orders.router, prefix="/api/v1")
app.include_router(dashboard.router, prefix="/api/v1")
app.include_router(websocket.router)


# ── Health check ──────────────────────────────────────────────────────────────

@app.get("/health", response_model=HealthResponse, tags=["health"])
async def health_check(request: Request):
    """
    Deep health check.

    WHY: A process can be running but unable to serve traffic if its
    dependencies (DB, Kafka) are down.  Health endpoints let orchestrators
    (Docker, Kubernetes) determine whether to send traffic.
    """
    checks: dict[str, str] = {}

    # Check PostgreSQL
    try:
        async with engine.connect() as conn:
            await conn.execute(__import__("sqlalchemy").text("SELECT 1"))
        checks["postgres"] = "healthy"
    except Exception as exc:
        checks["postgres"] = f"unhealthy: {exc}"

    # Check Kafka producer
    try:
        await get_producer()
        checks["kafka"] = "healthy"
    except Exception as exc:
        checks["kafka"] = f"unhealthy: {exc}"

    overall = "healthy" if all(v == "healthy" for v in checks.values()) else "degraded"

    return HealthResponse(
        status=overall,
        environment=settings.environment,
        checks=checks,
    )


@app.get("/", tags=["root"])
async def root():
    return {"message": "Real-Time Order Processing API", "docs": "/docs"}
