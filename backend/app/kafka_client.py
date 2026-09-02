"""
backend/app/kafka_client.py
────────────────────────────
Shared Kafka producer (aiokafka).

WHY aiokafka: It integrates cleanly with asyncio — send() is awaitable so
FastAPI / workers never block the event loop during network I/O.

TOPIC DESIGN
────────────
order.created       — emitted by OutboxWorker when a new order is committed
order.processed     — emitted by OrderWorker after successful processing
order.failed        — emitted by OrderWorker on permanent failure
notification.req    — emitted by NotificationWorker
order.created.dlq   — dead-letter queue for order.created messages that
                      exhausted all retries

MESSAGE KEY = str(order_id)
WHY: Kafka routes messages with the same key to the same partition.
     All events for a given order are therefore totally ordered, preventing
     race conditions such as COMPLETED arriving before PROCESSING.
"""
import json
import logging
from typing import Any

from aiokafka import AIOKafkaProducer
from aiokafka.errors import KafkaError

from app.config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()

# ── Topic constants ────────────────────────────────────────────────────────────
TOPIC_ORDER_CREATED = "order.created"
TOPIC_ORDER_PROCESSED = "order.processed"
TOPIC_ORDER_FAILED = "order.failed"
TOPIC_NOTIFICATION_REQUESTED = "notification.requested"
TOPIC_ORDER_CREATED_DLQ = "order.created.dlq"

_producer: AIOKafkaProducer | None = None


async def get_producer() -> AIOKafkaProducer:
    """Return the shared producer, starting it if not yet started."""
    global _producer
    if _producer is None:
        _producer = AIOKafkaProducer(
            bootstrap_servers=settings.kafka_bootstrap_servers,
            value_serializer=lambda v: json.dumps(v).encode("utf-8"),
            key_serializer=lambda k: str(k).encode("utf-8") if k else None,
            # acks="all" → leader + all in-sync replicas acknowledge before
            # the send() future resolves.  Safest durability setting.
            acks="all",
            # Retry up to 5 times on transient network errors.
            retries=5,
        )
        await _producer.start()
    return _producer


async def close_producer() -> None:
    global _producer
    if _producer:
        await _producer.stop()
        _producer = None


async def publish_event(
    topic: str,
    event: dict[str, Any],
    key: str | None = None,
) -> None:
    """
    Publish a single JSON event to a Kafka topic.

    Parameters
    ----------
    topic : Kafka topic name.
    event : Dict that will be JSON-serialised as the message value.
    key   : Partition key — use str(order_id) for order events so that all
            events for the same order land on the same partition (ordering).
    """
    producer = await get_producer()
    try:
        await producer.send_and_wait(topic, value=event, key=key)
        logger.info("Published event", extra={"topic": topic, "key": key, "event_type": event.get("event_type")})
    except KafkaError as exc:
        logger.error("Failed to publish Kafka event", extra={"topic": topic, "error": str(exc)})
        raise
