import { describe, expect, it } from 'vitest';

import { buildTagShares, readTagAnalysisConfig } from './tag-analysis-config';

const widgetConfig = (config?: Record<string, unknown>) => ({ widgetId: 'tag-analysis', colSpan: 2, config });

describe('readTagAnalysisConfig', () => {
  it('falls back to defaults when nothing is stored', () => {
    const expected = { tagIds: [], targets: {}, includeTransfers: false, percentBase: 'tags' };

    expect(readTagAnalysisConfig({ widgetConfig: widgetConfig() })).toEqual(expected);
    expect(readTagAnalysisConfig({ widgetConfig: null })).toEqual(expected);
  });

  it('reads stored values', () => {
    expect(
      readTagAnalysisConfig({
        widgetConfig: widgetConfig({
          tagIds: ['need', 'want'],
          targets: { need: 50, want: 30 },
          includeTransfers: true,
          percentBase: 'income',
        }),
      }),
    ).toEqual({
      tagIds: ['need', 'want'],
      targets: { need: 50, want: 30 },
      includeTransfers: true,
      percentBase: 'income',
    });
  });

  it('drops malformed values', () => {
    expect(
      readTagAnalysisConfig({
        widgetConfig: widgetConfig({
          tagIds: ['need', 5, null],
          targets: { need: 120, want: -1, save: '20', other: 20 },
          includeTransfers: 'true',
          percentBase: 'expenses',
        }),
      }),
    ).toEqual({ tagIds: ['need'], targets: { other: 20 }, includeTransfers: false, percentBase: 'tags' });
  });
});

describe('buildTagShares', () => {
  const totalsByTagId = { need: 500, want: 300, save: 200, untagged: 999 };

  it('splits by the selected tags total on the tags base', () => {
    const summary = buildTagShares({
      tagIds: ['need', 'want', 'save'],
      totalsByTagId,
      targets: { need: 40, want: 30 },
      percentBase: 'tags',
      incomeTotal: null,
    });

    expect(summary.total).toBe(1000);
    expect(summary.incomePercent).toBeNull();
    expect(summary.remaining).toBe(0);
    expect(summary.rows).toEqual([
      { tagId: 'need', amount: 500, percent: 50, target: 40, isOverTarget: true },
      { tagId: 'want', amount: 300, percent: 30, target: 30, isOverTarget: false },
      { tagId: 'save', amount: 200, percent: 20, target: null, isOverTarget: false },
    ]);
  });

  it('measures against income and reports the unallocated rest', () => {
    const summary = buildTagShares({
      tagIds: ['need', 'want'],
      totalsByTagId,
      targets: {},
      percentBase: 'income',
      incomeTotal: 2000,
    });

    expect(summary.rows.map((row) => row.percent)).toEqual([25, 15]);
    expect(summary.incomePercent).toBe(40);
    expect(summary.remaining).toBe(1200);
  });

  it('never reports negative remaining when tags exceed income', () => {
    const summary = buildTagShares({
      tagIds: ['need', 'want'],
      totalsByTagId,
      targets: {},
      percentBase: 'income',
      incomeTotal: 400,
    });

    expect(summary.rows[0]!.percent).toBe(125);
    expect(summary.remaining).toBe(0);
  });

  it('shows no percentages when the base is zero', () => {
    const onIncome = buildTagShares({
      tagIds: ['need'],
      totalsByTagId,
      targets: { need: 10 },
      percentBase: 'income',
      incomeTotal: 0,
    });
    const onEmptyTags = buildTagShares({
      tagIds: ['missing'],
      totalsByTagId,
      targets: {},
      percentBase: 'tags',
      incomeTotal: null,
    });

    expect(onIncome.rows[0]).toMatchObject({ percent: null, isOverTarget: false });
    expect(onIncome.incomePercent).toBeNull();
    expect(onEmptyTags.rows[0]).toMatchObject({ amount: 0, percent: null });
  });
});
