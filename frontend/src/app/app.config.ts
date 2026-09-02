/**
 * src/app/app.config.ts
 * ───────────────────────
 * Root application configuration (replaces AppModule in standalone Angular).
 *
 * WHY STANDALONE CONFIG vs NgModule?
 * ────────────────────────────────────
 * Angular 15+ supports "standalone" components — components that declare their
 * own imports instead of relying on a shared NgModule.  bootstrapApplication()
 * + provideX() functions replace AppModule + imports[] entirely.
 *
 * Benefits:
 * - Smaller initial bundle (tree-shaking works better)
 * - Clearer dependency graph (each component declares what it needs)
 * - Easier lazy-loading (routes just point to component files)
 * - Less boilerplate
 */

import { ApplicationConfig, provideZoneChangeDetection } from '@angular/core';
import { provideRouter, withComponentInputBinding, withViewTransitions } from '@angular/router';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { routes } from './app.routes';
import { errorInterceptor } from './core/interceptors/error.interceptor';

export const appConfig: ApplicationConfig = {
  providers: [
    // Zone-based change detection (default; compatible with Signals)
    provideZoneChangeDetection({ eventCoalescing: true }),

    // Router with lazy-loaded routes.
    // withComponentInputBinding: route params auto-bind to @Input() properties
    // withViewTransitions: native browser View Transitions API for navigation
    provideRouter(routes, withComponentInputBinding(), withViewTransitions()),

    // HttpClient with our error interceptor
    provideHttpClient(withInterceptors([errorInterceptor])),

    // Async animations (loaded lazily)
    provideAnimationsAsync(),
  ],
};
