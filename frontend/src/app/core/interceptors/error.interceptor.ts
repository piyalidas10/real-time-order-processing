/**
 * src/app/core/interceptors/error.interceptor.ts
 * ──────────────────────────────────────────────────
 * HTTP interceptor for centralised error handling and request logging.
 *
 * FUNCTIONAL INTERCEPTOR (Angular 15+ style):
 * ─────────────────────────────────────────────
 * Angular 15+ allows interceptors as plain functions, removing the need
 * for an @Injectable class.  This is the preferred modern Angular approach.
 *
 * Responsibilities:
 * 1. Log outgoing requests (dev mode)
 * 2. Catch HTTP errors and convert to user-friendly messages
 * 3. Add common headers (Content-Type is handled by HttpClient by default)
 */

import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, tap, throwError } from 'rxjs';
import { NotificationService } from '../services/notification.service';

export const errorInterceptor: HttpInterceptorFn = (req, next) => {
  const notify = inject(NotificationService);

  // Clone request to add a correlation ID header (useful for debugging)
  const reqWithHeaders = req.clone({
    setHeaders: {
      'X-Request-ID': crypto.randomUUID(),
    },
  });

  return next(reqWithHeaders).pipe(
    tap({
      subscribe: () => {
        if (typeof ngDevMode !== 'undefined' && ngDevMode) {
          console.log(`[HTTP] ${req.method} ${req.url}`);
        }
      },
    }),
    catchError((error: HttpErrorResponse) => {
      const message = extractErrorMessage(error);
      notify.error(message);
      return throwError(() => error);
    })
  );
};

function extractErrorMessage(error: HttpErrorResponse): string {
  if (error.error?.detail) {
    // FastAPI validation / HTTPException detail
    if (typeof error.error.detail === 'string') return error.error.detail;
    if (Array.isArray(error.error.detail)) {
      return error.error.detail.map((e: { msg: string }) => e.msg).join(', ');
    }
  }
  if (error.status === 0) return 'Unable to connect to server. Please check your connection.';
  if (error.status === 404) return 'Resource not found.';
  if (error.status === 422) return 'Validation error. Please check your input.';
  if (error.status >= 500) return 'Server error. Please try again later.';
  return error.message || 'An unexpected error occurred.';
}
