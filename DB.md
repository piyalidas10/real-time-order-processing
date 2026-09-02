There are **two mechanisms** in this project. Here is a complete explanation of both.

---

## How Tables Are Created in PostgreSQL

### Mechanism 1 — Automatic (Development): `create_all` in FastAPI lifespan

In [`backend/app/main.py`](backend/app/main.py:54), when `ENVIRONMENT=development`, the API auto-creates all tables on startup:

```python
# backend/app/main.py — lifespan()
if settings.environment == "development":
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
```

**How it works:**

```
FastAPI starts
      │
      ▼
SQLAlchemy reads all ORM models (imported via models.py)
      │
      ▼
For each model class that maps to a table:
  → Check if table already exists in PostgreSQL
  → If NOT → execute CREATE TABLE ...
  → If YES → skip (non-destructive)
      │
      ▼
All 5 tables exist in PostgreSQL
```

This means simply running `docker compose up --build` is enough — **no manual SQL needed**. The tables appear because:

1. [`app/models.py`](backend/app/models.py) defines 5 model classes, all inheriting from `Base`
2. `Base.metadata` tracks every registered table
3. `create_all` issues `CREATE TABLE IF NOT EXISTS` for each one

---

### Mechanism 2 — Production: Alembic Migrations

For production you run the migration manually (or in a Docker entrypoint). The migration lives in [`backend/alembic/versions/0001_initial_schema.py`](backend/alembic/versions/0001_initial_schema.py).

**Run it like this:**

```bash
# From inside the backend container or with local Python
cd backend
alembic upgrade head
```

Or add it to `docker-compose.yml` as a one-shot init service:

```yaml
# Add this to docker-compose.yml
db-migrate:
  build:
    context: ./backend
  command: ["alembic", "upgrade", "head"]
  env_file: .env
  environment:
    DATABASE_URL_SYNC: "postgresql://orderuser:orderpassword@postgres:5432/orderdb"
  depends_on:
    postgres:
      condition: service_healthy
  networks:
    - order-net
```

---

### What Each Migration Creates

The `upgrade()` function in [`0001_initial_schema.py`](backend/alembic/versions/0001_initial_schema.py:17) produces this exact SQL in PostgreSQL:

```sql
-- 1. Custom ENUM types (PostgreSQL-specific)
CREATE TYPE order_status AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');
CREATE TYPE outbox_event_status AS ENUM ('PENDING', 'PUBLISHED', 'FAILED');

-- 2. Main orders table
CREATE TABLE orders (
    id          BIGSERIAL PRIMARY KEY,
    customer_id INTEGER NOT NULL,
    status      order_status NOT NULL,
    total_amount NUMERIC(12,2) NOT NULL,
    retry_count INTEGER NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_orders_customer_id ON orders(customer_id);
CREATE INDEX ix_orders_status      ON orders(status);

-- 3. Order line items (FK → orders)
CREATE TABLE order_items (
    id         BIGSERIAL PRIMARY KEY,
    order_id   BIGINT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    product_id VARCHAR(100) NOT NULL,
    quantity   INTEGER NOT NULL,
    price      NUMERIC(10,2) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 4. Transactional Outbox (written in same TX as the order)
CREATE TABLE outbox_events (
    id             BIGSERIAL PRIMARY KEY,
    event_id       VARCHAR(36) NOT NULL UNIQUE,
    event_type     VARCHAR(100) NOT NULL,
    aggregate_type VARCHAR(100) NOT NULL,
    aggregate_id   VARCHAR(100) NOT NULL,
    payload        JSON NOT NULL,
    status         outbox_event_status NOT NULL,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    published_at   TIMESTAMPTZ
);
CREATE INDEX ix_outbox_events_status_created ON outbox_events(status, created_at);

-- 5. Idempotency store (prevents duplicate Kafka processing)
CREATE TABLE processed_events (
    id            BIGSERIAL PRIMARY KEY,
    event_id      VARCHAR(36) NOT NULL,
    consumer_name VARCHAR(100) NOT NULL,
    processed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_processed_event_consumer UNIQUE (event_id, consumer_name)
);

-- 6. Audit event log (shown as timeline in the UI)
CREATE TABLE order_events (
    id         BIGSERIAL PRIMARY KEY,
    order_id   BIGINT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    event_type VARCHAR(100) NOT NULL,
    status     VARCHAR(50),
    payload    JSON,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

---

### Side-by-side Comparison

| | `create_all` (dev) | Alembic (production) |
|---|---|---|
| **How** | `Base.metadata.create_all` on app startup | `alembic upgrade head` command |
| **When** | Automatically, every time the app starts | Explicitly, as part of a deploy step |
| **Safe to run twice?** | Yes — `IF NOT EXISTS` | Yes — tracks applied revisions |
| **Rollback** | No — you'd need to drop tables manually | Yes — `alembic downgrade -1` |
| **Schema drift tracking** | No | Yes — revision history in `alembic_version` table |
| **Use in** | Development, Docker Compose demo | Staging, Production |

### Verify Tables After Starting

```bash
# Connect to PostgreSQL inside Docker
docker compose exec postgres psql -U orderuser -d orderdb

# Then run:
\dt          -- list all tables
\d orders    -- describe the orders table
```

Expected output:
```
              List of relations
 Schema |       Name        | Type  |   Owner
--------+-------------------+-------+-----------
 public | order_events      | table | orderuser
 public | order_items       | table | orderuser
 public | orders            | table | orderuser
 public | outbox_events     | table | orderuser
 public | processed_events  | table | orderuser
```

All 5 tables are created automatically when you run `docker compose up --build` — no manual SQL required.