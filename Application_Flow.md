# Flow how status changing is displying in the UI after Creating order

Now that your implementation is working, the status-change flow after creating an order looks like this.

## 1. User clicks "Create Order"

Angular sends:
```
POST /api/v1/orders
```
The request goes:
```
Angular UI
   │
   │ POST /api/v1/orders
   ▼
FastAPI
```
FastAPI creates the order in PostgreSQL with:
```
status = PENDING
```
and creates the initial event:
```
OrderCreated
PENDING
```
At this point the UI displays:
```
● Pending
│
○ Processing
│
○ Completed
```

## 2. Order is published for processing

The order-processing architecture uses the Transactional Outbox pattern.

Conceptually:
```
FastAPI
   │
   ├── INSERT Order
   │      status = PENDING
   │
   └── INSERT Outbox Event
          OrderCreated
              │
              ▼
        Outbox Worker
              │
              ▼
            Kafka
              │
              ▼
       order.created
```
The important point is that the UI does not directly communicate with the worker.

## 3. Worker receives the order

The order worker consumes the Kafka event:
```
Kafka
  │
  │ order.created
  ▼
Order Worker
```
The worker changes PostgreSQL:
```
PENDING
   ↓
PROCESSING
```
It also records:
```
OrderEvent
    event_type = ProcessingStarted
    status     = PROCESSING
```
Then the worker publishes another Kafka event:
```
topic = order.status.changed

{
  "event_type": "ProcessingStarted",
  "order_id": 13,
  "status": "PROCESSING"
}
```

## 4. Kafka sends the status event to the FastAPI WebSocket bridge

FastAPI process has a background consumer:
```
FastAPI
   │
   │ Kafka Consumer
   ▼
order.status.changed
```
Your:
```
websocket_event_consumer.py
```
receives:
```
{
  "event_type": "ProcessingStarted",
  "order_id": 13,
  "status": "PROCESSING"
}
```
Then it calls:
```
await ws_manager.broadcast_order_event(
    13,
    event
)
```

## 5. WebSocket sends the event to Angular

The browser already has an open connection:
```
ws://localhost:8000/ws/orders/13
```
So FastAPI pushes:
```
{
  "event_type": "ProcessingStarted",
  "order_id": 13,
  "status": "PROCESSING"
}
```
Your browser log confirms this:
```
[WS] MESSAGE:
{
  event_type: 'ProcessingStarted',
  order_id: 13,
  status: 'PROCESSING'
}
```

## 6. Angular receives the event

Your WebSocketService receives the message:
```
WebSocket
    ↓
WebSocketService
    ↓
Observable
    ↓
OrderDetailComponent
```

The component receives:
```
ProcessingStarted
PROCESSING
```

Your filter allows it:
```
filter(
  event =>
    event.event_type === 'ProcessingStarted' ||
    event.event_type === 'OrderCompleted' ||
    event.event_type === 'OrderFailed'
)
```

Then:
```
this.order.update(o =>
  o
    ? {
        ...o,
        status: event.status!
      }
    : null
);
```

The important part is:
```
order.status
      ↓
PROCESSING
```
Because order is an Angular Signal, the UI automatically reacts.

## 7. Status bar changes

Your template has:
```
[style.width.%]="o.status | statusProgress"
```
So when:
```
PENDING
```
changes to:
```
PROCESSING
```
Angular recalculates the progress:
```
PENDING

● Pending
│
○ Processing
│
○ Completed
```
becomes:
```
● Pending
│
● Processing
│
○ Completed
```
The progress bar also increases.

No page refresh is required.

## 8. Worker completes processing

The worker finishes its work.

PostgreSQL changes:
```
PROCESSING
     ↓
COMPLETED
```
and creates:
```
OrderCompleted
COMPLETED
```
Then the worker publishes:
```
{
  "event_type": "OrderCompleted",
  "order_id": 13,
  "status": "COMPLETED"
}
```
to:
```
Kafka
└── order.status.changed
```

## 9. FastAPI broadcasts COMPLETED

The same WebSocket bridge receives it:
```
Kafka
   ↓
websocket_event_consumer
   ↓
ws_manager
   ↓
WebSocket
```
Angular receives:
```
[WS] MESSAGE:
{
  event_type: 'OrderCompleted',
  order_id: 13,
  status: 'COMPLETED'
}
```
Your component updates:
```
this.order.update(o => ({
  ...o,
  status: 'COMPLETED'
}));
```

## 10. Angular automatically updates the UI

The Signal changes:
```
order.status

PROCESSING
    ↓
COMPLETED
```
Angular detects the Signal change and updates the template.

Final UI:
```
● Pending
│
● Processing
│
● Completed
```
and the progress bar becomes:
```
████████████████████████████████ 100%
```

## Complete flow

The easiest way to remember your architecture is:
```
                 CREATE ORDER
                      │
                      ▼
              ┌──────────────┐
              │    Angular   │
              └──────┬───────┘
                     │ POST
                     ▼
              ┌──────────────┐
              │   FastAPI    │
              └──────┬───────┘
                     │
                     ▼
              ┌──────────────┐
              │ PostgreSQL   │
              │   PENDING    │
              └──────┬───────┘
                     │
               Outbox Event
                     │
                     ▼
              ┌──────────────┐
              │    Kafka     │
              │order.created │
              └──────┬───────┘
                     │
                     ▼
              ┌──────────────┐
              │ Order Worker │
              └──────┬───────┘
                     │
              status = PROCESSING
                     │
                     ▼
              ┌──────────────┐
              │    Kafka     │
              │order.status  │
              │  .changed    │
              └──────┬───────┘
                     │
                     ▼
          ┌────────────────────────┐
          │ FastAPI WS Consumer    │
          │ websocket_event_       │
          │ consumer.py            │
          └───────────┬────────────┘
                      │
                      ▼
                WebSocket
                      │
                      ▼
              ┌──────────────┐
              │   Angular    │
              │ WebSocketSvc │
              └──────┬───────┘
                     │
                  Observable
                     │
                     ▼
              ┌──────────────┐
              │ Order Signal │
              │ PROCESSING   │
              └──────┬───────┘
                     │
                     ▼
                    UI
              PROCESSING shown
                     │
                     │
              Worker finishes
                     │
                     ▼
              ┌──────────────┐
              │    Kafka     │
              │ OrderCompleted│
              └──────┬───────┘
                     │
                     ▼
                  WebSocket
                     │
                     ▼
                Angular Signal
                     │
                     ▼
              ┌──────────────┐
              │ UI = COMPLETE│
              └──────────────┘
```

In one sentence
```
The worker changes the order status in PostgreSQL and publishes a status event to Kafka; 
FastAPI consumes that Kafka event and pushes it through WebSocket; 
Angular receives it, updates its Signal, and the Signal automatically updates the status bar.
```

That's the key architectural story you can explain in an interview:
```
Kafka handles backend event propagation, WebSocket handles server-to-browser real-time delivery, and Angular Signals handle reactive UI rendering.
```