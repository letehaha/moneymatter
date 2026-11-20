import { TRACKER_LIMIT_KINDS, type TrackerStatsResponse } from '@bt/shared/types';

import type { TrackerTimeStatus } from '../tracker-time-status';

interface TrackerLimitSummary {
  spent: number;
  left: number;
  /** `spent` as a percentage of the limit. */
  rate: number;
  /** Amount per remaining day (today included); null without a countdown or once over the limit. */
  dailyPace: number | null;
}

/** Net spending for a spending limit, net income for the income kinds. */
export const getTrackerSpent = ({
  summary,
  limitKind,
}: {
  summary: Pick<TrackerStatsResponse['summary'], 'balance'>;
  limitKind: TRACKER_LIMIT_KINDS;
}) => Math.max(0, limitKind === TRACKER_LIMIT_KINDS.spending ? -summary.balance : summary.balance);

export const getTrackerLimitSummary = ({
  limitAmount,
  limitKind,
  summary,
  timeStatus,
}: {
  limitAmount: number;
  limitKind: TRACKER_LIMIT_KINDS;
  summary: Pick<TrackerStatsResponse['summary'], 'balance' | 'utilizationRate'>;
  timeStatus: TrackerTimeStatus;
}): TrackerLimitSummary => {
  const spent = getTrackerSpent({ summary, limitKind });
  const left = limitAmount - spent;
  const rate = summary.utilizationRate ?? 0;
  const dailyPace =
    timeStatus.kind === 'active' && timeStatus.daysLeft !== null && left > 0
      ? left / (Math.max(0, timeStatus.daysLeft) + 1)
      : null;

  return { spent, left, rate, dailyPace };
};
