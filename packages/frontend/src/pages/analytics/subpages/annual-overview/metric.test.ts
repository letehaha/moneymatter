import { TRANSACTION_TYPES } from '@bt/shared/types';

import { isGoodChange, metricTransactionType, percentChange } from './metric';

describe('percentChange', () => {
  it('returns the rounded change from the previous value', () => {
    expect(percentChange({ current: 150, previous: 100 })).toBe(50);
    expect(percentChange({ current: 2, previous: 3 })).toBe(-33);
  });

  it('is undefined without a base', () => {
    expect(percentChange({ current: 100, previous: 0 })).toBe(undefined);
    expect(percentChange({ current: 0, previous: 0 })).toBe(undefined);
  });

  it('measures against the magnitude of a negative previous value', () => {
    expect(percentChange({ current: 50, previous: -100 })).toBe(150);
  });
});

describe('isGoodChange', () => {
  it('treats a drop as good for expenses', () => {
    expect(isGoodChange({ metric: 'expenses', change: -10 })).toBe(true);
    expect(isGoodChange({ metric: 'expenses', change: 10 })).toBe(false);
  });

  it('treats a rise as good for income', () => {
    expect(isGoodChange({ metric: 'income', change: 10 })).toBe(true);
    expect(isGoodChange({ metric: 'income', change: -10 })).toBe(false);
  });
});

describe('metricTransactionType', () => {
  it('maps each metric to its transaction type', () => {
    expect(metricTransactionType({ metric: 'expenses' })).toBe(TRANSACTION_TYPES.expense);
    expect(metricTransactionType({ metric: 'income' })).toBe(TRANSACTION_TYPES.income);
  });
});
