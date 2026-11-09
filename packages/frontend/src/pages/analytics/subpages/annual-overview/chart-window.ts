import { type Period } from '@/composable/use-period-navigation';
import { differenceInCalendarMonths, endOfMonth, isAfter, startOfMonth, subMonths } from 'date-fns';

/**
 * Months the "Over time" chart shows: the selected period itself when it spans a year or more,
 * otherwise the 12 months up to now while the period sits inside them (so picking a bar doesn't
 * shift the chart), or the 12 months ending with the period when it is older.
 */
export const getChartWindow = ({ period, now = new Date() }: { period: Period; now?: Date }): Period => {
  if (differenceInCalendarMonths(period.to, period.from) + 1 >= 12) {
    return { from: startOfMonth(period.from), to: endOfMonth(period.to) };
  }

  const latest = endOfMonth(now);
  const fitsLatest = differenceInCalendarMonths(latest, period.from) <= 11 && !isAfter(period.to, latest);
  const end = fitsLatest ? latest : endOfMonth(period.to);

  return { from: startOfMonth(subMonths(end, 11)), to: end };
};
