import { PLANNED_MATCH_WINDOW_DAYS } from '@bt/shared/types';
import { addDays, differenceInCalendarDays, isBefore } from 'date-fns';

/** True once no incoming bank transaction can still merge into the plan. */
export const isPlanMatchWindowExpired = ({ time }: { time: Date | string }): boolean =>
  isBefore(addDays(new Date(time), PLANNED_MATCH_WINDOW_DAYS), new Date());

/** Calendar days between the plan's date and today, counting whole day boundaries. */
export const planExpiredDays = ({ time }: { time: Date | string }): number =>
  differenceInCalendarDays(new Date(), new Date(time));
