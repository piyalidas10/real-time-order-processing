"""
backend/app/routers/orders.py
──────────────────────────────
REST endpoints for order management.

POST /api/v1/orders              Create order (+ transactional outbox event)
GET  /api/v1/orders              List orders (paginated, filterable by status)
GET  /api/v1/orders/{id}         Get a single order with items + event timeline
POST /api/v1/orders/{id}/retry   Retry a FAILED order
GET  /api/v1/orders/{id}/events  Get event timeline for an order
"""
import uuid
from datetime import datetime, timezone
from math import ceil

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import Order, OrderEvent, OrderItem, OrderStatus, OutboxEvent, OutboxEventStatus
from app.schemas import (
    OrderCreate,
    OrderEventResponse,
    OrderListResponse,
    OrderResponse,
)

router = APIRouter(prefix="/orders", tags=["orders"])


# ──────────────────────────────────────────────────────────────────────────────
# POST /orders  — create an order
# ──────────────────────────────────────────────────────────────────────────────

@router.post("", response_model=OrderResponse, status_code=status.HTTP_201_CREATED)
async def create_order(payload: OrderCreate, db: AsyncSession = Depends(get_db)):
    """
    Create an order and atomically write an outbox event.

    TRANSACTIONAL OUTBOX:
    Both the Order INSERT and the OutboxEvent INSERT happen inside the same
    database transaction.  The Outbox Worker later reads PENDING outbox events
    and publishes them to Kafka.  This solves the dual-write problem — we can
    never have an order without its corresponding Kafka message, because either
    both are committed or neither is.
    """
    total = sum(item.quantity * item.price for item in payload.items)

    order = Order(
        customer_id=payload.customer_id,
        status=OrderStatus.PENDING,
        total_amount=float(total),
    )
    db.add(order)
    await db.flush()  # get order.id without committing

    # Persist order items
    for item_data in payload.items:
        db.add(OrderItem(
            order_id=order.id,
            product_id=item_data.product_id,
            quantity=item_data.quantity,
            price=float(item_data.price),
        ))

    # ── Transactional Outbox event ─────────────────────────────────────────
    event_id = str(uuid.uuid4())
    outbox_event = OutboxEvent(
        event_id=event_id,
        event_type="OrderCreated",
        aggregate_type="Order",
        aggregate_id=str(order.id),
        payload={
            "event_id": event_id,
            "event_type": "OrderCreated",
            "event_version": 1,
            "occurred_at": datetime.now(timezone.utc).isoformat(),
            "order_id": order.id,
            "customer_id": order.customer_id,
            "total_amount": float(total),
            "items": [
                {
                    "product_id": i.product_id,
                    "quantity": i.quantity,
                    "price": float(i.price),
                }
                for i in payload.items
            ],
        },
        status=OutboxEventStatus.PENDING,
    )
    db.add(outbox_event)

    # ── Audit event ────────────────────────────────────────────────────────
    db.add(OrderEvent(
        order_id=order.id,
        event_type="OrderCreated",
        status=OrderStatus.PENDING.value,
        payload={"customer_id": order.customer_id},
    ))

    await db.commit()
    await db.refresh(order)
    return order


# ──────────────────────────────────────────────────────────────────────────────
# GET /orders  — paginated list
# ──────────────────────────────────────────────────────────────────────────────

@router.get("", response_model=OrderListResponse)
async def list_orders(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    status_filter: str | None = Query(None, alias="status"),
    db: AsyncSession = Depends(get_db),
):
    query = select(Order).order_by(Order.created_at.desc())
    count_query = select(func.count()).select_from(Order)

    if status_filter:
        try:
            s = OrderStatus(status_filter.upper())
        except ValueError:
            raise HTTPException(status_code=400, detail=f"Invalid status: {status_filter}")
        query = query.where(Order.status == s)
        count_query = count_query.where(Order.status == s)

    total = (await db.execute(count_query)).scalar_one()
    offset = (page - 1) * page_size
    result = await db.execute(query.offset(offset).limit(page_size))
    orders = result.scalars().all()

    return OrderListResponse(
        items=orders,
        total=total,
        page=page,
        page_size=page_size,
        total_pages=ceil(total / page_size) if total else 0,
    )


# ──────────────────────────────────────────────────────────────────────────────
# GET /orders/{order_id}
# ──────────────────────────────────────────────────────────────────────────────

@router.get("/{order_id}", response_model=OrderResponse)
async def get_order(order_id: int, db: AsyncSession = Depends(get_db)):
    order = await _get_order_or_404(order_id, db)
    return order


# ──────────────────────────────────────────────────────────────────────────────
# POST /orders/{order_id}/retry
# ──────────────────────────────────────────────────────────────────────────────

@router.post("/{order_id}/retry", response_model=OrderResponse)
async def retry_order(order_id: int, db: AsyncSession = Depends(get_db)):
    """
    Manually retry a FAILED order.

    Resets status to PENDING and writes a new outbox event so the order
    re-enters the Kafka processing pipeline.
    """
    from app.config import get_settings
    settings = get_settings()

    order = await _get_order_or_404(order_id, db)

    if order.status != OrderStatus.FAILED:
        raise HTTPException(
            status_code=400,
            detail=f"Only FAILED orders can be retried. Current status: {order.status.value}",
        )

    if order.retry_count >= settings.max_retry_attempts:
        raise HTTPException(
            status_code=400,
            detail=f"Order has reached maximum retry limit ({settings.max_retry_attempts})",
        )

    order.status = OrderStatus.PENDING
    order.retry_count += 1

    event_id = str(uuid.uuid4())
    db.add(OutboxEvent(
        event_id=event_id,
        event_type="OrderCreated",
        aggregate_type="Order",
        aggregate_id=str(order.id),
        payload={
            "event_id": event_id,
            "event_type": "OrderCreated",
            "event_version": 1,
            "occurred_at": datetime.now(timezone.utc).isoformat(),
            "order_id": order.id,
            "customer_id": order.customer_id,
            "total_amount": float(order.total_amount),
            "retry": True,
            "retry_count": order.retry_count,
        },
        status=OutboxEventStatus.PENDING,
    ))

    db.add(OrderEvent(
        order_id=order.id,
        event_type="OrderRetried",
        status=OrderStatus.PENDING.value,
        payload={"retry_count": order.retry_count},
    ))

    await db.commit()
    await db.refresh(order)
    return order


# ──────────────────────────────────────────────────────────────────────────────
# GET /orders/{order_id}/events
# ──────────────────────────────────────────────────────────────────────────────

@router.get("/{order_id}/events", response_model=list[OrderEventResponse])
async def get_order_events(order_id: int, db: AsyncSession = Depends(get_db)):
    await _get_order_or_404(order_id, db)
    result = await db.execute(
        select(OrderEvent)
        .where(OrderEvent.order_id == order_id)
        .order_by(OrderEvent.created_at)
    )
    return result.scalars().all()


# ── Helper ─────────────────────────────────────────────────────────────────────

async def _get_order_or_404(order_id: int, db: AsyncSession) -> Order:
    result = await db.execute(select(Order).where(Order.id == order_id))
    order = result.scalar_one_or_none()
    if not order:
        raise HTTPException(status_code=404, detail=f"Order {order_id} not found")
    return order
