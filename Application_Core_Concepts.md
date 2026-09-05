# Core Concepts Explained

## Why the Transactional Outbox Pattern?

### The dual-write problem

When an order is created, the application needs to:

1. Save the order in PostgreSQL.
2. Publish an `OrderCreated` event so that the order can be processed asynchronously.

A dangerous implementation would be:

```python
# ❌ DANGEROUS — two independent operations

db.add(order)
await db.commit()

await kafka.publish(
    "order.created",
    order_data
)
```

Imagine this sequence:

```text
PostgreSQL COMMIT
       ↓
Order successfully saved
       ↓
Application crashes
       ↓
Kafka publish never happens
```

Now PostgreSQL contains:

```text
Order #13
status = PENDING
```

but Kafka never receives:

```text
OrderCreated
```

The Order Worker never receives the order.

The order can therefore remain stuck in `PENDING`.

---

## The fix — Transactional Outbox

The application stores the order and an outbox event in the **same PostgreSQL transaction**:

```python
# ✅ SAFE — both records are committed atomically

order = Order(
    status=OrderStatus.PENDING
)

outbox_event = OutboxEvent(
    event_type="OrderCreated",
    payload=order_data
)

db.add(order)
db.add(outbox_event)

await db.commit()
```

The transaction guarantees:

```text
┌───────────────────────────────────────┐
│ PostgreSQL Transaction                │
│                                       │
│  INSERT orders                        │
│  INSERT outbox_events                 │
│                                       │
│             COMMIT                    │
└───────────────────────────────────────┘
```

Either:

```text
Order + Outbox Event
        ↓
      COMMIT
```

or:

```text
Nothing is committed
```

There is no situation where the order is committed but the corresponding outbox event is lost.

### What does the Outbox Worker do?

The **Outbox Worker** continuously looks for unprocessed outbox events:

```text
PostgreSQL
    │
    │ unprocessed outbox event
    ▼
Outbox Worker
    │
    │ publish
    ▼
Kafka
    │
    ▼
order.created
```

After successful publication, the outbox record can be marked as processed.

Therefore:

> **Outbox Worker = reliable PostgreSQL → Kafka bridge**

The Outbox Worker does **not** process the order itself.

---

# Why is the Order Worker separate from the Outbox Worker?

They solve two different problems.

### Outbox Worker

Its responsibility is:

```text
PostgreSQL
     ↓
Outbox Worker
     ↓
Kafka
```

It answers:

> "How do I reliably get database events into Kafka?"

### Order Worker

Its responsibility is:

```text
Kafka
  ↓
Order Worker
  ↓
Business processing
  ↓
PostgreSQL
```

It answers:

> "What should happen when an order-created event arrives?"

For this application, the Order Worker:

1. Consumes `order.created`.
2. Checks idempotency.
3. Loads the order.
4. Changes status from `PENDING` to `PROCESSING`.
5. Creates the `ProcessingStarted` event.
6. Performs the simulated order-processing work.
7. Changes the order to `COMPLETED`.
8. Creates the `OrderCompleted` event.
9. Publishes status events to Kafka.

The separation allows both workers to scale independently.

---

# Why Idempotency in Kafka Consumers?

Kafka consumers in this application are designed around **at-least-once processing semantics**.

That means a Kafka message can potentially be delivered more than once.

Consider:

```text
Kafka
  │
  │ OrderCreated
  ▼
Order Worker
  │
  │ process order #13
  ▼
COMPLETED
  │
  │
  └── Worker crashes before recording/committing processing state
```

Kafka may deliver the message again:

```text
Kafka
  │
  │ OrderCreated
  ▼
Order Worker
  │
  └── receives duplicate
```

Without idempotency:

```text
Order #13
   ↓
Process
   ↓
COMPLETED

Duplicate message
   ↓
Process AGAIN
```

For a real business system this could cause serious problems such as:

```text
double payment
duplicate shipment
duplicate email
duplicate inventory update
```

---

## Idempotency using processed events

The application maintains processing information so that a previously handled event can be detected.

Conceptually:

```python
if await is_already_processed(
    event_id,
    consumer_name
):
    return

await process_order(event)

await mark_processed(
    event_id,
    consumer_name
)
```

The flow becomes:

```text
Kafka Event
     │
     ▼
Check processed_events
     │
     ├── Already processed ──► Skip
     │
     └── New event
             │
             ▼
        Process Order
             │
             ▼
      Mark Event Processed
```

This makes the Kafka consumer **idempotent**.

---

# Why Separate Workers from the API?

The FastAPI application and background workers have different responsibilities.

| FastAPI API                   | Background Workers               |
| ----------------------------- | -------------------------------- |
| Handles HTTP requests         | Handles Kafka messages           |
| Handles WebSocket connections | Performs asynchronous processing |
| Should respond quickly        | Can take seconds/minutes         |
| Stateless request handling    | Stateful processing workflow     |
| Horizontally scalable         | Independently scalable           |
| User-facing                   | Backend processing               |

For example, creating an order should return quickly:

```text
Angular
   │
   │ POST /api/v1/orders
   ▼
FastAPI
   │
   │ create order
   ▼
PostgreSQL
   │
   ▼
HTTP 201
   │
   ▼
Angular
```

The user does **not** wait for the complete order-processing operation.

Instead:

```text
PENDING
   ↓
PROCESSING
   ↓
COMPLETED
```

happens asynchronously.

---

# Why not process the order inside FastAPI?

Avoid doing this:

```python
@app.post("/orders")
async def create_order():
    create_order()

    # ❌ Long-running work inside HTTP request
    process_order()

    return order
```

This creates several problems:

1. HTTP requests become slow.
2. API workers remain occupied.
3. Long-running processing affects API throughput.
4. Kafka/business-processing failures become coupled to the HTTP request.
5. API and processing workloads cannot scale independently.

Instead:

```text
FastAPI
   │
   │ Create order
   ▼
PostgreSQL
   │
   ▼
Outbox
   │
   ▼
Kafka
   │
   ▼
Order Worker
```

The API is responsible for **accepting the command**.

The worker is responsible for **performing the asynchronous work**.

---

# How WebSocket Fits into the Application

WebSocket has a completely different role from Kafka.

### Kafka

Kafka provides asynchronous communication between backend components:

```text
Outbox Worker
      │
      ▼
    Kafka
      │
      ▼
Order Worker
```

### WebSocket

WebSocket provides real-time communication between the backend and the browser:

```text
FastAPI
   │
   │ WebSocket
   ▼
Angular Browser
```

Therefore, Kafka does **not** directly communicate with Angular.

The final architecture is:

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
Angular
```

---

# Why does the WebSocket Bridge exist?

The Order Worker and FastAPI are separate processes/containers.

The browser's WebSocket connection belongs to the FastAPI process.

For example:

```text
┌──────────────────────────────┐
│ FastAPI Container             │
│                               │
│ WebSocket Manager             │
│                               │
│ Browser ── WebSocket ────────┤
└──────────────────────────────┘


┌──────────────────────────────┐
│ Worker Container              │
│                               │
│ Order Worker                  │
│                               │
│ No browser WebSocket objects  │
└──────────────────────────────┘
```

The Order Worker cannot directly call the FastAPI process's in-memory `ws_manager`.

That was the original problem in this application.

---

# The Kafka → WebSocket Bridge

The solution is a Kafka consumer running inside the FastAPI process:

```text
backend/workers/websocket_event_consumer.py
```

Its responsibility is:

```text
Kafka
  ↓
order.status.changed
  ↓
WebSocket Event Consumer
  ↓
ws_manager
  ↓
WebSocket
  ↓
Angular
```

When the Order Worker publishes:

```json
{
  "event_type": "ProcessingStarted",
  "order_id": 13,
  "status": "PROCESSING"
}
```

the WebSocket bridge consumes it and calls:

```python
await ws_manager.broadcast_order_event(
    13,
    event
)
```

FastAPI then sends the event through:

```text
ws://localhost:8000/ws/orders/13
```

to the browser.

---

# Complete Real-Time Order Flow

The final application therefore works like this:

```text
                 Angular
                    │
                    │ POST /orders
                    ▼
                FastAPI
                    │
                    ▼
              PostgreSQL
                    │
          ┌─────────┴─────────┐
          │                   │
       orders            outbox_events
          │                   │
          └─────────┬─────────┘
                    │
                    ▼
              Outbox Worker
                    │
                    │ publish
                    ▼
                  Kafka
                    │
              order.created
                    │
                    ▼
              Order Worker
                    │
                    ├── PENDING
                    │
                    ├── PROCESSING
                    │
                    └── COMPLETED
                    │
                    │ publish
                    ▼
                  Kafka
                    │
           order.status.changed
                    │
                    ▼
          WebSocket Event Consumer
                    │
                    ▼
              ws_manager
                    │
                    │ WebSocket
                    ▼
                Angular
                    │
                    ▼
             Angular Signal
                    │
                    ▼
                   UI
```

---

# Example: Order #13

The actual successful flow demonstrated by the application was:

```text
Create Order #13
       │
       ▼
PENDING
       │
       │ Order Worker starts processing
       ▼
PROCESSING
       │
       │ Order Worker finishes
       ▼
COMPLETED
```

The browser received:

```text
ProcessingStarted
order_id = 13
status = PROCESSING
```

and then:

```text
OrderCompleted
order_id = 13
status = COMPLETED
```

The Angular UI therefore changed automatically:

```text
PENDING
   ↓
PROCESSING
   ↓
COMPLETED
```

without refreshing the page.

---

# Angular Signals vs RxJS

The application uses both because they solve different problems.

| Signals            | RxJS                   |
| ------------------ | ---------------------- |
| Current UI state   | Event streams          |
| Order state        | WebSocket stream       |
| Loading state      | HTTP streams           |
| Error state        | Retry/reconnection     |
| Selected values    | Filtering events       |
| Derived UI state   | Stream composition     |
| Template rendering | Async event processing |

A useful mental model is:

```text
RxJS
  =
"Events are continuously arriving"

Signal
  =
"What is the current state?"
```

---

# Integration: RxJS WebSocket → Angular Signal

The WebSocket service exposes an Observable:

```typescript
connectOrder(orderId: number): Observable<WebSocketEvent>
```

The Order Detail component subscribes to the stream:

```typescript
this.ws
  .connectOrder(orderId)
  .pipe(
    filter(
      event =>
        event.event_type === 'ProcessingStarted' ||
        event.event_type === 'OrderCompleted' ||
        event.event_type === 'OrderFailed'
    ),
    takeUntilDestroyed()
  )
  .subscribe(event => {

    this.order.update(order =>
      order
        ? {
            ...order,
            status: event.status!,
            updated_at: event.timestamp ?? order.updated_at
          }
        : null
    );
  });
```

The important architectural transition is:

```text
WebSocket
    ↓
RxJS Observable
    ↓
filter()
    ↓
subscribe()
    ↓
Angular Signal
    ↓
Template
```

---

# Why use a Signal for the Order?

The current order is **state**, not an event stream.

Therefore:

```typescript
this.order()
```

represents the current state of the order.

When the WebSocket event arrives:

```typescript
this.order.update(...)
```

changes the Signal.

Angular automatically knows which template expressions depend on that Signal.

For example:

```html
{{ order().status }}
```

and:

```html
[style.width.%]="o.status | statusProgress"
```

are automatically reevaluated when the order Signal changes.

Therefore:

```text
WebSocket Event
      ↓
PROCESSING
      ↓
order Signal changes
      ↓
Angular detects Signal dependency
      ↓
UI updates
```

No manual DOM manipulation is required.

---

# Angular Lazy Loading

The application uses Angular standalone components and route-level lazy loading.

For example:

```typescript
{
  path: 'orders',
  loadComponent: () =>
    import(
      './features/orders/pages/order-list/order-list.component'
    ).then(
      m => m.OrderListComponent
    )
}
```

The `import()` creates a separate JavaScript chunk.

The browser does not need to download the Orders feature until the user navigates to:

```text
/orders
```

Conceptually:

```text
Application Startup
        │
        ├── Core application
        │
        ├── Shared dependencies
        │
        └── Initial route
                 │
                 ▼
          User navigates
          to /orders
                 │
                 ▼
        Load Orders chunk
```

This reduces the initial JavaScript payload and improves startup performance as the application grows.

---

# Final Architecture Responsibilities

The easiest way to remember the complete system is:

```text
FastAPI
=
"Accept requests and maintain browser WebSockets"


PostgreSQL
=
"Persist orders and transactional events"


Outbox Worker
=
"Reliably move events from PostgreSQL to Kafka"


Kafka
=
"Decouple backend components with asynchronous events"


Order Worker
=
"Consume orders and execute business processing"


WebSocket Bridge
=
"Move Kafka status events into browser WebSockets"


RxJS
=
"Handle asynchronous event streams"


Angular Signals
=
"Represent current UI state"


Angular UI
=
"Render the current order status"
```

## The complete event-driven pipeline

```text
                COMMAND
Angular ──────────────────────► FastAPI
                                  │
                                  ▼
                              PostgreSQL
                              PENDING
                                  │
                                  ▼
                            Outbox Worker
                                  │
                                  ▼
                                Kafka
                           order.created
                                  │
                                  ▼
                            Order Worker
                                  │
                         business processing
                                  │
                    ┌─────────────┴─────────────┐
                    │                           │
                    ▼                           ▼
               PostgreSQL                   Kafka
               PROCESSING              order.status.changed
                    │                           │
                    │                           ▼
                    │                    WebSocket Bridge
                    │                           │
                    │                           ▼
                    │                       WebSocket
                    │                           │
                    │                           ▼
                    │                      Angular RxJS
                    │                           │
                    │                           ▼
                    │                    Angular Signal
                    │                           │
                    │                           ▼
                    │                           UI
                    │
                    ▼
                COMPLETED
```

### The key interview statement

> **The Transactional Outbox guarantees reliable publication of database events, Kafka decouples asynchronous backend processing, the Order Worker performs the business operation, and the FastAPI WebSocket Bridge converts Kafka status events into real-time browser updates. Angular uses RxJS to consume the WebSocket event stream and Signals to maintain the current UI state.**
