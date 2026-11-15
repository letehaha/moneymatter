import { describe, expect, it } from 'vitest';

import { startsFolded } from './card-fold';

describe('startsFolded', () => {
  it.each(['applied', 'rejected', 'blocked', 'superseded', 'expired'] as const)('folds a %s card', (status) => {
    expect(startsFolded({ status, offersAction: false })).toBe(true);
  });

  it('keeps a failed card open while it offers the owner an action', () => {
    expect(startsFolded({ status: 'failed', offersAction: true })).toBe(false);
  });

  it('folds a failed card that offers nothing more', () => {
    expect(startsFolded({ status: 'failed', offersAction: false })).toBe(true);
  });

  it.each(['pending', 'stale', 'applying', 'unknown'] as const)('never folds a %s card, actions or not', (status) => {
    expect(startsFolded({ status, offersAction: false })).toBe(false);
  });
});
