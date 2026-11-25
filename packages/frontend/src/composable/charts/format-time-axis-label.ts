/** Below this width charts switch to fewer ticks and narrower margins. */
export const COMPACT_CHART_WIDTH_PX = 480;

const MONTH_YEAR_SPAN_DAYS = 400;
const MONTH_SPAN_DAYS = 60;

/** Time-axis tick label that gets coarser as the span grows; `format` is the locale-aware date-fns formatter. */
export const formatTimeAxisLabel = ({
  date,
  spanDays,
  format,
}: {
  date: Date;
  spanDays: number;
  format: (date: Date, pattern: string) => string;
}) => {
  if (spanDays > MONTH_YEAR_SPAN_DAYS) return format(date, 'MMM yy');
  if (spanDays > MONTH_SPAN_DAYS) return format(date, 'MMM');
  return format(date, 'MMM d');
};
