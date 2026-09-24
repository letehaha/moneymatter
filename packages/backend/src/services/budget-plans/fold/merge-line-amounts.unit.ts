import { describe, expect, it } from '@jest/globals';

import { MergeLine, MergeWrite, mergeLineAmounts } from './merge-line-amounts';
import { AssignmentAmounts } from './resolve-assigned';

const PERIODS = ['p0', 'p1', 'p2', 'p3', 'p4'];

const row = (values: Partial<AssignmentAmounts> = {}): AssignmentAmounts => ({
  baselineAmount: null,
  overrideAmount: null,
  carryPolicy: null,
  ...values,
});

const line = ({
  periodIds = PERIODS,
  rows = {},
}: { periodIds?: string[]; rows?: Record<string, Partial<AssignmentAmounts>> } = {}): MergeLine => ({
  periodIds,
  rows: new Map(Object.entries(rows).map(([periodId, values]) => [periodId, row(values)])),
});

/** What the fold would report, so a test can compare the sums it must preserve. */
const assignedPerPeriod = ({ line: item, writes }: { line: MergeLine; writes: MergeWrite[] }): number[] => {
  const rows = new Map(item.rows);
  for (const write of writes) {
    if (write.row === null) rows.delete(write.periodId);
    else rows.set(write.periodId, write.row);
  }

  let baseline = 0;
  return item.periodIds.map((periodId) => {
    const stored = rows.get(periodId);
    baseline = stored?.baselineAmount ?? baseline;
    return stored?.overrideAmount ?? baseline;
  });
};

describe('mergeLineAmounts', () => {
  it('sums the two baselines at the first shared period and drops the source row', () => {
    const source = line({ rows: { p0: { baselineAmount: 100 } } });
    const target = line({ rows: { p0: { baselineAmount: 200 } } });

    const writes = mergeLineAmounts({ source, target, sharedPeriodIds: PERIODS });

    expect(writes.target[0]).toEqual({ periodId: 'p0', row: row({ baselineAmount: 300 }) });
    expect(writes.target.slice(1)).toEqual(PERIODS.slice(1).map((periodId) => ({ periodId, row: row() })));
    expect(writes.source).toEqual([{ periodId: 'p0', row: null }]);
  });

  it('re-sums wherever either baseline changes', () => {
    const source = line({ rows: { p0: { baselineAmount: 100 }, p2: { baselineAmount: 50 } } });
    const target = line({ rows: { p0: { baselineAmount: 200 }, p3: { baselineAmount: 400 } } });

    const writes = mergeLineAmounts({ source, target, sharedPeriodIds: PERIODS });

    expect(writes.target.map((write) => [write.periodId, write.row?.baselineAmount])).toEqual([
      ['p0', 300],
      ['p1', null],
      ['p2', 250],
      ['p3', 450],
      ['p4', null],
    ]);
  });

  it('sums the effective amounts where either line has an override', () => {
    const source = line({ rows: { p0: { baselineAmount: 100 }, p1: { overrideAmount: 700 } } });
    const target = line({ rows: { p0: { baselineAmount: 200 }, p2: { overrideAmount: 900 } } });

    const writes = mergeLineAmounts({ source, target, sharedPeriodIds: PERIODS });

    expect(writes.target.map((write) => [write.periodId, write.row?.overrideAmount])).toEqual([
      ['p0', null],
      ['p1', 900],
      ['p2', 1000],
      ['p3', null],
      ['p4', null],
    ]);
  });

  it('keeps the target carry policy and never writes one of its own', () => {
    const source = line({ rows: { p0: { baselineAmount: 100, carryPolicy: 'floor' } } });
    const target = line({ rows: { p0: { baselineAmount: 200, carryPolicy: 'signed' }, p1: { carryPolicy: 'none' } } });

    const writes = mergeLineAmounts({ source, target, sharedPeriodIds: PERIODS });

    expect(writes.target.map((write) => write.row?.carryPolicy)).toEqual(['signed', 'none', null, null, null]);
  });

  it('stops the summed baseline at the first period after the source lifetime', () => {
    const source = line({ periodIds: ['p0', 'p1'], rows: { p0: { baselineAmount: 100 } } });
    const target = line({ rows: { p0: { baselineAmount: 200 } } });

    const writes = mergeLineAmounts({ source, target, sharedPeriodIds: ['p0', 'p1'] });

    expect(writes.target.at(-1)).toEqual({ periodId: 'p2', row: row({ baselineAmount: 200 }) });
    expect(assignedPerPeriod({ line: target, writes: writes.target })).toEqual([300, 300, 200, 200, 200]);
  });

  it('stops the source baseline inside the window and restores it after', () => {
    const source = line({ rows: { p0: { baselineAmount: 100 } } });
    const target = line({ periodIds: ['p1', 'p2'], rows: { p1: { baselineAmount: 200 } } });

    const writes = mergeLineAmounts({ source, target, sharedPeriodIds: ['p1', 'p2'] });

    expect(writes.source).toEqual([
      { periodId: 'p1', row: row({ baselineAmount: 0 }) },
      { periodId: 'p3', row: row({ baselineAmount: 100 }) },
    ]);
    expect(assignedPerPeriod({ line: source, writes: writes.source })).toEqual([100, 0, 0, 100, 100]);
  });

  it('merges the restored baseline into the row already at that period', () => {
    const source = line({ rows: { p0: { baselineAmount: 100 }, p2: { overrideAmount: 700 } } });
    const target = line({ periodIds: ['p0', 'p1'], rows: { p0: { baselineAmount: 200 } } });

    const writes = mergeLineAmounts({ source, target, sharedPeriodIds: ['p0', 'p1'] });

    expect(writes.source.at(-1)).toEqual({ periodId: 'p2', row: row({ baselineAmount: 100, overrideAmount: 700 }) });
    expect(assignedPerPeriod({ line: source, writes: writes.source })).toEqual([0, 0, 700, 100, 100]);
  });

  it('keeps a baseline the source already stores right after the window', () => {
    const source = line({ rows: { p0: { baselineAmount: 100 }, p3: { baselineAmount: 500 } } });
    const target = line({ periodIds: ['p1', 'p2'], rows: { p1: { baselineAmount: 200 } } });

    const writes = mergeLineAmounts({ source, target, sharedPeriodIds: ['p1', 'p2'] });

    expect(writes.source).toEqual([{ periodId: 'p1', row: row({ baselineAmount: 0 }) }]);
    expect(assignedPerPeriod({ line: source, writes: writes.source })).toEqual([100, 0, 0, 500, 500]);
  });

  it('restores nothing when the source contributes no baseline', () => {
    const source = line();
    const target = line({ rows: { p0: { baselineAmount: 200 } } });

    const writes = mergeLineAmounts({ source, target, sharedPeriodIds: ['p0', 'p1'] });

    expect(writes.source).toEqual([]);
    expect(writes.target).toEqual([
      { periodId: 'p0', row: row({ baselineAmount: 200 }) },
      { periodId: 'p1', row: row() },
    ]);
  });

  it('keeps Σ assigned per period identical across both lines', () => {
    const source = line({ rows: { p0: { baselineAmount: 300 }, p2: { overrideAmount: 500 } } });
    const target = line({ periodIds: ['p1', 'p2', 'p3'], rows: { p1: { baselineAmount: 200, carryPolicy: 'floor' } } });

    const totals = ({ sourceWrites, targetWrites }: { sourceWrites: MergeWrite[]; targetWrites: MergeWrite[] }) => {
      const fromSource = assignedPerPeriod({ line: source, writes: sourceWrites });
      const fromTarget = assignedPerPeriod({ line: target, writes: targetWrites });

      return PERIODS.map(
        (periodId, index) => fromSource[index]! + (fromTarget[target.periodIds.indexOf(periodId)] ?? 0),
      );
    };

    const before = totals({ sourceWrites: [], targetWrites: [] });
    const writes = mergeLineAmounts({ source, target, sharedPeriodIds: target.periodIds });

    expect(before).toEqual([300, 500, 700, 500, 300]);
    expect(totals({ sourceWrites: writes.source, targetWrites: writes.target })).toEqual(before);
  });

  it('writes nothing when the lines share no period', () => {
    expect(mergeLineAmounts({ source: line(), target: line(), sharedPeriodIds: [] })).toEqual({
      source: [],
      target: [],
    });
  });
});
