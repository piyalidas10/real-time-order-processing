/**
 * src/app/core/services/notification.service.spec.ts
 * ─────────────────────────────────────────────────────
 * Tests for the NotificationService Signal-based toast management.
 */

import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { NotificationService, Toast } from './notification.service';

describe('NotificationService', () => {
  let service: NotificationService;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [NotificationService] });
    service = TestBed.inject(NotificationService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('initial toasts signal should be empty', () => {
    expect(service.toasts()).toEqual([]);
  });

  it('show() should add a toast', () => {
    service.show('Test message', 'info');
    expect(service.toasts().length).toBe(1);
    expect(service.toasts()[0].message).toBe('Test message');
    expect(service.toasts()[0].type).toBe('info');
  });

  it('success() should add a success toast', () => {
    service.success('Order created');
    expect(service.toasts()[0].type).toBe('success');
  });

  it('error() should add an error toast', () => {
    service.error('Something went wrong');
    expect(service.toasts()[0].type).toBe('error');
  });

  it('dismiss() should remove the toast by ID', () => {
    service.show('Toast 1', 'info');
    service.show('Toast 2', 'info');
    const id = service.toasts()[0].id;

    service.dismiss(id);

    expect(service.toasts().length).toBe(1);
    expect(service.toasts()[0].message).toBe('Toast 2');
  });

  it('toast should auto-dismiss after duration', fakeAsync(() => {
    service.show('Auto dismiss', 'info', 1000);
    expect(service.toasts().length).toBe(1);

    tick(1000);

    expect(service.toasts().length).toBe(0);
  }));

  it('multiple toasts should coexist', () => {
    service.success('Success 1');
    service.error('Error 1');
    service.info('Info 1');

    expect(service.toasts().length).toBe(3);
  });
});
