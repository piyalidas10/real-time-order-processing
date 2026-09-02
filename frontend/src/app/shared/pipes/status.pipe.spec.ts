/**
 * src/app/shared/pipes/status.pipe.spec.ts
 * ─────────────────────────────────────────
 * Unit tests for StatusBadgePipe and StatusProgressPipe.
 * Pure pipes are the simplest to test — just instantiate and call transform().
 */

import { StatusBadgePipe, StatusProgressPipe } from './status.pipe';

describe('StatusBadgePipe', () => {
  let pipe: StatusBadgePipe;

  beforeEach(() => { pipe = new StatusBadgePipe(); });

  it('PENDING → badge-pending class', () => {
    expect(pipe.transform('PENDING')).toContain('badge-pending');
  });

  it('PROCESSING → badge-processing class', () => {
    expect(pipe.transform('PROCESSING')).toContain('badge-processing');
  });

  it('COMPLETED → badge-completed class', () => {
    expect(pipe.transform('COMPLETED')).toContain('badge-completed');
  });

  it('FAILED → badge-failed class', () => {
    expect(pipe.transform('FAILED')).toContain('badge-failed');
  });

  it('unknown status → bare badge class', () => {
    expect(pipe.transform('UNKNOWN')).toBe('badge');
  });
});

describe('StatusProgressPipe', () => {
  let pipe: StatusProgressPipe;

  beforeEach(() => { pipe = new StatusProgressPipe(); });

  it('PENDING → 25%', () => { expect(pipe.transform('PENDING')).toBe(25); });
  it('PROCESSING → 60%', () => { expect(pipe.transform('PROCESSING')).toBe(60); });
  it('COMPLETED → 100%', () => { expect(pipe.transform('COMPLETED')).toBe(100); });
  it('FAILED → 100%', () => { expect(pipe.transform('FAILED')).toBe(100); });
  it('unknown → 0%', () => { expect(pipe.transform('UNKNOWN')).toBe(0); });
});
