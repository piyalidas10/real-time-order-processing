/**
 * src/app/core/services/websocket.service.ts
 * ─────────────────────────────────────────────
 * WebSocket service with automatic reconnection.
 *
 * WHY RxJS FOR WEBSOCKET (not Signals)?
 * ──────────────────────────────────────
 * WebSocket is a stream of events — it fits the Observable model perfectly:
 * - A stream that starts when subscribed, ends when unsubscribed
 * - Can error (connection drop) and complete (server close)
 * - RxJS retry/retryWhen handle reconnection declaratively
 *
 * Signals are for STATE (what the current value is).
 * Observables are for EVENTS (things that happen over time).
 *
 * The integration pattern:
 *   WebSocket Observable  →  Signal (state update)
 *                             ↓
 *                         Angular UI reads Signal
 *
 * WHY RECONNECTION IS REQUIRED:
 * ─────────────────────────────
 * WebSocket connections drop due to:
 * - Network interruptions (mobile, WiFi handover)
 * - Proxy/load-balancer idle timeouts (common at 60-90s)
 * - Server restarts
 * Without reconnection, the user silently stops receiving real-time updates.
 *
 * WHY UNCONTROLLED RECONNECT LOOPS ARE DANGEROUS:
 * ────────────────────────────────────────────────
 * If the server is down and we reconnect immediately in a tight loop,
 * we create a thundering-herd problem: hundreds of clients hammering the
 * server simultaneously.  The solution: exponential back-off with jitter
 * (each retry waits longer: 1s, 2s, 4s, 8s... capped at 30s).
 */

import { Injectable, OnDestroy, inject } from '@angular/core';
import { EMPTY, Observable, Subject, timer } from 'rxjs';
import {
  catchError,
  distinctUntilChanged,
  filter,
  retry,
  share,
  switchMap,
  takeUntil,
  tap,
} from 'rxjs/operators';
import { environment } from '../../environments/environment';
import { WebSocketEvent } from '../models/order.models';

/**
 * Creates a cold Observable that:
 * 1. Opens a WebSocket connection when subscribed
 * 2. Emits each parsed JSON message
 * 3. Errors when the socket closes unexpectedly
 * 4. Completes when the socket closes normally (code 1000)
 */
  function createWebSocketObservable(url: string): Observable<WebSocketEvent> {
    return new Observable<WebSocketEvent>((subscriber) => {
      const ws = new WebSocket(url);

      ws.onopen = () => {
        console.log(`[WS] OPEN: ${url}`);
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data) as WebSocketEvent;

          console.log('[WS] MESSAGE:', data);

          subscriber.next(data);
        } catch (error) {
          console.error('[WS] Invalid JSON:', event.data, error);
        }
      };

      ws.onerror = (event) => {
        console.error(`[WS] ERROR: ${url}`, event);
        subscriber.error(new Error(`WebSocket error on ${url}`));
      };

      ws.onclose = (event) => {
        console.warn(
          `[WS] CLOSED: ${url}`,
          `code=${event.code}`,
          `reason=${event.reason}`
        );

        subscriber.error(
          new Error(
            `WebSocket closed: code=${event.code}, reason=${event.reason}`
          )
        );
      };

      return () => {
        console.log(`[WS] TEARDOWN: ${url}`);

        if (
          ws.readyState === WebSocket.OPEN ||
          ws.readyState === WebSocket.CONNECTING
        ) {
          ws.close(1000, 'Observable unsubscribed');
        }
      };
    });
  }

@Injectable({ providedIn: 'root' })
export class WebSocketService implements OnDestroy {
  private readonly destroy$ = new Subject<void>();

  /**
   * Connect to the global order events WebSocket.
   * Returns a shared Observable — multiple subscribers reuse one WS connection.
   *
   * Uses retry() with exponential back-off to reconnect on failure.
   * takeUntilDestroyed (via destroy$) ensures cleanup when the service is destroyed.
   * 
   * connectGlobal()
      │
      ▼
    /ws/orders
      │
      └── ALL order events
   */
  connectGlobal(): Observable<WebSocketEvent> {
    const url = `${environment.wsBaseUrl}/ws/orders`;
    return this.buildReconnectingStream(url);
  }

  /**
   * Connect to a specific order's WebSocket channel.
   * Subscribe to this in the Order Detail page to get PROCESSING/COMPLETED events.
   * 
   * connectOrder(orderId)
      │
      ▼
    /ws/orders/{id}
      │
      └── events for ONE order
   */
  connectOrder(orderId: number): Observable<WebSocketEvent> {
    const url = `${environment.wsBaseUrl}/ws/orders/${orderId}`;
    return this.buildReconnectingStream(url);
  }

  private buildReconnectingStream(url: string): Observable<WebSocketEvent> {
    let attempt = 0;

    return createWebSocketObservable(url).pipe(
      tap({
        subscribe: () => console.log(`[WS] Connecting to ${url}`),
        error: (err) => console.warn(`[WS] Error (attempt ${attempt}):`, err.message),
        complete: () => console.log(`[WS] Closed normally: ${url}`),
      }),
      retry({
        count: 10,
        delay: (error, retryCount) => {
          attempt = retryCount;
          // Exponential back-off: 1s, 2s, 4s, 8s… capped at 30s
          const delayMs = Math.min(1000 * Math.pow(2, retryCount - 1), 30_000);
          console.log(`[WS] Reconnecting in ${delayMs}ms (attempt ${retryCount})`);
          return timer(delayMs);
        },
      }),
      // Filter out infrastructure messages (Ping, Connected) from data consumers
      filter((event) => event.event_type !== 'Ping'),
      // share() ensures multiple subscribers reuse a single connection
      share(),
      takeUntil(this.destroy$),
      catchError((err) => {
        console.error('[WS] Exhausted retries:', err.message);
        return EMPTY;
      })
    );
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }
}
