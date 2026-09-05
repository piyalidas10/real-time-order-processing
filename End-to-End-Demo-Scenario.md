# End-to-End Demo Scenario

This demo demonstrates an event-driven order-processing system using:

* Angular
* FastAPI
* PostgreSQL
* Kafka
* Transactional Outbox
* Background Workers
* WebSocket
* Angular Signals + RxJS
* Docker Compose

The complete flow is:

```text
Angular
   │
   │ HTTP POST
   ▼
FastAPI
   │
   ▼
PostgreSQL
   │
   │ Outbox Event
   ▼
Outbox Worker
   │
   ▼
Kafka
   │
   │ order.created
   ▼
Order Worker
   │
   ├── PENDING → PROCESSING
   │
   ├── business processing
   │
   └── PROCESSING → COMPLETED
   │
   │ order.status.changed
   ▼
Kafka
   │
   ▼
WebSocket Bridge
   │
   ▼
WebSocket
   │
   ▼
Angular
   │
   ▼
Signal
   │
   ▼
Real-time UI
```

---

# Step 1: Start the Application

From the project root:

```bash
docker compose up --build
```

This starts the application services, including:

```text
Angular
FastAPI
PostgreSQL
Kafka
Outbox Worker
Order Worker
Kafka UI
```

Depending on the Docker configuration, give Kafka and the workers some time to initialize.

You can check the service status with:

```bash
docker compose ps
```

All required services should be running.

To monitor the API and workers:

```bash
docker compose logs -f api order-worker
```

You should eventually see messages indicating that the Kafka/WebSocket bridge is running, such as:

```text
Kafka status consumer started:
topic=order.status.changed
group_id=order-websocket-broadcaster

Order status WebSocket bridge started
```

---

# Step 2: Open the Angular UI

Open:

```text
http://localhost:4200
```

The Angular application displays the order dashboard.

---

# Step 3: Open Kafka UI

Open Kafka UI in another browser tab:

```text
http://localhost:8080
```

Kafka UI allows you to observe:

* Kafka topics
* Messages
* Consumer groups
* Consumer offsets
* Consumer lag

For this demo, the most important topics are:

```text
order.created
order.status.changed
```

---

# Step 4: Create an Order

From the Angular application:

1. Click **"➕ New Order"**.
2. Enter Customer ID:

```text
101
```

3. Add a product:

```text
Product: PROD-001
Quantity: 2
Price: 499.50
```

4. Click **"📦 Create Order"**.

The browser sends:

```http
POST /api/v1/orders
```

to FastAPI.

FastAPI creates the order in PostgreSQL.

The initial state is:

```text
PENDING
```

The user is then redirected to the Order Detail page.

---

# Step 5: Order Starts in PENDING

Immediately after creation, the Order Detail page displays:

```text
Status: PENDING
```

The status timeline initially looks like:

```text
● Pending
│
○ Processing
│
○ Completed
```

The database contains the order with:

```text
status = PENDING
```

and the corresponding `OrderCreated` event/outbox event.

---

# Step 6: Outbox Worker Publishes the OrderCreated Event

The Outbox Worker reads the unprocessed event from PostgreSQL:

```text
outbox_events
       │
       ▼
Outbox Worker
       │
       ▼
Kafka
```

The event is published to:

```text
order.created
```

A message is conceptually similar to:

```json
{
  "event_id": "550e8400-...",
  "event_type": "OrderCreated",
  "event_version": 1,
  "occurred_at": "2026-09-05T14:42:44Z",
  "order_id": 13,
  "customer_id": 101,
  "total_amount": 999.00
}
```

The important architecture point is:

```text
FastAPI
   ↓
PostgreSQL
   ↓
Outbox Worker
   ↓
Kafka
```

FastAPI does **not** wait for the Order Worker to finish processing.

---

# Step 7: Order Worker Processes the Order

The Order Worker consumes:

```text
Kafka
  │
  │ order.created
  ▼
Order Worker
```

It receives the `OrderCreated` event and begins processing.

The order status changes:

```text
PENDING
   ↓
PROCESSING
```

The worker records the processing event:

```text
ProcessingStarted
status = PROCESSING
```

Then it publishes a status event to:

```text
order.status.changed
```

For example:

```json
{
  "event_type": "ProcessingStarted",
  "order_id": 13,
  "status": "PROCESSING",
  "timestamp": "2026-09-05T14:42:45.544400+00:00"
}
```

---

# Step 8: WebSocket Updates the Angular UI

This is the real-time part of the application.

The Angular Order Detail page maintains a WebSocket connection:

```text
ws://localhost:8000/ws/orders/13
```

The FastAPI WebSocket bridge consumes:

```text
Kafka
   │
   │ order.status.changed
   ▼
WebSocket Event Consumer
   │
   ▼
WebSocket Manager
   │
   ▼
Browser
```

Angular receives:

```json
{
  "event_type": "ProcessingStarted",
  "order_id": 13,
  "status": "PROCESSING"
}
```

The Angular component updates its Signal:

```text
order.status
     ↓
PROCESSING
```

Angular automatically updates the UI.

The user sees:

```text
● Pending
│
● Processing
│
○ Completed
```

**No page refresh is required.**

---

# Step 9: Order Processing Completes

The Order Worker finishes processing the order.

The database status changes:

```text
PROCESSING
     ↓
COMPLETED
```

The worker creates/publishes:

```text
OrderCompleted
status = COMPLETED
```

to:

```text
order.status.changed
```

The Kafka message looks like:

```json
{
  "event_type": "OrderCompleted",
  "order_id": 13,
  "status": "COMPLETED",
  "timestamp": "2026-09-05T14:42:47.686500+00:00"
}
```

---

# Step 10: Angular Receives COMPLETED

The WebSocket bridge consumes the Kafka event:

```text
Kafka
  │
  ▼
WebSocket Bridge
  │
  ▼
WebSocket
  │
  ▼
Angular WebSocketService
  │
  ▼
RxJS Observable
  │
  ▼
OrderDetailComponent
  │
  ▼
Angular Signal
```

The Signal changes:

```text
PROCESSING
     ↓
COMPLETED
```

The UI automatically becomes:

```text
● Pending
│
● Processing
│
● Completed
```

The progress bar reaches 100%.

---

# Step 11: Observe the Complete Real-Time Timeline

For example, Order #13 may show:

```text
14:42:44  OrderCreated
          status → PENDING

14:42:45  ProcessingStarted
          status → PROCESSING

14:42:47  OrderCompleted
          status → COMPLETED
```

The important point is that the status changes are pushed to the browser through WebSocket.

The user does **not** need to click Refresh.

---

# Step 12: Observe Kafka Messages

Open:

```text
http://localhost:8080
```

Navigate to:

```text
Topics
   ↓
order.created
   ↓
Messages
```

You should see the `OrderCreated` event published by the Outbox Worker.

Then inspect:

```text
Topics
   ↓
order.status.changed
   ↓
Messages
```

You should see events such as:

### ProcessingStarted

```json
{
  "event_type": "ProcessingStarted",
  "order_id": 13,
  "status": "PROCESSING"
}
```

### OrderCompleted

```json
{
  "event_type": "OrderCompleted",
  "order_id": 13,
  "status": "COMPLETED"
}
```

This demonstrates that Kafka is the communication layer between independent backend processes.

---

# Step 13: Observe Consumer Groups

In Kafka UI, open:

```text
Consumer Groups
```

The important consumer groups include:

```text
order-worker-group
order-websocket-broadcaster
```

### `order-worker-group`

This group consumes:

```text
order.created
```

and is responsible for processing orders.

### `order-websocket-broadcaster`

This group consumes:

```text
order.status.changed
```

and bridges Kafka events to WebSocket clients.

When everything is healthy, consumer lag should normally return to:

```text
0
```

after the messages have been processed.

---

# Step 14: Observe the WebSocket

Open the browser Developer Tools:

```text
F12
   ↓
Console
```

When opening Order #13, you should see:

```text
[WS] Connecting to ws://localhost:8000/ws/orders/13

[WS] OPEN: ws://localhost:8000/ws/orders/13

[WS] MESSAGE:
{
  event_type: 'Connected',
  order_id: 13
}
```

Then, while the order is processing:

```text
[WS] MESSAGE:
{
  event_type: 'ProcessingStarted',
  order_id: 13,
  status: 'PROCESSING'
}
```

And finally:

```text
[WS] MESSAGE:
{
  event_type: 'OrderCompleted',
  order_id: 13,
  status: 'COMPLETED'
}
```

This proves that the real-time path is working:

```text
Order Worker
     ↓
Kafka
     ↓
WebSocket Bridge
     ↓
WebSocket
     ↓
Angular
```

---

# Step 15: Test the Retry / Backlog Flow

This demonstrates why the Order Worker is independent of the API.

First stop the Order Worker:

```bash
docker compose stop order-worker
```

Now create another order from Angular.

The order should remain:

```text
PENDING
```

because the Order Worker is not consuming the `order.created` messages.

Check Kafka:

```text
order.created
```

The event remains available for the consumer.

Now restart the worker:

```bash
docker compose start order-worker
```

The Order Worker reconnects to Kafka and consumes the pending message.

The order then progresses:

```text
PENDING
   ↓
PROCESSING
   ↓
COMPLETED
```

The status changes are again delivered to Angular through WebSocket.

This demonstrates **asynchronous processing and Kafka-backed recovery from temporary worker unavailability**.

---

# Step 16: Understand the Complete Demo

The entire order lifecycle can be summarized as:

```text
                 USER
                  │
                  │ Create Order
                  ▼
              Angular
                  │
                  │ HTTP
                  ▼
              FastAPI
                  │
                  ▼
             PostgreSQL
             PENDING
                  │
                  │ Outbox Event
                  ▼
           Outbox Worker
                  │
                  │ publish
                  ▼
                Kafka
           order.created
                  │
                  ▼
            Order Worker
                  │
                  ▼
             PROCESSING
                  │
                  │ publish status
                  ▼
                Kafka
        order.status.changed
                  │
                  ▼
       WebSocket Event Consumer
                  │
                  ▼
            WebSocket
                  │
                  ▼
              Angular
                  │
                  ▼
           Signal Update
                  │
                  ▼
         UI → PROCESSING
                  │
                  │
            Worker finishes
                  │
                  ▼
              COMPLETED
                  │
                  │ publish status
                  ▼
                Kafka
                  │
                  ▼
       WebSocket Event Consumer
                  │
                  ▼
            WebSocket
                  │
                  ▼
              Angular
                  │
                  ▼
           Signal Update
                  │
                  ▼
         UI → COMPLETED
```

---

# What This Demo Proves

This single demo demonstrates several important production-oriented concepts:

### 1. Transactional Outbox

```text
PostgreSQL → Outbox → Kafka
```

Prevents the database/Kafka dual-write problem.

### 2. Asynchronous Processing

```text
FastAPI → Kafka → Order Worker
```

The HTTP request does not wait for long-running processing.

### 3. Independent Worker Scaling

The Order Worker can be scaled independently from FastAPI.

### 4. Kafka Consumer Idempotency

Previously processed events can be detected and skipped.

### 5. Real-Time Communication

```text
Kafka → WebSocket Bridge → Angular
```

delivers status changes without polling or page refresh.

### 6. RxJS + Signals

```text
WebSocket Observable
        ↓
       RxJS
        ↓
     Signal
        ↓
       UI
```

RxJS handles the asynchronous event stream while Signals represent the current UI state.

### 7. Fault Tolerance

Stopping the Order Worker does not lose the Kafka event. When the worker returns, it can consume the pending event and continue processing.

---

# Final Status Flow

The most visible part of the demo is:

```text
┌───────────┐
│  PENDING  │
└─────┬─────┘
      │
      │ Order Worker starts
      ▼
┌──────────────┐
│  PROCESSING  │
└──────┬───────┘
       │
       │ Order Worker finishes
       ▼
┌──────────────┐
│  COMPLETED   │
└──────────────┘
```

And the real-time delivery path is:

```text
Order Worker
     │
     │ Kafka
     ▼
order.status.changed
     │
     ▼
FastAPI WebSocket Bridge
     │
     │ WebSocket
     ▼
Angular WebSocketService
     │
     │ RxJS
     ▼
Angular Signal
     │
     ▼
Status Badge + Progress Bar
```

**The result:** the user creates an order once, and the UI automatically moves from **PENDING → PROCESSING → COMPLETED** in real time without refreshing the page.
