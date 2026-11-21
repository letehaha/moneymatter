import { ACCOUNT_CATEGORIES, GOAL_ELIGIBLE_ACCOUNT_CATEGORIES, type RecordId } from '@bt/shared/types';
import GoalAccounts from '@models/goal-accounts.model';
import { lockAccountRow } from '@services/accounts/lock-account-row';

/** Drops the account's goal links when it moves to a category that can't back a goal. */
export const releaseIneligibleGoalShares = async ({
  accountId,
  userId,
  accountCategory,
}: {
  accountId: RecordId;
  userId: number;
  accountCategory: ACCOUNT_CATEGORIES;
}): Promise<void> => {
  if (GOAL_ELIGIBLE_ACCOUNT_CATEGORIES.includes(accountCategory)) return;

  // Goal writes lock the account before touching its links; same order here, or they deadlock.
  await lockAccountRow({ accountId, userId, noKey: true });
  await GoalAccounts.destroy({ where: { accountId } });
};
