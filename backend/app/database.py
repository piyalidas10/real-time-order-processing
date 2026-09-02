"""
backend/app/database.py
───────────────────────
SQLAlchemy 2.x async engine + session factory.

Key design decisions:
- Async engine (asyncpg driver) so FastAPI request handlers are never blocked
  by a slow DB query — every await yields back to the event loop.
- expire_on_commit=False avoids lazy-load errors after await session.commit().
"""
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from app.config import get_settings

settings = get_settings()

# create_async_engine uses asyncpg under the hood.
# pool_pre_ping=True issues a lightweight "SELECT 1" before each connection
# is reused, auto-healing connections that dropped while idle.
engine = create_async_engine(
    settings.database_url,
    echo=settings.environment == "development",
    pool_pre_ping=True,
    pool_size=10,
    max_overflow=20,
)

AsyncSessionLocal = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
)


class Base(DeclarativeBase):
    """Shared declarative base for all ORM models."""
    pass


async def get_db() -> AsyncSession:  # type: ignore[return]
    """
    FastAPI dependency that yields an async DB session.
    The session is automatically closed (and rolled back on error)
    when the request finishes.
    """
    async with AsyncSessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
