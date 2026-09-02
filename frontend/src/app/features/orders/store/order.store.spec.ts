/**
 * src/app/features/orders/store/order.store.spec.ts
 * ──────────────────────────────────────────────────────
 * Unit tests for OrderStore (Signals + RxJS).
 *
 * Tests verify:
 * - Initial signal values
 * - Signal updates from HTTP responses
 * - Computed signal derivations
 * - updateOrderStatus() merges correctly
 */

import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { OrderStore } from './order.store';
import { Order, OrderListResponse } from '../../../core/models/order.models';

const makeOrder = (id: number, status: Order['status']): Order => ({
  id,
  customer_id: 100,
  status,
  total_amount: 500,
  retry_count: 0,
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
  items: [],
  events: [],
});

describe('OrderStore', () => {
  let store: OrderStore;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        OrderStore,
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });
    store = TestBed.inject(OrderStore);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('should have correct initial signal values', () => {
    expect(store.orders()).toEqual([]);
    expect(store.selectedOrder()).toBeNull();
    expect(store.loading()).toBeFalse();
    expect(store.error()).toBeNull();
  });

  it('loadOrders() should set orders signal from HTTP response', fakeAsync(() => {
    const mockResponse: OrderListResponse = {
      items: [makeOrder(1, 'PENDING'), makeOrder(2, 'COMPLETED')],
      total: 2,
      page: 1,
      page_size: 20,
      total_pages: 1,
    };

    store.loadOrders();
    expect(store.loading()).toBeTrue();

    const req = httpMock.expectOne((r) => r.url.includes('/api/v1/orders'));
    req.flush(mockResponse);
    tick();

    expect(store.orders().length).toBe(2);
    expect(store.loading()).toBeFalse();
    expect(store.totalOrders()).toBe(2);
  }));

  it('computed processingOrders should filter correctly', fakeAsync(() => {
    const mockResponse: OrderListResponse = {
      items: [
        makeOrder(1, 'PENDING'),
        makeOrder(2, 'PROCESSING'),
        makeOrder(3, 'PROCESSING'),
        makeOrder(4, 'COMPLETED'),
      ],
      total: 4,
      page: 1,
      page_size: 20,
      total_pages: 1,
    };

    store.loadOrders();
    httpMock.expectOne((r) => r.url.includes('/api/v1/orders')).flush(mockResponse);
    tick();

    // computed() derived automatically — no explicit trigger needed
    expect(store.processingOrders().length).toBe(2);
    expect(store.completedOrders().length).toBe(1);
    expect(store.failedOrders().length).toBe(0);
  }));

  it('updateOrderStatus() should update status without HTTP call', fakeAsync(() => {
    const mockResponse: OrderListResponse = {
      items: [makeOrder(1, 'PENDING'), makeOrder(2, 'PENDING')],
      total: 2,
      page: 1,
      page_size: 20,
      total_pages: 1,
    };

    store.loadOrders();
    httpMock.expectOne((r) => r.url.includes('/api/v1/orders')).flush(mockResponse);
    tick();

    // Simulate WebSocket event arriving
    store.updateOrderStatus(1, 'COMPLETED');

    const updated = store.orders().find((o) => o.id === 1);
    expect(updated?.status).toBe('COMPLETED');

    // Order 2 should be unchanged
    const unchanged = store.orders().find((o) => o.id === 2);
    expect(unchanged?.status).toBe('PENDING');
  }));

  it('updateOrderStatus() should also update selectedOrder if IDs match', fakeAsync(() => {
    const order = makeOrder(5, 'PROCESSING');
    store.selectedOrder.set(order);

    store.updateOrderStatus(5, 'COMPLETED');

    expect(store.selectedOrder()?.status).toBe('COMPLETED');
  }));

  it('loadOrders() error should set error signal', fakeAsync(() => {
    store.loadOrders();
    httpMock
      .expectOne((r) => r.url.includes('/api/v1/orders'))
      .flush('Server Error', { status: 500, statusText: 'Internal Server Error' });
    tick();

    expect(store.error()).toBeTruthy();
    expect(store.loading()).toBeFalse();
  }));
});
