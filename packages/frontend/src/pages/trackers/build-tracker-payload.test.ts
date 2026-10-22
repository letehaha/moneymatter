import { describe, expect, it } from 'vitest';

import {
  SMART_TRACKING_DEFAULTS,
  TRACKER_RULES_DEFAULTS,
  buildTrackerPayload,
  buildSmartTrackingPatch,
  changesRuleMatches,
  isTrackerRulesIncomplete,
} from './build-tracker-payload';

describe('buildTrackerPayload', () => {
  const baseValues = { name: 'Groceries', startDate: null, endDate: null };

  it.each([null, undefined, '', 0, -50, Number.NaN])('sends a null limit for %s', (limitAmount) => {
    expect(buildTrackerPayload({ ...baseValues, limitAmount }).limitAmount).toBeNull();
  });

  it('keeps a positive limit, including numeric strings', () => {
    expect(buildTrackerPayload({ ...baseValues, limitAmount: 250 }).limitAmount).toBe(250);
    expect(buildTrackerPayload({ ...baseValues, limitAmount: '99.5' }).limitAmount).toBe(99.5);
  });

  it('serializes the start date as start of day and missing dates to null', () => {
    const startDate = new Date(2026, 8, 23, 15, 30);
    const payload = buildTrackerPayload({ ...baseValues, limitAmount: null, startDate });

    expect(payload.startDate).toBe(new Date(2026, 8, 23).toISOString());
    expect(payload.endDate).toBeNull();
  });

  it('serializes the end date as end of day', () => {
    const endDate = new Date(2026, 8, 30, 9, 15);
    const payload = buildTrackerPayload({ ...baseValues, limitAmount: null, endDate });

    expect(payload.endDate).toBe(new Date(2026, 8, 30, 23, 59, 59, 999).toISOString());
  });

  it('handles create-form values: undefined dates', () => {
    expect(buildTrackerPayload({ name: 'Trip', limitAmount: 500, startDate: undefined, endDate: undefined })).toEqual({
      name: 'Trip',
      limitAmount: 500,
      startDate: null,
      endDate: null,
    });
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

describe('isTrackerRulesIncomplete', () => {
  it('needs a category or a tag only while rules are on', () => {
    expect(isTrackerRulesIncomplete({ values: TRACKER_RULES_DEFAULTS })).toBe(false);
    expect(isTrackerRulesIncomplete({ values: { ...TRACKER_RULES_DEFAULTS, rulesEnabled: true } })).toBe(true);
    expect(isTrackerRulesIncomplete({ values: { ...TRACKER_RULES_DEFAULTS, rulesEnabled: true, tagIds: ['t'] } })).toBe(
      false,
    );
  });
});

describe('changesRuleMatches', () => {
  const stored = { ...TRACKER_RULES_DEFAULTS, rulesEnabled: true, categoryIds: ['a', 'b'] };
  const storedDates = { startDate: '2026-01-01', endDate: null };

  it('is false for an unchanged rule set, in any order', () => {
    expect(
      changesRuleMatches({ values: { ...stored, categoryIds: ['b', 'a'] }, stored, dates: storedDates, storedDates }),
    ).toBe(false);
  });

  it('is false when rules are turned off', () => {
    expect(
      changesRuleMatches({ values: { ...stored, rulesEnabled: false }, stored, dates: storedDates, storedDates }),
    ).toBe(false);
  });

  it('is false when cleanup is turned off', () => {
    expect(
      changesRuleMatches({ values: { ...stored, rulesCleanup: false }, stored, dates: storedDates, storedDates }),
    ).toBe(false);
  });

  it('is false while rules stay off', () => {
    const off = { ...stored, rulesEnabled: false };
    expect(
      changesRuleMatches({ values: { ...off, tagIds: ['t'] }, stored: off, dates: storedDates, storedDates }),
    ).toBe(false);
  });

  it.each([
    ['rules turned on', { values: stored, stored: { ...stored, rulesEnabled: false } }],
    ['a tag added', { values: { ...stored, tagIds: ['t'] }, stored }],
    ['a category removed', { values: { ...stored, categoryIds: ['a'] }, stored }],
    ['cleanup turned on', { values: stored, stored: { ...stored, rulesCleanup: false } }],
  ])('is true when %s', (_label, { values, stored: before }) => {
    expect(changesRuleMatches({ values, stored: before, dates: storedDates, storedDates })).toBe(true);
  });

  it('is true when a date moves', () => {
    expect(
      changesRuleMatches({ values: stored, stored, dates: { ...storedDates, endDate: '2026-02-01' }, storedDates }),
    ).toBe(true);
  });
});
