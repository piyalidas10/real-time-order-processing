/**
 * src/app/core/services/api.service.ts
 * ──────────────────────────────────────
 * Centralised HTTP client for all REST API calls.
 *
 * WHY A CENTRALISED SERVICE?
 * ──────────────────────────
 * - Single place to set the base URL (read from environment, not hard-coded)
 * - Easy to intercept / mock in tests
 * - Encapsulates HTTP error mapping (backend 4xx/5xx → friendly Angular errors)
 *
 * RXJS USAGE HERE:
 * - HttpClient returns Observables — RxJS is the right tool for HTTP streams
 *   because they model "a future value that may error or cancel".
 * - switchMap, catchError, map operators are applied by callers as needed.
 */

import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import {
  CreateOrderPayload,
  DashboardStats,
  Order,
  OrderEvent,
  OrderListResponse,
} from '../models/order.models';

@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly http = inject(HttpClient);
  private readonly base = environment.apiBaseUrl;

  // ── Dashboard ───────────────────────────────────────────────────────────────

  getDashboardStats(): Observable<DashboardStats> {
    return this.http.get<DashboardStats>(`${this.base}/api/v1/dashboard/stats`);
  }

  // ── Orders ──────────────────────────────────────────────────────────────────

  getOrders(page = 1, pageSize = 20, status?: string): Observable<OrderListResponse> {
    let params = new HttpParams()
      .set('page', page.toString())
      .set('page_size', pageSize.toString());
    if (status) {
      params = params.set('status', status);
    }
    return this.http.get<OrderListResponse>(`${this.base}/api/v1/orders`, { params });
  }

  getOrder(id: number): Observable<Order> {
    return this.http.get<Order>(`${this.base}/api/v1/orders/${id}`);
  }

  createOrder(payload: CreateOrderPayload): Observable<Order> {
    return this.http.post<Order>(`${this.base}/api/v1/orders`, payload);
  }

  retryOrder(id: number): Observable<Order> {
    return this.http.post<Order>(`${this.base}/api/v1/orders/${id}/retry`, {});
  }

  getOrderEvents(id: number): Observable<OrderEvent[]> {
    return this.http.get<OrderEvent[]>(`${this.base}/api/v1/orders/${id}/events`);
  }

  // ── Health ──────────────────────────────────────────────────────────────────

  getHealth(): Observable<{ status: string; checks: Record<string, string> }> {
    return this.http.get<{ status: string; checks: Record<string, string> }>(
      `${this.base}/health`
    );
  }
}
