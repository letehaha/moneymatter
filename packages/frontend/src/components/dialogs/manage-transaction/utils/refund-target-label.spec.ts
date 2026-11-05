import type { TransactionModel } from '@bt/shared/types';
import { describe, expect, it } from 'vitest';

import { getRefundTargetLabel } from './refund-target-label';

const categoriesMap = { 'cat-tx': { name: 'Groceries' }, 'cat-split': { name: 'Household' } };
const tx = (note: string | null) => ({ note, categoryId: 'cat-tx' }) as TransactionModel;

describe('getRefundTargetLabel', () => {
  it('prefers the note', () => {
    expect(getRefundTargetLabel({ transaction: tx('Shoes'), categoriesMap, unknownLabel: '?' })).toBe('Shoes');
  });

  it('falls back to the transaction category', () => {
    expect(getRefundTargetLabel({ transaction: tx(null), categoriesMap, unknownLabel: '?' })).toBe('Groceries');
  });

  it('uses the overriding split category', () => {
    expect(
      getRefundTargetLabel({ transaction: tx(''), categoryId: 'cat-split', categoriesMap, unknownLabel: '?' }),
    ).toBe('Household');
  });

  it('falls back to the unknown label', () => {
    expect(
      getRefundTargetLabel({ transaction: tx(null), categoryId: 'missing', categoriesMap, unknownLabel: '?' }),
    ).toBe('?');
  });
});
