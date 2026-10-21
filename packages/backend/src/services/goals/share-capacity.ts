import {
  API_ERROR_CODES,
  GOAL_ELIGIBLE_ACCOUNT_CATEGORIES,
  GOAL_STATUSES_HOLDING_SHARES,
  type GoalAccountShare,
  type GoalShareCapacityExceededDetails,
  type GoalStatus,
  type RecordId,
} from '@bt/shared/types';
import { t } from '@i18n/index';
import { ConflictError, ValidationError } from '@js/errors';
import type Accounts from '@models/accounts.model';
import GoalAccounts from '@models/goal-accounts.model';
import Goals from '@models/goals.model';
import { lockAccountRow } from '@services/accounts/lock-account-row';
import { QueryTypes } from 'sequelize';

const FULL_SHARE_HUNDREDTHS = 10_000;
const toHundredths = (percent: number) => Math.round(percent * 100);

/** One statement per account, ascending, so two writes over overlapping accounts can't deadlock. */
const lockEligibleAccounts = async ({
  userId,
  accountIds,
}: {
  userId: number;
  accountIds: RecordId[];
}): Promise<Accounts[]> => {
  const accounts: Accounts[] = [];
  for (const accountId of accountIds.toSorted()) {
    const account = await lockAccountRow({ accountId, userId, noKey: true });
    if (!account) throw new ValidationError({ message: t({ key: 'goals.accountNotFound' }) });
    if (!GOAL_ELIGIBLE_ACCOUNT_CATEGORIES.includes(account.accountCategory)) {
      throw new ValidationError({
        message: t({ key: 'goals.accountNotEligible', variables: { accountName: account.name } }),
      });
    }
    accounts.push(account);
  }
  return accounts;
};

/**
 * Validates the accounts and, when the goal counts toward capacity, that each account's shares
 * over the user's share-holding goals stay ≤ 100%. The row locks taken here serialize
 * concurrent goal writes, so the sum reads every share already committed.
 */
const assertGoalAccounts = async ({
  userId,
  goalId,
  shares,
  countsTowardCapacity,
}: {
  userId: number;
  /** The goal being written; its stored shares are replaced, so they don't count as used. */
  goalId: RecordId;
  shares: GoalAccountShare[];
  countsTowardCapacity: boolean;
}): Promise<void> => {
  if (!shares.length) return;

  const accountIds = shares.map((share) => share.accountId);
  const accounts = await lockEligibleAccounts({ userId, accountIds });
  if (!countsTowardCapacity) return;

  const rows = await Goals.sequelize!.query<{ accountId: string; used: string }>(
    `SELECT ga."accountId", SUM(ga."sharePercent") AS used
       FROM "GoalAccounts" ga
       JOIN "Goals" g ON g."id" = ga."goalId"
      WHERE g."userId" = :userId
        AND g."status" IN (:holdingStatuses)
        AND g."id" <> :goalId
        AND ga."accountId" IN (:accountIds)
      GROUP BY ga."accountId"`,
    {
      replacements: { userId, goalId, accountIds, holdingStatuses: GOAL_STATUSES_HOLDING_SHARES },
      type: QueryTypes.SELECT,
    },
  );
  const usedByAccount = new Map(rows.map((row) => [row.accountId, toHundredths(Number(row.used))]));

  for (const share of shares) {
    const used = usedByAccount.get(share.accountId) ?? 0;
    if (toHundredths(share.sharePercent) + used <= FULL_SHARE_HUNDREDTHS) continue;

    const details: GoalShareCapacityExceededDetails = {
      accountId: share.accountId,
      accountName: accounts.find((account) => account.id === share.accountId)!.name,
      requested: share.sharePercent,
      usedByOtherGoals: used / 100,
      free: Math.max(0, FULL_SHARE_HUNDREDTHS - used) / 100,
    };
    throw new ConflictError({
      code: API_ERROR_CODES.goalShareCapacityExceeded,
      message: t({ key: 'goals.shareCapacityExceeded', variables: details }),
      details,
    });
  }
};

/** Replaces the goal's shares with `shares`, or re-checks the stored ones when `shares` is omitted. */
export const writeGoalShares = async ({
  userId,
  goalId,
  status,
  shares,
}: {
  userId: number;
  goalId: RecordId;
  status: GoalStatus;
  shares?: GoalAccountShare[];
}): Promise<void> => {
  const countsTowardCapacity = GOAL_STATUSES_HOLDING_SHARES.includes(status);
  if (!shares) {
    const stored = await GoalAccounts.findAll({ where: { goalId }, attributes: ['accountId', 'sharePercent'] });
    await assertGoalAccounts({ userId, goalId, shares: stored, countsTowardCapacity });
    return;
  }

  await assertGoalAccounts({ userId, goalId, shares, countsTowardCapacity });
  await GoalAccounts.destroy({ where: { goalId } });
  await GoalAccounts.bulkCreate(shares.map(({ accountId, sharePercent }) => ({ goalId, accountId, sharePercent })));
};
