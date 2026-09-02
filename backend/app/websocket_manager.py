"""
backend/app/websocket_manager.py
─────────────────────────────────
In-process WebSocket connection manager.

Architecture
────────────
FastAPI holds a single WebSocketManager instance (app-level singleton via
lifespan).  When a client connects to /ws/orders/{order_id} the connection is
registered under that order_id.  When a worker publishes a status change it
calls broadcast_order_event(), which pushes the JSON payload to every connected
client watching that order.

This is an in-process broadcast — sufficient for a single-instance deployment.
For horizontal scaling you would replace/augment this with a Redis Pub/Sub layer
so events published by a worker on node A reach WebSocket clients connected to
node B.
"""
import asyncio
import json
import logging
from collections import defaultdict
from typing import Any

from fastapi import WebSocket

logger = logging.getLogger(__name__)


class WebSocketManager:
    def __init__(self) -> None:
        # order_id → set of active WebSocket connections watching that order
        self._connections: dict[int, set[WebSocket]] = defaultdict(set)
        # "all" channel: clients watching any order (used by order list page)
        self._global_connections: set[WebSocket] = set()
        self._lock = asyncio.Lock()

    # ── Connection lifecycle ──────────────────────────────────────────────

    async def connect_order(self, order_id: int, websocket: WebSocket) -> None:
        await websocket.accept()
        async with self._lock:
            self._connections[order_id].add(websocket)
        logger.info(f"WS connected: order={order_id}, total={len(self._connections[order_id])}")

    async def connect_global(self, websocket: WebSocket) -> None:
        await websocket.accept()
        async with self._lock:
            self._global_connections.add(websocket)
        logger.info(f"WS global connected, total={len(self._global_connections)}")

    async def disconnect_order(self, order_id: int, websocket: WebSocket) -> None:
        async with self._lock:
            self._connections[order_id].discard(websocket)
            if not self._connections[order_id]:
                del self._connections[order_id]

    async def disconnect_global(self, websocket: WebSocket) -> None:
        async with self._lock:
            self._global_connections.discard(websocket)

    # ── Broadcasting ──────────────────────────────────────────────────────

    async def broadcast_order_event(self, order_id: int, event: dict[str, Any]) -> None:
        """
        Send an event to all WebSocket clients watching `order_id`
        AND to all global listeners.
        """
        payload = json.dumps(event, default=str)

        targets: set[WebSocket] = set()
        async with self._lock:
            targets.update(self._connections.get(order_id, set()))
            targets.update(self._global_connections)

        dead: list[tuple[int | None, WebSocket]] = []
        for ws in targets:
            try:
                await ws.send_text(payload)
            except Exception:
                # Client disconnected mid-flight — collect for cleanup.
                dead.append((order_id, ws))

        for oid, ws in dead:
            await self.disconnect_order(oid, ws)
            await self.disconnect_global(ws)

    async def broadcast_global(self, event: dict[str, Any]) -> None:
        """Send to global listeners only (e.g. order list updates)."""
        payload = json.dumps(event, default=str)
        async with self._lock:
            targets = set(self._global_connections)
        for ws in targets:
            try:
                await ws.send_text(payload)
            except Exception:
                await self.disconnect_global(ws)


# Singleton — imported wherever broadcast is needed.
ws_manager = WebSocketManager()
