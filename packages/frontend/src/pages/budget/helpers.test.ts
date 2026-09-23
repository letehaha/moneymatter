import { ACCOUNT_CATEGORIES, type AccountModel } from '@bt/shared/types';
import { uk } from 'date-fns/locale';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  OVERSPEND_WARNING_RATIO,
  buildAssignmentPayload,
  buildCreatePlanPayload,
  cadenceLabel,
  defaultAssignmentScope,
  formatPeriodLabel,
  isAttachableAccount,
  lineIdsWithHistory,
  progressOf,
  sumOverspent,
} from './helpers';

describe('formatPeriodLabel', () => {
  it('collapses the month and year when the period stays inside one month', () => {
    expect(formatPeriodLabel({ startDate: '2026-09-01', endDate: '2026-10-01' })).toBe('1 – 30 Sep 2026');
  });

  it('repeats the month when the period crosses one', () => {
    expect(formatPeriodLabel({ startDate: '2026-09-16', endDate: '2026-10-16' })).toBe('16 Sep – 15 Oct 2026');
  });

  it('repeats the year when the period crosses one', () => {
    expect(formatPeriodLabel({ startDate: '2026-12-28', endDate: '2027-01-11' })).toBe('28 Dec 2026 – 10 Jan 2027');
  });

  it('formats month names in the passed locale', () => {
    expect(formatPeriodLabel({ startDate: '2026-09-16', endDate: '2026-10-16', locale: uk })).toBe(
      '16 верес. – 15 жовт. 2026',
    );
  });
});

describe('buildCreatePlanPayload', () => {
  const base = { name: 'Budget', accountIds: ['acc-1'], carryPolicy: 'floor' as const };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 5, 12));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('maps monthly to a one-month cadence anchored on the picked day', () => {
    expect(buildCreatePlanPayload({ ...base, preset: 'monthly', startsOn: new Date(2026, 8, 5) })).toEqual({
      ...base,
      type: 'category_caps',
      cadence: 'months',
      intervalN: 1,
      anchorDate: '2026-09-05',
    });
  });

  it('maps semi-monthly to the picked day plus a second day about half a month away', () => {
    expect(buildCreatePlanPayload({ ...base, preset: 'semiMonthly', startsOn: new Date(2026, 8, 3) })).toEqual({
      ...base,
      type: 'category_caps',
      cadence: 'semi_monthly',
      anchorDate: '2026-09-03',
      secondAnchorDay: 18,
      epochDate: '2026-09-03',
    });
  });

  it('backdates the plan to a start date before today', () => {
    expect(buildCreatePlanPayload({ ...base, preset: 'monthly', startsOn: new Date(2026, 7, 1) })).toMatchObject({
      anchorDate: '2026-08-01',
      epochDate: '2026-08-01',
    });
  });

  it('leaves the epoch to the backend when the start date is today', () => {
    const payload = buildCreatePlanPayload({ ...base, preset: 'monthly', startsOn: new Date(2026, 8, 5, 23, 30) });
    expect(payload.anchorDate).toBe('2026-09-05');
    expect(payload).not.toHaveProperty('epochDate');
  });

  it('picks a semi-monthly day pair the backend accepts for every start day', () => {
    for (let day = 1; day <= 31; day++) {
      const payload = buildCreatePlanPayload({ ...base, preset: 'semiMonthly', startsOn: new Date(2026, 0, day) });
      const smaller = Math.min(day, payload.secondAnchorDay!);
      const larger = Math.max(day, payload.secondAnchorDay!);
      expect(larger - smaller, `day ${day}`).toBeGreaterThanOrEqual(10);
      expect(smaller + 28 - Math.min(larger, 28), `day ${day}`).toBeGreaterThanOrEqual(10);
    }
  });

  it('maps biweekly and weekly to day cadences', () => {
    expect(buildCreatePlanPayload({ ...base, preset: 'biweekly', startsOn: new Date(2026, 8, 5) })).toMatchObject({
      cadence: 'days',
      intervalN: 14,
    });
    expect(buildCreatePlanPayload({ ...base, preset: 'weekly', startsOn: new Date(2026, 8, 5) })).toMatchObject({
      cadence: 'days',
      intervalN: 7,
    });
  });
});

describe('isAttachableAccount', () => {
  const buildAccount = ({ share }: { share?: { isOwner: boolean } } = {}) =>
    ({ accountCategory: ACCOUNT_CATEGORIES.general, share }) as AccountModel;

  it('accepts own accounts and shares the user owns', () => {
    expect(isAttachableAccount(buildAccount())).toBe(true);
    expect(isAttachableAccount(buildAccount({ share: { isOwner: true } }))).toBe(true);
  });

  it('rejects accounts shared with the user by someone else', () => {
    expect(isAttachableAccount(buildAccount({ share: { isOwner: false } }))).toBe(false);
  });

  it('rejects categories a plan cannot attach', () => {
    expect(isAttachableAccount({ accountCategory: ACCOUNT_CATEGORIES.loan } as AccountModel)).toBe(false);
  });
});

describe('cadenceLabel', () => {
  it('names the four presets', () => {
    expect(cadenceLabel({ cadence: 'months', intervalN: 1 }).key).toBe('budgetPlans.cadence.monthly');
    expect(cadenceLabel({ cadence: 'semi_monthly', intervalN: 1 }).key).toBe('budgetPlans.cadence.semiMonthly');
    expect(cadenceLabel({ cadence: 'days', intervalN: 14 }).key).toBe('budgetPlans.cadence.biweekly');
    expect(cadenceLabel({ cadence: 'days', intervalN: 7 }).key).toBe('budgetPlans.cadence.weekly');
  });

  it('falls back to an interval-counted label', () => {
    expect(cadenceLabel({ cadence: 'days', intervalN: 10 })).toEqual({
      key: 'budgetPlans.cadence.everyNDays',
      params: { n: 10 },
    });
    expect(cadenceLabel({ cadence: 'months', intervalN: 3 })).toEqual({
      key: 'budgetPlans.cadence.everyNMonths',
      params: { n: 3 },
    });
  });
});

describe('sumOverspent', () => {
  it('sums only the negative availables', () => {
    expect(sumOverspent({ lines: [{ available: -500 }, { available: 120 }, { available: -380 }] })).toEqual({
      total: -880,
      lineCount: 2,
    });
  });

  it('returns a zero total when nothing is overspent', () => {
    expect(sumOverspent({ lines: [{ available: 0 }, { available: 12 }] })).toEqual({ total: 0, lineCount: 0 });
  });
});

describe('buildAssignmentPayload', () => {
  const baseline = { assigned: 100, assignedSource: 'baseline' as const, carryPolicy: 'floor' as const };
  const override = { ...baseline, assignedSource: 'override' as const };

  it('returns null when nothing changed', () => {
    expect(
      buildAssignmentPayload({ line: baseline, amount: 100, scope: 'from_here', carryPolicy: 'floor' }),
    ).toBeNull();
  });

  it('returns null for an unchanged baseline amount scoped to this period', () => {
    expect(
      buildAssignmentPayload({ line: baseline, amount: 100, scope: 'this_period', carryPolicy: 'floor' }),
    ).toBeNull();
  });

  it('sends an unchanged override amount to promote it to the baseline', () => {
    expect(buildAssignmentPayload({ line: override, amount: 100, scope: 'from_here', carryPolicy: 'floor' })).toEqual({
      scope: 'from_here',
      amount: 100,
    });
  });

  it('sends only the carry policy when only it changed', () => {
    expect(buildAssignmentPayload({ line: baseline, amount: 100, scope: 'from_here', carryPolicy: 'signed' })).toEqual({
      scope: 'from_here',
      carryPolicy: 'signed',
    });
  });

  it('assigns 0 when the amount is cleared', () => {
    expect(buildAssignmentPayload({ line: baseline, amount: null, scope: 'from_here', carryPolicy: 'floor' })).toEqual({
      scope: 'from_here',
      amount: 0,
    });
  });
});

describe('defaultAssignmentScope', () => {
  it('keeps an override scoped to its period and everything else from here on', () => {
    expect(defaultAssignmentScope({ line: { assignedSource: 'override' } })).toBe('this_period');
    expect(defaultAssignmentScope({ line: { assignedSource: 'baseline' } })).toBe('from_here');
    expect(defaultAssignmentScope({ line: { assignedSource: 'none' } })).toBe('from_here');
  });
});

describe('progressOf', () => {
  it('shows an empty bar when nothing is assigned', () => {
    expect(progressOf({ line: { assigned: 0, activity: -50 } })).toEqual({ width: '0%', class: 'bg-primary' });
  });

  it('fills proportionally below the warning ratio', () => {
    expect(progressOf({ line: { assigned: 100, activity: -50 } })).toEqual({ width: '50%', class: 'bg-primary' });
  });

  it('warns from the warning ratio up to a fully spent line', () => {
    expect(progressOf({ line: { assigned: 100, activity: -OVERSPEND_WARNING_RATIO * 100 } }).class).toBe('bg-warning');
    expect(progressOf({ line: { assigned: 100, activity: -100 } })).toEqual({ width: '100%', class: 'bg-warning' });
  });

  it('clamps the bar at 100% once the line is overspent', () => {
    expect(progressOf({ line: { assigned: 100, activity: -150 } })).toEqual({
      width: '100%',
      class: 'bg-app-expense-color',
    });
  });
});

describe('lineIdsWithHistory', () => {
  const periods = [
    { startDate: '2026-08-01', isCurrent: false },
    { startDate: '2026-09-01', isCurrent: true },
  ];

  it('keeps only lines that started before the current period', () => {
    const lines = [
      { id: 'past', activeFrom: '2026-08-01' },
      { id: 'current', activeFrom: '2026-09-01' },
    ];
    expect(lineIdsWithHistory({ lines, periods })).toEqual(new Set(['past']));
  });

  it('treats every line as having history when no period is current', () => {
    const lines = [{ id: 'line', activeFrom: '2026-09-01' }];
    expect(lineIdsWithHistory({ lines, periods: [{ startDate: '2026-09-01', isCurrent: false }] })).toEqual(
      new Set(['line']),
    );
  });
});
