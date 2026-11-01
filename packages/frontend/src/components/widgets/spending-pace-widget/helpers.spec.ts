import { describe, expect, it } from 'vitest';

import {
  comparisonCumulative,
  computeSpendingPace,
  formatPacePercent,
  getPayMonth,
  parseCompareMode,
  parseSpikePercent,
  spikeContributorsCount,
  spikeDays,
  splitDailyExpenses,
  toneOf,
  upcomingPlannedExpenses,
} from './helpers';

const month = ({ length, perDay, firstDay = perDay }: { length: number; perDay: number; firstDay?: number }) =>
  Array.from({ length }, (_, i) => (i === 0 ? firstDay : perDay));

describe('computeSpendingPace', () => {
  it('follows the comparison shape so rent on day 1 does not inflate the forecast', () => {
    const rentMonth = month({ length: 30, perDay: 10, firstDay: 1_000 });
    const result = computeSpendingPace({
      currentMonth: month({ length: 15, perDay: 10, firstDay: 1_000 }),
      comparisonMonths: [rentMonth],
      daysInMonth: 30,
    });

    expect(result.spent).toBe(1_140);
    expect(result.comparison!.byToday).toBe(1_140);
    expect(result.comparison!.total).toBe(1_290);
    expect(result.comparison!.forecast).toBe(1_290);
    expect(result.comparison!.diffPercent).toBe(0);
    expect(result.comparison!.tone).toBe('neutral');
    expect(result.comparison!.forecastCumulative.slice(0, 14)).toEqual(Array(14).fill(null));
    expect(result.comparison!.forecastCumulative[14]).toBe(1_140);
  });

  it('repeats the last day of a shorter comparison month', () => {
    const result = computeSpendingPace({
      currentMonth: month({ length: 10, perDay: 20 }),
      comparisonMonths: [month({ length: 30, perDay: 10 })],
      daysInMonth: 31,
    });

    expect(result.comparison!.cumulative).toHaveLength(31);
    expect(result.comparison!.cumulative[29]).toBe(300);
    expect(result.comparison!.cumulative[30]).toBe(300);
    expect(result.comparison!.forecast).toBe(200 + 300 - 100);
    expect(result.comparison!.tone).toBe('over');
  });

  it('averages months of different lengths day by day', () => {
    expect(
      comparisonCumulative({
        months: [month({ length: 28, perDay: 10 }), month({ length: 31, perDay: 20 })],
        daysInMonth: 31,
      })!.slice(27),
    ).toEqual([(280 + 560) / 2, (280 + 580) / 2, (280 + 600) / 2, (280 + 620) / 2]);
  });

  it('leaves nothing to forecast on the last day', () => {
    const result = computeSpendingPace({
      currentMonth: month({ length: 31, perDay: 5 }),
      comparisonMonths: [month({ length: 31, perDay: 10 })],
      daysInMonth: 31,
    });

    expect(result.comparison!.forecast).toBe(result.spent);
    expect(result.comparison!.forecastCumulative.filter((value) => value !== null)).toEqual([155]);
    expect(result.comparison!.diffPercent).toBe(-50);
    expect(result.comparison!.tone).toBe('under');
  });

  it('returns no comparison without full months', () => {
    const result = computeSpendingPace({
      currentMonth: [5, 5],
      comparisonMonths: [],
      daysInMonth: 31,
    });

    expect(result).toEqual({ spentCumulative: [5, 10], spent: 10, comparison: null });
  });

  it('hides the percent when the comparison spent nothing', () => {
    const result = computeSpendingPace({
      currentMonth: [5],
      comparisonMonths: [month({ length: 30, perDay: 0 })],
      daysInMonth: 30,
    });

    expect(result.comparison!.diffPercent).toBeNull();
    expect(result.comparison!.tone).toBe('neutral');
  });

  it('adds pending plans to the forecast from their day on, keeping today at the actual spend', () => {
    const plannedExpenses = Array<number>(10).fill(0);
    plannedExpenses[4] = 30;
    plannedExpenses[7] = 50;
    plannedExpenses[9] = 20;
    const result = computeSpendingPace({
      currentMonth: month({ length: 5, perDay: 10 }),
      comparisonMonths: [month({ length: 10, perDay: 10 })],
      daysInMonth: 10,
      plannedExpenses,
    });

    expect(result.spent).toBe(50);
    expect(result.comparison!.total).toBe(100);
    expect(result.comparison!.forecastCumulative).toEqual([null, null, null, null, 50, 90, 100, 160, 170, 200]);
    expect(result.comparison!.forecast).toBe(200);
    expect(result.comparison!.diffPercent).toBe(100);
    expect(result.comparison!.tone).toBe('over');
  });

  it('compares actual spend on the last day of the month, leaving plans dated today out', () => {
    const result = computeSpendingPace({
      currentMonth: month({ length: 3, perDay: 10 }),
      comparisonMonths: [month({ length: 3, perDay: 10 })],
      daysInMonth: 3,
      plannedExpenses: [0, 0, 25],
    });

    expect(result.comparison!.forecastCumulative).toEqual([null, null, 30]);
    expect(result.comparison!.forecast).toBe(30);
    expect(result.comparison!.diffPercent).toBe(0);
  });

  it('ignores plans without a comparison to forecast from', () => {
    const result = computeSpendingPace({
      currentMonth: [5],
      comparisonMonths: [],
      daysInMonth: 2,
      plannedExpenses: [0, 25],
    });

    expect(result).toEqual({ spentCumulative: [5], spent: 5, comparison: null });
  });
});

describe('upcomingPlannedExpenses', () => {
  const now = new Date(2026, 9, 3);
  const day = ({ date, expenses }: { date: string; expenses: number }) => ({
    periodStart: date,
    income: 0,
    expenses,
  });

  it('returns what planned rows add per day and ignores days before today', () => {
    const result = upcomingPlannedExpenses({
      actualPeriods: [
        day({ date: '2026-10-02', expenses: 5 }),
        day({ date: '2026-10-03', expenses: 7 }),
        day({ date: '2026-10-20', expenses: 99 }),
      ],
      withPlannedPeriods: [
        day({ date: '2026-10-02', expenses: 500 }),
        day({ date: '2026-10-03', expenses: 27 }),
        day({ date: '2026-10-20', expenses: 99 }),
        day({ date: '2026-10-25', expenses: 40 }),
      ],
      now,
    });

    expect(result).toHaveLength(31);
    expect(result[1]).toBe(0);
    expect(result[2]).toBe(20);
    expect(result[19]).toBe(0);
    expect(result[24]).toBe(40);
    expect(result.reduce((sum, value) => sum + value, 0)).toBe(60);
  });

  it('follows the pay month when a payday is set', () => {
    const result = upcomingPlannedExpenses({
      actualPeriods: [],
      withPlannedPeriods: [day({ date: '2026-11-01', expenses: 15 })],
      now: new Date(2026, 9, 28),
      payday: 22,
    });

    expect(result).toHaveLength(31);
    expect(result[10]).toBe(15);
  });
});

describe('splitDailyExpenses', () => {
  const now = new Date(2026, 9, 3);
  const day = ({ date, expenses, income = 0 }: { date: string; expenses: number; income?: number }) => ({
    periodStart: date,
    income,
    expenses,
  });

  it('drops leading months without cash flow and averages what exists', () => {
    const { currentMonth, fullMonths } = splitDailyExpenses({
      periods: [
        day({ date: '2026-07-15', expenses: 0 }),
        day({ date: '2026-08-31', expenses: 0, income: 100 }),
        day({ date: '2026-09-02', expenses: 40 }),
        day({ date: '2026-10-01', expenses: 7 }),
        day({ date: '2026-10-03', expenses: 3 }),
        day({ date: '2026-10-20', expenses: 99 }),
      ],
      now,
    });

    expect(currentMonth).toEqual([7, 0, 3]);
    expect(fullMonths).toHaveLength(2);
    expect(fullMonths[0]).toHaveLength(31);
    expect(fullMonths[1]).toHaveLength(30);
    expect(fullMonths[1]![1]).toBe(40);

    const pace = computeSpendingPace({ currentMonth, comparisonMonths: fullMonths, daysInMonth: 31 });
    expect(pace.comparison!.monthsCount).toBe(2);
    expect(pace.comparison!.total).toBe(20);
  });

  it('returns no full months when history starts this month', () => {
    const { fullMonths } = splitDailyExpenses({
      periods: [day({ date: '2026-10-01', expenses: 7 })],
      now,
    });

    expect(fullMonths).toEqual([]);
  });

  it('splits by pay months when a payday is set', () => {
    const payNow = new Date(2026, 9, 28);
    const { currentMonth, fullMonths } = splitDailyExpenses({
      periods: [
        day({ date: '2026-07-22', expenses: 0, income: 100 }),
        day({ date: '2026-09-21', expenses: 5 }),
        day({ date: '2026-09-22', expenses: 40 }),
        day({ date: '2026-10-22', expenses: 7 }),
        day({ date: '2026-10-28', expenses: 3 }),
      ],
      now: payNow,
      payday: 22,
    });

    expect(currentMonth).toEqual([7, 0, 0, 0, 0, 0, 3]);
    expect(fullMonths.map((days) => days.length)).toEqual([31, 31, 30]);
    expect(fullMonths[1]![30]).toBe(5);
    expect(fullMonths[2]![0]).toBe(40);

    const { start, daysInMonth, todayIndex, daysLeft } = getPayMonth({ now: payNow, payday: 22 });
    expect([start, daysInMonth, todayIndex, daysLeft]).toEqual([new Date(2026, 9, 22), 31, 6, 24]);
  });

  it.each([
    {
      name: 'before the payday, across the year end',
      now: new Date(2027, 0, 10),
      payday: 22,
      expected: [new Date(2026, 11, 22), 31, 19, 11],
    },
    {
      name: 'a pay month starting in February',
      now: new Date(2027, 2, 5),
      payday: 28,
      expected: [new Date(2027, 1, 28), 28, 5, 22],
    },
  ])('finds the pay month $name', ({ now: payNow, payday, expected }) => {
    const { start, daysInMonth, todayIndex, daysLeft } = getPayMonth({ now: payNow, payday });
    expect([start, daysInMonth, todayIndex, daysLeft]).toEqual(expected);
  });
});

describe('formatPacePercent', () => {
  it('signs positives and rounds', () => {
    expect(formatPacePercent({ percent: 12.4 })).toBe('+12%');
    expect(formatPacePercent({ percent: -7.6 })).toBe('-8%');
    expect(formatPacePercent({ percent: -0.2 })).toBe('0%');
  });
});

describe('toneOf', () => {
  it.each([
    { diffPercent: 5, tone: 'neutral' },
    { diffPercent: -5, tone: 'neutral' },
    { diffPercent: 5.01, tone: 'over' },
    { diffPercent: -5.01, tone: 'under' },
  ])('$diffPercent% → $tone', ({ diffPercent, tone }) => {
    expect(toneOf({ diffPercent })).toBe(tone);
  });
});

describe('parseCompareMode', () => {
  it('keeps known modes and falls back to avg', () => {
    expect(parseCompareMode({ value: 'last' })).toBe('last');
    expect(parseCompareMode({ value: 'avg' })).toBe('avg');
    expect(parseCompareMode({ value: undefined })).toBe('avg');
    expect(parseCompareMode({ value: 'weekly' })).toBe('avg');
  });
});

describe('spikeDays', () => {
  const values = month({ length: 30, perDay: 10, firstDay: 1_000 });

  it('returns the days carrying at least the given share of the month', () => {
    expect(spikeDays({ values, percent: 10 })).toEqual([0]);
  });

  it('flags every day once the threshold drops below a regular day', () => {
    expect(spikeDays({ values, percent: 0.5 })).toHaveLength(30);
  });

  it('returns nothing for an all-zero month', () => {
    expect(spikeDays({ values: month({ length: 30, perDay: 0 }), percent: 10 })).toEqual([]);
  });
});

describe('parseSpikePercent', () => {
  it('reads a stored percent', () => {
    expect(parseSpikePercent({ value: '20' })).toBe(20);
  });

  it.each([undefined, null, 'abc', '0', '-5', '150', '2.5'])('falls back to the default for %s', (value) => {
    expect(parseSpikePercent({ value })).toBe(10);
  });
});

describe('spikeContributorsCount', () => {
  it('drops small purchases once the bigger ones explain the day', () => {
    expect(spikeContributorsCount({ amounts: [202, 53, 16], dayTotal: 292 })).toBe(2);
  });

  it('keeps a single purchase that carries the day', () => {
    expect(spikeContributorsCount({ amounts: [1_600, 40, 10], dayTotal: 1_650 })).toBe(1);
  });

  it('keeps every amount when they never reach the coverage', () => {
    expect(spikeContributorsCount({ amounts: [50, 40, 30], dayTotal: 500 })).toBe(3);
  });
});
