import { format, parseISO, subDays } from 'date-fns';

const DATE_FORMAT = 'yyyy-MM-dd';

/**
 * A budget plan period as the chat's period. Periods end on an exclusive date (the first day of the
 * next one); the chat's period names its last day, so "Mar 1 to Apr 1" is read as March 1 to March 31.
 */
export const budgetPeriodToChatPeriod = ({
  startDate,
  endDate,
}: {
  startDate: string;
  endDate: string;
}): { from: string; to: string } => ({
  from: format(parseISO(startDate), DATE_FORMAT),
  to: format(subDays(parseISO(endDate), 1), DATE_FORMAT),
});
