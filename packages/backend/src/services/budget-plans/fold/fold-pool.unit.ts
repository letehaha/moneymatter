import { describe, expect, it } from '@jest/globals';

import { FoldAssignment, foldPlan } from './fold-plan';
import { PoolPeriodInput, foldPool } from './fold-pool';

const period = ({
  assigned = 0,
  available = 0,
  carriedIn = 0,
  income = 0,
  spending = 0,
}: {
  assigned?: number;
  available?: number;
  carriedIn?: number;
  income?: number;
  spending?: number;
}): PoolPeriodInput => ({
  header: {
    totalAssigned: assigned,
    totalAvailable: available,
    totalCarriedIn: carriedIn,
  },
  uncovered: { income, spending },
});

const foldWith = ({ assignments }: { assignments: FoldAssignment[] }) =>
  foldPlan({
    plan: { carryPolicy: 'floor' },
    periods: [
      { id: 'jul', startDate: '2026-07-01', endDate: '2026-08-01' },
      { id: 'aug', startDate: '2026-08-01', endDate: '2026-09-01' },
      { id: 'sep', startDate: '2026-09-01', endDate: '2026-10-01' },
    ],
    lines: [
      {
        id: 'l1',
        name: 'Line',
        sortOrder: 0,
        activeFrom: '2026-07-01',
        activeUntil: null,
      },
    ],
    lineCategories: [],
    assignments,
    activityRows: [],
    categories: [],
    today: '2026-07-15',
    explicitFutureOnly: true,
  });

describe('foldPool', () => {
  it('opens with the cash minus what lines carry into the first period', () => {
    const [first] = foldPool({
      periods: [period({ carriedIn: 170, available: 170 })],
      openingCash: 1470,
    });

    expect(first).toEqual({
      readyToAssign: 1300,
      committedLater: 0,
      flow: {
        leftOver: 1300,
        income: 0,
        outsideSpending: 0,
        fromLines: 0,
        assigned: 0,
      },
    });
  });

  it('adds income, subtracts outside spending and assignments, and chains periods', () => {
    const entries = foldPool({
      periods: [period({ income: 500, spending: -120, assigned: 300, available: 300 }), period({ carriedIn: 300 })],
      openingCash: 1000,
    });

    expect(entries.map((entry) => entry.readyToAssign)).toEqual([1080, 1080]);
    expect(entries[1]!.flow.leftOver).toBe(1080);
  });

  it('deducts a floored overspend from the next period only, not as committed later', () => {
    const entries = foldPool({
      periods: [period({ assigned: 100, available: -50 }), period({ carriedIn: 0 }), period({})],
      openingCash: 1000,
    });

    expect(entries.map((entry) => entry.flow.fromLines)).toEqual([0, -50, 0]);
    expect(entries.map((entry) => [entry.readyToAssign, entry.committedLater])).toEqual([
      [900, 0],
      [850, 0],
      [850, 0],
    ]);
  });

  it('shows money assigned later as committed in every earlier period', () => {
    const entries = foldPool({
      periods: [period({}), period({}), period({ assigned: 200 }), period({})],
      openingCash: 1000,
    });

    expect(entries.map((entry) => [entry.readyToAssign, entry.committedLater])).toEqual([
      [800, 200],
      [800, 200],
      [800, 0],
      [800, 0],
    ]);
  });

  it('goes negative when more is assigned than the pool holds', () => {
    const [first] = foldPool({
      periods: [period({ assigned: 1200, available: 1200 })],
      openingCash: 1000,
    });

    expect(first!.readyToAssign).toBe(-200);
  });

  it('commits only what is written in a future period, not a recurring baseline', () => {
    const baseline: FoldAssignment = {
      periodId: 'jul',
      lineId: 'l1',
      baselineAmount: 100,
      overrideAmount: null,
      carryPolicy: null,
    };

    const [recurring] = foldPool({
      periods: foldWith({ assignments: [baseline] }),
      openingCash: 1000,
    });
    expect(recurring).toMatchObject({ readyToAssign: 900, committedLater: 0 });

    const ahead = foldWith({
      assignments: [
        baseline,
        {
          ...baseline,
          periodId: 'aug',
          baselineAmount: null,
          overrideAmount: 50,
        },
      ],
    });
    expect(ahead.map((view) => view.header.totalAssigned)).toEqual([100, 50, 0]);
    expect(foldPool({ periods: ahead, openingCash: 1000 })[0]).toMatchObject({
      readyToAssign: 850,
      committedLater: 50,
    });
  });

  it('returns nothing for no periods', () => {
    expect(foldPool({ periods: [], openingCash: 1000 })).toEqual([]);
  });
});
