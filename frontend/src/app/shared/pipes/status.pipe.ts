/**
 * src/app/shared/pipes/status-color.pipe.ts
 * ───────────────────────────────────────────
 * Transforms an OrderStatus string into a CSS badge class.
 * Pure pipe — Angular only re-evaluates when the input changes.
 */

import { Pipe, PipeTransform } from '@angular/core';
import { OrderStatus } from '../../core/models/order.models';

@Pipe({ name: 'statusBadge', standalone: true, pure: true })
export class StatusBadgePipe implements PipeTransform {
  transform(status: OrderStatus | string): string {
    const map: Record<string, string> = {
      PENDING: 'badge badge-pending',
      PROCESSING: 'badge badge-processing',
      COMPLETED: 'badge badge-completed',
      FAILED: 'badge badge-failed',
    };
    return map[status] ?? 'badge';
  }
}

@Pipe({ name: 'statusProgress', standalone: true, pure: true })
export class StatusProgressPipe implements PipeTransform {
  transform(status: OrderStatus | string): number {
    const map: Record<string, number> = {
      PENDING: 25,
      PROCESSING: 60,
      COMPLETED: 100,
      FAILED: 100,
    };
    return map[status] ?? 0;
  }
}
