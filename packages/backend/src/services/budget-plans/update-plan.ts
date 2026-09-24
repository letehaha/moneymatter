import { RecordId } from '@bt/shared/types';
import { BudgetPlanCarryPolicy } from '@bt/shared/types/budget-plans';
import { Money } from '@common/types/money';
import { toUtcDateString } from '@common/utils/date';
import { removeUndefinedKeys } from '@js/helpers';
import { withTransaction } from '@services/common/with-transaction';

import { findPlan } from './find-plan';
import { getPlan } from './get-plan';
import { boundaryAtOrBefore } from './periods/period-enumerator';

/**
 * A new plan default reaches every period of every line without its own
 * setting, past ones included. Turning the pool on starts it at the current
 * period, so earlier periods never fold against income.
 */
const updatePlanImpl = async ({
  userId,
  planId,
  name,
  autoAttachAccounts,
  carryPolicy,
  poolEnabled,
  expectedIncome,
}: {
  userId: number;
  planId: RecordId;
  name?: string;
  autoAttachAccounts?: boolean;
  carryPolicy?: BudgetPlanCarryPolicy;
  poolEnabled?: boolean;
  /** Decimal; `null` clears it. */
  expectedIncome?: number | null;
}) => {
  const plan = await findPlan({ planId, userId, lock: true });

  let poolFrom: string | null | undefined;
  if (poolEnabled === false) poolFrom = null;
  else if (poolEnabled && !plan.poolFrom) poolFrom = boundaryAtOrBefore({ plan, date: toUtcDateString(new Date()) });

  await plan.update(
    removeUndefinedKeys({
      name,
      autoAttachAccounts,
      carryPolicy,
      poolFrom,
      expectedIncome: expectedIncome == null ? expectedIncome : Money.fromDecimal(expectedIncome),
    }),
  );

  return getPlan({ userId, planId });
};

export const updatePlan = withTransaction(updatePlanImpl);
