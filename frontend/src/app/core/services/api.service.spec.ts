/**
 * src/app/core/services/api.service.spec.ts
 * ─────────────────────────────────────────────
 * Unit tests for ApiService.
 *
 * Angular HTTP Testing:
 * ──────────────────────
 * provideHttpClientTesting() replaces the real HttpClient with a mock
 * (HttpTestingController).  We can:
 * - Inspect requests that were made
 * - Assert their URL, method, params, headers
 * - Flush fake responses
 * - Verify no unexpected requests were made
 *
 * This is a UNIT test — it tests the service in isolation, no real HTTP.
 *
 * Unit vs Integration vs E2E:
 * ────────────────────────────
 * Unit test:        Test a single class/function in isolation.
 *                   Fast (<1ms), no I/O, mock all dependencies.
 * Integration test: Test how multiple units work together.
 *                   May use a real (test) DB, real HTTP client.
 * E2E test:         Test the full application in a real browser.
 *                   Slow, catches integration bugs, uses Cypress/Playwright.
 */

import { TestBed } from '@angular/core/testing';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { ApiService } from './api.service';
import { DashboardStats, Order, OrderListResponse } from '../models/order.models';

const mockOrder: Order = {
  id: 1,
  customer_id: 101,
  status: 'PENDING',
  total_amount: 999,
  retry_count: 0,
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
  items: [],
  events: [],
};

describe('ApiService', () => {
  let service: ApiService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        ApiService,
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });
    service = TestBed.inject(ApiService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    // Verify no unexpected HTTP requests were made
    httpMock.verify();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('getOrders() should GET /api/v1/orders with pagination params', () => {
    const mockResponse: OrderListResponse = {
      items: [mockOrder],
      total: 1,
      page: 1,
      page_size: 20,
      total_pages: 1,
    };

    service.getOrders(1, 20).subscribe((res) => {
      expect(res.items.length).toBe(1);
      expect(res.total).toBe(1);
    });

    const req = httpMock.expectOne(
      (r) => r.url.includes('/api/v1/orders') && r.params.get('page') === '1'
    );
    expect(req.request.method).toBe('GET');
    req.flush(mockResponse);
  });

  it('getOrders() with status filter should include status param', () => {
    service.getOrders(1, 20, 'PENDING').subscribe();

    const req = httpMock.expectOne(
      (r) => r.url.includes('/api/v1/orders') && r.params.get('status') === 'PENDING'
    );
    req.flush({ items: [], total: 0, page: 1, page_size: 20, total_pages: 0 });
  });

  it('getOrder() should GET /api/v1/orders/{id}', () => {
    service.getOrder(1).subscribe((order) => {
      expect(order.id).toBe(1);
      expect(order.status).toBe('PENDING');
    });

    const req = httpMock.expectOne('/api/v1/orders/1');
    expect(req.request.method).toBe('GET');
    req.flush(mockOrder);
  });

  it('createOrder() should POST to /api/v1/orders', () => {
    const payload = {
      customer_id: 101,
      items: [{ product_id: 'P1', quantity: 2, price: 100 }],
    };

    service.createOrder(payload).subscribe((order) => {
      expect(order.status).toBe('PENDING');
      expect(order.customer_id).toBe(101);
    });

    const req = httpMock.expectOne('/api/v1/orders');
    expect(req.request.method).toBe('POST');
    expect(req.request.body.customer_id).toBe(101);
    req.flush({ ...mockOrder, customer_id: 101 });
  });

  it('retryOrder() should POST to /api/v1/orders/{id}/retry', () => {
    service.retryOrder(5).subscribe();

    const req = httpMock.expectOne('/api/v1/orders/5/retry');
    expect(req.request.method).toBe('POST');
    req.flush(mockOrder);
  });

  it('getOrderEvents() should GET /api/v1/orders/{id}/events', () => {
    service.getOrderEvents(1).subscribe((events) => {
      expect(Array.isArray(events)).toBeTrue();
    });

    const req = httpMock.expectOne('/api/v1/orders/1/events');
    expect(req.request.method).toBe('GET');
    req.flush([]);
  });

  it('getDashboardStats() should GET /api/v1/dashboard/stats', () => {
    const mockStats: DashboardStats = {
      total_orders: 10,
      pending_orders: 2,
      processing_orders: 1,
      completed_orders: 6,
      failed_orders: 1,
      recent_orders: [],
    };

    service.getDashboardStats().subscribe((stats) => {
      expect(stats.total_orders).toBe(10);
      expect(stats.completed_orders).toBe(6);
    });

    const req = httpMock.expectOne('/api/v1/dashboard/stats');
    expect(req.request.method).toBe('GET');
    req.flush(mockStats);
  });
});
