/**
 * src/app/features/orders/pages/order-list/order-list.component.ts
 * ──────────────────────────────────────────────────────────────────
 * Order list page with real-time status updates via WebSocket.
 *
 * Demonstrates:
 * - OrderStore signals for list state
 * - RxJS WebSocket stream → Signal update
 * - distinctUntilChanged to avoid unnecessary re-renders
 * - takeUntilDestroyed for automatic subscription cleanup
 * - Pagination and status filtering
 */

import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  inject,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { filter, tap } from 'rxjs';
import { DatePipe } from '@angular/common';
import { OrderStore } from '../../store/order.store';
import { WebSocketService } from '../../../../core/services/websocket.service';
import { StatusBadgePipe } from '../../../../shared/pipes/status.pipe';
import { OrderStatus } from '../../../../core/models/order.models';

@Component({
  selector: 'app-order-list',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, StatusBadgePipe, DatePipe],
  template: `
    <div class="page-header">
      <h1 class="page-title">📦 Orders</h1>
      <a routerLink="/orders/new" class="btn btn-primary">➕ New Order</a>
    </div>

    <!-- Connection status indicator -->
    <div class="ws-status" [class.connected]="wsConnected()">
      <span class="ws-dot"></span>
      {{ wsConnected() ? 'Live updates active' : 'Connecting...' }}
    </div>

    <!-- Filter bar -->
    <div class="filter-bar card">
      <span class="text-muted" style="font-size:12px">Filter by status:</span>
      @for (s of statusOptions; track s.value) {
        <button
          class="btn btn-sm"
          [class.btn-primary]="store.statusFilter() === s.value"
          [class.btn-secondary]="store.statusFilter() !== s.value"
          (click)="applyFilter(s.value)">
          {{ s.label }}
        </button>
      }
      <button class="btn btn-secondary btn-sm" (click)="store.loadOrders()" style="margin-left:auto">
        ⟳ Refresh
      </button>
    </div>

    <!-- Loading -->
    @if (store.loading()) {
      <div class="loading"><div class="spinner"></div> Loading orders...</div>
    }

    <!-- Error -->
    @if (store.error()) {
      <div class="alert alert-error">
        {{ store.error() }}
        <button class="btn btn-secondary btn-sm" (click)="store.loadOrders()">Retry</button>
      </div>
    }

    <!-- Order table -->
    @if (!store.loading()) {
      @if (store.orders().length === 0) {
        <div class="card empty-state">
          <div class="icon">📭</div>
          <p>No orders found.</p>
          <a routerLink="/orders/new" class="btn btn-primary">Create your first order</a>
        </div>
      } @else {
        <div class="card table-container">
          <table>
            <thead>
              <tr>
                <th>Order ID</th>
                <th>Customer</th>
                <th>Amount</th>
                <th>Status</th>
                <th>Created</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              @for (order of store.orders(); track order.id) {
                <tr>
                  <td><strong>#{{ order.id }}</strong></td>
                  <td>Customer {{ order.customer_id }}</td>
                  <td>₹{{ order.total_amount | number:'1.2-2' }}</td>
                  <td><span [class]="order.status | statusBadge">{{ order.status }}</span></td>
                  <td class="text-muted">{{ order.created_at | date:'medium' }}</td>
                  <td style="display:flex; gap:8px">
                    <a [routerLink]="['/orders', order.id]" class="btn btn-secondary btn-sm">View</a>
                    @if (order.status === 'FAILED') {
                      <button class="btn btn-danger btn-sm" (click)="store.retryOrder(order.id)">
                        ↺ Retry
                      </button>
                    }
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>

        <!-- Pagination -->
        <div class="pagination">
          <span class="text-muted">
            Page {{ store.currentPage() }} of {{ store.totalPages() }}
            ({{ store.totalOrders() }} orders)
          </span>
          <div style="display:flex; gap:8px">
            <button
              class="btn btn-secondary btn-sm"
              [disabled]="store.currentPage() <= 1"
              (click)="changePage(store.currentPage() - 1)">
              ← Prev
            </button>
            <button
              class="btn btn-secondary btn-sm"
              [disabled]="store.currentPage() >= store.totalPages()"
              (click)="changePage(store.currentPage() + 1)">
              Next →
            </button>
          </div>
        </div>
      }
    }
  `,
  styles: [`
    .filter-bar {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 16px;
      padding: 12px 16px;
      flex-wrap: wrap;
    }
    .pagination {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 16px 0;
      font-size: 13px;
    }
    .ws-status {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-size: 11px;
      color: var(--color-text-muted);
      margin-bottom: 16px;
    }
    .ws-dot {
      width: 8px; height: 8px;
      border-radius: 50%;
      background: var(--color-text-muted);
    }
    .ws-status.connected .ws-dot { background: var(--color-success); }
    .ws-status.connected { color: var(--color-success); }
  `],
})
export class OrderListComponent implements OnInit {
  readonly store = inject(OrderStore);
  private readonly ws = inject(WebSocketService);

  readonly wsConnected = signal(false);

  readonly statusOptions = [
    { label: 'All', value: '' as OrderStatus | '' },
    { label: 'Pending', value: 'PENDING' as OrderStatus },
    { label: 'Processing', value: 'PROCESSING' as OrderStatus },
    { label: 'Completed', value: 'COMPLETED' as OrderStatus },
    { label: 'Failed', value: 'FAILED' as OrderStatus },
  ];

  constructor() {
    /**
     * Subscribe to global WebSocket events.
     * takeUntilDestroyed() automatically unsubscribes when this component
     * is destroyed — no manual ngOnDestroy needed.
     *
     * filter() — only process OrderStatusChanged events (ignore Ping/Connected)
     * tap()    — side effect: update the Signal in the store
     *
     * This is the RxJS → Signal bridge pattern:
     * Observable event stream → update shared signal state
     */
    this.ws
      .connectGlobal()
      .pipe(
        tap(() => this.wsConnected.set(true)),
        filter((event) => event.event_type === 'OrderStatusChanged'),
        tap((event) => {
          if (event.order_id && event.status) {
            this.store.updateOrderStatus(event.order_id, event.status);
          }
        }),
        takeUntilDestroyed()
      )
      .subscribe();
  }

  ngOnInit(): void {
    this.store.loadOrders();
  }

  applyFilter(status: OrderStatus | ''): void {
    this.store.statusFilter.set(status);
    this.store.loadOrders(1, status);
  }

  changePage(page: number): void {
    this.store.loadOrders(page, this.store.statusFilter());
  }
}
