import { endOfMonth, startOfMonth, subMonths } from 'date-fns';

const TREND_MONTHS = 6;

/** The full months before the one the period ends in, so a half-finished month never reads as a drop. */
export const getTrendRange = ({ periodEnd }: { periodEnd: Date }): { from: Date; to: Date } => ({
  from: startOfMonth(subMonths(periodEnd, TREND_MONTHS)),
  to: endOfMonth(subMonths(periodEnd, 1)),
});

/** Flips net amounts so higher always means more of what the row shows: spending on an expense row, earnings on an income row. */
export const orientTrend = ({ values, netAmount }: { values: number[]; netAmount: number }): number[] => {
  const reference = netAmount !== 0 ? netAmount : values.reduce((acc, value) => acc + value, 0);
  return reference < 0 ? values.map((value) => -value) : values;
};

/** Scales `values` into a width × height box inset by `padding`; a flat series sits on the vertical middle. */
export const buildSparklinePoints = ({
  values,
  width,
  height,
  padding,
}: {
  values: number[];
  width: number;
  height: number;
  padding: number;
}): { x: number; y: number }[] => {
  const min = Math.min(...values);
  const range = Math.max(...values) - min;
  const step = values.length > 1 ? (width - 2 * padding) / (values.length - 1) : 0;

  return values.map((value, index) => ({
    x: padding + index * step,
    y: range === 0 ? height / 2 : height - padding - ((value - min) / range) * (height - 2 * padding),
  }));
};
