"""
backend/app/config.py
─────────────────────
Centralised settings loaded from environment variables (or .env file).
Pydantic-Settings validates every value at startup — fail fast, never silently.
"""
from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # ── Database ──────────────────────────────────────────────────────────
    database_url: str = "postgresql+asyncpg://orderuser:orderpassword@postgres:5432/orderdb"
    database_url_sync: str = "postgresql://orderuser:orderpassword@postgres:5432/orderdb"

    # ── Kafka ─────────────────────────────────────────────────────────────
    kafka_bootstrap_servers: str = "kafka:9092"

    # ── API ───────────────────────────────────────────────────────────────
    api_host: str = "0.0.0.0"
    api_port: int = 8000
    environment: str = "development"
    log_level: str = "INFO"

    # ── Workers ───────────────────────────────────────────────────────────
    order_worker_consumer_group: str = "order-worker-group"
    notification_worker_consumer_group: str = "notification-worker-group"
    outbox_poll_interval_seconds: int = 2
    max_retry_attempts: int = 3


@lru_cache
def get_settings() -> Settings:
    """Return a cached singleton Settings instance."""
    return Settings()
