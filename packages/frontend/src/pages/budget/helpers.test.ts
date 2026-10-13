import {
  ACCOUNT_CATEGORIES,
  type AccountModel,
  type BudgetPlanModel,
  type BudgetPlanScheduled,
  type BudgetPlanScheduledItem,
  type BudgetPlanTrendPeriod,
} from '@bt/shared/types';
import { uk } from 'date-fns/locale';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  availablePillClass,
  buildAssignmentPayload,
  buildCreatePlanPayload,
  buildLayoutPayload,
  buildGoalPayload,
  buildPoolAssignPayload,
  buildPoolTakeBackPayload,
  cadenceLabel,
  defaultAssignmentScope,
  formatPeriodLabel,
  formatPeriodShortLabel,
  type GoalEditorState,
  goalCaption,
  goalEditorFields,
  goalEditorStateFrom,
  goalPeekStats,
  goalPeriodUnit,
  goalStatusDisplay,
  goalSubtitle,
  goalSummary,
  goalTitle,
  groupLines,
  headerStats,
  isAttachableAccount,
  isPastPeriod,
  isValidCustomInterval,
  layoutStateFrom,
  lineBarsOf,
  lineIdsWithHistory,
  pickTakeBackLine,
  scheduledForLines,
  spentSummaryOf,
  setGoalFrequency,
  periodProgress,
  periodSpend,
  spendingPace,
  trashDaysLeft,
  trashedPlansOf,
  trendPaddingStarts,
  trendBars,
  sumLineTotals,
  sumOverspent,
  takeBackCandidates,
  validateGoalEditor,
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

describe('formatPeriodShortLabel', () => {
  it('shows only the month and year for a whole calendar month', () => {
    expect(formatPeriodShortLabel({ startDate: '2026-10-01', endDate: '2026-11-01' })).toBe('Oct 2026');
  });

  it('keeps the days and drops the year for part of a month', () => {
    expect(formatPeriodShortLabel({ startDate: '2026-10-01', endDate: '2026-10-15' })).toBe('1 – 14 Oct');
  });

  it('repeats the month when the period crosses one', () => {
    expect(formatPeriodShortLabel({ startDate: '2026-09-16', endDate: '2026-10-16' })).toBe('16 Sep – 15 Oct');
  });

  it('formats month names in the passed locale', () => {
    expect(formatPeriodShortLabel({ startDate: '2026-10-01', endDate: '2026-11-01', locale: uk })).toBe('жовт. 2026');
  });
});

describe('buildCreatePlanPayload', () => {
  const custom = { unit: 'days' as const, every: 10 };
  const base = { name: 'Budget', accountIds: ['acc-1'], carryPolicy: 'floor' as const, withSuggestedLines: true };

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

  it('passes the suggested lines opt-out through', () => {
    expect(
      buildCreatePlanPayload({ ...base, withSuggestedLines: false, preset: 'monthly', startsOn: new Date(2026, 8, 5) }),
    ).toMatchObject({ withSuggestedLines: false });
  });

  it('maps custom to the picked unit and interval', () => {
    expect(buildCreatePlanPayload({ ...base, custom, preset: 'custom', startsOn: new Date(2026, 8, 5) })).toMatchObject(
      {
        cadence: 'days',
        intervalN: 10,
        anchorDate: '2026-09-05',
      },
    );
    expect(
      buildCreatePlanPayload({
        ...base,
        custom: { unit: 'months', every: 3 },
        preset: 'custom',
        startsOn: new Date(2026, 8, 5),
      }),
    ).toMatchObject({ cadence: 'months', intervalN: 3 });
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
    expect(isAttachableAccount({ account: buildAccount() })).toBe(true);
    expect(isAttachableAccount({ account: buildAccount({ share: { isOwner: true } }) })).toBe(true);
  });

  it('rejects accounts shared with the user by someone else', () => {
    expect(isAttachableAccount({ account: buildAccount({ share: { isOwner: false } }) })).toBe(false);
  });

  it('rejects categories a plan cannot attach', () => {
    expect(isAttachableAccount({ account: { accountCategory: ACCOUNT_CATEGORIES.loan } as AccountModel })).toBe(false);
  });
});

describe('trashDaysLeft', () => {
  it('counts down from the retention window by calendar day', () => {
    const now = new Date(2026, 9, 12, 9);
    expect(trashDaysLeft({ deletedAt: new Date(2026, 9, 12, 8).toISOString(), now })).toBe(30);
    expect(trashDaysLeft({ deletedAt: new Date(2026, 9, 10, 23).toISOString(), now })).toBe(28);
  });

  it('stops at zero once the window has passed', () => {
    expect(trashDaysLeft({ deletedAt: new Date(2026, 7, 1).toISOString(), now: new Date(2026, 9, 12) })).toBe(0);
  });
});

describe('trashedPlansOf', () => {
  it('keeps only deleted plans, most recently deleted first', () => {
    const plans = [
      { id: 'old', deletedAt: '2026-10-01T10:00:00.000Z' },
      { id: 'active', deletedAt: null },
      { id: 'recent', deletedAt: '2026-10-11T10:00:00.000Z' },
    ] as BudgetPlanModel[];

    expect(trashedPlansOf({ plans }).map((plan) => plan.id)).toEqual(['recent', 'old']);
    expect(plans.map((plan) => plan.id)).toEqual(['old', 'active', 'recent']);
  });

  it('returns nothing when no plan is deleted', () => {
    expect(trashedPlansOf({ plans: [{ id: 'active', deletedAt: null }] as BudgetPlanModel[] })).toEqual([]);
  });
});

describe('isValidCustomInterval', () => {
  it('accepts only whole intervals within the cadence limit', () => {
    expect(isValidCustomInterval({ unit: 'days', every: 366 })).toBe(true);
    expect(isValidCustomInterval({ unit: 'days', every: 367 })).toBe(false);
    expect(isValidCustomInterval({ unit: 'months', every: 12 })).toBe(true);
    expect(isValidCustomInterval({ unit: 'months', every: 13 })).toBe(false);
    expect(isValidCustomInterval({ unit: 'days', every: 0 })).toBe(false);
    expect(isValidCustomInterval({ unit: 'days', every: 1.5 })).toBe(false);
    expect(isValidCustomInterval({ unit: 'days', every: null })).toBe(false);
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

describe('periodSpend', () => {
  it('measures spent against spent plus what is left', () => {
    expect(periodSpend({ header: { totalActivity: -750, totalAvailable: 250 } })).toEqual({
      funded: 1000,
      percent: 75,
    });
  });

  it('reads as 100 percent when the period is overspent, with funded as spent minus the overspend', () => {
    expect(periodSpend({ header: { totalActivity: -500, totalAvailable: -40 } })).toEqual({
      funded: 460,
      percent: 100,
    });
  });

  it('ignores net-positive activity and never reports a negative funded amount', () => {
    expect(periodSpend({ header: { totalActivity: 30, totalAvailable: 200 } })).toEqual({ funded: 200, percent: 0 });
    expect(periodSpend({ header: { totalActivity: 0, totalAvailable: -50 } })).toEqual({ funded: 0, percent: 0 });
    expect(periodSpend({ header: { totalActivity: 0, totalAvailable: 0 } })).toEqual({ funded: 0, percent: 0 });
  });
});

describe('availablePillClass', () => {
  it('lets an underfunded goal outrank the sign of the amount', () => {
    expect(availablePillClass({ amount: 50, underfunded: true })).toContain('text-warning-text');
    expect(availablePillClass({ amount: 50, underfunded: true })).not.toContain('text-success-text');
  });

  it('tones by sign otherwise, with zero muted', () => {
    expect(availablePillClass({ amount: 50 })).toContain('text-success-text');
    expect(availablePillClass({ amount: -50 })).toContain('text-app-expense-color');
    expect(availablePillClass({ amount: 0 })).toContain('text-muted-foreground');
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

describe('lineBarsOf', () => {
  const line = ({ carriedIn = 0, assigned = 0, activity = 0 }) => ({
    carriedIn,
    assigned,
    activity,
    available: carriedIn + assigned + activity,
  });

  it('shows an empty bar when nothing is funded or spent', () => {
    expect(lineBarsOf({ line: line({}) })).toEqual({
      carried: 0,
      assigned: 0,
      spendPercent: 0,
      deficitPercent: 0,
      overspentFundedPercent: 0,
      carriedSpentPercent: 0,
      assignedSpentPercent: 0,
      isOverspent: false,
    });
  });

  it('splits an overspent bar into its funded share and the excess', () => {
    expect(lineBarsOf({ line: line({ assigned: 20, activity: -80 }) }).overspentFundedPercent).toBe(25);
    expect(lineBarsOf({ line: line({ activity: -30 }) }).overspentFundedPercent).toBe(0);
    expect(lineBarsOf({ line: line({ assigned: 100, activity: -40 }) }).overspentFundedPercent).toBe(100);
  });

  it('sizes the excess by the deficit, not by spend, when a deficit is carried in', () => {
    expect(
      lineBarsOf({ line: line({ carriedIn: -100, assigned: 100, activity: -50 }) }).overspentFundedPercent,
    ).toBeCloseTo(66.67, 2);
    expect(lineBarsOf({ line: line({ carriedIn: -100, assigned: 40 }) }).overspentFundedPercent).toBe(40);
  });

  it('measures spend against carried-in plus assigned', () => {
    expect(lineBarsOf({ line: line({ carriedIn: 50, assigned: 150, activity: -50 }) })).toMatchObject({
      carried: 50,
      assigned: 150,
      spendPercent: 25,
      isOverspent: false,
    });
  });

  it('spends the carried-in capsule before the assigned one', () => {
    expect(lineBarsOf({ line: line({ carriedIn: 40, assigned: 100, activity: -20 }) })).toMatchObject({
      carriedSpentPercent: 50,
      assignedSpentPercent: 0,
    });
    expect(lineBarsOf({ line: line({ carriedIn: 40, assigned: 100, activity: -90 }) })).toMatchObject({
      carriedSpentPercent: 100,
      assignedSpentPercent: 50,
    });
  });

  it('treats a negative carry-in as nothing funded from the past', () => {
    expect(lineBarsOf({ line: line({ carriedIn: -100, assigned: 100, activity: -50 }) })).toMatchObject({
      carried: 0,
      assigned: 100,
      spendPercent: 0,
      assignedSpentPercent: 50,
      isOverspent: true,
    });
  });

  it('clamps at 100% and flags the line once it is overspent', () => {
    expect(lineBarsOf({ line: line({ assigned: 100, activity: -150 }) })).toMatchObject({
      spendPercent: 100,
      assignedSpentPercent: 100,
      isOverspent: true,
    });
  });

  it('fills the whole track when spending happens with nothing funded', () => {
    expect(lineBarsOf({ line: line({ activity: -30 }) })).toMatchObject({ spendPercent: 100, isOverspent: true });
  });

  it("counts a carried-in deficit as used, ahead of this period's spend", () => {
    const bars = lineBarsOf({ line: line({ carriedIn: -100, assigned: 150, activity: -40 }) });
    expect(bars.isOverspent).toBe(false);
    expect(bars.deficitPercent).toBeCloseTo(66.67, 2);
    expect(bars.spendPercent).toBeCloseTo(26.67, 2);
  });

  it('lets income on the line pay down a carried-in deficit', () => {
    expect(lineBarsOf({ line: line({ carriedIn: -100, assigned: 200, activity: 30 }) })).toMatchObject({
      deficitPercent: 35,
      spendPercent: 0,
    });
  });

  it('ignores income on the line', () => {
    expect(lineBarsOf({ line: line({ assigned: 100, activity: 40 }) }).spendPercent).toBe(0);
  });
});

describe('spentSummaryOf', () => {
  const line = ({ carriedIn = 0, assigned = 0, activity = 0 }) => ({
    carriedIn,
    assigned,
    activity,
    available: carriedIn + assigned + activity,
  });

  it('reports the used share of the funded amount', () => {
    expect(spentSummaryOf({ line: line({ carriedIn: 80, assigned: 500, activity: -441.76 }) })).toEqual({
      kind: 'used',
      used: 441.76,
      funded: 580,
      percent: '76',
    });
    expect(spentSummaryOf({ line: line({ assigned: 550 }) })).toMatchObject({ kind: 'used', percent: '0' });
    expect(spentSummaryOf({ line: line({ assigned: 100, activity: -100 }) })).toMatchObject({ percent: '100' });
  });

  it('counts a carried-in deficit as used', () => {
    expect(spentSummaryOf({ line: line({ carriedIn: -100, assigned: 150, activity: -40 }) })).toEqual({
      kind: 'used',
      used: 140,
      funded: 150,
      percent: '93',
    });
    expect(spentSummaryOf({ line: line({ carriedIn: -100, assigned: 200, activity: 30 }) })).toMatchObject({
      used: 70,
      percent: '35',
    });
  });

  it('reads 100% once nothing is available, despite float drift in the deficit sum', () => {
    expect(spentSummaryOf({ line: { carriedIn: -0.1, assigned: 0.8, activity: -0.7, available: 0 } })).toMatchObject({
      kind: 'used',
      percent: '100',
    });
  });

  it('never rounds a partly spent line to 0% or 100%', () => {
    expect(spentSummaryOf({ line: line({ assigned: 960, activity: -1 }) })).toMatchObject({ percent: '<1' });
    expect(spentSummaryOf({ line: line({ assigned: 1000, activity: -999 }) })).toMatchObject({ percent: '99' });
  });

  it('reports the overspend by the negative available amount', () => {
    expect(spentSummaryOf({ line: line({ assigned: 20, activity: -50 }) })).toEqual({
      kind: 'overspent',
      used: 50,
      funded: 20,
      overBy: 30,
    });
    expect(spentSummaryOf({ line: line({ carriedIn: -100, assigned: 100, activity: -50 }) })).toEqual({
      kind: 'overspent',
      used: 150,
      funded: 100,
      overBy: 50,
    });
  });

  it('reports spending on a line with nothing funded as overspent', () => {
    expect(spentSummaryOf({ line: line({ activity: -30 }) })).toEqual({
      kind: 'overspent',
      used: 30,
      funded: 0,
      overBy: 30,
    });
  });

  it('flags a line with nothing funded and nothing owed', () => {
    expect(spentSummaryOf({ line: line({}) })).toEqual({ kind: 'unfunded' });
    expect(spentSummaryOf({ line: line({ activity: 40 }) })).toEqual({ kind: 'unfunded' });
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

describe('buildPoolAssignPayload', () => {
  const baseline = { assigned: 100.1, assignedSource: 'baseline' as const, carryPolicy: 'floor' as const };

  it.each(['baseline', 'override'] as const)('adds the amount to a %s line for this period only', (assignedSource) => {
    expect(buildPoolAssignPayload({ line: { ...baseline, assignedSource }, amount: 0.2 })).toEqual({
      scope: 'this_period',
      amount: 100.3,
    });
  });

  it.each([null, 0, -10])('returns null for amount %s', (amount) => {
    expect(buildPoolAssignPayload({ line: baseline, amount })).toBeNull();
  });
});

describe('buildPoolTakeBackPayload', () => {
  const baseline = {
    assigned: 100.3,
    poolAssigned: 100.3,
    assignedSource: 'baseline' as const,
    carryPolicy: 'floor' as const,
  };

  it.each(['baseline', 'override'] as const)(
    'takes the amount off a %s line for this period only',
    (assignedSource) => {
      expect(buildPoolTakeBackPayload({ line: { ...baseline, assignedSource }, amount: 0.2 })).toEqual({
        scope: 'this_period',
        amount: 100.1,
      });
    },
  );

  it('takes the whole assigned down to 0', () => {
    expect(buildPoolTakeBackPayload({ line: baseline, amount: 100.3 })).toEqual({ scope: 'this_period', amount: 0 });
  });

  it.each([null, 0, -10, 100.31])('returns null for amount %s', (amount) => {
    expect(buildPoolTakeBackPayload({ line: baseline, amount })).toBeNull();
  });

  it('returns null when the pool counts none of the assigned', () => {
    expect(buildPoolTakeBackPayload({ line: { ...baseline, poolAssigned: 0 }, amount: 10 })).toBeNull();
  });
});

describe('pickTakeBackLine', () => {
  it('picks the line that can give back the most, the first one on a tie', () => {
    const lines = [
      { lineId: 'small', available: 20, poolAssigned: 50 },
      { lineId: 'first', available: 80, poolAssigned: 100 },
      { lineId: 'tie', available: 120, poolAssigned: 80 },
    ];
    expect(pickTakeBackLine({ lines })?.lineId).toBe('first');
  });

  it('ranks by what the pool counts, not by available alone', () => {
    const lines = [
      { lineId: 'carried', available: 500, poolAssigned: 20 },
      { lineId: 'assigned', available: 150, poolAssigned: 150 },
      { lineId: 'overspent', available: -40, poolAssigned: 300 },
    ];
    expect(pickTakeBackLine({ lines })?.lineId).toBe('assigned');
  });

  it('returns undefined for no lines', () => {
    expect(pickTakeBackLine({ lines: [] })).toBeUndefined();
  });
});

describe('takeBackCandidates', () => {
  it('keeps the lines whose assigned the pool counts', () => {
    const lines = [
      { lineId: 'unassigned', assigned: 0, poolAssigned: 0, assignedSource: 'none' as const },
      { lineId: 'baseline-set-here', assigned: 100, poolAssigned: 100, assignedSource: 'baseline' as const },
      { lineId: 'override', assigned: 50, poolAssigned: 50, assignedSource: 'override' as const },
      { lineId: 'recurring-future', assigned: 100, poolAssigned: 0, assignedSource: 'baseline' as const },
      { lineId: 'zero-override', assigned: 0, poolAssigned: 0, assignedSource: 'override' as const },
    ];
    expect(takeBackCandidates({ lines }).map((line) => line.lineId)).toEqual(['baseline-set-here', 'override']);
  });

  it('returns nothing when the pool counts no assigned money', () => {
    expect(takeBackCandidates({ lines: [{ poolAssigned: 0 }] })).toEqual([]);
  });
});

describe('periodProgress', () => {
  const period = { startDate: '2026-09-01', endDate: '2026-10-01' };

  it('counts today as elapsed and clamps to the period', () => {
    expect(periodProgress({ ...period, now: new Date(2026, 8, 27) })).toEqual({ day: 27, totalDays: 30, daysLeft: 3 });
    expect(periodProgress({ ...period, now: new Date(2026, 7, 20) })).toEqual({ day: 0, totalDays: 30, daysLeft: 30 });
    expect(periodProgress({ ...period, now: new Date(2026, 9, 5) })).toEqual({ day: 30, totalDays: 30, daysLeft: 0 });
  });
});

describe('spendingPace', () => {
  const period = { startDate: '2026-09-01', endDate: '2026-10-01' };

  it('measures spent against carried-in plus assigned and counts today as elapsed', () => {
    const pace = spendingPace({
      ...period,
      activity: -300,
      carriedIn: 200,
      assigned: 800,
      now: new Date(2026, 8, 23, 15),
    });
    expect(pace).toMatchObject({ spent: 300, total: 1000, spentPercent: 30, daysLeft: 7 });
    expect(pace.elapsedPercent).toBeCloseTo((23 / 30) * 100);
  });

  it('ignores income when counting spent', () => {
    expect(spendingPace({ ...period, activity: 50, carriedIn: 0, assigned: 100 }).spent).toBe(0);
  });

  it('counts a negative carry-in as 0, matching the spend segment of the row bar', () => {
    const figures = { activity: -50, carriedIn: -40, assigned: 100 };
    const pace = spendingPace({ ...period, ...figures });
    expect(pace).toMatchObject({ total: 100, spentPercent: 50 });
    const bars = lineBarsOf({ line: { ...figures, available: 10 } });
    expect(bars.spendPercent).toBe(pace.spentPercent);
  });

  it('reports full spend when there is no money to spend but something was spent', () => {
    const now = new Date(2026, 8, 10);
    expect(spendingPace({ ...period, activity: -20, carriedIn: 0, assigned: 0, now }).spentPercent).toBe(100);
    expect(spendingPace({ ...period, activity: 0, carriedIn: 0, assigned: 0, now }).spentPercent).toBe(0);
  });

  it('shows nothing elapsed for a period that has not started', () => {
    const pace = spendingPace({ ...period, activity: 0, carriedIn: 0, assigned: 100, now: new Date(2026, 7, 20) });
    expect(pace).toMatchObject({ elapsedPercent: 0, daysLeft: 30 });
  });

  it('caps elapsed at the end of the period', () => {
    const pace = spendingPace({ ...period, activity: 0, carriedIn: 0, assigned: 100, now: new Date(2026, 9, 5) });
    expect(pace).toMatchObject({ elapsedPercent: 100, daysLeft: 0 });
  });
});

describe('trendBars', () => {
  const trendPeriod = ({
    assigned,
    activity,
    lines = [],
  }: {
    assigned: number;
    activity: number;
    lines?: BudgetPlanTrendPeriod['lines'];
  }): BudgetPlanTrendPeriod => ({
    periodId: 'p',
    startDate: '2026-09-01',
    endDate: '2026-10-01',
    assigned,
    activity,
    carriedIn: 0,
    available: 0,
    lines,
  });

  it('puts assigned and spent on one scale when assigned varies between periods', () => {
    const { bars } = trendBars({
      periods: [
        trendPeriod({ assigned: 200, activity: -100 }),
        trendPeriod({ assigned: 400, activity: -300 }),
        trendPeriod({ assigned: 100, activity: -50 }),
      ],
      lineIds: [],
    });
    expect(bars.map((bar) => bar.assignedPercent)).toEqual([50, 100, 25]);
    expect(bars.map((bar) => bar.withinPercent)).toEqual([25, 75, 12.5]);
    expect(bars.map((bar) => bar.over)).toEqual([0, 0, 0]);
  });

  const line = ({ assigned, activity, available }: { assigned: number; activity: number; available: number }) => [
    { lineId: 'food', assigned, activity, available },
  ];

  it('splits overspending into an over part that sets the scale', () => {
    const { bars } = trendBars({
      periods: [
        trendPeriod({ assigned: 300, activity: -400, lines: line({ assigned: 300, activity: -400, available: -100 }) }),
        trendPeriod({ assigned: 0, activity: -100, lines: line({ assigned: 0, activity: -100, available: -100 }) }),
      ],
      lineIds: [],
    });
    expect(bars[0]).toMatchObject({ over: 100, assignedPercent: 75, withinPercent: 75, overPercent: 25 });
    expect(bars[1]).toMatchObject({ over: 100, assignedPercent: 0, withinPercent: 0, overPercent: 25 });
  });

  it('has no over when carried-in money covers spending above assigned', () => {
    const { bars } = trendBars({
      periods: [
        trendPeriod({ assigned: 100, activity: -200, lines: line({ assigned: 100, activity: -200, available: 0 }) }),
      ],
      lineIds: [],
    });
    expect(bars[0]).toMatchObject({ over: 0, assignedPercent: 50, withinPercent: 100, overPercent: 0 });
  });

  it('caps over at the spending of the period, so a carried-in deficit alone is not over', () => {
    const { bars } = trendBars({
      periods: [
        trendPeriod({ assigned: 0, activity: 0, lines: line({ assigned: 0, activity: 0, available: -40 }) }),
        trendPeriod({ assigned: 0, activity: -10, lines: line({ assigned: 0, activity: -10, available: -50 }) }),
      ],
      lineIds: [],
    });
    expect(bars.map((bar) => bar.over)).toEqual([0, 10]);
  });

  it('counts income as no spend and has no heights when everything is 0', () => {
    const result = trendBars({
      periods: [trendPeriod({ assigned: 0, activity: 40 }), trendPeriod({ assigned: 0, activity: 0 })],
      lineIds: [],
    });
    expect(result.bars.map((bar) => [bar.spent, bar.assignedPercent, bar.withinPercent])).toEqual([
      [0, 0, 0],
      [0, 0, 0],
    ]);
    expect(result).toMatchObject({ usedPercent: null, averageUsedPercent: null });
  });

  it('sums the selected lines, ignores the rest and treats a period without the line as 0', () => {
    const lines = [
      { lineId: 'food', assigned: 100, activity: -80, available: 20 },
      { lineId: 'fun', assigned: 50, activity: -10, available: 40 },
      { lineId: 'rent', assigned: 300, activity: -100, available: 200 },
    ];
    const { bars } = trendBars({
      periods: [trendPeriod({ assigned: 600, activity: 0 }), trendPeriod({ assigned: 500, activity: -200, lines })],
      lineIds: ['food', 'fun'],
    });
    expect(bars.map(({ assigned, spent }) => ({ assigned, spent }))).toEqual([
      { assigned: 0, spent: 0 },
      { assigned: 150, spent: 90 },
    ]);
  });

  it('reports the current period usage and the usage across the earlier funded periods', () => {
    const result = trendBars({
      periods: [
        trendPeriod({ assigned: 0, activity: 0 }),
        trendPeriod({ assigned: 100, activity: -50 }),
        trendPeriod({ assigned: 300, activity: -250 }),
        trendPeriod({ assigned: 200, activity: -50 }),
      ],
      lineIds: [],
    });
    expect(result).toMatchObject({ usedPercent: 25, averageUsedPercent: 75 });
  });

  it('takes over from each overspent line, limited to the selected lines', () => {
    const lines = [
      { lineId: 'food', assigned: 100, activity: -80, available: 20 },
      { lineId: 'fun', assigned: 50, activity: -55, available: -5 },
      { lineId: 'rent', assigned: 300, activity: -400, available: -100 },
    ];
    const period = trendPeriod({ assigned: 450, activity: -535, lines });
    expect(trendBars({ periods: [period], lineIds: [] }).bars[0]!.over).toBe(105);
    expect(trendBars({ periods: [period], lineIds: ['food', 'fun'] }).bars[0]!.over).toBe(5);
    expect(trendBars({ periods: [period], lineIds: ['food'] }).bars[0]!.over).toBe(0);
  });

  it('treats negative assigned as nothing assigned', () => {
    const result = trendBars({
      periods: [
        trendPeriod({ assigned: -50, activity: -50 }),
        trendPeriod({ assigned: 100, activity: 0 }),
        trendPeriod({ assigned: 0, activity: -30 }),
      ],
      lineIds: [],
    });
    expect(result.bars[0]).toMatchObject({ assigned: -50, assignedPercent: 0, withinPercent: 50 });
    expect(result).toMatchObject({ usedPercent: null, averageUsedPercent: 50 });
  });

  it('averages only the 5 periods before the current one', () => {
    const periods = [1000, 100, 100, 100, 100, 100, 100].map((spent) =>
      trendPeriod({ assigned: 100, activity: -spent }),
    );
    expect(trendBars({ periods, lineIds: [] }).averageUsedPercent).toBe(100);
  });

  it('has no bars or usage without periods', () => {
    expect(trendBars({ periods: [], lineIds: [] })).toEqual({ bars: [], usedPercent: null, averageUsedPercent: null });
  });

  it('has no average for a single period', () => {
    expect(trendBars({ periods: [trendPeriod({ assigned: 80, activity: -20 })], lineIds: [] })).toMatchObject({
      usedPercent: 25,
      averageUsedPercent: null,
    });
  });
});

describe('isPastPeriod', () => {
  const period = { endDate: '2026-10-01' };

  it('counts a period as past from its exclusive end date', () => {
    expect(isPastPeriod({ period, now: new Date(2026, 8, 30, 23) })).toBe(false);
    expect(isPastPeriod({ period, now: new Date(2026, 9, 1) })).toBe(true);
  });
});

describe('scheduledForLines', () => {
  const item = ({ id, date, amount, lineId }: Pick<BudgetPlanScheduledItem, 'id' | 'date' | 'amount' | 'lineId'>) =>
    ({
      id,
      date,
      amount,
      lineId,
      source: 'planned',
      name: id,
      currencyCode: 'USD',
      nativeAmount: amount,
      categoryId: null,
      accountId: null,
    }) satisfies BudgetPlanScheduledItem;

  const scheduled: BudgetPlanScheduled = {
    items: [
      item({ id: 'rent', date: '2026-09-24', amount: -1000, lineId: 'home' }),
      item({ id: 'gym', date: '2026-09-25', amount: -40, lineId: 'fun' }),
      item({ id: 'refund', date: '2026-09-27', amount: 15, lineId: 'fun' }),
      item({ id: 'bill', date: '2026-09-28', amount: -60, lineId: 'fun' }),
    ],
    outflows: { total: -1100, count: 3 },
    inflows: { total: 15, count: 1 },
    nextDate: '2026-09-24',
  };

  it('returns the whole period untouched without a line', () => {
    expect(scheduledForLines({ scheduled, lineIds: [] })).toBe(scheduled);
  });

  it('keeps only the line items and re-sums them', () => {
    expect(scheduledForLines({ scheduled, lineIds: ['fun'] })).toEqual({
      items: scheduled.items.slice(1),
      outflows: { total: -100, count: 2 },
      inflows: { total: 15, count: 1 },
      nextDate: '2026-09-25',
    });
  });

  it('returns the empty shape when the line has nothing scheduled', () => {
    expect(scheduledForLines({ scheduled, lineIds: ['car'] })).toEqual({
      items: [],
      outflows: { total: 0, count: 0 },
      inflows: { total: 0, count: 0 },
      nextDate: null,
    });
  });

  it('unions the items of several lines', () => {
    expect(scheduledForLines({ scheduled, lineIds: ['home', 'car'] })).toEqual({
      items: scheduled.items.slice(0, 1),
      outflows: { total: -1000, count: 1 },
      inflows: { total: 0, count: 0 },
      nextDate: '2026-09-24',
    });
  });
});

describe('trendPaddingStarts', () => {
  it('extrapolates earlier monthly periods so there are 6 slots', () => {
    expect(
      trendPaddingStarts({
        oldest: { startDate: '2026-08-01', endDate: '2026-09-01' },
        cadence: 'months',
        periodCount: 2,
      }),
    ).toEqual(['2026-04-01', '2026-05-01', '2026-06-01', '2026-07-01']);
  });

  it('steps back by the period length for day cadences', () => {
    expect(
      trendPaddingStarts({
        oldest: { startDate: '2026-09-15', endDate: '2026-09-29' },
        cadence: 'days',
        periodCount: 4,
      }),
    ).toEqual(['2026-08-18', '2026-09-01']);
  });

  it('leaves semi-monthly padding unlabelled', () => {
    expect(
      trendPaddingStarts({
        oldest: { startDate: '2026-09-01', endDate: '2026-09-16' },
        cadence: 'semi_monthly',
        periodCount: 5,
      }),
    ).toEqual([null]);
  });

  it('adds no padding when every slot has a period', () => {
    expect(
      trendPaddingStarts({
        oldest: { startDate: '2026-04-01', endDate: '2026-05-01' },
        cadence: 'months',
        periodCount: 6,
      }),
    ).toEqual([]);
  });
});

describe('goalStatusDisplay', () => {
  const goal = { frequency: 'every_period' as const, status: 'funded' as const, progress: 50, target: 100 };

  it('tints an underfunded goal orange and fills the bar to progress over target', () => {
    expect(goalStatusDisplay({ goal: { ...goal, status: 'underfunded' } })).toEqual({
      kind: 'underfunded',
      percent: 50,
      textClass: 'text-warning-text',
      barClass: 'bg-warning',
    });
  });

  it('tints a funded goal green', () => {
    expect(goalStatusDisplay({ goal: { ...goal, progress: 100 } })).toMatchObject({
      kind: 'funded',
      percent: 100,
      textClass: 'text-success-text',
    });
  });

  it('shows an open-ended goal as progress in the accent colour', () => {
    const display = goalStatusDisplay({ goal: { ...goal, frequency: 'open_ended', progress: 87.6 } });
    expect(display).toMatchObject({ kind: 'progress', percent: 87, textClass: 'text-primary-text' });
  });

  it('keeps a dated goal as funded', () => {
    expect(goalStatusDisplay({ goal: { ...goal, frequency: 'by_date' } }).kind).toBe('funded');
  });

  it('fills an achieved goal and mutes a snoozed one', () => {
    expect(goalStatusDisplay({ goal: { ...goal, status: 'achieved', progress: 10 } }).percent).toBe(100);
    expect(goalStatusDisplay({ goal: { ...goal, status: 'snoozed' } })).toMatchObject({
      kind: 'snoozed',
      textClass: 'text-muted-foreground',
    });
  });

  it('clamps the bar between 0 and 100', () => {
    expect(goalStatusDisplay({ goal: { ...goal, progress: -20 } }).percent).toBe(0);
    expect(goalStatusDisplay({ goal: { ...goal, progress: 250 } }).percent).toBe(100);
    expect(goalStatusDisplay({ goal: { ...goal, target: 0 } }).percent).toBe(0);
  });
});

describe('goalPeriodUnit', () => {
  it('says month only for a one-month plan', () => {
    expect(goalPeriodUnit({ cadence: 'months', intervalN: 1 })).toBe('month');
    expect(goalPeriodUnit({ cadence: 'months', intervalN: 2 })).toBe('period');
    expect(goalPeriodUnit({ cadence: 'semi_monthly', intervalN: 1 })).toBe('period');
    expect(goalPeriodUnit({ cadence: 'days', intervalN: 7 })).toBe('period');
  });
});

describe('goalTitle / goalSubtitle', () => {
  const goal = { frequency: 'every_period' as const, weekday: null, anchorDate: null, dueDate: null };

  it('titles the goal by behaviour', () => {
    expect(goalTitle({ goal: { behavior: 'reach_balance', amount: 6500 } })).toEqual({
      key: 'budgetPlans.goals.title.reach_balance',
      params: { amount: { money: 6500 } },
    });
  });

  it('names the rhythm, using the plan unit for every period', () => {
    expect(goalSubtitle({ goal, unit: 'month' }).key).toBe('budgetPlans.goals.unit.month.frequency');
    expect(goalSubtitle({ goal, unit: 'period' }).key).toBe('budgetPlans.goals.unit.period.frequency');
    expect(goalSubtitle({ goal: { ...goal, frequency: 'weekly', weekday: 1 }, unit: 'month' })).toEqual({
      key: 'budgetPlans.goals.subtitle.weeklyOn',
      params: { weekday: { weekday: 1 } },
    });
    expect(goalSubtitle({ goal: { ...goal, frequency: 'biweekly' }, unit: 'month' }).key).toBe(
      'budgetPlans.goals.subtitle.biweekly',
    );
    expect(goalSubtitle({ goal: { ...goal, frequency: 'open_ended' }, unit: 'month' }).key).toBe(
      'budgetPlans.goals.subtitle.noDeadline',
    );
  });

  it('dates a dated goal by the active cycle, falling back to the anchor', () => {
    const byDate = { ...goal, frequency: 'by_date' as const, anchorDate: '2027-03-28' };
    expect(goalSubtitle({ goal: byDate, unit: 'month' })).toEqual({
      key: 'budgetPlans.goals.dueBy',
      params: { date: { date: '2027-03-28', pattern: 'PP' } },
    });
    const yearly = { ...goal, frequency: 'yearly' as const, anchorDate: '2026-03-28', dueDate: '2027-03-28' };
    expect(goalSubtitle({ goal: yearly, unit: 'month' }).params?.date).toEqual({
      date: '2027-03-28',
      pattern: 'd MMM',
    });
  });
});

describe('goalCaption', () => {
  const goal = {
    frequency: 'every_period' as const,
    status: 'underfunded' as const,
    ask: 71.43,
    progress: 0,
    target: 100,
    fundedThrough: null,
    nextNeededDate: null,
  };

  it('asks for the amount this period', () => {
    expect(goalCaption({ goal, unit: 'month' })).toEqual({
      part: { key: 'budgetPlans.goals.unit.month.need', params: { amount: { money: 71.43 } } },
      icon: null,
    });
  });

  it('asks by the next needed date for weekly goals', () => {
    const weekly = { ...goal, frequency: 'weekly' as const, nextNeededDate: '2026-09-19' };
    expect(goalCaption({ goal: weekly, unit: 'month' }).part).toEqual({
      key: 'budgetPlans.goals.needBy',
      params: { amount: { money: 71.43 }, date: { date: '2026-09-19', pattern: 'do' } },
    });
  });

  it('says how far a partly funded biweekly goal reaches', () => {
    const biweekly = { ...goal, frequency: 'biweekly' as const, fundedThrough: '2026-09-12' };
    expect(goalCaption({ goal: biweekly, unit: 'month' }).part.key).toBe('budgetPlans.goals.fundedThrough');
  });

  it('falls back to the generic ask for a weekly goal with no funded-through or next needed date', () => {
    const weekly = { ...goal, frequency: 'weekly' as const };
    expect(goalCaption({ goal: weekly, unit: 'period' })).toEqual({
      part: { key: 'budgetPlans.goals.unit.period.need', params: { amount: { money: 71.43 } } },
      icon: null,
    });
  });

  it('marks funded, achieved and snoozed goals', () => {
    expect(goalCaption({ goal: { ...goal, status: 'funded' }, unit: 'month' })).toEqual({
      part: { key: 'budgetPlans.goals.status.funded' },
      icon: 'check',
    });
    expect(goalCaption({ goal: { ...goal, status: 'achieved' }, unit: 'month' }).part.key).toBe(
      'budgetPlans.goals.status.achieved',
    );
    expect(goalCaption({ goal: { ...goal, status: 'snoozed' }, unit: 'month' })).toEqual({
      part: { key: 'budgetPlans.goals.status.snoozed' },
      icon: 'moon',
    });
  });

  it('shows an open-ended goal as a fraction', () => {
    const openEnded = { ...goal, frequency: 'open_ended' as const, status: 'funded' as const, progress: 13073.5 };
    expect(goalCaption({ goal: { ...openEnded, target: 15000 }, unit: 'month' }).part).toEqual({
      key: 'budgetPlans.goals.progressFraction',
      params: { progress: { money: 13073.5 }, target: { money: 15000 }, percent: { value: 87 } },
    });
  });
});

describe('goalPeekStats', () => {
  const goal = { progress: 40, target: 100, periodTarget: 100, ask: 60 };
  const line = { assigned: 40 };
  const labels = (stats: { labelKey: string }[]) => stats.map((stat) => stat.labelKey.split('.').pop());

  it('shows saved, target, left to save and need for a balance goal', () => {
    const stats = goalPeekStats({ goal: { ...goal, behavior: 'reach_balance' }, line, unit: 'month' });
    expect(labels(stats)).toEqual(['saved', 'target', 'leftToSave', 'needLabel']);
    expect(stats.map((stat) => stat.amount)).toEqual([40, 100, 60, 60]);
  });

  it('shows balance and refill target for refill up to', () => {
    const stats = goalPeekStats({ goal: { ...goal, behavior: 'refill_up_to' }, line, unit: 'month' });
    expect(labels(stats)).toEqual(['balance', 'refillTo', 'needLabel']);
  });

  it('shows budgeted and this period target for budget another', () => {
    const stats = goalPeekStats({ goal: { ...goal, behavior: 'budget_another' }, line, unit: 'period' });
    expect(stats).toEqual([
      { labelKey: 'budgetPlans.goals.unit.period.budgeted', amount: 40 },
      { labelKey: 'budgetPlans.goals.unit.period.target', amount: 100 },
      { labelKey: 'budgetPlans.goals.unit.period.needLabel', amount: 60 },
    ]);
  });

  it('uses the period target, not the cycle total, for a dated budget another', () => {
    const dated = { ...goal, behavior: 'budget_another' as const, target: 6500, periodTarget: 571.43 };
    expect(goalPeekStats({ goal: dated, line, unit: 'month' })[1]!.amount).toBe(571.43);
  });
});

const editorState = (overrides: Partial<GoalEditorState> = {}): GoalEditorState => ({
  ...goalEditorStateFrom({ goal: null }),
  amount: 100,
  ...overrides,
});

describe('goalEditorStateFrom', () => {
  it('starts a new goal as an every-period budget on Mondays', () => {
    expect(goalEditorStateFrom({ goal: null })).toEqual({
      frequency: 'every_period',
      behavior: 'budget_another',
      amount: null,
      weekday: 1,
      anchorDate: null,
      repeats: false,
      repeatEvery: 1,
      repeatUnit: 'months',
      hasStopAtBalance: false,
      stopAtBalance: null,
      hasFundingCap: false,
      fundingCap: null,
    });
  });

  it('reads an existing goal back', () => {
    const state = goalEditorStateFrom({
      goal: {
        frequency: 'by_date',
        behavior: 'refill_up_to',
        amount: 500,
        weekday: null,
        anchorDate: '2027-03-28',
        repeatEvery: 3,
        repeatUnit: 'months',
        stopAtBalance: null,
        fundingCap: 80,
      },
    });
    expect(state).toMatchObject({ frequency: 'by_date', repeats: true, repeatEvery: 3, hasFundingCap: true });
    expect(state.anchorDate?.getDate()).toBe(28);
  });
});

describe('setGoalFrequency', () => {
  it('resets the behaviour to the default and keeps the amount', () => {
    const state = editorState({ behavior: 'refill_up_to', amount: 250 });
    expect(setGoalFrequency({ state, frequency: 'by_date' })).toMatchObject({
      behavior: 'reach_balance',
      amount: 250,
    });
    expect(setGoalFrequency({ state, frequency: 'open_ended' }).behavior).toBe('reach_balance');
    expect(setGoalFrequency({ state, frequency: 'weekly' }).behavior).toBe('budget_another');
  });
});

describe('goalEditorFields', () => {
  const fields = ({ frequency, behavior }: Pick<GoalEditorState, 'frequency' | 'behavior'>) =>
    goalEditorFields({ state: { frequency, behavior } });

  it('asks for a weekday only on a weekly goal', () => {
    expect(fields({ frequency: 'weekly', behavior: 'budget_another' }).weekday).toBe(true);
    for (const frequency of ['biweekly', 'every_period', 'yearly', 'by_date', 'open_ended'] as const) {
      expect(fields({ frequency, behavior: 'budget_another' }).weekday).toBe(false);
    }
  });

  it('asks for an anchor date on biweekly, yearly and by-date goals', () => {
    for (const frequency of ['biweekly', 'yearly', 'by_date'] as const) {
      expect(fields({ frequency, behavior: 'budget_another' }).anchorDate).toBe(true);
    }
    for (const frequency of ['weekly', 'every_period', 'open_ended'] as const) {
      expect(fields({ frequency, behavior: 'budget_another' }).anchorDate).toBe(false);
    }
  });

  it('offers repeat on a by-date goal unless it saves up to a balance', () => {
    expect(fields({ frequency: 'by_date', behavior: 'budget_another' }).repeat).toBe(true);
    expect(fields({ frequency: 'by_date', behavior: 'refill_up_to' }).repeat).toBe(true);
    expect(fields({ frequency: 'by_date', behavior: 'reach_balance' }).repeat).toBe(false);
    expect(fields({ frequency: 'yearly', behavior: 'budget_another' }).repeat).toBe(false);
  });

  it('ties the stop-at balance to budget_another and the funding cap to refill_up_to', () => {
    expect(fields({ frequency: 'every_period', behavior: 'budget_another' })).toMatchObject({
      stopAtBalance: true,
      fundingCap: false,
    });
    expect(fields({ frequency: 'every_period', behavior: 'refill_up_to' })).toMatchObject({
      stopAtBalance: false,
      fundingCap: true,
    });
    expect(fields({ frequency: 'open_ended', behavior: 'reach_balance' })).toMatchObject({
      stopAtBalance: false,
      fundingCap: false,
    });
  });
});

describe('validateGoalEditor', () => {
  const now = new Date(2026, 8, 23, 12);
  const valid = { amount: null, anchorDate: null, repeatEvery: null, stopAtBalance: null, fundingCap: null };

  it('passes a positive amount', () => {
    expect(validateGoalEditor({ state: editorState(), now })).toEqual(valid);
  });

  it('rejects a missing, zero or negative amount', () => {
    for (const amount of [null, 0, -5]) {
      expect(validateGoalEditor({ state: editorState({ amount }), now }).amount).toBe(
        'budgetPlans.goals.errors.amount',
      );
    }
  });

  it('requires a date for biweekly, yearly and by date', () => {
    for (const frequency of ['biweekly', 'yearly', 'by_date'] as const) {
      expect(validateGoalEditor({ state: editorState({ frequency }), now }).anchorDate).toBe(
        'budgetPlans.goals.errors.dateRequired',
      );
    }
    expect(validateGoalEditor({ state: editorState({ anchorDate: new Date('nope') }), now }).anchorDate).toBeNull();
  });

  it('requires a future due date only for a non-repeating by-date goal', () => {
    const past = new Date(2026, 0, 1);
    const byDate = editorState({ frequency: 'by_date', behavior: 'reach_balance', anchorDate: past });
    expect(validateGoalEditor({ state: byDate, now }).anchorDate).toBe('budgetPlans.goals.errors.dueDateFuture');
    expect(validateGoalEditor({ state: { ...byDate, anchorDate: new Date(2026, 8, 24) }, now }).anchorDate).toBeNull();
    expect(
      validateGoalEditor({ state: { ...byDate, behavior: 'budget_another', repeats: true }, now }).anchorDate,
    ).toBeNull();
    expect(validateGoalEditor({ state: { ...byDate, frequency: 'yearly' }, now }).anchorDate).toBeNull();
  });

  it('bounds the repeat by its unit', () => {
    const repeating = editorState({
      frequency: 'by_date',
      behavior: 'budget_another',
      anchorDate: new Date(2027, 0, 1),
      repeats: true,
    });
    expect(validateGoalEditor({ state: { ...repeating, repeatEvery: 11 }, now }).repeatEvery).toBeNull();
    expect(validateGoalEditor({ state: { ...repeating, repeatEvery: 12 }, now }).repeatEvery).toBe(
      'budgetPlans.goals.errors.repeatEvery',
    );
    expect(validateGoalEditor({ state: { ...repeating, repeatEvery: 6, repeatUnit: 'years' }, now }).repeatEvery).toBe(
      'budgetPlans.goals.errors.repeatEvery',
    );
    expect(validateGoalEditor({ state: { ...repeating, repeatEvery: 1.5 }, now }).repeatEvery).not.toBeNull();
    expect(
      validateGoalEditor({ state: { ...repeating, behavior: 'reach_balance', repeatEvery: 99 }, now }).repeatEvery,
    ).toBeNull();
  });

  it('checks a switched-on cap only for its behaviour', () => {
    const stop = editorState({ hasStopAtBalance: true, stopAtBalance: null });
    expect(validateGoalEditor({ state: stop, now }).stopAtBalance).toBe('budgetPlans.goals.errors.amount');
    expect(validateGoalEditor({ state: { ...stop, behavior: 'refill_up_to' }, now }).stopAtBalance).toBeNull();
    const cap = editorState({ behavior: 'refill_up_to', hasFundingCap: true, fundingCap: 0 });
    expect(validateGoalEditor({ state: cap, now }).fundingCap).toBe('budgetPlans.goals.errors.amount');
  });
});

describe('buildGoalPayload', () => {
  const anchorDate = new Date(2027, 2, 28);

  it('sends an every-period goal with every optional field cleared', () => {
    expect(buildGoalPayload({ state: editorState({ anchorDate, weekday: 3 }) })).toEqual({
      frequency: 'every_period',
      behavior: 'budget_another',
      amount: 100,
      weekday: null,
      anchorDate: null,
      repeatEvery: null,
      repeatUnit: null,
      stopAtBalance: null,
      fundingCap: null,
    });
  });

  it('sends the weekday only for weekly and the date for anchored frequencies', () => {
    expect(buildGoalPayload({ state: editorState({ frequency: 'weekly', weekday: 0 }) }).weekday).toBe(0);
    expect(buildGoalPayload({ state: editorState({ frequency: 'biweekly', anchorDate }) })).toMatchObject({
      weekday: null,
      anchorDate: '2027-03-28',
    });
  });

  it('sends the repeat only for a repeating by-date budget another or refill', () => {
    const state = editorState({
      frequency: 'by_date',
      behavior: 'budget_another',
      anchorDate,
      repeats: true,
      repeatEvery: 2,
      repeatUnit: 'years',
    });
    expect(buildGoalPayload({ state })).toMatchObject({ repeatEvery: 2, repeatUnit: 'years' });
    expect(buildGoalPayload({ state: { ...state, behavior: 'reach_balance' } })).toMatchObject({
      repeatEvery: null,
      repeatUnit: null,
    });
    expect(buildGoalPayload({ state: { ...state, repeats: false } }).repeatEvery).toBeNull();
  });

  it('sends a switched-on cap only for its behaviour', () => {
    const state = editorState({ hasStopAtBalance: true, stopAtBalance: 500, hasFundingCap: true, fundingCap: 50 });
    expect(buildGoalPayload({ state })).toMatchObject({ stopAtBalance: 500, fundingCap: null });
    expect(buildGoalPayload({ state: { ...state, behavior: 'refill_up_to' } })).toMatchObject({
      stopAtBalance: null,
      fundingCap: 50,
    });
    expect(buildGoalPayload({ state: { ...state, hasStopAtBalance: false } }).stopAtBalance).toBeNull();
  });

  it('adds the period only when given', () => {
    expect(buildGoalPayload({ state: editorState(), periodId: '42' }).periodId).toBe('42');
    expect(buildGoalPayload({ state: editorState() })).not.toHaveProperty('periodId');
  });
});

describe('goalSummary', () => {
  const anchorDate = new Date(2027, 2, 28);

  it('describes an every-period goal in the plan unit', () => {
    expect(goalSummary({ state: editorState(), unit: 'month' })).toEqual({
      key: 'budgetPlans.goals.summary.budget_another',
      params: { amount: { money: 100 }, when: { part: { key: 'budgetPlans.goals.unit.month.each' } } },
    });
    expect(goalSummary({ state: editorState({ behavior: 'refill_up_to' }), unit: 'period' })).toEqual({
      key: 'budgetPlans.goals.summary.refill_up_to',
      params: { amount: { money: 100 }, when: { part: { key: 'budgetPlans.goals.unit.period.each' } } },
    });
  });

  it('names the weekday of a weekly goal', () => {
    expect(
      goalSummary({ state: editorState({ frequency: 'weekly', weekday: 1 }), unit: 'month' })?.params?.when,
    ).toEqual({ part: { key: 'budgetPlans.goals.when.eachWeekOn', params: { weekday: { weekday: 1 } } } });
  });

  it('describes balance goals with and without a deadline', () => {
    expect(
      goalSummary({
        state: editorState({ frequency: 'by_date', behavior: 'reach_balance', anchorDate }),
        unit: 'month',
      }),
    ).toEqual({
      key: 'budgetPlans.goals.summary.by_date',
      params: { amount: { money: 100 }, date: { date: '2027-03-28', pattern: 'PP' } },
    });
    expect(
      goalSummary({ state: editorState({ frequency: 'open_ended', behavior: 'reach_balance' }), unit: 'month' }),
    ).toEqual({ key: 'budgetPlans.goals.summary.open_ended', params: { amount: { money: 100 } } });
  });

  it('adds the repeat interval to a repeating by-date goal', () => {
    const state = editorState({ frequency: 'by_date', anchorDate, repeats: true, repeatEvery: 1, repeatUnit: 'years' });
    expect(goalSummary({ state, unit: 'month' })?.params?.when).toEqual({
      part: {
        key: 'budgetPlans.goals.when.byDateRepeating.years',
        params: { date: { date: '2027-03-28', pattern: 'PP' }, count: { value: 1 } },
      },
    });
    expect(goalSummary({ state: { ...state, repeats: false }, unit: 'month' })?.params?.when).toEqual({
      part: { key: 'budgetPlans.goals.when.byDate', params: { date: { date: '2027-03-28', pattern: 'PP' } } },
    });
  });

  it('stays empty without an amount or, for by date, a due date', () => {
    expect(goalSummary({ state: editorState({ amount: null }), unit: 'month' })).toBeNull();
    expect(goalSummary({ state: editorState({ frequency: 'by_date' }), unit: 'month' })).toBeNull();
  });
});

describe('groupLines', () => {
  const groups = [
    { id: 'bills', name: 'Bills' },
    { id: 'fun', name: 'Fun' },
  ];

  it('splits lines into ungrouped and per-group sections in group order, keeping line order', () => {
    const lines = [
      { id: 'a', groupId: 'fun' },
      { id: 'b', groupId: null },
      { id: 'c', groupId: 'bills' },
      { id: 'd', groupId: 'fun' },
    ];
    const result = groupLines({ lines, groups });
    expect(result.ungrouped.map((line) => line.id)).toEqual(['b']);
    expect(
      result.groups.map(({ group, lines: sectionLines }) => [group.id, sectionLines.map((line) => line.id)]),
    ).toEqual([
      ['bills', ['c']],
      ['fun', ['a', 'd']],
    ]);
  });

  it('keeps empty groups and treats a line with an unknown group as ungrouped', () => {
    const result = groupLines({ lines: [{ id: 'a', groupId: 'gone' }], groups });
    expect(result.ungrouped.map((line) => line.id)).toEqual(['a']);
    expect(result.groups.map(({ lines: sectionLines }) => sectionLines.length)).toEqual([0, 0]);
  });
});

describe('headerStats', () => {
  it('lists assigned, spent, available and overspent with the overspent line count', () => {
    const result = headerStats({
      view: {
        header: { totalAssigned: 500, totalActivity: -320, totalAvailable: 180 },
        lines: [{ available: -20 }, { available: 250 }, { available: -50 }],
      } as Parameters<typeof headerStats>[0]['view'],
    });
    expect(result.overspentLineCount).toBe(2);
    expect(result.stats.map(({ key, amount, toned }) => ({ key, amount, toned }))).toEqual([
      { key: 'assigned', amount: 500, toned: false },
      { key: 'spent', amount: 320, toned: false },
      { key: 'available', amount: 180, toned: true },
      { key: 'overspent', amount: -70, toned: true },
    ]);
  });
});

describe('sumLineTotals', () => {
  it('sums assigned, activity and available', () => {
    expect(
      sumLineTotals({
        lines: [
          { carriedIn: 10, assigned: 100, activity: -40, available: 60 },
          { carriedIn: 0, assigned: 50, activity: -80, available: -30 },
        ],
      }),
    ).toEqual({ carriedIn: 10, assigned: 150, activity: -120, available: 30 });
  });

  it('returns zeros for no lines', () => {
    expect(sumLineTotals({ lines: [] })).toEqual({ carriedIn: 0, assigned: 0, activity: 0, available: 0 });
  });

  it('rounds float residue to a positive zero', () => {
    const line = { carriedIn: 0, assigned: 0, activity: 0 };
    const { available } = sumLineTotals({
      lines: [
        { ...line, available: 10.1 },
        { ...line, available: 20.2 },
        { ...line, available: -30.3 },
      ],
    });
    expect(Object.is(available, 0)).toBe(true);
  });
});

describe('layoutStateFrom / buildLayoutPayload', () => {
  const line = ({
    id,
    sortOrder,
    groupId = null,
    activeUntil = null,
  }: {
    id: string;
    sortOrder: number;
    groupId?: string | null;
    activeUntil?: string | null;
  }) => ({ id, name: id.toUpperCase(), sortOrder, groupId, activeUntil });

  const groups = [
    { id: 'bills', name: 'Bills' },
    { id: 'fun', name: 'Fun' },
  ];

  it('orders live lines by sortOrder inside each section and leaves archived lines out', () => {
    const state = layoutStateFrom({
      lines: [
        line({ id: 'rent', sortOrder: 1, groupId: 'bills' }),
        line({ id: 'power', sortOrder: 0, groupId: 'bills' }),
        line({ id: 'old', sortOrder: 2, groupId: 'bills', activeUntil: '2026-01-01' }),
        line({ id: 'misc', sortOrder: 0 }),
      ],
      groups,
    });
    expect(state).toEqual({
      ungrouped: [{ id: 'misc', name: 'MISC' }],
      groups: [
        {
          id: 'bills',
          name: 'Bills',
          lines: [
            { id: 'power', name: 'POWER' },
            { id: 'rent', name: 'RENT' },
          ],
        },
        { id: 'fun', name: 'Fun', lines: [] },
      ],
    });
  });

  it('builds the payload from the edited state, listing every group even when empty', () => {
    expect(
      buildLayoutPayload({
        state: {
          ungrouped: [{ id: 'rent', name: 'Rent' }],
          groups: [
            { id: 'fun', name: 'Fun', lines: [{ id: 'movies', name: 'Movies' }] },
            { id: 'bills', name: 'Bills', lines: [] },
          ],
        },
      }),
    ).toEqual({
      groups: [
        { id: 'fun', lineIds: ['movies'] },
        { id: 'bills', lineIds: [] },
      ],
      ungroupedLineIds: ['rent'],
    });
  });
});
