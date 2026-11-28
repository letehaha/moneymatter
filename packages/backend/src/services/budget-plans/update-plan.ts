import { RecordId } from '@bt/shared/types';
import { BudgetPlanCarryPolicy } from '@bt/shared/types';
import { roundToCurrency } from '@common/lib/currency-precision';
import { Money } from '@common/types/money';
import { t } from '@i18n/index';
import { ConflictError, ValidationError } from '@js/errors';
import { removeUndefinedKeys } from '@js/helpers';
import { withTransaction } from '@services/common/with-transaction';

import { findPlan } from './find-plan';
import { getPlan } from './get-plan';
import { currentPeriodStart } from './periods/period-enumerator';
import { ownerCategories } from './validate-line-categories';

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
  ignoredCategoryIds,
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
  ignoredCategoryIds?: RecordId[];
}) => {
  const plan = await findPlan({ planId, userId, lock: true });
  let ignored = ignoredCategoryIds;
  if (ignored?.length) {
    const { byId } = await ownerCategories({ userId: plan.userId });
    // An id already stored may have gone stale; it is dropped, not refused, so the list stays editable.
    if (ignored.some((id) => !byId.has(id) && !plan.ignoredCategoryIds.includes(id))) {
      throw new ValidationError({ message: t({ key: 'budgetPlans.categoryNotFound' }) });
    }
    ignored = ignored.filter((id) => byId.has(id));
  }
  const income =
    expectedIncome == null
      ? expectedIncome
      : await roundToCurrency({
          money: Money.fromDecimal(expectedIncome),
          userId,
          currencyCode: plan.currencyCode,
          mode: 'half-up',
        });

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
      expectedIncome: income,
      ignoredCategoryIds: ignored,
    }),
  );

  return getPlan({ userId, planId });
};

export const updatePlan = withTransaction(updatePlanImpl);
