/**
 * src/app/features/orders/pages/create-order/create-order.component.spec.ts
 * ──────────────────────────────────────────────────────────────────────────────
 * Component tests for Create Order form.
 *
 * Tests:
 * - Component renders without error
 * - Form validation: required fields
 * - FormArray: add and remove items
 * - Total calculation
 * - Submit with invalid form shows errors
 */

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CreateOrderComponent } from './create-order.component';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { ReactiveFormsModule } from '@angular/forms';

describe('CreateOrderComponent', () => {
  let component: CreateOrderComponent;
  let fixture: ComponentFixture<CreateOrderComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CreateOrderComponent, ReactiveFormsModule],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(CreateOrderComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should start with one empty item', () => {
    expect(component.itemsArray.length).toBe(1);
  });

  it('form should be invalid when empty', () => {
    expect(component.form.invalid).toBeTrue();
  });

  it('customer_id is required', () => {
    const ctrl = component.form.get('customer_id');
    ctrl?.setValue(null);
    expect(ctrl?.valid).toBeFalse();
  });

  it('customer_id must be >= 1', () => {
    const ctrl = component.form.get('customer_id');
    ctrl?.setValue(0);
    expect(ctrl?.errors?.['min']).toBeTruthy();
  });

  it('addItem() should add a new item to FormArray', () => {
    component.addItem();
    expect(component.itemsArray.length).toBe(2);
  });

  it('removeItem() should remove the item at the given index', () => {
    component.addItem();
    expect(component.itemsArray.length).toBe(2);
    component.removeItem(1);
    expect(component.itemsArray.length).toBe(1);
  });

  it('removeItem() should not remove if only one item remains', () => {
    expect(component.itemsArray.length).toBe(1);
    component.removeItem(0);
    expect(component.itemsArray.length).toBe(1);
  });

  it('computedTotal() should calculate sum of quantity * price', () => {
    component.itemsArray.at(0).setValue({
      product_id: 'P1',
      quantity: 3,
      price: 100,
    });
    component.addItem();
    component.itemsArray.at(1).setValue({
      product_id: 'P2',
      quantity: 2,
      price: 50,
    });

    expect(component.computedTotal()).toBe(400);
  });

  it('submit() should mark all fields touched when form is invalid', () => {
    component.submit();
    expect(component.form.touched).toBeTrue();
  });

  it('form is valid with all required fields filled', () => {
    component.form.get('customer_id')?.setValue(101);
    component.itemsArray.at(0).setValue({
      product_id: 'PROD-1',
      quantity: 2,
      price: 99.99,
    });
    expect(component.form.valid).toBeTrue();
  });
});
