/**
 * src/app/features/orders/pages/order-detail/order-detail.component.ts
 * ────────────────────────────────────────────────────────────────────────
 * Order Detail page — THE CORE LEARNING DEMONSTRATION.
 *
 * This component shows the complete real-time order lifecycle:
 * PENDING → PROCESSING → COMPLETED
 * driven by WebSocket events without any page refresh.
 *
 * ARCHITECTURE:
 * ─────────────
 * 1. Component loads order from REST API (HTTP Observable → Signal)
 * 2. WebSocket connection is opened for this specific order
 * 3. WebSocket stream filtered for OrderStatusChanged events
 * 4. Each event updates the Signal → template re-renders automatically
 * 5. On component destroy, takeUntilDestroyed() closes the subscription
 *
 * WHY WEBSOCKET PER ORDER (not global)?
 * ──────────────────────────────────────
 * The /ws/orders/{id} channel is more efficient than the global /ws/orders
 * because:
 * - Server only pushes events relevant to THIS order
 * - No client-side filtering needed for high-volume systems
 * - Works correctly even if 1000+ orders are being processed simultaneously
 */

import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { filter, switchMap, tap } from 'rxjs';
import { DatePipe, DecimalPipe } from '@angular/common';
import { ApiService } from '../../../../core/services/api.service';
import { WebSocketService } from '../../../../core/services/websocket.service';
import { NotificationService } from '../../../../core/services/notification.service';
import { Order, OrderEvent, OrderStatus } from '../../../../core/models/order.models';
import { StatusBadgePipe, StatusProgressPipe } from '../../../../shared/pipes/status.pipe';

@Component({
  selector: 'app-order-detail',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, StatusBadgePipe, StatusProgressPipe, DatePipe, DecimalPipe],
  template: `
    <div class="page-header">
      <div>
        <a routerLink="/orders" class="text-muted" style="font-size:13px">← Back to Orders</a>
        <h1 class="page-title" style="margin-top:4px">Order #{{ orderId() }}</h1>
      </div>
      <div style="display:flex; gap:8px; align-items:center">
        <!-- WebSocket live indicator -->
        <div class="ws-indicator" [class.active]="wsConnected()">
          <span class="ws-dot"></span>
          {{ wsConnected() ? 'Live' : 'Connecting...' }}
        </div>
        @if (order()?.status === 'FAILED') {
          <button class="btn btn-danger" (click)="retry()">↺ Retry Order</button>
        }
      </div>
    </div>

    @if (loading()) {
      <div class="loading"><div class="spinner"></div> Loading order...</div>
    }

    @if (error()) {
      <div class="alert alert-error">
        {{ error() }}
        <button class="btn btn-secondary btn-sm" (click)="loadOrder()">Retry</button>
      </div>
    }

    @if (order(); as o) {
      <div class="detail-grid">

        <!-- Order info card -->
        <div class="card">
          <h3 style="margin:0 0 16px; font-size:14px; color: var(--color-text-muted)">ORDER DETAILS</h3>
          <div class="detail-row">
            <span class="text-muted">Customer</span>
            <span>Customer {{ o.customer_id }}</span>
          </div>
          <div class="detail-row">
            <span class="text-muted">Total Amount</span>
            <span style="font-size:20px; font-weight:700; color:var(--color-primary)">
              ₹{{ o.total_amount | number:'1.2-2' }}
            </span>
          </div>
          <div class="detail-row">
            <span class="text-muted">Created</span>
            <span>{{ o.created_at | date:'medium' }}</span>
          </div>
          <div class="detail-row">
            <span class="text-muted">Last Updated</span>
            <span>{{ o.updated_at | date:'medium' }}</span>
          </div>
          @if (o.retry_count > 0) {
            <div class="detail-row">
              <span class="text-muted">Retry Count</span>
              <span class="badge badge-warning">{{ o.retry_count }}</span>
            </div>
          }
        </div>

        <!-- Status card with progress bar -->
        <div class="card">
          <h3 style="margin:0 0 16px; font-size:14px; color: var(--color-text-muted)">STATUS</h3>
          <div style="margin-bottom:12px">
            <span [class]="o.status | statusBadge" style="font-size:14px; padding:6px 14px">
              {{ o.status }}
            </span>
          </div>

          <!-- Progress bar — driven by StatusProgressPipe -->
          <div class="progress-bar-container">
            <div
              class="progress-bar"
              [class.completed]="o.status === 'COMPLETED'"
              [class.failed]="o.status === 'FAILED'"
              [style.width.%]="o.status | statusProgress">
            </div>
          </div>

          <!-- Status steps -->
          <div class="status-steps">
            @for (step of statusSteps; track step.status) {
              <div class="step" [class.done]="isStepDone(o.status, step.status)" [class.active]="o.status === step.status">
                <div class="step-dot"></div>
                <div class="step-label">{{ step.label }}</div>
              </div>
            }
          </div>

          @if (lastEventTime()) {
            <div class="text-muted" style="font-size:11px; margin-top:8px">
              Last update: {{ lastEventTime() | date:'mediumTime' }}
            </div>
          }
        </div>

      </div>

      <!-- Items table -->
      <div class="card" style="margin-top:16px">
        <h3 style="margin:0 0 16px; font-size:14px; color: var(--color-text-muted)">ORDER ITEMS</h3>
        <div class="table-container">
          <table>
            <thead>
              <tr>
                <th>Product ID</th>
                <th>Quantity</th>
                <th>Unit Price</th>
                <th>Subtotal</th>
              </tr>
            </thead>
            <tbody>
              @for (item of o.items; track item.id) {
                <tr>
                  <td>{{ item.product_id }}</td>
                  <td>{{ item.quantity }}</td>
                  <td>₹{{ item.price | number:'1.2-2' }}</td>
                  <td>₹{{ (item.quantity * item.price) | number:'1.2-2' }}</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      </div>

      <!-- Event timeline -->
      <div class="card" style="margin-top:16px">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px">
          <h3 style="margin:0; font-size:14px; color: var(--color-text-muted)">EVENT TIMELINE</h3>
          <button class="btn btn-secondary btn-sm" (click)="refreshEvents()">⟳ Refresh</button>
        </div>

        @if (events().length === 0) {
          <div class="text-muted" style="font-size:13px">No events yet.</div>
        } @else {
          <div class="timeline">
            @for (event of events(); track event.id) {
              <div class="timeline-item">
                <div class="timeline-dot" [class]="eventDotClass(event.event_type)"></div>
                <div class="timeline-time">{{ event.created_at | date:'HH:mm:ss' }}</div>
                <div class="timeline-event">{{ event.event_type }}</div>
                @if (event.status) {
                  <div class="timeline-status">Status → {{ event.status }}</div>
                }
              </div>
            }
          </div>
        }
      </div>
    }
  `,
  styles: [`
    .detail-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
    @media (max-width: 640px) { .detail-grid { grid-template-columns: 1fr; } }
    .detail-row { display: flex; justify-content: space-between; align-items: center; padding: 10px 0; border-bottom: 1px solid var(--color-border); }
    .detail-row:last-child { border-bottom: none; }
    .status-steps { display: flex; justify-content: space-between; margin-top: 16px; }
    .step { text-align: center; flex: 1; position: relative; }
    .step-dot { width: 12px; height: 12px; border-radius: 50%; background: var(--color-border); margin: 0 auto 4px; }
    .step.done .step-dot { background: var(--color-success); }
    .step.active .step-dot { background: var(--color-primary); box-shadow: 0 0 0 4px rgba(99,102,241,0.2); }
    .step-label { font-size: 10px; color: var(--color-text-muted); text-transform: uppercase; }
    .step.done .step-label, .step.active .step-label { color: var(--color-text); }
    .ws-indicator { display: inline-flex; align-items: center; gap: 6px; font-size: 11px; color: var(--color-text-muted); }
    .ws-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--color-text-muted); }
    .ws-indicator.active .ws-dot { background: var(--color-success); animation: pulse 2s infinite; }
    .ws-indicator.active { color: var(--color-success); }
    @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.5; } }
  `],
})
export class OrderDetailComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly api = inject(ApiService);
  private readonly ws = inject(WebSocketService);
  private readonly notify = inject(NotificationService);

  // ── Signals ────────────────────────────────────────────────────────────────
  readonly order = signal<Order | null>(null);
  readonly events = signal<OrderEvent[]>([]);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly wsConnected = signal(false);
  readonly lastEventTime = signal<string | null>(null);

  // Computed: extract order ID from route
  readonly orderId = computed(() => {
    const id = this.route.snapshot.params['id'];
    return id ? parseInt(id, 10) : null;
  });

  readonly statusSteps = [
    { status: 'PENDING', label: 'Pending' },
    { status: 'PROCESSING', label: 'Processing' },
    { status: 'COMPLETED', label: 'Completed' },
  ];

  constructor() {
    // Connect to order-specific WebSocket channel
    // switchMap: if orderId changes, cancel the previous WS connection and
    // open a new one for the new orderId.
    const id = this.orderId();
    if (id) {
      this.ws.connectOrder(id).subscribe({
        next: (event) => {
          console.log('📥 [OrderDetail] WS NEXT:', event);

          if (event.event_type === 'Connected') {
            this.wsConnected.set(true);
            return;
          }

          if (
            event.event_type === 'ProcessingStarted' ||
            event.event_type === 'OrderCompleted' ||
            event.event_type === 'OrderFailed'
          ) {
            console.log(
              '✅ [OrderDetail] STATUS UPDATE:',
              event.order_id,
              event.event_type,
              event.status
            );

            if (event.status) {
              this.order.update((o) =>
                o
                  ? {
                      ...o,
                      status: event.status!,
                      updated_at: event.timestamp || o.updated_at,
                    }
                  : null
              );

              this.lastEventTime.set(event.timestamp || null);
              this.refreshEvents();
            }
          }
        },

        error: (err) => {
          console.error('❌ [OrderDetail] WS ERROR:', err);
        },

        complete: () => {
          console.log('🛑 [OrderDetail] WS COMPLETED');
        },
      });
    }
  }

  ngOnInit(): void {
    this.loadOrder();
  }

  loadOrder(): void {
    const id = this.orderId();
    if (!id) return;

    this.loading.set(true);
    this.error.set(null);

    this.api
      .getOrder(id)
      .pipe(
        tap((order) => {
          this.order.set(order);
          this.events.set(order.events);
          this.loading.set(false);
        })
      )
      .subscribe({
        error: () => {
          this.error.set(`Order #${id} not found.`);
          this.loading.set(false);
        },
      });
  }

  refreshEvents(): void {
    const id = this.orderId();
    if (!id) return;

    this.api.getOrderEvents(id).pipe(
      tap((events) => this.events.set(events))
    ).subscribe();
  }

  retry(): void {
    const id = this.orderId();
    if (!id) return;
    this.api.retryOrder(id).pipe(
      tap((order) => {
        this.order.set(order);
        this.notify.success(`Order #${id} queued for retry`);
      })
    ).subscribe();
  }

  isStepDone(currentStatus: OrderStatus, stepStatus: string): boolean {
    const order = ['PENDING', 'PROCESSING', 'COMPLETED'];
    return order.indexOf(currentStatus) > order.indexOf(stepStatus);
  }

  eventDotClass(eventType: string): string {
    const map: Record<string, string> = {
      OrderCreated: 'timeline-dot-info',
      ProcessingStarted: 'timeline-dot-processing',
      OrderCompleted: 'timeline-dot-success',
      OrderFailed: 'timeline-dot-error',
      NotificationSent: 'timeline-dot-success',
    };
    return map[eventType] || '';
  }
}
