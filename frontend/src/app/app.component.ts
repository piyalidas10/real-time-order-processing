/**
 * src/app/app.component.ts
 * ──────────────────────────
 * Root shell component: sidebar navigation + router outlet.
 * Standalone — declares its own imports, no NgModule needed.
 */

import { Component } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { ToastComponent } from './shared/components/toast/toast.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, ToastComponent],
  template: `
    <div class="layout">
      <!-- ── Sidebar ─────────────────────────────────────────────────── -->
      <aside class="sidebar">
        <div class="sidebar-brand">
          ⚡ OrderFlow
          <span>Real-Time Processing</span>
        </div>
        <nav>
          <a routerLink="/dashboard" routerLinkActive="active">
            <span>📊</span> Dashboard
          </a>
          <a routerLink="/orders" routerLinkActive="active">
            <span>📦</span> Orders
          </a>
          <a routerLink="/orders/new" routerLinkActive="active">
            <span>➕</span> New Order
          </a>
          <a routerLink="/events" routerLinkActive="active">
            <span>📜</span> Event Log
          </a>
        </nav>
      </aside>

      <!-- ── Main content ─────────────────────────────────────────────── -->
      <main class="main-content">
        <router-outlet />
      </main>
    </div>

    <!-- Global toast notifications -->
    <app-toast />
  `,
})
export class AppComponent {}
