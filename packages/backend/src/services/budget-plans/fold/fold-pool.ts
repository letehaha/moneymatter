import { BudgetPlanPool } from '@bt/shared/types';

export interface PoolPeriodInput {
  header: { totalAssigned: number; totalAvailable: number; totalCarriedIn: number };
  uncovered: { income: number; spending: number };
}

type PoolLedgerEntry = Omit<BudgetPlanPool, 'balance'>;

/**
 * Pure: the pool periods oldest first, integer cents. What lines carry into the
 * first period is theirs, the rest of the opening cash is the pool. A period's
 * readyToAssign is its level lowered by the deepest dip later income, outside
 * spending and assignments reach; later `fromLines` is past money, so it is left out.
 */
export const foldPool = ({
  periods,
  openingCash,
}: {
  periods: PoolPeriodInput[];
  openingCash: number;
}): PoolLedgerEntry[] => {
  let level = openingCash - (periods[0]?.header.totalCarriedIn ?? 0);

  const steps = periods.map((period, index) => {
    const previous = periods[index - 1];
    const flow = {
      leftOver: level,
      income: period.uncovered.income,
      outsideSpending: period.uncovered.spending,
      fromLines: previous ? previous.header.totalAvailable - period.header.totalCarriedIn : 0,
      assigned: period.header.totalAssigned,
    };
    level = flow.leftOver + flow.income + flow.outsideSpending + flow.fromLines - flow.assigned;
    return { flow, level };
  });

  let dip = 0;
  return steps
    .toReversed()
    .map(({ flow, level: stepLevel }) => {
      const entry = { readyToAssign: stepLevel + dip, committedLater: 0 - dip, flow };
      dip = Math.min(0, flow.income + flow.outsideSpending - flow.assigned + dip);
      return entry;
    })
    .toReversed();
};
