import { OTHERS_SERIES_COLOR } from '@/composable/charts/categorical-series-palette';
import type { ChatDonutSlice, ChatSeriesChartSpec } from '@bt/shared/types';
import { describe, expect, it } from 'vitest';

import { buildDonutGeometry, buildSeriesChartGeometry, hasDonutData, hasSeriesData } from './chart-geometry';

const SIZE = { width: 480, height: 240 };

const seriesSpec = ({
  kind = 'line',
  series,
  values = ['a', 'b', 'c'],
}: {
  kind?: ChatSeriesChartSpec['kind'];
  series: ChatSeriesChartSpec['series'];
  values?: string[];
}): ChatSeriesChartSpec => ({
  type: 'chart',
  kind,
  title: 'T',
  unit: { kind: 'number' },
  xAxis: { type: 'category', values },
  series,
});

const slices = ({ count }: { count: number }): ChatDonutSlice[] =>
  Array.from({ length: count }, (_, index) => ({ label: `S${index + 1}`, value: count - index }));

describe('buildSeriesChartGeometry', () => {
  it('draws one line path per series with higher values higher on the plot', () => {
    const geometry = buildSeriesChartGeometry({
      spec: seriesSpec({
        series: [
          { name: 'A', values: [1, 2, 3] },
          { name: 'B', values: [3, 2, 1] },
        ],
      }),
      size: SIZE,
    });

    expect(geometry.series).toHaveLength(2);
    for (const series of geometry.series) {
      expect(series.linePath).toEqual(expect.stringMatching(/^M/));
      expect(series.areaPath).toBeNull();
      expect(series.points).toHaveLength(3);
    }
    const [first] = geometry.series;
    expect(first!.points[0]!.x).toBeLessThan(first!.points[2]!.x);
    expect(first!.points[2]!.y!).toBeLessThan(first!.points[0]!.y!);
  });

  it('gives each series its own palette color', () => {
    const geometry = buildSeriesChartGeometry({
      spec: seriesSpec({
        series: [
          { name: 'A', values: [1, 2, 3] },
          { name: 'B', values: [3, 2, 1] },
        ],
      }),
      size: SIZE,
    });

    expect(new Set(geometry.series.map((series) => series.color)).size).toBe(2);
  });

  it('breaks the line at a null value instead of bridging it', () => {
    const geometry = buildSeriesChartGeometry({
      spec: seriesSpec({ series: [{ name: 'A', values: [1, null, 3] }] }),
      size: SIZE,
    });
    const [series] = geometry.series;

    expect(series!.linePath!.match(/M/g)).toHaveLength(2);
    expect(series!.points[1]!.y).toBeNull();
    expect(series!.points[1]!.value).toBeNull();
  });

  it('has no line for a series of only nulls', () => {
    const geometry = buildSeriesChartGeometry({
      spec: seriesSpec({ series: [{ name: 'A', values: [null, null, null] }] }),
      size: SIZE,
    });

    expect(geometry.series[0]!.linePath).toBeNull();
  });

  it('adds an area path for an area chart', () => {
    const geometry = buildSeriesChartGeometry({
      spec: seriesSpec({ kind: 'area', series: [{ name: 'A', values: [1, 2, 3] }] }),
      size: SIZE,
    });

    expect(geometry.series[0]!.areaPath).toEqual(expect.stringMatching(/^M/));
  });

  it('places a grouped bar per non-null value, below the zero line for a negative one', () => {
    const geometry = buildSeriesChartGeometry({
      spec: seriesSpec({
        kind: 'bar',
        series: [
          { name: 'A', values: [4, null, -2] },
          { name: 'B', values: [1, 2, 3] },
        ],
      }),
      size: SIZE,
    });
    const [a, b] = geometry.series;

    expect(a!.linePath).toBeNull();
    expect(a!.bars.map((bar) => bar.index)).toEqual([0, 2]);
    expect(b!.bars).toHaveLength(3);
    expect(a!.bars[0]!.x).not.toBe(b!.bars[0]!.x);
    const negative = a!.bars[1]!;
    expect(negative.y).toBeCloseTo(geometry.zeroY, 5);
    expect(negative.height).toBeGreaterThan(0);
    const positive = a!.bars[0]!;
    expect(positive.y + positive.height).toBeCloseTo(geometry.zeroY, 5);
  });

  it('stacks bars of one category on top of each other', () => {
    const geometry = buildSeriesChartGeometry({
      spec: seriesSpec({
        kind: 'stackedBar',
        series: [
          { name: 'A', values: [4, 1, 2] },
          { name: 'B', values: [2, 3, 2] },
        ],
      }),
      size: SIZE,
    });
    const [a, b] = geometry.series;

    expect(b!.bars[0]!.x).toBe(a!.bars[0]!.x);
    expect(b!.bars[0]!.y + b!.bars[0]!.height).toBeCloseTo(a!.bars[0]!.y, 5);
  });

  it('always includes zero in the value ticks and keeps ticks inside the plot', () => {
    const geometry = buildSeriesChartGeometry({
      spec: seriesSpec({ series: [{ name: 'A', values: [120, 150, 180] }] }),
      size: SIZE,
    });

    expect(geometry.yTicks.map((tick) => tick.value)).toContain(0);
    for (const tick of geometry.yTicks) {
      expect(tick.y).toBeGreaterThanOrEqual(geometry.plot.top - 0.001);
      expect(tick.y).toBeLessThanOrEqual(geometry.plot.bottom + 0.001);
    }
  });

  it('copes with an all-zero series', () => {
    const geometry = buildSeriesChartGeometry({
      spec: seriesSpec({ series: [{ name: 'A', values: [0, 0, 0] }] }),
      size: SIZE,
    });

    expect(geometry.yTicks.length).toBeGreaterThan(0);
    expect(Number.isFinite(geometry.series[0]!.points[0]!.y)).toBe(true);
  });

  it('thins the x ticks of a long axis', () => {
    const values = Array.from({ length: 400 }, (_, index) => `p${index}`);
    const geometry = buildSeriesChartGeometry({
      spec: seriesSpec({ values, series: [{ name: 'A', values: values.map((_, index) => index) }] }),
      size: SIZE,
    });

    expect(geometry.xTicks.length).toBeGreaterThan(1);
    expect(geometry.xTicks.length).toBeLessThanOrEqual(8);
    expect(geometry.xTicks[0]!.index).toBe(0);
  });

  it('centres a single point', () => {
    const geometry = buildSeriesChartGeometry({
      spec: seriesSpec({ values: ['only'], series: [{ name: 'A', values: [5] }] }),
      size: SIZE,
    });
    const middle = (geometry.plot.left + geometry.plot.right) / 2;

    expect(geometry.series[0]!.points[0]!.x).toBeCloseTo(middle, 5);
  });
});

describe('hasSeriesData', () => {
  it('is false without points or without any value', () => {
    expect(hasSeriesData({ spec: seriesSpec({ values: [], series: [{ name: 'A', values: [] }] }) })).toBe(false);
    expect(hasSeriesData({ spec: seriesSpec({ series: [] }) })).toBe(false);
    expect(hasSeriesData({ spec: seriesSpec({ series: [{ name: 'A', values: [null, null, null] }] }) })).toBe(false);
  });

  it('is true with one value', () => {
    expect(hasSeriesData({ spec: seriesSpec({ series: [{ name: 'A', values: [null, 1, null] }] }) })).toBe(true);
  });
});

describe('buildDonutGeometry', () => {
  it('draws one arc per slice with a share of the total', () => {
    const geometry = buildDonutGeometry({
      slices: [
        { label: 'A', value: 30 },
        { label: 'B', value: 70 },
      ],
      size: { width: 200, height: 200 },
      othersLabel: 'Others',
    });

    expect(geometry.slices.map((slice) => slice.label)).toEqual(['A', 'B']);
    expect(geometry.slices.map((slice) => slice.share)).toEqual([0.3, 0.7]);
    expect(geometry.total).toBe(100);
    for (const slice of geometry.slices) {
      expect(slice.path).toEqual(expect.stringMatching(/^M/));
    }
  });

  it('folds slices past the twelfth into Others', () => {
    const geometry = buildDonutGeometry({
      slices: slices({ count: 15 }),
      size: { width: 200, height: 200 },
      othersLabel: 'Others',
    });
    const last = geometry.slices.at(-1)!;

    expect(geometry.slices).toHaveLength(13);
    expect(last.label).toBe('Others');
    expect(last.color).toBe(OTHERS_SERIES_COLOR);
    expect(last.value).toBe(3 + 2 + 1);
    expect(geometry.slices.slice(0, 12).map((slice) => slice.label)).toEqual(
      slices({ count: 12 }).map((slice) => slice.label),
    );
  });

  it('does not add Others for twelve slices', () => {
    const geometry = buildDonutGeometry({
      slices: slices({ count: 12 }),
      size: { width: 200, height: 200 },
      othersLabel: 'Others',
    });

    expect(geometry.slices).toHaveLength(12);
    expect(geometry.slices.some((slice) => slice.label === 'Others')).toBe(false);
  });

  it('drops slices that cannot be drawn', () => {
    const geometry = buildDonutGeometry({
      slices: [
        { label: 'A', value: 10 },
        { label: 'Zero', value: 0 },
        { label: 'Negative', value: -5 },
      ],
      size: { width: 200, height: 200 },
      othersLabel: 'Others',
    });

    expect(geometry.slices.map((slice) => slice.label)).toEqual(['A']);
  });
});

describe('hasDonutData', () => {
  it('needs a slice with a positive value', () => {
    expect(hasDonutData({ slices: [] })).toBe(false);
    expect(hasDonutData({ slices: [{ label: 'A', value: 0 }] })).toBe(false);
    expect(hasDonutData({ slices: [{ label: 'A', value: 1 }] })).toBe(true);
  });
});
