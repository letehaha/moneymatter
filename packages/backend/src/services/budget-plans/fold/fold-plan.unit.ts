import { describe, expect, it } from '@jest/globals';

import {
  FoldActivityRow,
  FoldAssignment,
  FoldCategory,
  FoldLine,
  FoldLineCategory,
  FoldPeriod,
  FoldedPeriodView,
  foldPlan,
} from './fold-plan';

const PERIODS: FoldPeriod[] = [
  { id: 'jul', startDate: '2026-07-01', endDate: '2026-08-01' },
  { id: 'aug', startDate: '2026-08-01', endDate: '2026-09-01' },
  { id: 'sep', startDate: '2026-09-01', endDate: '2026-10-01' },
];

const FOOD: FoldCategory = { id: 'food', parentId: null };
const SNACKS: FoldCategory = { id: 'snacks', parentId: 'food' };
const TRANSPORT: FoldCategory = { id: 'transport', parentId: null };

const line = (overrides: Partial<FoldLine> = {}): FoldLine => ({
  id: 'l1',
  name: 'Line',
  sortOrder: 0,
  activeFrom: '2026-07-01',
  activeUntil: null,
  ...overrides,
});

const covers = (overrides: Partial<FoldLineCategory> = {}): FoldLineCategory => ({
  lineId: 'l1',
  categoryId: 'food',
  fromDate: '2026-07-01',
  untilDate: null,
  ...overrides,
});

const row = (overrides: Partial<FoldAssignment>): FoldAssignment => ({
  periodId: 'jul',
  lineId: 'l1',
  baselineAmount: null,
  overrideAmount: null,
  carryPolicy: null,
  ...overrides,
});

const spent = ({
  periodId,
  amount,
  categoryId = 'food',
}: {
  periodId: string;
  amount: number;
  categoryId?: string;
}): FoldActivityRow => ({
  periodId,
  categoryId,
  activity: -amount,
});

/** Amounts are integer cents inside the fold; the scale is irrelevant to it. */
const fold = (input: Partial<Parameters<typeof foldPlan>[0]> = {}): FoldedPeriodView[] =>
  foldPlan({
    plan: { carryPolicy: 'none' },
    periods: PERIODS,
    lines: [line()],
    lineCategories: [covers()],
    assignments: [],
    activityRows: [],
    categories: [FOOD],
    today: '2026-09-15',
    ...input,
  });

const amounts = (views: FoldedPeriodView[]) => views.map((view) => view.lines.map((entry) => entry.assigned));
const available = (views: FoldedPeriodView[]) => views.map((view) => view.lines.map((entry) => entry.available));

describe('foldPlan amounts', () => {
  it('recurs a baseline into later periods with no rows', () => {
    const views = fold({ assignments: [row({ baselineAmount: 100 })] });

    expect(amounts(views)).toEqual([[100], [100], [100]]);
    expect(views.map((view) => view.lines[0]!.assignedSource)).toEqual(['baseline', 'baseline', 'baseline']);
  });

  it('applies an override to its own period only', () => {
    const views = fold({
      assignments: [row({ baselineAmount: 100 }), row({ periodId: 'aug', overrideAmount: 150 })],
    });

    expect(amounts(views)).toEqual([[100], [150], [100]]);
    expect(views[1]!.lines[0]!.assignedSource).toBe('override');
  });

  it('applies an override to its own period and the baseline stored on the same row to later ones', () => {
    const views = fold({ assignments: [row({ periodId: 'aug', baselineAmount: 200, overrideAmount: 150 })] });

    expect(amounts(views)).toEqual([[0], [150], [200]]);
    expect(views.map((view) => view.lines[0]!.assignedSource)).toEqual(['none', 'override', 'baseline']);
  });

  it('reports assigned 0 with source none while no baseline has ever been set', () => {
    const views = fold({ assignments: [row({ periodId: 'aug', baselineAmount: 100 })] });

    expect(amounts(views)).toEqual([[0], [100], [100]]);
    expect(views.map((view) => view.lines[0]!.assignedSource)).toEqual(['none', 'baseline', 'baseline']);
  });

  it('does not let a policy-only row start an amount', () => {
    const views = fold({ assignments: [row({ carryPolicy: 'floor' })] });

    expect(views[0]!.lines[0]).toMatchObject({ assigned: 0, assignedSource: 'none', carryPolicy: 'floor' });
  });

  it('starts at activeFrom whatever rows exist earlier', () => {
    const views = fold({
      lines: [line({ activeFrom: '2026-08-01' })],
      lineCategories: [covers({ fromDate: '2026-08-01' })],
      assignments: [row({ baselineAmount: 500 }), row({ periodId: 'jul', overrideAmount: 900 })],
    });

    expect(views[0]!.lines).toEqual([]);
    expect(views[1]!.lines[0]).toMatchObject({ assigned: 0, assignedSource: 'none', carriedIn: 0 });
  });
});

describe('foldPlan rollover', () => {
  const capped = ({ policy, julySpend }: { policy: 'none' | 'floor' | 'signed'; julySpend: number }) =>
    fold({
      assignments: [row({ baselineAmount: 300, carryPolicy: policy })],
      activityRows: [spent({ periodId: 'jul', amount: julySpend })],
    });

  it('carries nothing, the floor or the signed leftover', () => {
    expect(available(capped({ policy: 'none', julySpend: 250 }))[1]).toEqual([300]);
    expect(available(capped({ policy: 'floor', julySpend: 250 }))[1]).toEqual([350]);
    expect(available(capped({ policy: 'signed', julySpend: 250 }))[1]).toEqual([350]);

    expect(available(capped({ policy: 'none', julySpend: 340 }))[1]).toEqual([300]);
    expect(available(capped({ policy: 'floor', julySpend: 340 }))[1]).toEqual([300]);
    expect(available(capped({ policy: 'signed', julySpend: 340 }))[1]).toEqual([260]);
  });

  it('leaves earlier periods alone when rollover is switched off mid-history', () => {
    const views = fold({
      assignments: [row({ baselineAmount: 100, carryPolicy: 'floor' }), row({ periodId: 'sep', carryPolicy: 'none' })],
      activityRows: [spent({ periodId: 'jul', amount: 40 })],
    });

    expect(available(views)).toEqual([[60], [160], [100]]);
    expect(views.map((view) => view.lines[0]!.carryPolicy)).toEqual(['floor', 'floor', 'none']);
  });

  it('pulls the previous leftover in the moment rollover is switched on', () => {
    const views = fold({
      assignments: [row({ baselineAmount: 100 }), row({ periodId: 'sep', carryPolicy: 'floor' })],
    });

    expect(views.map((view) => view.lines[0]!.carriedIn)).toEqual([0, 0, 100]);
    expect(available(views)).toEqual([[100], [100], [200]]);
  });

  it('reaches lines without their own setting when the plan default changes', () => {
    const assignments = [row({ baselineAmount: 100 })];
    const activityRows = [spent({ periodId: 'jul', amount: 140 })];

    const none = fold({ assignments, activityRows });
    const signed = fold({ plan: { carryPolicy: 'signed' }, assignments, activityRows });

    expect(none.map((view) => view.lines[0]!.carriedIn)).toEqual([0, 0, 0]);
    expect(signed.map((view) => view.lines[0]!.carriedIn)).toEqual([0, -40, 60]);
  });

  it('matches the worked three-line example, Travel reaching 150 in September', () => {
    const lines = [
      line({ id: 'food', name: 'Food' }),
      line({ id: 'travel', name: 'Travel', sortOrder: 1 }),
      line({ id: 'bills', name: 'Bills', sortOrder: 2 }),
    ];
    const views = fold({
      lines,
      categories: [FOOD, TRANSPORT, { id: 'bills-cat', parentId: null }],
      lineCategories: [
        covers({ lineId: 'food' }),
        covers({ lineId: 'travel', categoryId: 'transport' }),
        covers({ lineId: 'bills', categoryId: 'bills-cat' }),
      ],
      assignments: [
        row({ lineId: 'food', baselineAmount: 100 }),
        row({ lineId: 'food', periodId: 'aug', overrideAmount: 150 }),
        row({ lineId: 'travel', baselineAmount: 100, carryPolicy: 'floor' }),
        row({ lineId: 'travel', periodId: 'aug', overrideAmount: 300 }),
        row({ lineId: 'bills', baselineAmount: 100 }),
      ],
      // July's cap is fully spent, so August starts fresh and its own 250 leaves 50.
      activityRows: [
        spent({ periodId: 'jul', amount: 100, categoryId: 'transport' }),
        spent({ periodId: 'aug', amount: 250, categoryId: 'transport' }),
      ],
    });

    expect(amounts(views)).toEqual([
      [100, 100, 100],
      [150, 300, 100],
      [100, 100, 100],
    ]);
    expect(views[2]!.lines[1]).toMatchObject({ lineId: 'travel', carriedIn: 50, available: 150 });
  });
});

describe('foldPlan lifetimes', () => {
  it('drops an archived line and does not run its baseline on', () => {
    const views = fold({
      lines: [line({ activeUntil: '2026-09-01' })],
      lineCategories: [covers({ untilDate: '2026-09-01' })],
      assignments: [row({ baselineAmount: 100 })],
    });

    expect(amounts(views)).toEqual([[100], [100], []]);
    expect(views[2]!.header).toEqual({ totalAssigned: 0, totalActivity: 0, totalAvailable: 0, totalCarriedIn: 0 });
  });

  it('never shows a line archived in its first period, leaving its spending unbudgeted', () => {
    const views = fold({
      lines: [line({ activeFrom: '2026-09-01', activeUntil: '2026-09-01' })],
      lineCategories: [],
      activityRows: [spent({ periodId: 'sep', amount: 40 })],
    });

    expect(views.map((view) => view.lines)).toEqual([[], [], []]);
    expect(views[2]!.unbudgeted).toEqual([{ categoryId: 'food', activity: -40 }]);
  });

  it('counts an archive and its successors once inside the shared period', () => {
    const views = fold({
      lines: [
        line({ id: 'a', name: 'A', activeUntil: '2026-09-01' }),
        line({ id: 'b', name: 'B', activeFrom: '2026-09-01' }),
        line({ id: 'c', name: 'C', activeFrom: '2026-09-01', sortOrder: 1 }),
      ],
      categories: [FOOD, SNACKS, TRANSPORT],
      lineCategories: [
        covers({ lineId: 'a', untilDate: '2026-09-01' }),
        covers({ lineId: 'b', categoryId: 'snacks', fromDate: '2026-09-01' }),
        covers({ lineId: 'c', categoryId: 'transport', fromDate: '2026-09-01' }),
      ],
      assignments: [
        row({ lineId: 'a', baselineAmount: 300 }),
        row({ lineId: 'b', periodId: 'sep', baselineAmount: 200 }),
        row({ lineId: 'c', periodId: 'sep', baselineAmount: 150 }),
      ],
    });

    expect(views[2]!.header.totalAssigned).toBe(350);
  });

  it('keeps a category on the line that dropped it for the periods it still covered', () => {
    const views = fold({
      lines: [line({ id: 'l1' })],
      categories: [FOOD, TRANSPORT],
      lineCategories: [
        covers({ untilDate: '2026-09-01' }),
        covers({ categoryId: 'transport', fromDate: '2026-09-01' }),
      ],
      assignments: [row({ baselineAmount: 100, carryPolicy: 'floor' })],
      activityRows: [
        spent({ periodId: 'aug', amount: 60 }),
        spent({ periodId: 'sep', amount: 20 }),
        spent({ periodId: 'sep', amount: 10, categoryId: 'transport' }),
      ],
    });

    expect(views.map((view) => view.lines[0]!.categoryIds)).toEqual([['food'], ['food'], ['transport']]);
    expect(available(views)).toEqual([[100], [140], [230]]);
    expect(views[2]!.unbudgeted).toEqual([{ categoryId: 'food', activity: -20 }]);
  });

  it('honours a category that left a line and came back', () => {
    const views = fold({
      lineCategories: [covers({ untilDate: '2026-08-01' }), covers({ fromDate: '2026-09-01' })],
      activityRows: [
        spent({ periodId: 'jul', amount: 10 }),
        spent({ periodId: 'aug', amount: 20 }),
        spent({ periodId: 'sep', amount: 30 }),
      ],
    });

    expect(views.map((view) => view.lines[0]!.activity)).toEqual([-10, 0, -30]);
    expect(views[1]!.unbudgeted).toEqual([{ categoryId: 'food', activity: -20 }]);
  });
});

describe('foldPlan ownership', () => {
  it('gives a category to the nearest ancestor line after a re-parent', () => {
    const views = fold({
      lines: [line({ id: 'l-food', name: 'Food' }), line({ id: 'l-snacks', name: 'Snacks', sortOrder: 1 })],
      categories: [FOOD, SNACKS],
      lineCategories: [covers({ lineId: 'l-food' }), covers({ lineId: 'l-snacks', categoryId: 'snacks' })],
      activityRows: [
        spent({ periodId: 'jul', amount: 10, categoryId: 'snacks' }),
        spent({ periodId: 'jul', amount: 40 }),
      ],
    });

    expect(views[0]!.lines.map((entry) => [entry.lineId, entry.activity])).toEqual([
      ['l-food', -40],
      ['l-snacks', -10],
    ]);
    expect(views[0]!.unbudgeted).toEqual([]);
  });

  it('breaks a tie on one category by the smallest line id', () => {
    const views = fold({
      lines: [line({ id: 'b' }), line({ id: 'a', sortOrder: 1 })],
      lineCategories: [covers({ lineId: 'b' }), covers({ lineId: 'a' })],
      activityRows: [spent({ periodId: 'jul', amount: 10 })],
    });

    expect(views[0]!.lines.map((entry) => [entry.lineId, entry.activity])).toEqual([
      ['b', 0],
      ['a', -10],
    ]);
  });

  it('sums a parent category and its child, on the line and under the unbudgeted root', () => {
    const views = fold({
      categories: [FOOD, SNACKS, { id: 'fun', parentId: null }, { id: 'games', parentId: 'fun' }],
      activityRows: [
        spent({ periodId: 'jul', amount: 40 }),
        spent({ periodId: 'jul', amount: 25, categoryId: 'snacks' }),
        spent({ periodId: 'jul', amount: 10, categoryId: 'fun' }),
        spent({ periodId: 'jul', amount: 20, categoryId: 'games' }),
      ],
    });

    expect(views[0]!.lines[0]!.activity).toBe(-65);
    expect(views[0]!.unbudgeted).toEqual([{ categoryId: 'fun', activity: -30 }]);
  });
});

describe('foldPlan unbudgeted and header', () => {
  it('filters negative leaves before rolling them up to the root', () => {
    const views = fold({
      lines: [],
      lineCategories: [],
      categories: [FOOD, SNACKS, { id: 'restaurants', parentId: 'food' }],
      activityRows: [
        spent({ periodId: 'jul', amount: 100, categoryId: 'snacks' }),
        { periodId: 'jul', categoryId: 'restaurants', activity: 300 },
      ],
    });

    expect(views[0]!.unbudgeted).toEqual([{ categoryId: 'food', activity: -100 }]);
  });

  it('sums the header over several lines', () => {
    const views = fold({
      lines: [line({ id: 'l1' }), line({ id: 'l2', sortOrder: 1 })],
      categories: [FOOD, TRANSPORT],
      lineCategories: [covers(), covers({ lineId: 'l2', categoryId: 'transport' })],
      assignments: [row({ baselineAmount: 100 }), row({ lineId: 'l2', baselineAmount: 250 })],
      activityRows: [
        spent({ periodId: 'jul', amount: 30 }),
        spent({ periodId: 'jul', amount: 400, categoryId: 'transport' }),
      ],
    });

    expect(views[0]!.header).toEqual({
      totalAssigned: 350,
      totalActivity: -430,
      totalAvailable: -80,
      totalCarriedIn: 0,
    });
  });

  it('splits what no line covers into uncovered income and spending, uncategorised included', () => {
    const views = fold({
      categories: [FOOD, TRANSPORT],
      activityRows: [
        spent({ periodId: 'jul', amount: 30 }),
        spent({ periodId: 'jul', amount: 400, categoryId: 'transport' }),
        { periodId: 'jul', categoryId: null, activity: -50 },
        { periodId: 'jul', categoryId: null, activity: 700 },
      ],
    });

    expect(views[0]!.uncovered).toEqual({ income: 700, spending: -450 });
    expect(views[0]!.lines[0]!.activity).toBe(-30);
    expect(views[0]!.unbudgeted).toEqual([{ categoryId: 'transport', activity: -400 }]);
  });

  it('flags the period today falls into', () => {
    expect(fold().map((view) => view.period.isCurrent)).toEqual([false, false, true]);
  });
});
