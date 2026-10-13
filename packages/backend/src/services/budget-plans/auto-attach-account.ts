import { RecordId } from '@bt/shared/types';
import { BUDGET_PLAN_ATTACHABLE_ACCOUNT_CATEGORIES } from '@bt/shared/types';
import Accounts from '@models/accounts.model';
import BudgetPlanAccounts from '@models/budget-plan-accounts.model';
import BudgetPlans from '@models/budget-plans.model';
import { Op } from 'sequelize';

/** The accounts a plan may hold. `accountIds` narrows it to a known subset. */
export const eligibleAccountIds = async ({
  userId,
  accountIds,
}: {
  userId: number;
  accountIds?: RecordId[];
}): Promise<RecordId[]> => {
  const accounts = await Accounts.findAll({
    where: {
      userId,
      accountCategory: { [Op.in]: [...BUDGET_PLAN_ATTACHABLE_ACCOUNT_CATEGORIES] },
      ...(accountIds ? { id: { [Op.in]: accountIds } } : {}),
    },
    attributes: ['id'],
  });
  return accounts.map((account) => account.id);
};

/**
 * Trashed plans are included, so a restored plan already holds accounts created meanwhile;
 * re-attaching on restore would undo the user's removals.
 */
export const attachEligibleAccounts = async ({
  userId,
  accountIds,
}: {
  userId: number;
  accountIds: RecordId[];
}): Promise<void> => {
  const plans = await BudgetPlans.findAll({
    where: { userId, autoAttachAccounts: true },
    attributes: ['id'],
    paranoid: false,
  });
  if (!plans.length) return;

  const eligible = await eligibleAccountIds({ userId, accountIds });

  await BudgetPlanAccounts.bulkCreate(
    plans.flatMap((plan) => eligible.map((accountId) => ({ planId: plan.id, accountId }))),
    { ignoreDuplicates: true },
  );
};
