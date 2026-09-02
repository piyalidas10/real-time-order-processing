/**
 * src/app/core/models/order.models.ts
 * ─────────────────────────────────────
 * Shared TypeScript interfaces mirroring the backend Pydantic schemas.
 * Using interfaces (not classes) — no runtime overhead, pure type information.
 */

export type OrderStatus = 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';

export interface OrderItem {
  id: number;
  order_id: number;
  product_id: string;
  quantity: number;
  price: number;
  created_at: string;
}

export interface OrderEvent {
  id: number;
  order_id: number;
  event_type: string;
  status: string | null;
  payload: Record<string, unknown> | null;
  created_at: string;
}

export interface Order {
  id: number;
  customer_id: number;
  status: OrderStatus;
  total_amount: number;
  retry_count: number;
  created_at: string;
  updated_at: string;
  items: OrderItem[];
  events: OrderEvent[];
}

export interface OrderListResponse {
  items: Order[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

export interface DashboardStats {
  total_orders: number;
  pending_orders: number;
  processing_orders: number;
  completed_orders: number;
  failed_orders: number;
  recent_orders: Order[];
}

// ── Request payloads ──────────────────────────────────────────────────────────

export interface CreateOrderItemPayload {
  product_id: string;
  quantity: number;
  price: number;
}

export interface CreateOrderPayload {
  customer_id: number;
  items: CreateOrderItemPayload[];
}

// ── WebSocket events ──────────────────────────────────────────────────────────

export interface WebSocketEvent {
  event_type: 'OrderStatusChanged' | 'Connected' | 'Ping';
  order_id?: number;
  status?: OrderStatus;
  timestamp?: string;
  payload?: Record<string, unknown>;
  error?: string;
  channel?: string;
}
