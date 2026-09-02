/**
 * src/app/features/orders/pages/create-order/create-order.component.ts
 * ────────────────────────────────────────────────────────────────────────
 * Create Order form using Angular Reactive Forms with FormArray.
 *
 * Reactive Forms vs Template-driven Forms:
 * ──────────────────────────────────────────
 * Reactive Forms:
 * - Form model defined in TypeScript (explicit, testable)
 * - FormArray for dynamic lists of items
 * - Typed forms (Angular 14+) catch errors at compile time
 * - Validators as composable functions
 * Best for: complex forms, dynamic fields, programmatic control
 *
 * Template-driven:
 * - Simpler, uses ngModel
 * Best for: simple contact forms
 *
 * We use Reactive Forms here because the items array is dynamic
 * (user can add/remove products) and we need typed access.
 */

import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
} from '@angular/core';
import { Router } from '@angular/router';
import {
  AbstractControl,
  FormArray,
  FormBuilder,
  FormGroup,
  ReactiveFormsModule,
  ValidationErrors,
  Validators,
} from '@angular/forms';
import { tap, catchError, EMPTY } from 'rxjs';
import { ApiService } from '../../../../core/services/api.service';
import { NotificationService } from '../../../../core/services/notification.service';

@Component({
  selector: 'app-create-order',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule],
  template: `
    <div class="page-header">
      <h1 class="page-title">➕ Create New Order</h1>
    </div>

    <div class="card" style="max-width: 680px">
      <form [formGroup]="form" (ngSubmit)="submit()">

        <!-- Customer ID -->
        <div class="form-group">
          <label for="customerId">Customer ID</label>
          <input
            id="customerId"
            type="number"
            formControlName="customer_id"
            placeholder="e.g. 101"
          />
          @if (customerIdCtrl.invalid && customerIdCtrl.touched) {
            <div class="error-msg">
              @if (customerIdCtrl.errors?.['required']) { Customer ID is required. }
              @if (customerIdCtrl.errors?.['min']) { Customer ID must be at least 1. }
            </div>
          }
        </div>

        <!-- Items (FormArray) -->
        <div formArrayName="items">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px">
            <label style="margin:0">Products</label>
            <button type="button" class="btn btn-secondary btn-sm" (click)="addItem()">
              + Add Item
            </button>
          </div>

          @for (item of itemsArray.controls; track $index; let i = $index) {
            <div [formGroupName]="i" class="item-row">
              <div class="item-fields">
                <div class="form-group" style="flex:2">
                  <label>Product ID</label>
                  <input formControlName="product_id" placeholder="e.g. PROD-001" />
                  @if (getItemCtrl(i, 'product_id').invalid && getItemCtrl(i, 'product_id').touched) {
                    <div class="error-msg">Product ID is required.</div>
                  }
                </div>
                <div class="form-group" style="flex:1">
                  <label>Quantity</label>
                  <input type="number" formControlName="quantity" placeholder="1" min="1" />
                  @if (getItemCtrl(i, 'quantity').invalid && getItemCtrl(i, 'quantity').touched) {
                    <div class="error-msg">Min 1</div>
                  }
                </div>
                <div class="form-group" style="flex:1">
                  <label>Price (₹)</label>
                  <input type="number" formControlName="price" placeholder="99.00" min="0.01" step="0.01" />
                  @if (getItemCtrl(i, 'price').invalid && getItemCtrl(i, 'price').touched) {
                    <div class="error-msg">Price > 0 required</div>
                  }
                </div>
              </div>
              @if (itemsArray.length > 1) {
                <button type="button" class="btn btn-danger btn-sm" (click)="removeItem(i)">✕</button>
              }
            </div>
          }
        </div>

        <!-- Total amount (computed from form values) -->
        <div class="total-bar">
          <span class="text-muted">Total Amount:</span>
          <span class="total-value">₹{{ computedTotal() | number:'1.2-2' }}</span>
        </div>

        <!-- Submit -->
        <div style="display:flex; gap:12px; margin-top:24px">
          <button
            type="submit"
            class="btn btn-primary"
            [disabled]="form.invalid || submitting()">
            @if (submitting()) {
              <div class="spinner" style="width:14px;height:14px;border-width:2px"></div>
              Creating...
            } @else {
              📦 Create Order
            }
          </button>
          <button type="button" class="btn btn-secondary" (click)="router.navigate(['/orders'])">
            Cancel
          </button>
        </div>

        @if (submitError()) {
          <div class="alert alert-error" style="margin-top:12px">{{ submitError() }}</div>
        }

      </form>
    </div>
  `,
  styles: [`
    .item-row {
      display: flex;
      align-items: flex-end;
      gap: 12px;
      background: var(--color-surface-2);
      border: 1px solid var(--color-border);
      border-radius: 6px;
      padding: 12px;
      margin-bottom: 12px;
    }
    .item-fields { display: flex; gap: 12px; flex: 1; }
    .total-bar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 16px;
      background: var(--color-surface-2);
      border-radius: 6px;
      margin-top: 8px;
    }
    .total-value { font-size: 22px; font-weight: 700; color: var(--color-primary); }
  `],
})
export class CreateOrderComponent {
  readonly router = inject(Router);
  private readonly api = inject(ApiService);
  private readonly notify = inject(NotificationService);
  private readonly fb = inject(FormBuilder);

  readonly submitting = signal(false);
  readonly submitError = signal<string | null>(null);

  // ── Typed Reactive Form ────────────────────────────────────────────────────
  form = this.fb.group({
    customer_id: [null as number | null, [Validators.required, Validators.min(1)]],
    items: this.fb.array([this.createItemGroup()]),
  });

  get customerIdCtrl(): AbstractControl {
    return this.form.get('customer_id')!;
  }

  get itemsArray(): FormArray {
    return this.form.get('items') as FormArray;
  }

  getItemCtrl(index: number, field: string): AbstractControl {
    return (this.itemsArray.at(index) as FormGroup).get(field)!;
  }

  /**
   * Computed total from FormArray values.
   * Note: this is NOT an Angular Signal — it's a regular getter that reads
   * the form's current value.  We use a signal here because it needs to be
   * reactive to form value changes.
   *
   * In a real app you might use form.valueChanges | async with toSignal().
   */
  computedTotal(): number {
    return this.itemsArray.controls.reduce((sum, ctrl) => {
      const { quantity, price } = ctrl.value;
      return sum + ((quantity || 0) * (price || 0));
    }, 0);
  }

  createItemGroup(): FormGroup {
    return this.fb.group({
      product_id: ['', [Validators.required, Validators.minLength(1)]],
      quantity: [1, [Validators.required, Validators.min(1)]],
      price: [null as number | null, [Validators.required, Validators.min(0.01)]],
    });
  }

  addItem(): void {
    this.itemsArray.push(this.createItemGroup());
  }

  removeItem(index: number): void {
    if (this.itemsArray.length > 1) {
      this.itemsArray.removeAt(index);
    }
  }

  submit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched(); // Show all validation errors
      return;
    }

    this.submitting.set(true);
    this.submitError.set(null);

    const { customer_id, items } = this.form.value;

    this.api
      .createOrder({
        customer_id: customer_id!,
        items: items!.map((i: { product_id: string; quantity: number; price: number }) => ({
          product_id: i.product_id,
          quantity: i.quantity,
          price: i.price,
        })),
      })
      .pipe(
        tap((order) => {
          this.submitting.set(false);
          this.notify.success(`Order #${order.id} created! Status: PENDING`);
          // Navigate to the order detail page to watch real-time updates
          this.router.navigate(['/orders', order.id]);
        }),
        catchError((err) => {
          this.submitting.set(false);
          this.submitError.set('Failed to create order. Please try again.');
          return EMPTY;
        })
      )
      .subscribe();
  }
}
