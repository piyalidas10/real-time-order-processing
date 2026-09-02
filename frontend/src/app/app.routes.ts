/**
 * src/app/app.routes.ts
 * ───────────────────────
 * Root route configuration using lazy loading.
 *
 * WHY LAZY LOADING?
 * ──────────────────
 * Without lazy loading, the browser downloads ALL JavaScript for ALL features
 * on initial page load — even features the user may never visit.
 *
 * With lazy loading:
 * - The initial bundle contains only the app shell (navbar, shared components)
 * - Feature code (dashboard, orders, events) is loaded ON DEMAND when the
 *   user navigates to that route
 * - Result: faster initial load, especially important on mobile networks
 *
 * Angular's `loadComponent` and `loadChildren` power lazy loading.
 * The dynamic import() syntax tells the bundler to create a separate chunk.
 *
 * Route structure:
 *   /                → redirect to /dashboard
 *   /dashboard       → Dashboard feature (lazy)
 *   /orders          → Order list (lazy)
 *   /orders/new      → Create order form (lazy)
 *   /orders/:id      → Order detail page (lazy)
 *   /events          → Event log viewer (lazy)
 */

import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    redirectTo: 'dashboard',
    pathMatch: 'full',
  },
  {
    path: 'dashboard',
    loadComponent: () =>
      import('./features/dashboard/dashboard.component').then(
        (m) => m.DashboardComponent
      ),
    title: 'Dashboard — Order Processing',
  },
  {
    path: 'orders',
    loadComponent: () =>
      import('./features/orders/pages/order-list/order-list.component').then(
        (m) => m.OrderListComponent
      ),
    title: 'Orders — Order Processing',
  },
  {
    path: 'orders/new',
    loadComponent: () =>
      import('./features/orders/pages/create-order/create-order.component').then(
        (m) => m.CreateOrderComponent
      ),
    title: 'Create Order — Order Processing',
  },
  {
    path: 'orders/:id',
    loadComponent: () =>
      import('./features/orders/pages/order-detail/order-detail.component').then(
        (m) => m.OrderDetailComponent
      ),
    title: 'Order Detail — Order Processing',
  },
  {
    path: 'events',
    loadComponent: () =>
      import('./features/events/events.component').then(
        (m) => m.EventsComponent
      ),
    title: 'Events — Order Processing',
  },
  {
    path: '**',
    redirectTo: 'dashboard',
  },
];
