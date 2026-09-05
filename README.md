# Real-Time Order Processing System

A **production-style, full-stack learning application** demonstrating how a modern Angular 21 frontend communicates with an event-driven Python backend through REST, WebSocket, Apache Kafka, and the Transactional Outbox Pattern.

<img src="img/complete_order_websocket.png" width="90%" />

```
Angular 21  ──REST──▶  FastAPI  ──▶  PostgreSQL
    │                                    │
    │                            Transactional Outbox
    │                                    │
    ◀─────────WebSocket─────────  Outbox Worker  ──▶  Kafka
                                          │
                              ┌───────────┴────────────┐
                              ▼                        ▼
                        Order Worker           Notification Worker
                              │
                         PostgreSQL
                              │
                         Status Event  ──▶  WebSocket  ──▶  Angular UI
```

The user creates an order and watches it transition from **PENDING → PROCESSING → COMPLETED** in the browser without refreshing.

---

## Quick Start

1. Create .env
2. Then put this into .env:
```
POSTGRES_USER=orderuser
POSTGRES_PASSWORD=orderpassword
POSTGRES_DB=orderdb
DATABASE_URL=postgresql+asyncpg://orderuser:orderpassword@postgres:5432/orderdb
DATABASE_URL_SYNC=postgresql://orderuser:orderpassword@postgres:5432/orderdb
KAFKA_BOOTSTRAP_SERVERS=kafka:9092
ENVIRONMENT=development
```
3. If package-lock.json is not present inside frontend folder. 
```
cd frontend
npm i
```
4. Start everything
```
# Validate Compose
docker compose config

# Build + start
docker compose up --build 
or
docker compose build
docker compose up
```

| Command                     |                  Build image | Start containers |
| --------------------------- | ---------------------------: | ---------------: |
| `docker compose build`      |                            ✅ |                ❌ |
| `docker compose up`         | Usually uses existing images |                ✅ |
| `docker compose up --build` |                            ✅ |                ✅ |

4. Open the app

| Component       | URL                                                          |
| --------------- | ------------------------------------------------------------ |
| Angular         | [http://localhost:4200](http://localhost:4200)               |
| Kafka UI        | [http://localhost:8080](http://localhost:8080)               |
| FastAPI Swagger | [http://localhost:8000/docs](http://localhost:8000/docs)     |
| FastAPI Health  | [http://localhost:8000/health](http://localhost:8000/health) |
| PostgreSQL      | localhost:5432                                               |
| Kafka           | localhost:9092                                               |

Note : Don't open localhost:5432 in Chrome. PostgreSQL does not speak HTTP.

5. Rebuild + start again
```
docker compose down -v
docker compose up --build
```

**No local Node.js, Python, PostgreSQL, or Kafka installation required.**

6. You will see, The outbox-worker is repeatedly polling PostgreSQL:
Docker continuously showing logs is normal. Your outbox-worker is designed as a long-running worker and will keep polling PostgreSQL every few seconds.

What you're seeing:
```
SELECT ... FROM outbox_events
WHERE status = 'PENDING'
...
ROLLBACK
```
means:
```
"Check whether there are any new PENDING events."
```
Since both events are already:
```
1 → PUBLISHED
2 → PUBLISHED
```
there is nothing for the outbox worker to process, so it waits and checks again.

That means:
```
Outbox Worker
     │
     ▼
Check PostgreSQL
     │
     ▼
Are there PENDING events?
     │
     ├── YES → publish to Kafka → mark as published
     │
     └── NO  → wait → check again
                    │
                    └── repeat
```
So the terminal will not return to the PowerShell prompt because the worker is designed to run continuously.

7. Check DB - See it directly from Docker

You don't need any GUI just to verify it.
```
docker compose exec postgres psql -U orderuser -d orderdb
```
Then:
```
\dt
```
This shows your tables.

For example:
```
        List of relations
 Schema |     Name      | Type  |   Owner
--------+---------------+-------+----------
 public | orders        | table | orderuser
 public | order_items   | table | orderuser
```
To see the data:
```
SELECT * FROM orders;
```
To see the database:
```
\l
```
To see the tables' structure:
```
\d orders
```

8. If you chec DB table through UI

**Option 1 — pgAdmin**

Install/open pgAdmin, then create a server connection:
```
Host:     localhost
Port:     5432
Database: orderdb
Username: orderuser
Password: orderpassword
```
After connecting:
```
Servers
 └── PostgreSQL
      └── Databases
           └── orderdb
                ├── Schemas
                │    └── public
                │         └── Tables
                │              ├── orders
                │              ├── order_items
                │              └── ...
                └── ...
```
You can then right-click a table → View/Edit Data.

**Option 2 — DBeaver**

DBeaver is also very good for development.

Connection:
```
Host: localhost
Port: 5432
Database: orderdb
User: orderuser
Password: orderpassword
```

| Service         | Expected behavior                              |
| --------------- | ---------------------------------------------- |
| `outbox-worker` | ♻️ Runs forever, repeatedly polls DB           |
| `order-worker`  | ♻️ Runs forever, waits/consumes Kafka messages |
| `notif-worker`  | ♻️ Runs forever, waits/consumes Kafka messages |
| `api`           | 🌐 Runs forever, serves HTTP requests          |
| `postgres`      | 🗄️ Runs forever                               |
| `kafka`         | 📨 Runs forever                                |

## Make change in the code - Check the Steps
Rebuild full application root, run:
```
docker compose up -d --build
```

Rebuild and restart only the api service
```
docker compose up -d --build api
```

if you have changed both API and worker code
```
docker compose up -d --build api worker
```

**Recommended sequence**
```
# 1. Stop existing containers
docker compose down

# 2. Rebuild images with your latest code
docker compose build

# 3. Start everything
docker compose up -d
```

Or simply do it in one command:
```
docker compose up -d --build
```

---

## Check Status of Particular Oder
```
docker exec -it order-processing-system-postgres-1 psql -U orderuser -d orderdb -c "SELECT id, order_id, event_type, status, created_at FROM order_events WHERE order_id = 9 ORDER BY created_at;"
```

 id | order_id |    event_type     |   status   |          created_at
----+----------+-------------------+------------+-------------------------------
 33 |        9 | OrderCreated      | PENDING    | 2026-09-05 13:27:39.237189+00
 34 |        9 | ProcessingStarted | PROCESSING | 2026-09-05 13:27:41.356493+00
 35 |        9 | OrderCompleted    | COMPLETED  | 2026-09-05 13:27:42.520761+00
(3 rows)

## After creating order -  your flow becomes:
```
                 CREATE ORDER
                      │
                      ▼
              OrderCreated/PENDING
                      │
                      ▼
                  Kafka
                      │
                      ▼
              Background Worker
                      │
             ┌────────┴────────┐
             ▼                 ▼
        PostgreSQL         WebSocket
             │                 │
             │          ProcessingStarted
             │          status=PROCESSING
             │                 │
             │                 ▼
             │          Angular Signal
             │                 │
             │                 ▼
             │          Progress = 50%
             │
             ▼
          COMPLETED
             │
             ├──────────────► WebSocket
             │                OrderCompleted
             │                status=COMPLETED
             │                     │
             │                     ▼
             │               Angular Signal
             │                     │
             │                     ▼
             │               Progress = 100%
```
So the UI should visibly transition:
> **PENDING → PROCESSING → COMPLETED**

## Why your logs look different

**For `outbox-worker`, you're seeing:**
```
SELECT ... FROM outbox_events
WHERE status = 'PENDING'
...
ROLLBACK
```
That is normal.

**It means:**
```
outbox-worker
     ↓
Check DB for PENDING events
     ↓
No new events
     ↓
sleep
     ↓
Check again
     ↓
No new events
     ↓
sleep
     ↓
...
```
So it should not stop.

**`order-worker` is different**

**You should see something like:**
```
Order worker started, waiting for messages...
Subscribed to topic order.created
Joined group 'order-worker-group'
Successfully synced group
Setting newly assigned partitions...
```

**And then it may appear to do nothing:**
```
Order worker started, waiting for messages...
Joined group...
Assigned partitions...
```
That's also normal.

**It is essentially doing:**
```
order-worker
     ↓
WAIT for Kafka message
     ↓
WAIT...
     ↓
WAIT...
     ↓
Kafka message arrives
     ↓
process order
     ↓
WAIT again
     ↓
...
```

**It doesn't need to continuously print:**
```
Consuming...
Consuming...
Consuming...
```
unless you explicitly add logging for that.

## Kafka → worker → PostgreSQL → frontend real-time update flow
```
Angular
   │
   │ POST /orders
   ▼
FastAPI
   │
   │ save order = PENDING
   ▼
PostgreSQL
   │
   │ Outbox record
   ▼
Outbox Worker
   │
   │ Kafka event
   ▼
Kafka
   │
   ▼
Order Worker
   │
   │ update DB
   ▼
PostgreSQL
   │
   │ PROCESSING / COMPLETED
   ▼
WebSocket / polling
   │
   ▼
Angular
```

## Architecture Overview
```
Angular 21
   │
   │ POST /orders
   ▼
FastAPI
   │
   ├── orders → PENDING
   └── outbox_events → PENDING
                 │
                 ▼
           outbox-worker
                 │
                 ▼
              Kafka
          order.created
                 │
                 ▼
           order-worker
                 │
       ┌─────────┴─────────┐
       ▼                   ▼
  PROCESSING           COMPLETED
       │                   │
       └─────────┬─────────┘
                 ▼
             PostgreSQL
```
**And your supporting tables give you:**
```
orders
    └── current state

order_events
    └── state/event history

outbox_events
    └── reliable Kafka publishing

processed_events
    └── idempotency / duplicate protection
```
<img src="img/DBeaver_DB_Table.png" width="90%" />
<img src="img/DBeaver_DB_Table_Order_Completed.png" width="90%" />

### Overall Architecture

```mermaid
flowchart LR
    Angular -->|REST POST /orders| FastAPI
    Angular <-->|WebSocket /ws/orders/id| FastAPI
    FastAPI -->|INSERT order + outbox event| PostgreSQL
    PostgreSQL -->|Poll PENDING outbox events| OutboxWorker
    OutboxWorker -->|Publish order.created| Kafka
    Kafka -->|Consume order.created| OrderWorker
    OrderWorker -->|UPDATE PROCESSING/COMPLETED| PostgreSQL
    OrderWorker -->|Publish order.processed| Kafka
    Kafka -->|Consume order.processed| NotificationWorker
    FastAPI -->|broadcast_order_event| Angular
```

### Event Flow Sequence

```mermaid
sequenceDiagram
    participant UI as Angular 21
    participant API as FastAPI
    participant DB as PostgreSQL
    participant O as Outbox Worker
    participant K as Kafka
    participant W as Order Worker
    participant N as Notification Worker

    UI->>API: POST /api/v1/orders
    API->>DB: BEGIN TRANSACTION
    API->>DB: INSERT order (status=PENDING)
    API->>DB: INSERT outbox_event (status=PENDING)
    DB-->>API: COMMIT
    API-->>UI: 201 { status: "PENDING" }

    Note over UI: Opens WebSocket /ws/orders/{id}

    O->>DB: SELECT * FROM outbox_events WHERE status='PENDING'
    O->>K: Publish order.created (key=order_id)
    O->>DB: UPDATE outbox_events SET status='PUBLISHED'

    K->>W: Consume order.created
    W->>DB: Check processed_events (idempotency)
    W->>DB: UPDATE orders SET status='PROCESSING'
    W-->>UI: WebSocket { event_type: "OrderStatusChanged", status: "PROCESSING" }

    Note over UI: Status badge updates: PENDING → PROCESSING

    W->>DB: UPDATE orders SET status='COMPLETED'
    W->>K: Publish order.processed

    W-->>UI: WebSocket { event_type: "OrderStatusChanged", status: "COMPLETED" }

    Note over UI: Status badge updates: PROCESSING → COMPLETED

    K->>N: Consume order.processed
    N->>DB: INSERT order_events (NotificationSent)
    N->>K: Publish notification.requested
```

### Database Schema

```mermaid
erDiagram
    orders {
        bigint id PK
        int customer_id
        enum status
        numeric total_amount
        int retry_count
        timestamp created_at
        timestamp updated_at
    }
    order_items {
        bigint id PK
        bigint order_id FK
        string product_id
        int quantity
        numeric price
    }
    outbox_events {
        bigint id PK
        string event_id UK
        string event_type
        string aggregate_type
        string aggregate_id
        json payload
        enum status
        timestamp created_at
        timestamp published_at
    }
    processed_events {
        bigint id PK
        string event_id
        string consumer_name
        timestamp processed_at
    }
    order_events {
        bigint id PK
        bigint order_id FK
        string event_type
        string status
        json payload
        timestamp created_at
    }
    orders ||--o{ order_items : "has"
    orders ||--o{ order_events : "logs"
```

---

## Project Structure

```
.
├── backend/
│   ├── app/
│   │   ├── main.py              # FastAPI app, lifespan, CORS
│   │   ├── config.py            # Pydantic Settings
│   │   ├── database.py          # SQLAlchemy async engine + session
│   │   ├── models.py            # ORM models (Order, OrderItem, Outbox, etc.)
│   │   ├── schemas.py           # Pydantic v2 request/response schemas
│   │   ├── kafka_client.py      # Shared aiokafka producer + topic constants
│   │   ├── websocket_manager.py # In-process WebSocket broadcast manager
│   │   └── routers/
│   │       ├── orders.py        # REST: POST/GET/RETRY orders
│   │       ├── dashboard.py     # GET /dashboard/stats
│   │       └── websocket.py     # WS: /ws/orders, /ws/orders/{id}
│   ├── workers/
│   │   ├── outbox_worker.py     # Polls DB → publishes to Kafka
│   │   ├── order_worker.py      # Consumes order.created → PROCESSING/COMPLETED
│   │   └── notification_worker.py # Consumes order.processed → sends notification
│   ├── alembic/                 # Database migrations
│   ├── tests/
│   │   ├── conftest.py          # Pytest fixtures (in-memory SQLite, HTTPX client)
│   │   └── test_orders.py       # API endpoint + unit tests
│   ├── Dockerfile
│   ├── requirements.txt
│   └── pytest.ini
│
├── frontend/
│   └── src/app/
│       ├── core/
│       │   ├── models/          # TypeScript interfaces
│       │   ├── services/        # ApiService, WebSocketService, NotificationService
│       │   └── interceptors/    # HTTP error interceptor
│       ├── features/
│       │   ├── dashboard/       # Dashboard with stats + recent orders
│       │   ├── orders/
│       │   │   ├── pages/       # OrderList, OrderDetail, CreateOrder
│       │   │   └── store/       # OrderStore (Signals + RxJS)
│       │   └── events/          # Live event log page
│       ├── shared/
│       │   ├── components/      # ToastComponent
│       │   └── pipes/           # StatusBadgePipe, StatusProgressPipe
│       ├── app.routes.ts        # Lazy-loaded routes
│       └── app.config.ts        # Application providers
│
├── docker-compose.yml
├── .env.example
└── README.md
```

---

## API Reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/v1/orders` | Create a new order |
| `GET` | `/api/v1/orders` | List orders (paginated, filterable) |
| `GET` | `/api/v1/orders/{id}` | Get order with items + events |
| `POST` | `/api/v1/orders/{id}/retry` | Retry a FAILED order |
| `GET` | `/api/v1/orders/{id}/events` | Get event timeline |
| `GET` | `/api/v1/dashboard/stats` | Dashboard statistics |
| `GET` | `/health` | Deep health check |
| `WS` | `/ws/orders` | Global order event stream |
| `WS` | `/ws/orders/{id}` | Per-order event stream |

---

## Kafka Topics

| Topic | Producer | Consumer | Description |
|-------|----------|----------|-------------|
| `order.created` | Outbox Worker | Order Worker | New orders ready to process |
| `order.processed` | Order Worker | Notification Worker | Successfully processed orders |
| `order.failed` | Order Worker | — | Failed orders (audit) |
| `notification.requested` | Notification Worker | — | Notification audit trail |
| `order.created.dlq` | Order Worker | — | Dead-letter queue (max retries) |

**Message key = `order_id`** — ensures all events for the same order land on the same Kafka partition, guaranteeing ordering.

---

## Running Tests

### Backend

```bash
cd backend

# Install application and test dependencies
pip install -r requirements-dev.txt

# Run all tests
pytest

# Run tests with coverage
pytest --cov=app --cov-report=term-missing
```

The backend test suite uses `aiosqlite` for the in-memory SQLite test database.

### Frontend

```bash
cd frontend

# Install dependencies from package-lock.json
npm ci

# Run unit tests
npm test

# Run tests with coverage
npm run test:coverage
```

### Test Coverage

Backend coverage:

```text
pytest --cov=app --cov-report=term-missing
```

Frontend coverage:

```text
npm run test:coverage
```

Coverage reports help verify that the API, business logic, services, components, and other critical application paths are adequately tested.

---

## Services & Ports

| Service | URL | Description |
|---------|-----|-------------|
| Angular UI | http://localhost:4200 | Frontend application |
| FastAPI | http://localhost:8000 | REST API + WebSocket |
| FastAPI Docs | http://localhost:8000/docs | Swagger UI |
| Kafka UI | http://localhost:8080 | Kafka topic/message browser |
| PostgreSQL | localhost:5432 | Database (dev access) |
| Kafka | localhost:9092 | Kafka broker |

---

## Key Design Decisions

### Why KRaft Kafka (no Zookeeper)?

Kafka 3.7 supports KRaft mode — Kafka manages its own metadata without Zookeeper. Simpler to run in Docker (one less service, no port 2181 to manage).

### Why asyncpg (not psycopg2)?

asyncpg is a native async PostgreSQL driver. It never blocks the event loop during DB queries, allowing FastAPI to handle thousands of concurrent requests on a single thread.

### Why `SKIP LOCKED` in the Outbox Worker?

```sql
SELECT * FROM outbox_events WHERE status='PENDING'
FOR UPDATE SKIP LOCKED
```

If you run multiple outbox worker instances, `FOR UPDATE` prevents two workers from publishing the same event. `SKIP LOCKED` means other workers skip rows already locked by a peer — they pick the next available row instead of waiting.

### Why message key = `order_id`?

Kafka routes messages with the same key to the same partition. This guarantees that for order #1001:
- `order.created` event
- `order.processed` event

...are always consumed **in order** by the same consumer instance. Without this, `COMPLETED` could arrive before `PROCESSING` if they land on different partitions with different consumer lag.
