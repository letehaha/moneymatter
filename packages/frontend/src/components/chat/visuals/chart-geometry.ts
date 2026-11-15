import { CATEGORICAL_SERIES_PALETTE, OTHERS_SERIES_COLOR } from '@/composable/charts/categorical-series-palette';
import { CHAT_VISUAL_LIMITS, type ChatDonutSlice, type ChatSeriesChartSpec } from '@bt/shared/types';
import * as d3 from 'd3';

/**
 * Pure geometry of the chat charts: scales, paths and bars as numbers and SVG path strings, so the
 * components only place them and the tricky parts (gaps, stacking, folding) are unit-testable
 * without a DOM.
 */

interface ChartSize {
  width: number;
  height: number;
}

const MARGIN = { top: 8, right: 12, bottom: 24, left: 56 };
const MIN_X_TICK_SPACING = 64;
const TARGET_Y_TICKS = 5;
const BAND_PADDING_INNER = 0.2;
const BAND_PADDING_OUTER = 0.1;
const GROUP_PADDING = 0.1;
const DONUT_INNER_RATIO = 0.62;
const DONUT_PAD_ANGLE = 0.01;
const DONUT_EDGE = 4;

const seriesColor = ({ index }: { index: number }): string =>
  CATEGORICAL_SERIES_PALETTE[index % CATEGORICAL_SERIES_PALETTE.length]!;

interface SeriesPoint {
  index: number;
  x: number;
  /** `null` where the value is missing: the line breaks there. */
  y: number | null;
  value: number | null;
}

interface SeriesBar {
  index: number;
  x: number;
  y: number;
  width: number;
  height: number;
  value: number;
}

interface SeriesGeometry {
  name: string;
  color: string;
  linePath: string | null;
  areaPath: string | null;
  points: SeriesPoint[];
  bars: SeriesBar[];
}

interface SeriesChartGeometry {
  plot: { left: number; right: number; top: number; bottom: number };
  zeroY: number;
  yTicks: Array<{ value: number; y: number }>;
  /** Where the x axis labels go: `x` is the center of the point or the bar group. */
  xTicks: Array<{ index: number; x: number }>;
  /** Width of one category's slot, so a hover target can cover it. */
  slotWidth: number;
  series: SeriesGeometry[];
}

type BarKind = 'bar' | 'stackedBar';

const isBarKind = (kind: ChatSeriesChartSpec['kind']): kind is BarKind => kind === 'bar' || kind === 'stackedBar';

const valueExtent = ({ spec }: { spec: ChatSeriesChartSpec }): [number, number] => {
  let min = 0;
  let max = 0;

  if (spec.kind === 'stackedBar') {
    for (let index = 0; index < spec.xAxis.values.length; index += 1) {
      let negative = 0;
      let positive = 0;
      for (const series of spec.series) {
        const value = series.values[index] ?? 0;
        if (value < 0) negative += value;
        else positive += value;
      }
      min = Math.min(min, negative);
      max = Math.max(max, positive);
    }
  } else {
    for (const series of spec.series) {
      for (const value of series.values) {
        if (value === null) continue;
        min = Math.min(min, value);
        max = Math.max(max, value);
      }
    }
  }

  return min === max ? [0, 1] : [min, max];
};

const thinTicks = ({ count, plotWidth }: { count: number; plotWidth: number }): number[] => {
  const maxTicks = Math.max(2, Math.floor(plotWidth / MIN_X_TICK_SPACING));
  const step = Math.max(1, Math.ceil(count / maxTicks));

  return Array.from({ length: Math.ceil(count / step) }, (_, tick) => tick * step);
};

const buildBars = ({
  spec,
  xBand,
  y,
}: {
  spec: ChatSeriesChartSpec;
  xBand: d3.ScaleBand<number>;
  y: d3.ScaleLinear<number, number>;
}): SeriesBar[][] => {
  const categories = spec.xAxis.values.map((_, index) => index);
  const bandwidth = xBand.bandwidth();
  const barOf = ({
    index,
    x,
    width,
    low,
    high,
    value,
  }: Omit<SeriesBar, 'y' | 'height'> & { low: number; high: number }) => ({
    index,
    x,
    width,
    value,
    y: Math.min(y(low), y(high)),
    height: Math.abs(y(low) - y(high)),
  });

  if (spec.kind === 'stackedBar') {
    const stacked = d3
      .stack<number, number>()
      .keys(spec.series.map((_, index) => index))
      .value((category, key) => spec.series[key]!.values[category] ?? 0)
      .offset(d3.stackOffsetDiverging)(categories);

    return stacked.map((layer, seriesIndex) =>
      layer.flatMap((segment, category) => {
        const value = spec.series[seriesIndex]!.values[category];
        if (value === null || value === undefined) return [];
        return [
          barOf({ index: category, x: xBand(category)!, width: bandwidth, low: segment[0], high: segment[1], value }),
        ];
      }),
    );
  }

  const seriesBand = d3
    .scaleBand<number>(
      spec.series.map((_, index) => index),
      [0, bandwidth],
    )
    .padding(GROUP_PADDING);

  return spec.series.map((series, seriesIndex) =>
    series.values.flatMap((value, category) =>
      value === null
        ? []
        : [
            barOf({
              index: category,
              x: xBand(category)! + seriesBand(seriesIndex)!,
              width: seriesBand.bandwidth(),
              low: 0,
              high: value,
              value,
            }),
          ],
    ),
  );
};

export const buildSeriesChartGeometry = ({
  spec,
  size,
}: {
  spec: ChatSeriesChartSpec;
  size: ChartSize;
}): SeriesChartGeometry => {
  const plot = {
    left: MARGIN.left,
    right: Math.max(MARGIN.left + 1, size.width - MARGIN.right),
    top: MARGIN.top,
    bottom: Math.max(MARGIN.top + 1, size.height - MARGIN.bottom),
  };
  const categories = spec.xAxis.values.map((_, index) => index);
  const [min, max] = valueExtent({ spec });
  const y = d3.scaleLinear([min, max], [plot.bottom, plot.top]).nice(TARGET_Y_TICKS);
  const zeroY = y(0);

  const xBand = d3
    .scaleBand<number>(categories, [plot.left, plot.right])
    .paddingInner(BAND_PADDING_INNER)
    .paddingOuter(BAND_PADDING_OUTER);
  const xPoint = d3.scalePoint<number>(categories, [plot.left, plot.right]);
  const isBars = isBarKind(spec.kind);
  const xCenter = (index: number) => (isBars ? xBand(index)! + xBand.bandwidth() / 2 : xPoint(index)!);

  const barsBySeries = isBars ? buildBars({ spec, xBand, y }) : [];

  const series = spec.series.map((source, seriesIndex): SeriesGeometry => {
    const points = source.values.map((value, index) => ({
      index,
      x: xCenter(index),
      y: value === null ? null : y(value),
      value,
    }));
    const defined = (point: SeriesPoint) => point.y !== null;
    const linePath =
      spec.kind === 'line' || spec.kind === 'area'
        ? d3
            .line<SeriesPoint>()
            .defined(defined)
            .x((point) => point.x)
            .y((point) => point.y!)(points)
        : null;
    const areaPath =
      spec.kind === 'area'
        ? d3
            .area<SeriesPoint>()
            .defined(defined)
            .x((point) => point.x)
            .y0(zeroY)
            .y1((point) => point.y!)(points)
        : null;

    return {
      name: source.name,
      color: seriesColor({ index: seriesIndex }),
      linePath,
      areaPath,
      points,
      bars: barsBySeries[seriesIndex] ?? [],
    };
  });

  return {
    plot,
    zeroY,
    yTicks: y.ticks(TARGET_Y_TICKS).map((value) => ({ value, y: y(value) })),
    xTicks: thinTicks({ count: categories.length, plotWidth: plot.right - plot.left }).map((index) => ({
      index,
      x: xCenter(index),
    })),
    slotWidth: isBars ? xBand.step() : categories.length > 1 ? xPoint.step() : plot.right - plot.left,
    series,
  };
};

/** A series chart has something to draw when the axis has points and at least one value is set. */
export const hasSeriesData = ({ spec }: { spec: ChatSeriesChartSpec }): boolean =>
  spec.xAxis.values.length > 0 && spec.series.some((series) => series.values.some((value) => value !== null));

interface DonutSliceGeometry {
  label: string;
  value: number;
  /** Fraction of the total, 0 to 1. */
  share: number;
  color: string;
  /** Arc outline, relative to the donut's center. */
  path: string;
  isOthers: boolean;
}

interface DonutGeometry {
  total: number;
  cx: number;
  cy: number;
  radius: number;
  slices: DonutSliceGeometry[];
}

const drawableSlices = ({ slices }: { slices: ChatDonutSlice[] }) =>
  slices.filter((slice) => Number.isFinite(slice.value) && slice.value > 0);

/** Slices past the limit are folded into one "Others" slice with its own muted color. */
const foldSlices = ({ slices, othersLabel }: { slices: ChatDonutSlice[]; othersLabel: string }) => {
  const kept = slices.slice(0, CHAT_VISUAL_LIMITS.maxSlices).map((slice, index) => ({
    ...slice,
    color: seriesColor({ index }),
    isOthers: false,
  }));
  const rest = slices.slice(CHAT_VISUAL_LIMITS.maxSlices);
  if (rest.length === 0) return kept;

  const value = rest.reduce((sum, slice) => sum + slice.value, 0);
  return [...kept, { label: othersLabel, value, color: OTHERS_SERIES_COLOR, isOthers: true }];
};

export const buildDonutGeometry = ({
  slices,
  size,
  othersLabel,
}: {
  slices: ChatDonutSlice[];
  size: ChartSize;
  othersLabel: string;
}): DonutGeometry => {
  const folded = foldSlices({ slices: drawableSlices({ slices }), othersLabel });
  const total = folded.reduce((sum, slice) => sum + slice.value, 0);
  const radius = Math.max(1, Math.min(size.width, size.height) / 2 - DONUT_EDGE);
  const arc = d3
    .arc<d3.PieArcDatum<(typeof folded)[number]>>()
    .innerRadius(radius * DONUT_INNER_RATIO)
    .outerRadius(radius);
  const arcs = d3
    .pie<(typeof folded)[number]>()
    .sort(null)
    .padAngle(folded.length > 1 ? DONUT_PAD_ANGLE : 0)
    .value((slice) => slice.value)(folded);

  return {
    total,
    cx: size.width / 2,
    cy: size.height / 2,
    radius,
    slices: arcs.map((datum) => ({
      label: datum.data.label,
      value: datum.data.value,
      share: datum.data.value / total,
      color: datum.data.color,
      path: arc(datum) ?? '',
      isOthers: datum.data.isOthers,
    })),
  };
};

export const hasDonutData = ({ slices }: { slices: ChatDonutSlice[] }): boolean =>
  drawableSlices({ slices }).length > 0;
