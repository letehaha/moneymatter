import { describe, expect, it } from 'vitest';

import { SMART_TRACKING_DEFAULTS, buildBudgetPayload, buildSmartTrackingPatch } from './build-budget-payload';

describe('buildBudgetPayload', () => {
  const baseValues = { name: 'Groceries', startDate: null, endDate: null };

  it.each([null, undefined, '', 0, -50, Number.NaN])('sends a null limit for %s', (limitAmount) => {
    expect(buildBudgetPayload({ ...baseValues, limitAmount }).limitAmount).toBeNull();
  });

  it('keeps a positive limit, including numeric strings', () => {
    expect(buildBudgetPayload({ ...baseValues, limitAmount: 250 }).limitAmount).toBe(250);
    expect(buildBudgetPayload({ ...baseValues, limitAmount: '99.5' }).limitAmount).toBe(99.5);
  });

  it('serializes the start date as start of day and missing dates to null', () => {
    const startDate = new Date(2026, 8, 23, 15, 30);
    const payload = buildBudgetPayload({ ...baseValues, limitAmount: null, startDate });

    expect(payload.startDate).toBe(new Date(2026, 8, 23).toISOString());
    expect(payload.endDate).toBeNull();
  });

  it('serializes the end date as end of day', () => {
    const endDate = new Date(2026, 8, 30, 9, 15);
    const payload = buildBudgetPayload({ ...baseValues, limitAmount: null, endDate });

    expect(payload.endDate).toBe(new Date(2026, 8, 30, 23, 59, 59, 999).toISOString());
  });

  it('includes categoryIds only when given', () => {
    expect('categoryIds' in buildBudgetPayload({ ...baseValues, limitAmount: null })).toBe(false);
    expect(buildBudgetPayload({ ...baseValues, limitAmount: null, categoryIds: ['cat-1'] })).toEqual({
      name: 'Groceries',
      limitAmount: null,
      startDate: null,
      endDate: null,
      categoryIds: ['cat-1'],
    });
  });

  it('handles create-form values: undefined dates and an empty category list', () => {
    expect(
      buildBudgetPayload({ name: 'Trip', limitAmount: 500, startDate: undefined, endDate: undefined, categoryIds: [] }),
    ).toEqual({ name: 'Trip', limitAmount: 500, startDate: null, endDate: null, categoryIds: [] });
  });
});

describe('buildSmartTrackingPatch', () => {
  const stored = { aiEnabled: true, aiDescription: 'Greece trip', aiPreWindowDays: 60 as const };

  it('returns nothing when the values match what is stored', () => {
    expect(buildSmartTrackingPatch({ values: { ...stored, aiDescription: '  Greece trip ' }, stored })).toEqual({});
  });

  it('returns only the changed fields, with a trimmed description', () => {
    expect(
      buildSmartTrackingPatch({ values: { ...stored, aiDescription: ' Flights ', aiPreWindowDays: 90 }, stored }),
    ).toEqual({ aiDescription: 'Flights', aiPreWindowDays: 90 });
  });

  it('sends a blank description as null', () => {
    expect(buildSmartTrackingPatch({ values: { ...stored, aiEnabled: false, aiDescription: '  ' }, stored })).toEqual({
      aiEnabled: false,
      aiDescription: null,
    });
  });

  it('diffs against the defaults when nothing is stored', () => {
    expect(buildSmartTrackingPatch({ values: SMART_TRACKING_DEFAULTS })).toEqual({});
    expect(
      buildSmartTrackingPatch({ values: { ...SMART_TRACKING_DEFAULTS, aiEnabled: true, aiDescription: 'Trip' } }),
    ).toEqual({ aiEnabled: true, aiDescription: 'Trip' });
  });
});
