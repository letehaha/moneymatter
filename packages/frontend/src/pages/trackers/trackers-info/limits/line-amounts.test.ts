import type { TrackerStatsResponse, RecordId, TrackerLineModel } from '@bt/shared/types';
import { describe, expect, it } from 'vitest';

import { buildLineRows, buildLinesTotals } from './line-amounts';

const line = ({ id, position, limitAmount }: { id: string; position: number; limitAmount: number | null }) =>
  ({
    id: id as RecordId,
    trackerId: 'b' as RecordId,
    name: id,
    limitAmount,
    position,
    categories: [],
  }) satisfies TrackerLineModel;

const stats = ({ lines, otherSpent = 0 }: { lines: [string, number][]; otherSpent?: number }) =>
  ({
    summary: {
      actualIncome: 0,
      actualExpense: 0,
      balance: 0,
      utilizationRate: null,
      transactionsCount: 0,
      firstTransactionDate: null,
      lastTransactionDate: null,
    },
    lines: lines.map(([lineId, spent]) => ({ lineId: lineId as RecordId, spent })),
    otherSpent,
  }) satisfies TrackerStatsResponse;

describe('buildLineRows', () => {
  it('orders by position and computes spent, left and percent', () => {
    const rows = buildLineRows({
      decimals: 2,
      lines: [
        line({ id: 'food', position: 2, limitAmount: 500 }),
        line({ id: 'hotels', position: 1, limitAmount: 1000 }),
      ],
      stats: stats({
        lines: [
          ['hotels', 820],
          ['food', 564],
        ],
      }),
    });

    expect(rows.map((row) => row.line.id)).toEqual(['hotels', 'food']);
    expect(rows[0]).toMatchObject({ spent: 820, left: 180, percent: 82, isOver: false });
    expect(rows[1]).toMatchObject({ spent: 564, left: -64, isOver: true });
  });

  it('treats missing stats as zero spent', () => {
    const [row] = buildLineRows({
      decimals: 2,
      lines: [line({ id: 'a', position: 0, limitAmount: 100 })],
      stats: undefined,
    });
    expect(row).toMatchObject({ spent: 0, left: 100, percent: 0, isOver: false });
  });

  it('leaves left and percent empty without a limit', () => {
    const [row] = buildLineRows({
      decimals: 2,
      lines: [line({ id: 'a', position: 0, limitAmount: null })],
      stats: stats({ lines: [['a', 40]] }),
    });
    expect(row).toMatchObject({ spent: 40, limit: null, left: null, percent: null, isOver: false });
  });

  it('does not flag a line spent exactly to its limit as over', () => {
    const [row] = buildLineRows({
      decimals: 2,
      lines: [line({ id: 'a', position: 0, limitAmount: 0.3 })],
      stats: stats({ lines: [['a', 0.1 + 0.2]] }),
    });
    expect(row).toMatchObject({ left: 0, isOver: false });
  });

  it('handles a zero limit', () => {
    const [row] = buildLineRows({
      decimals: 2,
      lines: [line({ id: 'a', position: 0, limitAmount: 0 })],
      stats: stats({ lines: [['a', 10]] }),
    });
    expect(row).toMatchObject({ percent: 100, left: -10, isOver: true });
  });
});

describe('buildLinesTotals', () => {
  it('sums limits of limited lines and includes other spending', () => {
    const rows = buildLineRows({
      decimals: 2,
      lines: [
        line({ id: 'a', position: 0, limitAmount: 1000 }),
        line({ id: 'b', position: 1, limitAmount: 800 }),
        line({ id: 'c', position: 2, limitAmount: null }),
      ],
      stats: stats({
        lines: [
          ['a', 820],
          ['b', 564],
          ['c', 120],
        ],
        otherSpent: 276,
      }),
    });

    expect(buildLinesTotals({ decimals: 2, rows, otherSpent: 276 })).toEqual({ limitSum: 1800, spent: 1780, left: 20 });
  });

  it('has no limit sum or left when no line has a limit', () => {
    const rows = buildLineRows({
      decimals: 2,
      lines: [line({ id: 'a', position: 0, limitAmount: null })],
      stats: stats({ lines: [['a', 50]] }),
    });

    expect(buildLinesTotals({ decimals: 2, rows, otherSpent: 0 })).toEqual({ limitSum: null, spent: 50, left: null });
  });
});

describe('line amounts at the base currency decimals', () => {
  it.each<[number, number, number, number]>([
    [3, 10.004, 10.005, -0.001],
    [0, 1000, 1001, -1],
  ])('at %d decimals flags a line over its %d limit by one minor unit', (decimals, limitAmount, spent, left) => {
    const [row] = buildLineRows({
      decimals,
      lines: [line({ id: 'a', position: 0, limitAmount })],
      stats: stats({ lines: [['a', spent]] }),
    });
    expect(row).toMatchObject({ left, isOver: true });
  });

  it('keeps the third decimal in the totals', () => {
    const rows = buildLineRows({
      decimals: 3,
      lines: [line({ id: 'a', position: 0, limitAmount: 1.234 })],
      stats: stats({ lines: [['a', 0.001]] }),
    });
    expect(buildLinesTotals({ decimals: 3, rows, otherSpent: 2.345 })).toEqual({
      limitSum: 1.234,
      spent: 2.346,
      left: -1.112,
    });
  });
});
