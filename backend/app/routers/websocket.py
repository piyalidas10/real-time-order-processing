"""
backend/app/routers/websocket.py
─────────────────────────────────
WebSocket endpoints.

GET /ws/orders/{order_id}  — subscribe to real-time status events for a specific order
GET /ws/orders             — subscribe to all order events (used by order list page)
"""
import asyncio
import json
import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.websocket_manager import ws_manager

logger = logging.getLogger(__name__)

router = APIRouter(tags=["websocket"])


@router.websocket("/ws/orders/{order_id}")
async def websocket_order(websocket: WebSocket, order_id: int):
    """
    Subscribe to real-time status updates for a specific order.

    The client keeps the connection open.  When the order status changes
    (driven by a Kafka worker → ws_manager.broadcast_order_event), the server
    pushes a JSON event without the client polling.

    The client should also handle:
    - ping/pong keep-alive (browser WebSocket does this automatically)
    - reconnection if the connection drops (implemented in the Angular service)
    """
    await ws_manager.connect_order(order_id, websocket)
    try:
        # Send an initial acknowledgement so the client knows it is connected.
        await websocket.send_json({"event_type": "Connected", "order_id": order_id})
        # Block here, keeping the connection alive.  We receive only pings;
        # clients do not send data in this application.
        while True:
            try:
                # receive_text with a timeout so we detect dead connections.
                await asyncio.wait_for(websocket.receive_text(), timeout=30)
            except asyncio.TimeoutError:
                # No message in 30 s — send a ping to keep the connection alive.
                await websocket.send_json({"event_type": "Ping"})
    except WebSocketDisconnect:
        logger.info(f"WS disconnected: order={order_id}")
    finally:
        await ws_manager.disconnect_order(order_id, websocket)


@router.websocket("/ws/orders")
async def websocket_orders_global(websocket: WebSocket):
    """
    Subscribe to all order events.  Used by the order list page to update
    status badges without full page refresh.
    """
    await ws_manager.connect_global(websocket)
    try:
        await websocket.send_json({"event_type": "Connected", "channel": "global"})
        while True:
            try:
                await asyncio.wait_for(websocket.receive_text(), timeout=30)
            except asyncio.TimeoutError:
                await websocket.send_json({"event_type": "Ping"})
    except WebSocketDisconnect:
        logger.info("WS global disconnected")
    finally:
        await ws_manager.disconnect_global(websocket)
