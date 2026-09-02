/**
 * src/app/features/events/events.component.ts
 * ─────────────────────────────────────────────
 * Event Log page — shows live WebSocket events and allows loading
 * the full event history for any recent order.
 *
 * Demonstrates:
 * - Global WebSocket subscription
 * - RxJS scan() to accumulate events into an array
 * - toSignal() to convert Observable to Signal (Angular 16+ interop)
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
import { filter, scan, tap } from 'rxjs';
import { DatePipe } from '@angular/common';
import { WebSocketService } from '../../core/services/websocket.service';
import { WebSocketEvent } from '../../core/models/order.models';
import { StatusBadgePipe } from '../../shared/pipes/status.pipe';

interface LiveEvent extends WebSocketEvent {
  receivedAt: string;
}

@Component({
  selector: 'app-events',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, DatePipe, StatusBadgePipe],
  template: `
    <div class="page-header">
      <h1 class="page-title">📜 Live Event Log</h1>
      <div style="display:flex; gap:8px">
        <div class="ws-indicator" [class.active]="wsConnected()">
          <span class="ws-dot"></span>
          {{ wsConnected() ? 'Connected — watching live events' : 'Connecting...' }}
        </div>
        <button class="btn btn-secondary btn-sm" (click)="clearEvents()">Clear</button>
      </div>
    </div>

    <div class="card" style="margin-bottom:16px">
      <p style="margin:0; font-size:13px; color:var(--color-text-muted)">
        This page shows real-time WebSocket events as they arrive.
        Create an order and watch the events appear: <strong>OrderCreated → ProcessingStarted → OrderCompleted</strong>
      </p>
    </div>

    @if (liveEvents().length === 0) {
      <div class="card empty-state">
        <div class="icon">📡</div>
        <p>Waiting for events... Create an order to see the event flow.</p>
        <a routerLink="/orders/new" class="btn btn-primary">Create an Order</a>
      </div>
    } @else {
      <div class="card">
        <div class="table-container">
          <table>
            <thead>
              <tr>
                <th>Time</th>
                <th>Event Type</th>
                <th>Order</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              @for (event of liveEvents(); track event.receivedAt + event.order_id) {
                <tr class="event-row event-{{ event.event_type?.toLowerCase() }}">
                  <td class="text-muted">{{ event.receivedAt | date:'HH:mm:ss.SSS' }}</td>
                  <td><strong>{{ event.event_type }}</strong></td>
                  <td>
                    @if (event.order_id) {
                      <a [routerLink]="['/orders', event.order_id]" class="btn btn-secondary btn-sm">
                        #{{ event.order_id }}
                      </a>
                    }
                  </td>
                  <td>
                    @if (event.status) {
                      <span [class]="event.status | statusBadge">{{ event.status }}</span>
                    }
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
        <div class="text-muted" style="font-size:11px; padding:8px 0">
          Showing {{ liveEvents().length }} events (most recent first)
        </div>
      </div>
    }
  `,
  styles: [`
    .ws-indicator { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--color-text-muted); }
    .ws-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--color-text-muted); }
    .ws-indicator.active .ws-dot { background: var(--color-success); animation: pulse 2s infinite; }
    .ws-indicator.active { color: var(--color-success); }
    @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.5; } }
    .event-row { animation: fadeIn 0.3s ease; }
    @keyframes fadeIn { from { background: rgba(99,102,241,0.1); } to { background: transparent; } }
  `],
})
export class EventsComponent {
  private readonly ws = inject(WebSocketService);

  readonly wsConnected = signal(false);
  readonly liveEvents = signal<LiveEvent[]>([]);

  constructor() {
    /**
     * RxJS scan() operator: accumulates events into an array.
     *
     * scan(accumulator, seed) is like Array.reduce() but for streams:
     * - seed: initial value []
     * - accumulator: (currentArray, newEvent) → newArray
     *
     * Each new WebSocket event is prepended (most recent first).
     * Capped at 100 events to avoid memory growth.
     */
    this.ws
      .connectGlobal()
      .pipe(
        tap(() => this.wsConnected.set(true)),
        filter((event) => event.event_type === 'OrderStatusChanged'),
        tap((event) => {
          const liveEvent: LiveEvent = {
            ...event,
            receivedAt: new Date().toISOString(),
          };
          // Prepend and cap at 100
          this.liveEvents.update((events) =>
            [liveEvent, ...events].slice(0, 100)
          );
        }),
        takeUntilDestroyed()
      )
      .subscribe();
  }

  clearEvents(): void {
    this.liveEvents.set([]);
  }
}
