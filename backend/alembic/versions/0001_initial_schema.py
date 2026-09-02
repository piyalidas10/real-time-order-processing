"""Initial schema

Revision ID: 0001
Revises:
Create Date: 2024-01-01
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("CREATE TYPE order_status AS ENUM ('PENDING','PROCESSING','COMPLETED','FAILED')")
    op.execute("CREATE TYPE outbox_event_status AS ENUM ('PENDING','PUBLISHED','FAILED')")

    op.create_table(
        "orders",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("customer_id", sa.Integer(), nullable=False),
        sa.Column("status", sa.Enum("PENDING", "PROCESSING", "COMPLETED", "FAILED", name="order_status"), nullable=False),
        sa.Column("total_amount", sa.Numeric(12, 2), nullable=False),
        sa.Column("retry_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_orders_customer_id", "orders", ["customer_id"])
    op.create_index("ix_orders_status", "orders", ["status"])

    op.create_table(
        "order_items",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("order_id", sa.BigInteger(), nullable=False),
        sa.Column("product_id", sa.String(100), nullable=False),
        sa.Column("quantity", sa.Integer(), nullable=False),
        sa.Column("price", sa.Numeric(10, 2), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["order_id"], ["orders.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_order_items_order_id", "order_items", ["order_id"])

    op.create_table(
        "outbox_events",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("event_id", sa.String(36), nullable=False),
        sa.Column("event_type", sa.String(100), nullable=False),
        sa.Column("aggregate_type", sa.String(100), nullable=False),
        sa.Column("aggregate_id", sa.String(100), nullable=False),
        sa.Column("payload", postgresql.JSON(), nullable=False),
        sa.Column("status", sa.Enum("PENDING", "PUBLISHED", "FAILED", name="outbox_event_status"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("published_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("event_id"),
    )
    op.create_index("ix_outbox_events_status_created", "outbox_events", ["status", "created_at"])

    op.create_table(
        "processed_events",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("event_id", sa.String(36), nullable=False),
        sa.Column("consumer_name", sa.String(100), nullable=False),
        sa.Column("processed_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("event_id", "consumer_name", name="uq_processed_event_consumer"),
    )
    op.create_index("ix_processed_events_event_consumer", "processed_events", ["event_id", "consumer_name"])

    op.create_table(
        "order_events",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("order_id", sa.BigInteger(), nullable=False),
        sa.Column("event_type", sa.String(100), nullable=False),
        sa.Column("status", sa.String(50), nullable=True),
        sa.Column("payload", postgresql.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["order_id"], ["orders.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_order_events_order_id", "order_events", ["order_id"])
    op.create_index("ix_order_events_created_at", "order_events", ["created_at"])


def downgrade() -> None:
    op.drop_table("order_events")
    op.drop_table("processed_events")
    op.drop_table("outbox_events")
    op.drop_table("order_items")
    op.drop_table("orders")
    op.execute("DROP TYPE IF EXISTS order_status")
    op.execute("DROP TYPE IF EXISTS outbox_event_status")
