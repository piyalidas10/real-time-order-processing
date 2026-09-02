# Real-Time Order Processing System — Complete

The entire application is in place with **21 Python files** and **24 TypeScript files**, all syntax-validated, all imports resolving correctly.

---

## Backend (`backend/`)

| File | Purpose |
|------|---------|
| [`app/main.py`](backend/app/main.py) | FastAPI app, lifespan (Kafka + DB startup), CORS |
| [`app/models.py`](backend/app/models.py) | SQLAlchemy 2.x ORM: `orders`, `order_items`, `outbox_events`, `processed_events`, `order_events` |
| [`app/schemas.py`](backend/app/schemas.py) | Pydantic v2 request/response contracts |
| [`app/kafka_client.py`](backend/app/kafka_client.py) | aiokafka producer, topic constants, `order_id` as message key |
| [`app/websocket_manager.py`](backend/app/websocket_manager.py) | In-process WebSocket broadcast (per-order + global channels) |
| [`app/routers/orders.py`](backend/app/routers/orders.py) | POST/GET orders, retry, transactional outbox write |
| [`workers/outbox_worker.py`](backend/workers/outbox_worker.py) | Polls `outbox_events` → publishes to Kafka (`SKIP LOCKED`) |
| [`workers/order_worker.py`](backend/workers/order_worker.py) | Consumes `order.created` → PROCESSING → COMPLETED, idempotency, retry+DLQ |
| [`workers/notification_worker.py`](backend/workers/notification_worker.py) | Consumes `order.processed` → simulates notification |
| [`tests/test_orders.py`](backend/tests/test_orders.py) | 16 Pytest+HTTPX tests covering API, validation, outbox, idempotency |

---

## Frontend (`frontend/src/app/`)

| File | Purpose |
|------|---------|
| [`app.routes.ts`](frontend/src/app/app.routes.ts) | 5 lazy-loaded routes with `loadComponent()` |
| [`app.config.ts`](frontend/src/app/app.config.ts) | `provideRouter` + `provideHttpClient` + error interceptor |
| [`core/services/api.service.ts`](frontend/src/app/core/services/api.service.ts) | All REST calls, base URL from `environment` |
| [`core/services/websocket.service.ts`](frontend/src/app/core/services/websocket.service.ts) | WebSocket with exponential back-off reconnection, `share()`, `retry()` |
| [`features/orders/store/order.store.ts`](frontend/src/app/features/orders/store/order.store.ts) | Signals: `orders`, `selectedOrder`, `loading`, `error`; computed: `processingOrders`, `completedOrders` |
| [`features/orders/pages/order-detail/`](frontend/src/app/features/orders/pages/order-detail/order-detail.component.ts) | **Core demo**: WS events → signal updates, live status + progress bar + timeline |
| [`features/orders/pages/create-order/`](frontend/src/app/features/orders/pages/create-order/create-order.component.ts) | Reactive Forms + `FormArray`, typed validators |
| [`features/events/events.component.ts`](frontend/src/app/features/events/events.component.ts) | Live event log using `scan()` operator |

---

## Infrastructure

| File | Purpose |
|------|---------|
| [`docker-compose.yml`](docker-compose.yml) | 8 services: postgres, kafka (KRaft), kafka-ui, api, outbox-worker, order-worker, notif-worker, frontend |
| [`frontend/nginx.conf`](frontend/nginx.conf) | SPA fallback, `/api` + `/ws` proxy to FastAPI |
| [`frontend/Dockerfile`](frontend/Dockerfile) | Multi-stage: Node build → Nginx (~25 MB final image) |
| [`alembic/versions/0001_initial_schema.py`](backend/alembic/versions/0001_initial_schema.py) | Full DB migration: all 5 tables, indexes, constraints |

---

## The Core Learning Flow

```
User clicks Create Order
         │
POST /api/v1/orders           (Angular → FastAPI)
         │
BEGIN TRANSACTION
  INSERT order (PENDING)
  INSERT outbox_event           ← Same transaction
COMMIT
         │
Return { status: "PENDING" }  → Angular opens WebSocket /ws/orders/{id}
         │
Outbox Worker polls DB
  → Publishes order.created to Kafka
         │
Order Worker consumes
  → DB: PENDING → PROCESSING
  → WebSocket broadcast: { status: "PROCESSING" }
  → Angular badge auto-updates (no refresh)
         │
  → DB: PROCESSING → COMPLETED
  → WebSocket broadcast: { status: "COMPLETED" }
  → Angular badge auto-updates (no refresh)
```