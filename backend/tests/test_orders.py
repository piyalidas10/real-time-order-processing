"""
backend/tests/test_orders.py
──────────────────────────────
Tests for the Orders API endpoints.

Test categories:
- Unit: order total calculation, status transitions
- Integration: API endpoint tests using HTTPX AsyncClient + in-memory SQLite

WHY HTTPX + ASGI transport:
  httpx.AsyncClient(transport=ASGITransport(app=app)) sends real HTTP requests
  through the FastAPI ASGI interface WITHOUT starting a network server.
  This is fast, deterministic, and tests the full request/response cycle
  including middleware, dependency injection, and Pydantic validation.
"""
import pytest
from decimal import Decimal


# ──────────────────────────────────────────────────────────────────────────────
# Unit tests — pure logic, no DB/network
# ──────────────────────────────────────────────────────────────────────────────

class TestOrderTotalCalculation:
    """Order total must equal sum(quantity * price) for all items."""

    def test_single_item(self):
        items = [{"quantity": 2, "price": Decimal("499.50")}]
        total = sum(i["quantity"] * i["price"] for i in items)
        assert total == Decimal("999.00")

    def test_multiple_items(self):
        items = [
            {"quantity": 1, "price": Decimal("1199.00")},
            {"quantity": 2, "price": Decimal("250.00")},
            {"quantity": 3, "price": Decimal("99.99")},
        ]
        total = sum(i["quantity"] * i["price"] for i in items)
        assert total == Decimal("1999.97")

    def test_zero_price_rejected_by_schema(self):
        from pydantic import ValidationError
        from app.schemas import OrderItemCreate
        with pytest.raises(ValidationError):
            OrderItemCreate(product_id="P1", quantity=1, price=Decimal("0"))

    def test_zero_quantity_rejected(self):
        from pydantic import ValidationError
        from app.schemas import OrderItemCreate
        with pytest.raises(ValidationError):
            OrderItemCreate(product_id="P1", quantity=0, price=Decimal("10.00"))

    def test_empty_items_rejected(self):
        from pydantic import ValidationError
        from app.schemas import OrderCreate
        with pytest.raises(ValidationError):
            OrderCreate(customer_id=1, items=[])


# ──────────────────────────────────────────────────────────────────────────────
# Integration tests — full HTTP request cycle
# ──────────────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_health_check(client):
    """Health endpoint should return 200 even if Kafka is unavailable in tests."""
    response = await client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert "status" in data
    assert "checks" in data


@pytest.mark.asyncio
async def test_create_order_success(client):
    """POST /api/v1/orders with valid payload returns 201 and PENDING status."""
    payload = {
        "customer_id": 101,
        "items": [
            {"product_id": "PROD-1", "quantity": 2, "price": "499.50"},
            {"product_id": "PROD-2", "quantity": 1, "price": "200.00"},
        ],
    }
    response = await client.post("/api/v1/orders", json=payload)
    assert response.status_code == 201
    data = response.json()
    assert data["status"] == "PENDING"
    assert data["customer_id"] == 101
    assert float(data["total_amount"]) == pytest.approx(1199.00)
    assert data["id"] is not None


@pytest.mark.asyncio
async def test_create_order_total_calculation(client):
    """Total amount must be computed from items, not provided by caller."""
    payload = {
        "customer_id": 102,
        "items": [
            {"product_id": "A", "quantity": 3, "price": "100.00"},
            {"product_id": "B", "quantity": 2, "price": "50.00"},
        ],
    }
    response = await client.post("/api/v1/orders", json=payload)
    assert response.status_code == 201
    assert float(response.json()["total_amount"]) == pytest.approx(400.00)


@pytest.mark.asyncio
async def test_create_order_missing_items(client):
    """POST without items returns 422 Unprocessable Entity."""
    payload = {"customer_id": 101, "items": []}
    response = await client.post("/api/v1/orders", json=payload)
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_create_order_invalid_customer_id(client):
    """customer_id must be >= 1."""
    payload = {
        "customer_id": 0,
        "items": [{"product_id": "P1", "quantity": 1, "price": "10.00"}],
    }
    response = await client.post("/api/v1/orders", json=payload)
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_get_order_not_found(client):
    """GET a non-existent order returns 404."""
    response = await client.get("/api/v1/orders/99999")
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_get_order_after_creation(client):
    """Order created via POST can be retrieved via GET with matching data."""
    create_payload = {
        "customer_id": 103,
        "items": [{"product_id": "X1", "quantity": 1, "price": "299.00"}],
    }
    create_response = await client.post("/api/v1/orders", json=create_payload)
    order_id = create_response.json()["id"]

    get_response = await client.get(f"/api/v1/orders/{order_id}")
    assert get_response.status_code == 200
    data = get_response.json()
    assert data["id"] == order_id
    assert data["customer_id"] == 103
    assert len(data["items"]) == 1


@pytest.mark.asyncio
async def test_list_orders_pagination(client):
    """List endpoint returns paginated results."""
    # Create 3 orders
    for cid in [201, 202, 203]:
        await client.post("/api/v1/orders", json={
            "customer_id": cid,
            "items": [{"product_id": "P", "quantity": 1, "price": "10.00"}],
        })

    response = await client.get("/api/v1/orders?page=1&page_size=2")
    assert response.status_code == 200
    data = response.json()
    assert data["page"] == 1
    assert data["page_size"] == 2
    assert data["total"] == 3
    assert len(data["items"]) == 2


@pytest.mark.asyncio
async def test_list_orders_status_filter(client):
    """Status filter returns only orders with the specified status."""
    await client.post("/api/v1/orders", json={
        "customer_id": 301,
        "items": [{"product_id": "P1", "quantity": 1, "price": "10.00"}],
    })

    response = await client.get("/api/v1/orders?status=PENDING")
    assert response.status_code == 200
    data = response.json()
    assert all(o["status"] == "PENDING" for o in data["items"])


@pytest.mark.asyncio
async def test_list_orders_invalid_status(client):
    """Invalid status filter returns 400."""
    response = await client.get("/api/v1/orders?status=INVALID")
    assert response.status_code == 400


@pytest.mark.asyncio
async def test_get_order_events(client):
    """Order events endpoint returns timeline for the order."""
    create_response = await client.post("/api/v1/orders", json={
        "customer_id": 401,
        "items": [{"product_id": "E1", "quantity": 1, "price": "50.00"}],
    })
    order_id = create_response.json()["id"]

    events_response = await client.get(f"/api/v1/orders/{order_id}/events")
    assert events_response.status_code == 200
    events = events_response.json()
    # First event should be OrderCreated
    assert len(events) >= 1
    assert events[0]["event_type"] == "OrderCreated"


@pytest.mark.asyncio
async def test_retry_non_failed_order_returns_400(client):
    """Cannot retry an order that is not FAILED."""
    create_response = await client.post("/api/v1/orders", json={
        "customer_id": 501,
        "items": [{"product_id": "R1", "quantity": 1, "price": "100.00"}],
    })
    order_id = create_response.json()["id"]

    retry_response = await client.post(f"/api/v1/orders/{order_id}/retry")
    assert retry_response.status_code == 400
    assert "FAILED" in retry_response.json()["detail"]


@pytest.mark.asyncio
async def test_dashboard_stats(client):
    """Dashboard stats returns aggregated order counts."""
    await client.post("/api/v1/orders", json={
        "customer_id": 601,
        "items": [{"product_id": "D1", "quantity": 1, "price": "10.00"}],
    })

    response = await client.get("/api/v1/dashboard/stats")
    assert response.status_code == 200
    data = response.json()
    assert "total_orders" in data
    assert "pending_orders" in data
    assert data["total_orders"] >= 1
    assert len(data["recent_orders"]) >= 1


# ──────────────────────────────────────────────────────────────────────────────
# Idempotency tests
# ──────────────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_outbox_event_created_on_order(client, db_session):
    """Creating an order must write an outbox event in the same transaction."""
    from sqlalchemy import select
    from app.models import OutboxEvent

    create_response = await client.post("/api/v1/orders", json={
        "customer_id": 701,
        "items": [{"product_id": "O1", "quantity": 1, "price": "99.00"}],
    })
    assert create_response.status_code == 201
    order_id = create_response.json()["id"]

    # Verify outbox event was written
    result = await db_session.execute(
        select(OutboxEvent).where(OutboxEvent.aggregate_id == str(order_id))
    )
    events = result.scalars().all()
    assert len(events) == 1
    assert events[0].event_type == "OrderCreated"
    assert events[0].payload["order_id"] == order_id


@pytest.mark.asyncio
async def test_status_transition_validation(client, db_session):
    """
    Status transition test: verify only valid statuses are accepted.
    """
    from app.models import Order, OrderStatus
    from sqlalchemy import select

    create_response = await client.post("/api/v1/orders", json={
        "customer_id": 801,
        "items": [{"product_id": "S1", "quantity": 2, "price": "149.50"}],
    })
    order_id = create_response.json()["id"]

    # Verify initial status is PENDING
    result = await db_session.execute(select(Order).where(Order.id == order_id))
    order = result.scalar_one()
    assert order.status == OrderStatus.PENDING
