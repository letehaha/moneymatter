import { RecordId } from '@bt/shared/types';
import { BudgetPlanCarryPolicy } from '@bt/shared/types';
import { Money } from '@common/types/money';
import { t } from '@i18n/index';
import { ConflictError } from '@js/errors';
import { removeUndefinedKeys } from '@js/helpers';
import { withTransaction } from '@services/common/with-transaction';

import { findPlan } from './find-plan';
import { getPlan } from './get-plan';
import { currentPeriodStart } from './periods/period-enumerator';

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
  zeroSum,
  expectedIncome,
}: {
  userId: number;
  planId: RecordId;
  name?: string;
  autoAttachAccounts?: boolean;
  carryPolicy?: BudgetPlanCarryPolicy;
  poolEnabled?: boolean;
  zeroSum?: boolean;
  /** Decimal; `null` clears it. */
  expectedIncome?: number | null;
}) => {
  const plan = await findPlan({ planId, userId, lock: true });

  let poolFrom: string | null | undefined;
  if (poolEnabled === false) poolFrom = null;
  else if (poolEnabled && !plan.poolFrom) poolFrom = currentPeriodStart({ plan });

  const poolOn = (poolFrom === undefined ? plan.poolFrom : poolFrom) !== null;
  if (zeroSum && !poolOn) throw new ConflictError({ message: t({ key: 'budgetPlans.zeroSumNeedsPool' }) });

  await plan.update(
    removeUndefinedKeys({
      name,
      autoAttachAccounts,
      carryPolicy,
      poolFrom,
      zeroSum: poolOn ? zeroSum : false,
      expectedIncome: expectedIncome == null ? expectedIncome : Money.fromDecimal(expectedIncome),
    }),
  );

  return getPlan({ userId, planId });
};

export const updatePlan = withTransaction(updatePlanImpl);
