"""
backend/workers/outbox_worker.py
──────────────────────────────────
Transactional Outbox Worker.

RESPONSIBILITY
──────────────
Poll the `outbox_events` table for PENDING events and publish them to Kafka.
Mark them PUBLISHED after successful delivery.

WHY A SEPARATE WORKER (not done inside the API request)?
─────────────────────────────────────────────────────────
1. The API handler must return fast.  Calling Kafka.send() inside a request
   adds latency and failure modes that are the user's problem.
2. Kafka may be temporarily unavailable.  The worker retries independently
   without affecting the API.
3. If the API pod crashes after DB commit but before Kafka send, the outbox
   event survives and the worker will publish it on restart.

POLLING vs CHANGE DATA CAPTURE
───────────────────────────────
This worker uses simple polling (SELECT ... FOR UPDATE SKIP LOCKED) which is
correct and simple.  A production system could use Debezium CDC for lower
latency, but polling is fine for < ~10k events/second.
"""
import asyncio
import logging
import os
import sys
from datetime import datetime, timezone

# Allow imports from the parent (app) package when run as a script.
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.database import AsyncSessionLocal
from app.kafka_client import TOPIC_ORDER_CREATED, publish_event
from app.models import OutboxEvent, OutboxEventStatus

logger = logging.getLogger(__name__)
settings = get_settings()


async def process_outbox_batch(db: AsyncSession) -> int:
    """
    Fetch up to 50 PENDING outbox events, publish each to Kafka, mark PUBLISHED.
    Returns the number of events published.
    """
    result = await db.execute(
        select(OutboxEvent)
        .where(OutboxEvent.status == OutboxEventStatus.PENDING)
        .order_by(OutboxEvent.created_at)
        .limit(50)
        .with_for_update(skip_locked=True)  # SKIP LOCKED: multiple workers are safe
    )
    events = result.scalars().all()

    published_count = 0
    for event in events:
        try:
            await publish_event(
                topic=TOPIC_ORDER_CREATED,
                event=event.payload,
                key=event.aggregate_id,  # order_id as partition key
            )
            event.status = OutboxEventStatus.PUBLISHED
            event.published_at = datetime.now(timezone.utc)
            published_count += 1
            logger.info(f"Outbox published: event_id={event.event_id} order={event.aggregate_id}")
        except Exception as exc:
            event.status = OutboxEventStatus.FAILED
            logger.error(f"Outbox publish failed: event_id={event.event_id} error={exc}")

    if events:
        await db.commit()

    return published_count


async def run_outbox_worker() -> None:
    logger.info("Outbox worker started")
    while True:
        try:
            async with AsyncSessionLocal() as db:
                count = await process_outbox_batch(db)
                if count:
                    logger.info(f"Outbox: published {count} events")
        except Exception as exc:
            logger.error(f"Outbox worker error: {exc}", exc_info=True)

        await asyncio.sleep(settings.outbox_poll_interval_seconds)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    asyncio.run(run_outbox_worker())
