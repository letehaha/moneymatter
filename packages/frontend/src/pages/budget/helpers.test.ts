import {
  ACCOUNT_CATEGORIES,
  type AccountModel,
  type BudgetPlanScheduled,
  type BudgetPlanScheduledItem,
  type BudgetPlanTrendPeriod,
} from '@bt/shared/types';
import { uk } from 'date-fns/locale';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  buildAssignmentPayload,
  buildCreatePlanPayload,
  buildLayoutPayload,
  buildGoalPayload,
  buildPoolAssignPayload,
  cadenceLabel,
  defaultAssignmentScope,
  formatPeriodLabel,
  type GoalEditorState,
  goalCaption,
  goalEditorStateFrom,
  goalPeekStats,
  goalPeriodUnit,
  goalStatusDisplay,
  goalSubtitle,
  goalSummary,
  goalTitle,
  groupLines,
  isAttachableAccount,
  isPastPeriod,
  layoutStateFrom,
  lineBarsOf,
  lineIdsWithHistory,
  scheduledForLine,
  setGoalFrequency,
  spendingPace,
  trendPaddingStarts,
  trendSummary,
  trendValues,
  sumLineTotals,
  sumOverspent,
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
      spentPercent: 0,
      carriedSpentPercent: 0,
      assignedSpentPercent: 0,
      isOverspent: false,
    });
  });

  it('measures spend against carried-in plus assigned', () => {
    expect(lineBarsOf({ line: line({ carriedIn: 50, assigned: 150, activity: -50 }) })).toMatchObject({
      carried: 50,
      assigned: 150,
      spentPercent: 25,
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
      spentPercent: 50,
      assignedSpentPercent: 50,
      isOverspent: true,
    });
  });

  it('clamps at 100% and flags the line once it is overspent', () => {
    expect(lineBarsOf({ line: line({ assigned: 100, activity: -150 }) })).toMatchObject({
      spentPercent: 100,
      assignedSpentPercent: 100,
      isOverspent: true,
    });
  });

  it('fills the whole track when spending happens with nothing funded', () => {
    expect(lineBarsOf({ line: line({ activity: -30 }) })).toMatchObject({ spentPercent: 100, isOverspent: true });
  });

  it('ignores income on the line', () => {
    expect(lineBarsOf({ line: line({ assigned: 100, activity: 40 }) }).spentPercent).toBe(0);
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

describe('trendValues', () => {
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

  const periods = [
    trendPeriod({
      assigned: 500,
      activity: -200,
      lines: [{ lineId: 'food', assigned: 100, activity: -80, available: 20 }],
    }),
    trendPeriod({ assigned: 600, activity: 40 }),
  ];

  it('reads assigned for budgeting and spent for spending, with income counting as no spend', () => {
    expect(trendValues({ periods, lineId: null, kind: 'budgeting' })).toEqual([500, 600]);
    expect(trendValues({ periods, lineId: null, kind: 'spending' })).toEqual([200, 0]);
  });

  it('reads the line values and treats a period without the line as 0', () => {
    expect(trendValues({ periods, lineId: 'food', kind: 'budgeting' })).toEqual([100, 0]);
    expect(trendValues({ periods, lineId: 'food', kind: 'spending' })).toEqual([80, 0]);
  });
});

describe('trendSummary', () => {
  it('scales bars to the max and compares the current value with the previous one', () => {
    const summary = trendSummary({ values: [100, 200, 400, 300, 500, 250] });
    expect(summary.heights).toEqual([20, 40, 80, 60, 100, 50]);
    expect(summary).toMatchObject({ current: 250, changePercent: -50, average: 300, averageCount: 5 });
  });

  it('averages only the periods before the current one', () => {
    expect(trendSummary({ values: [100, 300] })).toMatchObject({ average: 100, averageCount: 1, changePercent: 200 });
  });

  it('has no change or average for a single period', () => {
    expect(trendSummary({ values: [80] })).toMatchObject({ changePercent: null, average: null, heights: [100] });
  });

  it('has no change when the previous value is 0 and no bar heights when everything is 0', () => {
    expect(trendSummary({ values: [0, 0] })).toMatchObject({ changePercent: null, heights: [0, 0] });
  });
});

describe('isPastPeriod', () => {
  const period = { endDate: '2026-10-01' };

  it('counts a period as past from its exclusive end date', () => {
    expect(isPastPeriod({ period, now: new Date(2026, 8, 30, 23) })).toBe(false);
    expect(isPastPeriod({ period, now: new Date(2026, 9, 1) })).toBe(true);
  });
});

describe('scheduledForLine', () => {
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
    expect(scheduledForLine({ scheduled, lineId: null })).toBe(scheduled);
  });

  it('keeps only the line items and re-sums them', () => {
    expect(scheduledForLine({ scheduled, lineId: 'fun' })).toEqual({
      items: scheduled.items.slice(1),
      outflows: { total: -100, count: 2 },
      inflows: { total: 15, count: 1 },
      nextDate: '2026-09-25',
    });
  });

  it('returns the empty shape when the line has nothing scheduled', () => {
    expect(scheduledForLine({ scheduled, lineId: 'car' })).toEqual({
      items: [],
      outflows: { total: 0, count: 0 },
      inflows: { total: 0, count: 0 },
      nextDate: null,
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
      params: { date: { date: '2027-03-28', pattern: 'P' } },
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
      params: { amount: { money: 100 }, date: { date: '2027-03-28', pattern: 'P' } },
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
        params: { date: { date: '2027-03-28', pattern: 'P' }, count: { value: 1 } },
      },
    });
    expect(goalSummary({ state: { ...state, repeats: false }, unit: 'month' })?.params?.when).toEqual({
      part: { key: 'budgetPlans.goals.when.byDate', params: { date: { date: '2027-03-28', pattern: 'P' } } },
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

describe('sumLineTotals', () => {
  it('sums assigned, activity and available', () => {
    expect(
      sumLineTotals({
        lines: [
          { assigned: 100, activity: -40, available: 60 },
          { assigned: 50, activity: -80, available: -30 },
        ],
      }),
    ).toEqual({ assigned: 150, activity: -120, available: 30 });
  });

  it('returns zeros for no lines', () => {
    expect(sumLineTotals({ lines: [] })).toEqual({ assigned: 0, activity: 0, available: 0 });
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
