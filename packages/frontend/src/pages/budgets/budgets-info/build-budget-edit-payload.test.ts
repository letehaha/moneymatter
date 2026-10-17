import { describe, expect, it } from 'vitest';

import { buildBudgetEditPayload } from './build-budget-edit-payload';

describe('buildBudgetEditPayload', () => {
  const baseValues = { name: 'Groceries', startDate: null, endDate: null };

  it.each([null, undefined, '', 0, -50, Number.NaN])('sends a null limit for %s', (limitAmount) => {
    expect(buildBudgetEditPayload({ ...baseValues, limitAmount }).limitAmount).toBeNull();
  });

  it('keeps a positive limit, including numeric strings', () => {
    expect(buildBudgetEditPayload({ ...baseValues, limitAmount: 250 }).limitAmount).toBe(250);
    expect(buildBudgetEditPayload({ ...baseValues, limitAmount: '99.5' }).limitAmount).toBe(99.5);
  });

  it('serializes dates to ISO strings and missing dates to null', () => {
    const startDate = new Date('2026-09-23T00:00:00Z');
    const payload = buildBudgetEditPayload({ ...baseValues, limitAmount: null, startDate });

    expect(payload.startDate).toBe('2026-09-23T00:00:00.000Z');
    expect(payload.endDate).toBeNull();
  });

  it('includes categoryIds only when given', () => {
    expect('categoryIds' in buildBudgetEditPayload({ ...baseValues, limitAmount: null })).toBe(false);
    expect(buildBudgetEditPayload({ ...baseValues, limitAmount: null, categoryIds: ['cat-1'] })).toEqual({
      name: 'Groceries',
      limitAmount: null,
      startDate: null,
      endDate: null,
      categoryIds: ['cat-1'],
    });
  });
});
