import { RecordId } from '@bt/shared/types';
import { t } from '@i18n/index';
import { ValidationError } from '@js/errors';
import BudgetPlanAccounts from '@models/budget-plan-accounts.model';
import { withTransaction } from '@services/common/with-transaction';
import { Op } from 'sequelize';

import { eligibleAccountIds } from './auto-attach-account';
import { findPlan } from './find-plan';
import { getPlan } from './get-plan';

/** Every id must be the user's own and of an attachable category; ids are unique per the schema. */
export const assertAccountsAttachable = async ({
  userId,
  accountIds,
}: {
  userId: number;
  accountIds: RecordId[];
}): Promise<void> => {
  if (!accountIds.length) return;

  const attachable = await eligibleAccountIds({ userId, accountIds });
  if (attachable.length !== accountIds.length) {
    throw new ValidationError({ message: t({ key: 'budgetPlans.accountNotFound' }) });
  }
};

/**
 * Known: a replace can drop an account that auto-attach added between the
 * client's GET and this PUT. Reversible, left as is.
 */
const setPlanAccountsImpl = async ({
  userId,
  planId,
  accountIds,
}: {
  userId: number;
  planId: RecordId;
  accountIds: RecordId[];
}) => {
  const plan = await findPlan({ planId, userId, lock: true });
  await assertAccountsAttachable({ userId, accountIds });

  // A delta, not a replace: re-locking unchanged rows would invert the lock
  // order against a hard account delete and deadlock it.
  await BudgetPlanAccounts.destroy({
    where: { planId: plan.id, ...(accountIds.length ? { accountId: { [Op.notIn]: accountIds } } : {}) },
  });
  await BudgetPlanAccounts.bulkCreate(
    accountIds.map((accountId) => ({ planId: plan.id, accountId })),
    { ignoreDuplicates: true },
  );

  return getPlan({ userId, planId });
};

export const setPlanAccounts = withTransaction(setPlanAccountsImpl);
