import asyncio
import logging

from app.kafka_client import create_status_consumer
from app.websocket_manager import ws_manager

logger = logging.getLogger(__name__)


async def consume_order_status_events() -> None:
    consumer = await create_status_consumer()

    try:
        logger.info("Order status WebSocket bridge started")

        async for message in consumer:
            try:
                event = message.value

                order_id = event.get("order_id")

                if order_id is None:
                    logger.warning(
                        "Ignoring status event without order_id: %s",
                        event,
                    )
                    continue

                logger.info(
                    "Broadcasting order status event: order=%s status=%s",
                    order_id,
                    event.get("status"),
                )

                await ws_manager.broadcast_order_event(
                    int(order_id),
                    event,
                )

            except Exception:
                logger.exception(
                    "Failed to process Kafka status event"
                )

    except asyncio.CancelledError:
        logger.info("Order status WebSocket bridge stopping")
        raise

    finally:
        await consumer.stop()
        logger.info("Order status WebSocket bridge stopped")