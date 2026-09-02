"""
backend/workers/notification_worker.py
────────────────────────────────────────
Notification Worker — consumes `order.processed` from Kafka.

RESPONSIBILITY
──────────────
Simulate sending a customer notification (email / SMS / push) when an order
is successfully completed.  In production this would call SendGrid, Twilio, etc.

CONSUMER GROUP: notification-worker-group
WHY SEPARATE GROUP: This worker is independent from the order-worker-group.
Kafka delivers the same message to every consumer GROUP (not every consumer
instance within a group).  So order.processed messages are consumed by both:
  - order-worker-group  (for any further order processing)
  - notification-worker-group (for notifications)
Each group tracks its own committed offsets.
"""
import asyncio
import json
import logging
import os
import sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from aiokafka import AIOKafkaConsumer
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert

from app.config import get_settings
from app.database import AsyncSessionLocal
from app.kafka_client import TOPIC_NOTIFICATION_REQUESTED, TOPIC_ORDER_PROCESSED, publish_event
from app.models import OrderEvent, ProcessedEvent

logger = logging.getLogger(__name__)
settings = get_settings()

CONSUMER_NAME = "notification-worker"


async def send_notification(order_id: int, customer_id: int, total_amount: float) -> None:
    """
    Simulate sending a notification.
    In production: call an email/SMS provider API here.
    """
    await asyncio.sleep(0.2)  # simulate async I/O to external service
    logger.info(
        f"📧 Notification sent: order={order_id} customer={customer_id} amount=₹{total_amount}"
    )


async def process_notification_event(event: dict) -> None:
    order_id: int = event["order_id"]
    event_id: str = event["event_id"]

    async with AsyncSessionLocal() as db:
        # Idempotency check
        result = await db.execute(
            select(ProcessedEvent).where(
                ProcessedEvent.event_id == event_id,
                ProcessedEvent.consumer_name == CONSUMER_NAME,
            )
        )
        if result.scalar_one_or_none():
            logger.info(f"Duplicate notification event skipped: {event_id}")
            return

        # Send notification
        await send_notification(
            order_id=order_id,
            customer_id=event.get("customer_id", 0),
            total_amount=event.get("total_amount", 0),
        )

        # Record order event
        db.add(OrderEvent(
            order_id=order_id,
            event_type="NotificationSent",
            status=None,
            payload={"channel": "email", "worker": CONSUMER_NAME},
        ))

        # Mark idempotency key
        stmt = pg_insert(ProcessedEvent).values(
            event_id=event_id,
            consumer_name=CONSUMER_NAME,
        ).on_conflict_do_nothing()
        await db.execute(stmt)
        await db.commit()

    # Publish notification.requested for audit trail
    await publish_event(
        topic=TOPIC_NOTIFICATION_REQUESTED,
        event={
            "event_id": f"notif-{event_id}",
            "event_type": "NotificationRequested",
            "event_version": 1,
            "occurred_at": datetime.now(timezone.utc).isoformat(),
            "order_id": order_id,
            "channel": "email",
        },
        key=str(order_id),
    )
    logger.info(f"Notification event published for order {order_id}")


async def run_notification_worker() -> None:
    logger.info("Notification worker started")
    consumer = AIOKafkaConsumer(
        TOPIC_ORDER_PROCESSED,
        bootstrap_servers=settings.kafka_bootstrap_servers,
        group_id=settings.notification_worker_consumer_group,
        auto_offset_reset="earliest",
        enable_auto_commit=False,
        value_deserializer=lambda v: json.loads(v.decode("utf-8")),
    )

    await consumer.start()
    try:
        async for msg in consumer:
            event = msg.value
            try:
                await process_notification_event(event)
            except Exception as exc:
                logger.error(f"Notification worker error: {exc}", exc_info=True)
            finally:
                await consumer.commit()
    finally:
        await consumer.stop()


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    asyncio.run(run_notification_worker())
