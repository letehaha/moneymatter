import { TRACKER_LIMIT_KINDS, type TrackerModel } from '@bt/shared/types';
import { endOfDay } from 'date-fns';

import { parseTrackerDate } from './tracker-time-status';

type TrackerPeriod = Pick<TrackerModel, 'startDate' | 'endDate' | 'limitKind'>;

const INCOME_TARGET_SLACK = 10;

const getElapsedPercent = ({ tracker, now }: { tracker?: TrackerPeriod; now: Date }): number => {
  const start = parseTrackerDate(tracker?.startDate);
  const end = parseTrackerDate(tracker?.endDate);
  if (!start || !end) return 0;
  const total = endOfDay(end).getTime() - start.getTime();
  if (total <= 0) return 0;
  return Math.min(100, Math.max(0, ((now.getTime() - start.getTime()) / total) * 100));
};

/**
 * Thresholds shift with the elapsed share of the period, so progress in line with time stays green.
 * An income target warns only when it falls behind that pace and is never red: going over is a win.
 */
export const utilizationClasses = ({
  rate,
  tracker,
  now = new Date(),
}: {
  rate: number;
  tracker?: TrackerPeriod;
  now?: Date;
}) => {
  const elapsed = getElapsedPercent({ tracker, now });
  if (tracker?.limitKind === TRACKER_LIMIT_KINDS.incomeTarget) {
    return rate < elapsed - INCOME_TARGET_SLACK
      ? { text: 'text-warning-text', bg: 'bg-warning-text' }
      : { text: 'text-success-text', bg: 'bg-success-text' };
  }
  if (rate > Math.min(100, Math.max(90, elapsed + 10)))
    return { text: 'text-app-expense-color', bg: 'bg-app-expense-color' };
  if (rate > Math.max(70, elapsed)) return { text: 'text-warning-text', bg: 'bg-warning-text' };
  return { text: 'text-success-text', bg: 'bg-success-text' };
};
