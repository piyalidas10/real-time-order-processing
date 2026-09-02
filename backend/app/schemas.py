"""
backend/app/schemas.py
──────────────────────
Pydantic v2 schemas for request/response validation and serialisation.

Separated from ORM models (app/models.py) intentionally:
- ORM models represent the database shape.
- Schemas represent the API contract.
- Decoupling means you can evolve the DB schema without breaking the API and
  vice-versa.
"""
from __future__ import annotations

from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


# ──────────────────────────────────────────────────────────────────────────────
# Order Items
# ──────────────────────────────────────────────────────────────────────────────

class OrderItemCreate(BaseModel):
    product_id: str = Field(..., min_length=1, max_length=100, description="Product identifier")
    quantity: int = Field(..., ge=1, le=1000, description="Units ordered")
    price: Decimal = Field(..., gt=0, decimal_places=2, description="Price per unit in INR")


class OrderItemResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    order_id: int
    product_id: str
    quantity: int
    price: Decimal
    created_at: datetime


# ──────────────────────────────────────────────────────────────────────────────
# Orders
# ──────────────────────────────────────────────────────────────────────────────

class OrderCreate(BaseModel):
    customer_id: int = Field(..., ge=1, description="Customer identifier")
    items: list[OrderItemCreate] = Field(..., min_length=1, description="At least one item required")

    @model_validator(mode="after")
    def items_not_empty(self) -> "OrderCreate":
        if not self.items:
            raise ValueError("An order must contain at least one item")
        return self


class OrderResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    customer_id: int
    status: str
    total_amount: Decimal
    retry_count: int
    created_at: datetime
    updated_at: datetime
    items: list[OrderItemResponse] = []
    events: list["OrderEventResponse"] = []


class OrderListResponse(BaseModel):
    """Paginated order list."""
    items: list[OrderResponse]
    total: int
    page: int
    page_size: int
    total_pages: int


# ──────────────────────────────────────────────────────────────────────────────
# Order Events (timeline)
# ──────────────────────────────────────────────────────────────────────────────

class OrderEventResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    order_id: int
    event_type: str
    status: str | None
    payload: dict | None
    created_at: datetime


# ──────────────────────────────────────────────────────────────────────────────
# Dashboard
# ──────────────────────────────────────────────────────────────────────────────

class DashboardStats(BaseModel):
    total_orders: int
    pending_orders: int
    processing_orders: int
    completed_orders: int
    failed_orders: int
    recent_orders: list[OrderResponse]


# ──────────────────────────────────────────────────────────────────────────────
# WebSocket events  (sent from server → client)
# ──────────────────────────────────────────────────────────────────────────────

class WebSocketEvent(BaseModel):
    event_type: str
    order_id: int
    status: str
    timestamp: datetime
    payload: dict | None = None


# ──────────────────────────────────────────────────────────────────────────────
# Health
# ──────────────────────────────────────────────────────────────────────────────

class HealthResponse(BaseModel):
    status: str  # "healthy" | "degraded" | "unhealthy"
    version: str = "1.0.0"
    environment: str
    checks: dict[str, str]


# Rebuild for forward-references
OrderResponse.model_rebuild()
