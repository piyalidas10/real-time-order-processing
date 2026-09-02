/**
 * src/app/core/services/notification.service.ts
 * ─────────────────────────────────────────────────
 * In-app toast notification service.
 * Uses Signals to manage the active toast list.
 */

import { Injectable, signal } from '@angular/core';

export interface Toast {
  id: string;
  message: string;
  type: 'success' | 'error' | 'info' | 'warning';
}

@Injectable({ providedIn: 'root' })
export class NotificationService {
  readonly toasts = signal<Toast[]>([]);

  show(message: string, type: Toast['type'] = 'info', durationMs = 4000): void {
    const id = crypto.randomUUID();
    this.toasts.update((t) => [...t, { id, message, type }]);
    setTimeout(() => this.dismiss(id), durationMs);
  }

  dismiss(id: string): void {
    this.toasts.update((t) => t.filter((toast) => toast.id !== id));
  }

  success(message: string): void { this.show(message, 'success'); }
  error(message: string): void   { this.show(message, 'error'); }
  info(message: string): void    { this.show(message, 'info'); }
  warning(message: string): void { this.show(message, 'warning'); }
}
