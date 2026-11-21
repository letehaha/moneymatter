import { type Period } from '@/composable/use-period-navigation';
import { differenceInCalendarMonths, endOfMonth, startOfMonth, subMonths } from 'date-fns';

/**
 * Months the "Over time" chart shows: the selected period itself when it spans a year or more,
 * otherwise the 12 months ending with the period.
 */
export const getChartWindow = ({ period }: { period: Period }): Period => {
  if (differenceInCalendarMonths(period.to, period.from) + 1 >= 12) {
    return { from: startOfMonth(period.from), to: endOfMonth(period.to) };
  }

  const end = endOfMonth(period.to);
  return { from: startOfMonth(subMonths(end, 11)), to: end };
};
