import { BudgetPlanCarryPolicy } from '@bt/shared/types';
import type BudgetAssignments from '@models/budget-assignments.model';

/** Integer minor units at the plan currency's decimals. */
export interface AssignmentAmounts {
  baselineAmount: number | null;
  overrideAmount: number | null;
  carryPolicy: BudgetPlanCarryPolicy | null;
}

export const assignmentMinorUnits = ({
  row: { baselineAmount, overrideAmount, carryPolicy },
  decimals,
}: {
  row: Pick<BudgetAssignments, keyof AssignmentAmounts>;
  decimals: number;
}): AssignmentAmounts => ({
  baselineAmount: baselineAmount?.toMinorUnits({ decimals }) ?? null,
  overrideAmount: overrideAmount?.toMinorUnits({ decimals }) ?? null,
  carryPolicy,
});

/** The row CHECK rejects an all-null assignment, so an empty one is deleted, never written. */
export const isEmptyAssignment = ({
  baselineAmount,
  overrideAmount,
  carryPolicy,
}: Record<keyof AssignmentAmounts, unknown>): boolean =>
  baselineAmount === null && overrideAmount === null && carryPolicy === null;

/**
 * One step of the sparse-row walk, in integer minor units: a baseline recurs until
 * the next one, an override lasts a single period.
 */
export const resolveAssigned = ({
  row,
  baseline,
}: {
  row?: AssignmentAmounts;
  baseline: number;
}): { baseline: number; override: number | null; assigned: number; baselineSet: boolean } => {
  const next = row?.baselineAmount ?? baseline;
  const override = row?.overrideAmount ?? null;

  return { baseline: next, override, assigned: override ?? next, baselineSet: row?.baselineAmount != null };
};
