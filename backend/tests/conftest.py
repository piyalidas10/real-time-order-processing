"""
backend/tests/conftest.py
──────────────────────────
Pytest fixtures shared across all test modules.

Key patterns:
- In-memory SQLite for unit tests (fast, no external dependencies)
- HTTPX AsyncClient for integration tests against a real FastAPI app
- pytest-asyncio with asyncio_mode="auto" for all async tests
"""
import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from app.database import Base, get_db
from app.main import app

# Use SQLite in-memory for tests — fast, zero setup, no Docker required.
TEST_DATABASE_URL = "sqlite+aiosqlite:///:memory:"


@pytest_asyncio.fixture(scope="function")
async def test_engine():
    engine = create_async_engine(
        TEST_DATABASE_URL,
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield engine
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
    await engine.dispose()


@pytest_asyncio.fixture(scope="function")
async def db_session(test_engine):
    TestSessionLocal = async_sessionmaker(
        test_engine, class_=AsyncSession, expire_on_commit=False
    )
    async with TestSessionLocal() as session:
        yield session


@pytest_asyncio.fixture(scope="function")
async def client(test_engine):
    """
    HTTPX AsyncClient wired to the FastAPI app with a test DB session.
    Each test gets a clean database.
    """
    TestSessionLocal = async_sessionmaker(
        test_engine, class_=AsyncSession, expire_on_commit=False
    )

    async def override_get_db():
        async with TestSessionLocal() as session:
            try:
                yield session
                await session.commit()
            except Exception:
                await session.rollback()
                raise

    app.dependency_overrides[get_db] = override_get_db

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as ac:
        yield ac

    app.dependency_overrides.clear()
