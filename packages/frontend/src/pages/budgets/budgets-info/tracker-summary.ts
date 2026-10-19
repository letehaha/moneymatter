import type { BudgetStatsResponse } from '@bt/shared/types';

import type { TrackerTimeStatus } from '../tracker-time-status';

interface TrackerLimitSummary {
  spent: number;
  left: number;
  /** Spent as a percentage of the limit. */
  rate: number;
  /** Amount per remaining day (today included); null without a countdown or once over the limit. */
  dailyPace: number | null;
}

export const getTrackerSpent = ({ summary }: { summary: Pick<BudgetStatsResponse['summary'], 'balance'> }) =>
  Math.max(0, -summary.balance);

export const getTrackerLimitSummary = ({
  limitAmount,
  summary,
  timeStatus,
}: {
  limitAmount: number;
  summary: Pick<BudgetStatsResponse['summary'], 'balance' | 'utilizationRate'>;
  timeStatus: TrackerTimeStatus;
}): TrackerLimitSummary => {
  const spent = getTrackerSpent({ summary });
  const left = limitAmount - spent;
  const rate = summary.utilizationRate ?? 0;
  const dailyPace =
    timeStatus.kind === 'active' && timeStatus.daysLeft !== null && left > 0
      ? left / (Math.max(0, timeStatus.daysLeft) + 1)
      : null;

  return { spent, left, rate, dailyPace };
};
