"""
backend/app/models.py
─────────────────────
SQLAlchemy 2.x ORM models.

All tables use Integer PKs for simplicity.  UUID is used for idempotency keys
(event_id) because they are generated outside the DB and must be globally unique.

Design notes:
- ForeignKey constraints keep referential integrity at the DB level.
- Indexes on high-cardinality filter/lookup columns (status, order_id, event_id).
- Timestamps default to DB-side now() to avoid clock-skew from app servers.
"""
import enum
import uuid
from datetime import datetime

from sqlalchemy import (
    BigInteger,
    DateTime,
    Enum,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSON, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


# ──────────────────────────────────────────────────────────────────────────────
# Enumerations
# ──────────────────────────────────────────────────────────────────────────────

class OrderStatus(str, enum.Enum):
    PENDING = "PENDING"
    PROCESSING = "PROCESSING"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"


class OutboxEventStatus(str, enum.Enum):
    PENDING = "PENDING"
    PUBLISHED = "PUBLISHED"
    FAILED = "FAILED"


# ──────────────────────────────────────────────────────────────────────────────
# Orders
# ──────────────────────────────────────────────────────────────────────────────

class Order(Base):
    __tablename__ = "orders"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    customer_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    status: Mapped[OrderStatus] = mapped_column(
        Enum(OrderStatus, name="order_status"),
        nullable=False,
        default=OrderStatus.PENDING,
        index=True,
    )
    total_amount: Mapped[float] = mapped_column(Numeric(12, 2), nullable=False)
    retry_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    items: Mapped[list["OrderItem"]] = relationship(
        "OrderItem", back_populates="order", cascade="all, delete-orphan", lazy="selectin"
    )
    events: Mapped[list["OrderEvent"]] = relationship(
        "OrderEvent", back_populates="order", cascade="all, delete-orphan", lazy="selectin",
        order_by="OrderEvent.created_at"
    )


class OrderItem(Base):
    __tablename__ = "order_items"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    order_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("orders.id", ondelete="CASCADE"), nullable=False, index=True
    )
    product_id: Mapped[str] = mapped_column(String(100), nullable=False)
    quantity: Mapped[int] = mapped_column(Integer, nullable=False)
    price: Mapped[float] = mapped_column(Numeric(10, 2), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    order: Mapped["Order"] = relationship("Order", back_populates="items")


# ──────────────────────────────────────────────────────────────────────────────
# Transactional Outbox
# ──────────────────────────────────────────────────────────────────────────────

class OutboxEvent(Base):
    """
    Transactional Outbox pattern.

    WHY: The dual-write problem — if we INSERT an order and then publish to Kafka
    in two separate operations, a crash between them leaves them inconsistent:
    the order exists but no Kafka message was sent, or vice-versa.

    FIX: Write the Kafka payload INTO the same database transaction as the order.
    A separate Outbox Worker polls this table and publishes to Kafka, then marks
    events PUBLISHED.  If the worker crashes, it simply re-reads PENDING rows on
    restart — safe because consumers are idempotent.
    """
    __tablename__ = "outbox_events"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    event_id: Mapped[str] = mapped_column(
        String(36), nullable=False, unique=True, default=lambda: str(uuid.uuid4())
    )
    event_type: Mapped[str] = mapped_column(String(100), nullable=False)
    aggregate_type: Mapped[str] = mapped_column(String(100), nullable=False)
    aggregate_id: Mapped[str] = mapped_column(String(100), nullable=False)
    payload: Mapped[dict] = mapped_column(JSON, nullable=False)
    status: Mapped[OutboxEventStatus] = mapped_column(
        Enum(OutboxEventStatus, name="outbox_event_status"),
        nullable=False,
        default=OutboxEventStatus.PENDING,
        index=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    published_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    __table_args__ = (
        Index("ix_outbox_events_status_created", "status", "created_at"),
    )


# ──────────────────────────────────────────────────────────────────────────────
# Idempotency
# ──────────────────────────────────────────────────────────────────────────────

class ProcessedEvent(Base):
    """
    Idempotency store for Kafka consumers.

    WHY: Kafka guarantees at-least-once delivery — a message may be delivered
    more than once (e.g., consumer restart before offset commit).  Without this
    table an order could be processed twice.

    HOW: Before processing, check if (event_id, consumer_name) exists.
         If yes → skip.  If no → process, then insert here.
    """
    __tablename__ = "processed_events"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    event_id: Mapped[str] = mapped_column(String(36), nullable=False)
    consumer_name: Mapped[str] = mapped_column(String(100), nullable=False)
    processed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    __table_args__ = (
        UniqueConstraint("event_id", "consumer_name", name="uq_processed_event_consumer"),
        Index("ix_processed_events_event_consumer", "event_id", "consumer_name"),
    )


# ──────────────────────────────────────────────────────────────────────────────
# Order Event Log
# ──────────────────────────────────────────────────────────────────────────────

class OrderEvent(Base):
    """
    Append-only audit log for order lifecycle events.
    Exposed via GET /api/v1/orders/{id}/events and shown as a timeline in the UI.
    """
    __tablename__ = "order_events"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    order_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("orders.id", ondelete="CASCADE"), nullable=False, index=True
    )
    event_type: Mapped[str] = mapped_column(String(100), nullable=False)
    status: Mapped[str | None] = mapped_column(String(50), nullable=True)
    payload: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False, index=True
    )

    order: Mapped["Order"] = relationship("Order", back_populates="events")
