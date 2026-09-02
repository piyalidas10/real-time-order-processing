/**
 * src/app/shared/components/toast/toast.component.ts
 * ─────────────────────────────────────────────────────
 * Global toast notification display.
 * Reads from NotificationService's signal — no @Input needed.
 */

import { Component, inject } from '@angular/core';
import { NotificationService } from '../../../core/services/notification.service';

@Component({
  selector: 'app-toast',
  standalone: true,
  template: `
    <div class="toast-container">
      @for (toast of notify.toasts(); track toast.id) {
        <div class="toast toast-{{ toast.type }}">
          <span>{{ toast.message }}</span>
          <button class="toast-close" (click)="notify.dismiss(toast.id)">✕</button>
        </div>
      }
    </div>
  `,
  styles: [`
    .toast-container {
      position: fixed;
      bottom: 24px;
      right: 24px;
      z-index: 9999;
      display: flex;
      flex-direction: column;
      gap: 8px;
      max-width: 380px;
    }
    .toast {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 12px 16px;
      border-radius: 8px;
      font-size: 13px;
      animation: slideIn 0.2s ease;
    }
    .toast-success { background: rgba(34,197,94,.15); border: 1px solid rgba(34,197,94,.4); color: #86efac; }
    .toast-error   { background: rgba(239,68,68,.15); border: 1px solid rgba(239,68,68,.4); color: #fca5a5; }
    .toast-info    { background: rgba(99,102,241,.15); border: 1px solid rgba(99,102,241,.4); color: #a5b4fc; }
    .toast-warning { background: rgba(245,158,11,.15); border: 1px solid rgba(245,158,11,.4); color: #fde68a; }
    .toast-close {
      background: none; border: none; cursor: pointer;
      color: inherit; opacity: 0.7; padding: 0; font-size: 12px;
    }
    .toast-close:hover { opacity: 1; }
    @keyframes slideIn { from { transform: translateX(100%); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
  `],
})
export class ToastComponent {
  readonly notify = inject(NotificationService);
}
