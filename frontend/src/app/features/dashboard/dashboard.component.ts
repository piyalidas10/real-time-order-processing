/**
 * src/app/features/dashboard/dashboard.component.ts
 * ────────────────────────────────────────────────────
 * Dashboard page.
 *
 * Demonstrates:
 * - signal() for local loading/error state
 * - Reactive data fetching with RxJS Observable → Signal bridge
 * - Modern Angular @if / @for control flow (no *ngIf, no *ngFor)
 * - Standalone component (no NgModule)
 */

import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  inject,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { catchError, EMPTY, filter, tap } from 'rxjs';
import { ApiService } from '../../core/services/api.service';
import { DashboardStats, Order } from '../../core/models/order.models';
import { StatusBadgePipe } from '../../shared/pipes/status.pipe';
import { DatePipe, DecimalPipe } from '@angular/common';
import { WebSocketService } from '@core/services/websocket.service';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, StatusBadgePipe, DatePipe, DecimalPipe],
  template: `
    <div class="page-header">
      <h1 class="page-title">📊 Order Processing Dashboard</h1>
      <button class="btn btn-secondary btn-sm" (click)="load()">⟳ Refresh</button>
    </div>

    <!-- Loading state -->
    @if (loading()) {
      <div class="loading"><div class="spinner"></div> Loading dashboard...</div>
    }

    <!-- Error state -->
    @if (error()) {
      <div class="alert alert-error">
        {{ error() }}
        <button class="btn btn-secondary btn-sm mt-4" (click)="load()">Retry</button>
      </div>
    }

    <!-- Stats cards -->
    @if (stats(); as s) {
      <div class="stats-grid">
        <div class="card stat-card">
          <div class="stat-value">{{ s.total_orders }}</div>
          <div class="stat-label">Total Orders</div>
        </div>
        <div class="card stat-card stat-pending">
          <div class="stat-value">{{ s.pending_orders }}</div>
          <div class="stat-label">Pending</div>
        </div>
        <div class="card stat-card stat-processing">
          <div class="stat-value">{{ s.processing_orders }}</div>
          <div class="stat-label">Processing</div>
        </div>
        <div class="card stat-card stat-completed">
          <div class="stat-value">{{ s.completed_orders }}</div>
          <div class="stat-label">Completed</div>
        </div>
        <div class="card stat-card stat-failed">
          <div class="stat-value">{{ s.failed_orders }}</div>
          <div class="stat-label">Failed</div>
        </div>
      </div>

      <!-- Recent orders table -->
      <div class="card" style="margin-top: 24px">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px">
          <h2 style="margin:0; font-size:16px">Recent Orders</h2>
          <a routerLink="/orders" class="btn btn-secondary btn-sm">View All →</a>
        </div>

        @if (s.recent_orders.length === 0) {
          <div class="empty-state">
            <div class="icon">📦</div>
            No orders yet. <a routerLink="/orders/new">Create your first order →</a>
          </div>
        } @else {
          <div class="table-container">
            <table>
              <thead>
                <tr>
                  <th>Order ID</th>
                  <th>Customer</th>
                  <th>Amount</th>
                  <th>Status</th>
                  <th>Created</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                @for (order of s.recent_orders; track order.id) {
                  <tr>
                    <td><strong>#{{ order.id }}</strong></td>
                    <td>Customer {{ order.customer_id }}</td>
                    <td>₹{{ order.total_amount | number:'1.2-2' }}</td>
                    <td><span [class]="order.status | statusBadge">{{ order.status }}</span></td>
                    <td class="text-muted">{{ order.created_at | date:'short' }}</td>
                    <td>
                      <a [routerLink]="['/orders', order.id]" class="btn btn-secondary btn-sm">
                        View →
                      </a>
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }
      </div>

      <!-- Quick actions -->
      <div style="margin-top: 24px; display: flex; gap: 12px">
        <a routerLink="/orders/new" class="btn btn-primary">➕ Create New Order</a>
        <a routerLink="/orders" class="btn btn-secondary">📋 All Orders</a>
        <a routerLink="/events" class="btn btn-secondary">📜 Event Log</a>
      </div>
    }
  `,
  styles: [`
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
      gap: 16px;
    }
    .stat-card { text-align: center; padding: 20px; }
    .stat-value { font-size: 36px; font-weight: 700; margin-bottom: 4px; }
    .stat-label { font-size: 12px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--color-text-muted); }
    .stat-pending .stat-value   { color: var(--color-warning); }
    .stat-processing .stat-value { color: var(--color-primary); }
    .stat-completed .stat-value  { color: var(--color-success); }
    .stat-failed .stat-value     { color: var(--color-danger); }
  `],
})
export class DashboardComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly ws = inject(WebSocketService);

  // ── Signals ────────────────────────────────────────────────────────────────
  // signal<T | null>(null) — initial null; set after HTTP response arrives
  readonly stats = signal<DashboardStats | null>(null);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);

  ngOnInit(): void {
    // 1. Load initial dashboard state using REST 
    this.load(); 
    // 2. Listen for real-time order events
    this.listenForOrderUpdates();
  }

  /** 
   * Initial / refreshed dashboard state.
   * REST API remains the source of truth. 
   */
  load(): void {
    this.loading.set(true);
    this.error.set(null);

    // RxJS Observable → Signal bridge
    // We subscribe once, update the signal with the result, then unsubscribe.
    // tap() is side-effect operator — runs the function without modifying the stream.
    // catchError() handles errors without crashing the stream.
    // Initial page load GET /dashboard/stats to populate the dashboard.
    this.api
      .getDashboardStats()
      .pipe(
        tap((data) => {
          this.stats.set(data);   // ← Signal updated, template re-renders automatically
          this.loading.set(false);
        }),
        catchError(() => {
          this.error.set('Failed to load dashboard statistics.');
          this.loading.set(false);
          return EMPTY;
        })
      )
      .subscribe();
  }

  /** 
   * Listen to the global WebSocket.
   * Every order event can potentially change
   * dashboard statistics.
   * 
   * When OrderStatusChanged arrives: 
   * 
   * WebSocket
   * ↓
   * OrderStatusChanged
   * ↓
   * load()
   * ↓
   * GET /dashboard/stats
   * ↓
   * stats.set(...)
   * ↓
   * Angular UI updates
   */
  private listenForOrderUpdates(): void {
  console.log('[Dashboard] Starting global WebSocket...');

  this.ws
    .connectGlobal()
    .pipe(
      tap(event => {
        console.log('[Dashboard] WebSocket EVENT RECEIVED:', event);
      }),
      filter(
        event =>
          event.event_type === 'OrderCreated' ||
          event.event_type === 'ProcessingStarted' ||
          event.event_type === 'OrderCompleted' ||
          event.event_type === 'OrderFailed'
      ),
      tap(event => {
        console.log(
          '[Dashboard] REFRESHING because of:',
          event.event_type
        );

        this.load();
      }),
        takeUntilDestroyed()
      )
      .subscribe({
        error: err => {
          console.error('[Dashboard] WebSocket ERROR:', err);
        },
        complete: () => {
          console.log('[Dashboard] WebSocket COMPLETED');
        }
      });
  }
}
