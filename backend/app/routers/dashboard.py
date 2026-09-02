"""
backend/app/routers/dashboard.py
──────────────────────────────────
GET /api/v1/dashboard/stats — aggregated statistics for the dashboard.
"""
from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import Order, OrderStatus
from app.schemas import DashboardStats, OrderResponse

router = APIRouter(prefix="/dashboard", tags=["dashboard"])


@router.get("/stats", response_model=DashboardStats)
async def get_dashboard_stats(db: AsyncSession = Depends(get_db)):
    # Aggregate counts per status in a single query
    count_result = await db.execute(
        select(Order.status, func.count(Order.id).label("cnt"))
        .group_by(Order.status)
    )
    counts: dict[str, int] = {row.status.value: row.cnt for row in count_result}

    # 10 most recent orders
    recent_result = await db.execute(
        select(Order).order_by(Order.created_at.desc()).limit(10)
    )
    recent = recent_result.scalars().all()

    return DashboardStats(
        total_orders=sum(counts.values()),
        pending_orders=counts.get("PENDING", 0),
        processing_orders=counts.get("PROCESSING", 0),
        completed_orders=counts.get("COMPLETED", 0),
        failed_orders=counts.get("FAILED", 0),
        recent_orders=recent,
    )
