"""
backend/app/routers/dashboard.py
──────────────────────────────────
GET /api/v1/dashboard/stats — aggregated statistics for the dashboard.

These are SQLAlchemy query-building functions.
- select() → creates a SQL SELECT
- func.count() → creates SQL COUNT()
- func → allows SQL functions such as COUNT, SUM, AVG, etc.
"""
from fastapi import APIRouter, Depends
from sqlalchemy import func, select
# This is SQLAlchemy's asynchronous database session.
from sqlalchemy.ext.asyncio import AsyncSession

# get_db → provides the database connection/session
from app.database import get_db
from app.models import Order, OrderStatus
from app.schemas import DashboardStats, OrderResponse

router = APIRouter(prefix="/dashboard", tags=["dashboard"])

# Get the database session
@router.get("/stats", response_model=DashboardStats)
async def get_dashboard_stats(db: AsyncSession = Depends(get_db)):
    # Aggregate counts per status in a single query
    # you're asking PostgreSQL: "Give me the number of orders for each status."
    """
    Suppose your database contains:

    Order 1 → PENDING
    Order 2 → PROCESSING
    Order 3 → COMPLETED
    Order 4 → COMPLETED
    Order 5 → FAILED

    The database might return:

    status       cnt
    -----------  ---
    PENDING       1
    PROCESSING    1
    COMPLETED     2
    FAILED        1

    Without GROUP BY, you'd only get:   total = 5

    With:

    GROUP BY status

    you get:

    PENDING     → 1
    PROCESSING  → 1
    COMPLETED   → 2
    FAILED      → 1
    """
    count_result = await db.execute(
        select(Order.status, func.count(Order.id).label("cnt"))
        .group_by(Order.status)
    )

    # Convert database results into a Python dictionary
    """
    The database result:

    PENDING     1
    PROCESSING  1
    COMPLETED   2
    FAILED      1

    becomes:

    {
        "PENDING": 1,
        "PROCESSING": 1,
        "COMPLETED": 2,
        "FAILED": 1
    }
    """
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
