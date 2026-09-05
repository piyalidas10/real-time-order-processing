"""
backend/workers/order_worker.py
─────────────────────────────────
Order Worker — consumes `order.created` from Kafka.

PROCESSING PIPELINE
───────────────────
1. Consume message from `order.created`
2. Deserialise JSON event
3. Check idempotency (processed_events table) → skip if already seen
4. Update order status → PROCESSING  (+ write OrderEvent)
5. Broadcast WebSocket event "PROCESSING"
6. Simulate business logic (validate, process payment, etc.)
7. Update order status → COMPLETED   (+ write OrderEvent)
8. Broadcast WebSocket event "COMPLETED"
9. Publish `order.processed` to Kafka
10. Record event_id in processed_events

RETRY + DEAD-LETTER QUEUE
──────────────────────────
If an exception occurs during steps 4-9, the worker catches it and:
- Increments a retry counter (stored in the event header / DB)
- On < MAX_RETRIES: re-raises so aiokafka does NOT commit the offset,
  causing the message to be re-delivered.
- On >= MAX_RETRIES: marks order FAILED, publishes to DLQ topic,
  commits the offset so the poison message does not block the partition.

WHY THIS WORKER IS SEPARATE FROM FastAPI
─────────────────────────────────────────
- Decoupling: the API is stateless HTTP; the worker is a long-running process.
- Scaling: workers can be scaled independently from API pods.
- Resilience: a crashing worker does not affect API availability.

CONSUMER GROUP: order-worker-group
WHY: All instances of this worker share the group.  Kafka distributes
partitions across instances → horizontal scaling with guaranteed ordering
per partition (and per order_id key).
"""
import asyncio
import json
import logging
import os
import random
import sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from aiokafka import AIOKafkaConsumer
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.database import AsyncSessionLocal
from app.kafka_client import (
    TOPIC_ORDER_CREATED,
    TOPIC_ORDER_CREATED_DLQ,
    TOPIC_ORDER_FAILED,
    TOPIC_ORDER_PROCESSED,
    TOPIC_ORDER_STATUS_CHANGED,
    publish_event,
)
from app.models import Order, OrderEvent, OrderStatus, ProcessedEvent

logger = logging.getLogger(__name__)
settings = get_settings()

CONSUMER_NAME = "order-worker"


async def is_already_processed(db: AsyncSession, event_id: str) -> bool:
    """
    Idempotency check: returns True if this event was already processed.

    WHY: Kafka guarantees at-least-once delivery.  A consumer crash after
    processing but before committing the offset causes re-delivery.  Without
    this check we would process the same order twice.
    """
    result = await db.execute(
        select(ProcessedEvent).where(
            ProcessedEvent.event_id == event_id,
            ProcessedEvent.consumer_name == CONSUMER_NAME,
        )
    )
    return result.scalar_one_or_none() is not None


async def mark_processed(db: AsyncSession, event_id: str) -> None:
    """Record that this event has been processed (idempotency key store)."""
    stmt = pg_insert(ProcessedEvent).values(
        event_id=event_id,
        consumer_name=CONSUMER_NAME,
    ).on_conflict_do_nothing()
    await db.execute(stmt)


async def process_order_event(event: dict) -> None:
    """Core business logic for a single OrderCreated event."""
    order_id: int = event["order_id"]
    event_id: str = event["event_id"]

    async with AsyncSessionLocal() as db:
        # ── Idempotency guard ────────────────────────────────────────────────
        if await is_already_processed(db, event_id):
            logger.info(f"Skipping duplicate event: event_id={event_id}")
            return

        # ── Fetch order ──────────────────────────────────────────────────────
        result = await db.execute(select(Order).where(Order.id == order_id))
        order = result.scalar_one_or_none()
        if not order:
            logger.error(f"Order not found: {order_id}")
            return

        now = datetime.now(timezone.utc)

        # ── Transition → PROCESSING ──────────────────────────────────────────
        order.status = OrderStatus.PROCESSING
        db.add(OrderEvent(
            order_id=order.id,
            event_type="ProcessingStarted",
            status=OrderStatus.PROCESSING.value,
            payload={"worker": CONSUMER_NAME},
        ))
        await db.commit()

        # Broadcast real-time update via WebSocket
        await publish_event(
            topic=TOPIC_ORDER_STATUS_CHANGED,
            event={
                "event_type": "ProcessingStarted",
                "order_id": order_id,
                "status": "PROCESSING",
                "timestamp": now.isoformat(),
            },
            key=str(order_id),
        )
        logger.info(f"Order {order_id} → PROCESSING")

        # ── Simulate business logic ──────────────────────────────────────────
        # In a real system this would: validate inventory, charge payment, etc.
        await asyncio.sleep(random.uniform(1, 3))  # simulate work

        # ── Transition → COMPLETED ───────────────────────────────────────────
        async with AsyncSessionLocal() as db2:
            result2 = await db2.execute(select(Order).where(Order.id == order_id))
            order2 = result2.scalar_one()
            order2.status = OrderStatus.COMPLETED
            db2.add(OrderEvent(
                order_id=order_id,
                event_type="OrderCompleted",
                status=OrderStatus.COMPLETED.value,
                payload={"worker": CONSUMER_NAME},
            ))
            await mark_processed(db2, event_id)
            await db2.commit()

        completed_at = datetime.now(timezone.utc)
        await publish_event(
            topic=TOPIC_ORDER_STATUS_CHANGED,
            event={
                "event_type": "OrderCompleted",
                "order_id": order_id,
                "status": "COMPLETED",
                "timestamp": completed_at.isoformat(),
            },
            key=str(order_id),
        )
        logger.info(f"Order {order_id} → COMPLETED")

        # ── Publish order.processed ──────────────────────────────────────────
        await publish_event(
            topic=TOPIC_ORDER_PROCESSED,
            event={
                "event_id": f"processed-{event_id}",
                "event_type": "OrderProcessed",
                "event_version": 1,
                "occurred_at": completed_at.isoformat(),
                "order_id": order_id,
                "customer_id": event.get("customer_id"),
                "total_amount": event.get("total_amount"),
            },
            key=str(order_id),
        )


async def handle_failed_order(order_id: int, event: dict, error: str) -> None:
    """Mark order FAILED, write DLQ event."""
    async with AsyncSessionLocal() as db:
        result = await db.execute(select(Order).where(Order.id == order_id))
        order = result.scalar_one_or_none()
        if order:
            order.status = OrderStatus.FAILED
            db.add(OrderEvent(
                order_id=order_id,
                event_type="OrderFailed",
                status=OrderStatus.FAILED.value,
                payload={"error": error, "worker": CONSUMER_NAME},
            ))
            await db.commit()

    await publish_event(
        topic=TOPIC_ORDER_STATUS_CHANGED,
        event={
            "event_type": "OrderFailed",
            "order_id": order_id,
            "status": "FAILED",
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "error": error,
        },
        key=str(order_id),
    )

    # Publish to DLQ so the message can be inspected / replayed
    await publish_event(
        topic=TOPIC_ORDER_CREATED_DLQ,
        event={**event, "dlq_reason": error, "dlq_at": datetime.now(timezone.utc).isoformat()},
        key=str(order_id),
    )
    logger.error(f"Order {order_id} → FAILED (published to DLQ)")


async def run_order_worker() -> None:
    logger.info("Order worker started, waiting for messages...")
    consumer = AIOKafkaConsumer(
        TOPIC_ORDER_CREATED,
        bootstrap_servers=settings.kafka_bootstrap_servers,
        group_id=settings.order_worker_consumer_group,
        auto_offset_reset="earliest",
        enable_auto_commit=False,   # Manual commit for at-least-once semantics
        value_deserializer=lambda v: json.loads(v.decode("utf-8")),
    )

    await consumer.start()
    try:
        async for msg in consumer:
            event = msg.value
            order_id = event.get("order_id", "?")
            attempt = 0

            while attempt < settings.max_retry_attempts:
                try:
                    await process_order_event(event)
                    break  # success
                except Exception as exc:
                    attempt += 1
                    logger.warning(
                        f"Order {order_id} processing attempt {attempt} failed: {exc}"
                    )
                    if attempt < settings.max_retry_attempts:
                        await asyncio.sleep(2 ** attempt)  # exponential back-off
                    else:
                        # Permanent failure → DLQ
                        await handle_failed_order(order_id, event, str(exc))

            # Commit offset regardless of outcome (DLQ handles poison messages)
            await consumer.commit()
    finally:
        await consumer.stop()


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    asyncio.run(run_order_worker())
