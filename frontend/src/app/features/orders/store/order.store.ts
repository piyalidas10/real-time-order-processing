/**
 * src/app/features/orders/store/order.store.ts
 * ───────────────────────────────────────────────
 * Order state management using Angular Signals.
 *
 * SIGNALS ARCHITECTURE — WHY NOT NgRx?
 * ──────────────────────────────────────
 * NgRx excels when you need:
 * - Complex state machines across many components
 * - Time-travel debugging
 * - Strict unidirectional data flow enforcement on large teams
 *
 * For this application, Angular Signals + RxJS give us everything we need:
 * - signal<T>() — reactive state container (like useState in React, but in Angular)
 * - computed()  — derived state that auto-updates when signals it reads change
 * - effect()    — side effects that run when signals change
 *
 * SIGNAL CONCEPTS:
 * ─────────────────
 * signal(value)          — Creates a writable signal with an initial value
 * signal.set(v)          — Replace the value
 * signal.update(fn)      — Update based on current value
 * signal()               — READ the signal (calling it as a function)
 *
 * computed(() => expr)   — Creates a read-only derived signal.
 *                          Angular automatically tracks which signals are READ
 *                          inside the function and re-runs it when they change.
 *                          Result is memoised — only recalculated when inputs change.
 *
 * effect(() => {})       — Runs a side effect when signals it reads change.
 *                          Example: log to console, persist to localStorage.
 *
 * OBSERVABLE vs SIGNAL:
 * ──────────────────────
 * Observable: models an EVENT STREAM — many values over time, supports
 *   operators (map, filter, debounce), lazy (nothing happens until subscribe).
 *   Best for: HTTP calls, WebSocket streams, user events (keystrokes, clicks).
 *
 * Signal: models CURRENT STATE — one value at a time, synchronous, always
 *   readable.  Best for: loading flags, selected item, filter values,
 *   any UI state that needs to be read in templates.
 *
 * Integration pattern used here:
 *   HTTP Observable  →  subscribe  →  signal.set(data)
 *   WebSocket Observable  →  subscribe  →  signal.update(...)
 */

import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { catchError, EMPTY, tap } from 'rxjs';
import { ApiService } from '../../../core/services/api.service';
import { NotificationService } from '../../../core/services/notification.service';
import { WebSocketService } from '../../../core/services/websocket.service';
import { Order, OrderListResponse, OrderStatus } from '../../../core/models/order.models';

@Injectable({ providedIn: 'root' })
export class OrderStore {
  private readonly api = inject(ApiService);
  private readonly ws = inject(WebSocketService);
  private readonly notify = inject(NotificationService);

  // ── State signals ──────────────────────────────────────────────────────────

  /** All loaded orders */
  readonly orders = signal<Order[]>([]);

  /** Currently selected order (for detail view) */
  readonly selectedOrder = signal<Order | null>(null);

  /** Loading flag — controls skeleton/spinner display */
  readonly loading = signal(false);

  /** Error message — null when no error */
  readonly error = signal<string | null>(null);

  /** Current page for order list pagination */
  readonly currentPage = signal(1);

  /** Total number of orders (from server) */
  readonly totalOrders = signal(0);

  /** Status filter for order list */
  readonly statusFilter = signal<OrderStatus | ''>('');

  // ── Computed signals ───────────────────────────────────────────────────────
  // computed() creates derived values that automatically update when their
  // dependencies change.  No manual subscriptions, no stale data.

  /** Orders currently being processed — used for the processing count badge */
  readonly processingOrders = computed(() =>
    this.orders().filter((o) => o.status === 'PROCESSING')
  );

  /** Completed orders */
  readonly completedOrders = computed(() =>
    this.orders().filter((o) => o.status === 'COMPLETED')
  );

  /** Failed orders — for the retry section */
  readonly failedOrders = computed(() =>
    this.orders().filter((o) => o.status === 'FAILED')
  );

  /** Total pages for pagination */
  readonly totalPages = computed(() => Math.ceil(this.totalOrders() / 20));

  // ── Actions ────────────────────────────────────────────────────────────────

  loadOrders(page = 1, status?: OrderStatus | ''): void {
    this.loading.set(true);
    this.error.set(null);

    this.api
      .getOrders(page, 20, status || undefined)
      .pipe(
        tap((response: OrderListResponse) => {
          this.orders.set(response.items);
          this.totalOrders.set(response.total);
          this.currentPage.set(response.page);
          this.loading.set(false);
        }),
        catchError((err) => {
          this.error.set('Failed to load orders. Please try again.');
          this.loading.set(false);
          return EMPTY;
        })
      )
      .subscribe();
  }

  loadOrder(id: number): void {
    this.loading.set(true);
    this.error.set(null);

    this.api
      .getOrder(id)
      .pipe(
        tap((order: Order) => {
          this.selectedOrder.set(order);
          this.loading.set(false);
        }),
        catchError(() => {
          this.error.set(`Order ${id} not found.`);
          this.loading.set(false);
          return EMPTY;
        })
      )
      .subscribe();
  }

  /**
   * Update a specific order's status in the orders list signal.
   * Called when a WebSocket event arrives.
   *
   * signal.update() takes a function (currentValue → newValue) so we can
   * safely update immutably without re-fetching from the server.
   */
  updateOrderStatus(orderId: number, status: OrderStatus): void {
    this.orders.update((orders) =>
      orders.map((o) => (o.id === orderId ? { ...o, status } : o))
    );

    // Also update selectedOrder if it's the same order
    const current = this.selectedOrder();
    if (current?.id === orderId) {
      this.selectedOrder.update((o) => (o ? { ...o, status } : null));
    }
  }

  retryOrder(id: number): void {
    this.api
      .retryOrder(id)
      .pipe(
        tap((order: Order) => {
          this.updateOrderStatus(id, 'PENDING');
          this.notify.success(`Order #${id} queued for retry`);
        }),
        catchError(() => EMPTY)
      )
      .subscribe();
  }
}
