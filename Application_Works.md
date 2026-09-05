# Outbox Worker, Order Worker, Kafka, and WebSocket have four different responsibilities
Think of your application as a pipeline:
```
Angular
   │
   │ HTTP
   ▼
FastAPI
   │
   ▼
PostgreSQL
   │
   ▼
Outbox Worker
   │
   ▼
Kafka
   │
   ▼
Order Worker
   │
   ▼
PostgreSQL
   │
   └──────────────► Kafka
                      │
                      ▼
               WebSocket Bridge
                      │
                      ▼
                   Angular

Let's separate each responsibility.
```

## 1. What is the Outbox Worker?

The Outbox Worker is responsible for reliably moving database events into Kafka.

Suppose the user creates order #13.

FastAPI needs to do two things:
```
1. Save Order #13
2. Publish OrderCreated event
```
The dangerous approach would be:
```
Save database
      ↓
Publish Kafka
```
What if PostgreSQL succeeds but Kafka is temporarily unavailable?

You could end up with:
```
PostgreSQL
Order #13 exists

Kafka
OrderCreated doesn't exist
```
Your system has lost the event.

### Transactional Outbox solves this.

FastAPI does:
```
PostgreSQL transaction
 ├── orders
 │     order_id = 13
 │     status = PENDING
 │
 └── outbox_events
       event = OrderCreated
       processed = false
```
Both are committed together.

Then the Outbox Worker periodically reads:
```
outbox_events
WHERE processed = false
```
and publishes the event to Kafka:
```
Outbox Worker
     │
     │ publish
     ▼
Kafka
order.created
```
After successful publication, it marks the outbox record as processed.

So:
```
Outbox Worker = Database → Kafka reliability bridge
```

## 2. What is the Order Worker?

The Order Worker performs the actual business processing of an order.

It listens to Kafka:
```
Kafka
  │
  │ order.created
  ▼
Order Worker
```
It receives:
```
{
  "event_type": "OrderCreated",
  "order_id": 13
}
```
Then it does the actual work.

For your demo, something like:
```
Order Worker
    │
    ├── Read order #13
    │
    ├── PENDING → PROCESSING
    │
    ├── Perform simulated processing
    │
    ├── PROCESSING → COMPLETED
    │
    └── Publish status events
```
So:
```
Order Worker = Kafka → Business processing
```

## 3. So why are they separate?

Because they have different responsibilities.

### Outbox Worker
```
Database
   ↓
Outbox Worker
   ↓
Kafka
```
Its job is:
```
"I need to make sure database events eventually reach Kafka."
```

### Order Worker
```
Kafka
   ↓
Order Worker
   ↓
Business logic
   ↓
Database
```
Its job is:
```
"I need to process orders."
```
This separation is a standard event-driven architecture concept.

## 4. Where exactly is Kafka?

Kafka sits between independent components.

Your architecture is essentially:
```
                    Kafka
                      │
          ┌───────────┴───────────┐
          │                       │
          ▼                       ▼
   Order Worker             WebSocket Bridge
```
But there are actually multiple Kafka topics.

For example:
```
                  Kafka
                   │
       ┌───────────┼──────────────┐
       │           │              │
       ▼           ▼              ▼
order.created   order.status   notification
                .changed
```

### order.created

Produced by:
```
Outbox Worker
```
Consumed by:
```
Order Worker
```

### order.status.changed

Produced by:
```
Order Worker
```
Consumed by:
```
FastAPI WebSocket bridge
```
This is the key to your real-time UI.

## 5. Where does WebSocket come into this?

This is where it gets interesting.

WebSocket is not replacing Kafka.

They solve completely different problems.

### Kafka

Kafka is primarily backend-to-backend asynchronous communication.
```
Service A
   │
   ▼
 Kafka
   │
   ▼
Service B
```
### WebSocket

WebSocket is server-to-browser real-time communication.
```
FastAPI
   │
   │ WebSocket
   ▼
Browser
```
Therefore your application uses both:
```
Backend world
────────────────────────

Order Worker
      │
      │ Kafka
      ▼
    Kafka
      │
      │ Kafka
      ▼
FastAPI WebSocket Bridge
      │
      │ WebSocket
      ▼
Angular Browser
```

## 6. Why can't Order Worker directly use WebSocket?

This was actually the problem you had earlier.

Initially you had something conceptually like:
```
Order Worker
     │
     │ ws_manager.broadcast(...)
     ▼
WebSocket
     │
     ▼
Angular
```
But your Order Worker and FastAPI are separate processes/containers.

For example:
```
┌─────────────────────┐
│ API Container       │
│                     │
│ FastAPI             │
│ ws_manager          │
│                     │
│ Browser connected   │
└─────────────────────┘


┌─────────────────────┐
│ Worker Container    │
│                     │
│ Order Worker        │
│ ws_manager          │
│                     │
│ NO browser here     │
└─────────────────────┘
```
The two ws_manager objects are different memory spaces.

Therefore:
```
await ws_manager.broadcast_order_event(...)
```
inside the worker cannot reach the WebSocket connections maintained by FastAPI.

## 7. Kafka solves that problem

Now you have:
```
Order Worker
      │
      │ Kafka
      ▼
order.status.changed
      │
      ▼
FastAPI
      │
      │ ws_manager
      ▼
WebSocket
      │
      ▼
Angular
```
FastAPI owns the actual WebSocket connections.

The worker doesn't need to know:
- which browser is connected
- which WebSocket object exists
- which Angular page is open
- how many users are connected

It simply publishes:
```
{
  "event_type": "ProcessingStarted",
  "order_id": 13,
  "status": "PROCESSING"
}
```
Kafka handles backend delivery.

FastAPI handles browser delivery.

## 8. Your complete Order #13 example

Let's follow exactly what happened in your successful test.

### Step 1 — User creates order

Angular:
```
POST /api/v1/orders
```
FastAPI:
```
Create Order #13
status = PENDING
```
PostgreSQL:
```
Order #13
PENDING
```
and:
```
OutboxEvent
OrderCreated
```

### Step 2 — Outbox Worker

Outbox Worker reads:
```
OrderCreated
```
and publishes:
```
Kafka
└── order.created
       │
       └── order_id = 13
```

### Step 3 — Order Worker

Order Worker consumes:
```
order.created
```
and changes:
```
PENDING
    ↓
PROCESSING
```
PostgreSQL now says:
```
Order #13
PROCESSING
```
Then it publishes:
```
Kafka
└── order.status.changed

{
    order_id: 13,
    status: "PROCESSING",
    event_type: "ProcessingStarted"
}
```

## 9. WebSocket bridge receives it

Your FastAPI process has:
```
websocket_event_consumer.py
```
It consumes:
```
order.status.changed
```
Then:
```
await ws_manager.broadcast_order_event(
    13,
    event
)
```
FastAPI already knows:
```
Browser A
   ↓
/ws/orders/13
```
So it sends:
```
{
  "event_type": "ProcessingStarted",
  "order_id": 13,
  "status": "PROCESSING"
}
```

## 10. Angular receives it

Your Angular WebSocket:
```
ws://localhost:8000/ws/orders/13
```
receives:
```
ProcessingStarted
PROCESSING
```
Then your component does:
```
order.status = PROCESSING
```
Because order is a Signal:
```
Signal changes
     ↓
Angular detects change
     ↓
Template re-evaluates
     ↓
Progress bar changes
```
UI:
```
● Pending
│
● Processing
│
○ Completed
```

## 11. Then completion happens

Order Worker finishes:
```
PROCESSING
     ↓
COMPLETED
```

PostgreSQL:
```
Order #13
COMPLETED
```

Kafka:
```
order.status.changed

{
    order_id: 13,
    status: "COMPLETED",
    event_type: "OrderCompleted"
}
```

FastAPI:
```
Kafka
  ↓
WebSocket bridge
  ↓
ws_manager
  ↓
WebSocket
```

Angular:
```
WebSocket
    ↓
Observable
    ↓
OrderDetailComponent
    ↓
Signal
    ↓
UI
```

Final:
```
● Pending
│
● Processing
│
● Completed
```

## 12. The simplest way to remember the four components
| Component            | Responsibility                           | Communication              |
| -------------------- | ---------------------------------------- | -------------------------- |
| **FastAPI**          | Accept HTTP requests / manage WebSockets | HTTP + WebSocket           |
| **Outbox Worker**    | Move DB events reliably to Kafka         | PostgreSQL → Kafka         |
| **Kafka**            | Transport/store asynchronous events      | Backend ↔ Backend          |
| **Order Worker**     | Process orders/business logic            | Kafka → PostgreSQL + Kafka |
| **WebSocket Bridge** | Convert Kafka events to browser messages | Kafka → WebSocket          |
| **Angular**          | Display real-time status                 | WebSocket → Signal → UI    |

The most important distinction is:
```
Outbox Worker
    = "Get events OUT of PostgreSQL and INTO Kafka"

Order Worker
    = "Get orders OUT of Kafka and PROCESS them"

WebSocket Bridge
    = "Get status events OUT of Kafka and INTO browsers"
```
And Kafka is the decoupling layer between these independently running components.

That is why your final architecture is much closer to a real-world event-driven system than simply having the Order Worker call the WebSocket directly.