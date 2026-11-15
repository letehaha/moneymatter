import { toGoalCurrency } from '@bt/shared/goals/goal-math';
import {
  API_ERROR_CODES,
  GOAL_ELIGIBLE_ACCOUNT_CATEGORIES,
  GOAL_STATUSES_HOLDING_SHARES,
  type GoalAccountShareInput,
  type GoalShareCapacityExceededDetails,
  type GoalStatus,
  type RecordId,
} from '@bt/shared/types';
import { Money } from '@common/types/money';
import { t } from '@i18n/index';
import { ConflictError, ValidationError } from '@js/errors';
import type Accounts from '@models/accounts.model';
import GoalAccounts from '@models/goal-accounts.model';
import Goals from '@models/goals.model';
import { getBaseCurrency } from '@models/users-currencies.model';
import { lockAccountRow } from '@services/accounts/lock-account-row';
import { calculateRefAmountFromParams } from '@services/calculate-ref-amount.service';
import { QueryTypes } from 'sequelize';

import { loadConversionDecimals, loadHeldFixedAmounts, requireRateToBase } from './goal-insights';
import { roundGoalAmount } from './round-goal-amount';

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
  shares: GoalAccountShareInput[];
  countsTowardCapacity: boolean;
}): Promise<Accounts[]> => {
  if (!shares.length) return [];

  const accountIds = shares.map((share) => share.accountId);
  const accounts = await lockEligibleAccounts({ userId, accountIds });
  const percentShares = shares.filter((share) => share.sharePercent != null);
  if (!countsTowardCapacity || !percentShares.length) return accounts;

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
      replacements: {
        userId,
        goalId,
        accountIds: percentShares.map((share) => share.accountId),
        holdingStatuses: GOAL_STATUSES_HOLDING_SHARES,
      },
      type: QueryTypes.SELECT,
    },
  );
  const usedByAccount = new Map(rows.map((row) => [row.accountId, toHundredths(Number(row.used))]));

  for (const share of percentShares) {
    const used = usedByAccount.get(share.accountId) ?? 0;
    if (toHundredths(share.sharePercent!) + used <= FULL_SHARE_HUNDREDTHS) continue;

    const details: GoalShareCapacityExceededDetails = {
      accountId: share.accountId,
      accountName: accounts.find((account) => account.id === share.accountId)!.name,
      requested: share.sharePercent!,
      usedByOtherGoals: used / 100,
      free: Math.max(0, FULL_SHARE_HUNDREDTHS - used) / 100,
    };
    throw new ConflictError({
      code: API_ERROR_CODES.goalShareCapacityExceeded,
      message: t({ key: 'goals.shareCapacityExceeded', variables: details }),
      details,
    });
  }
  return accounts;
};

/**
 * Backed by fixed amounts alone, a goal can never pass their sum, so a target above it is refused.
 * Both sides go to base the way insights convert them, so the check and the reached status agree.
 */
const assertFixedAmountsReachTarget = async ({
  userId,
  shares,
  accounts,
  target,
}: {
  userId: number;
  shares: GoalAccountShareInput[];
  accounts: Accounts[];
  target: { amount: Money; currencyCode: string };
}): Promise<void> => {
  if (!shares.length || shares.some((share) => share.fixedAmount == null)) return;

  const { currencyCode: baseCurrencyCode } = await getBaseCurrency({ userId });
  const currencyByAccount = new Map(accounts.map((account) => [account.id, account.currencyCode]));
  const rateByCurrency = new Map(
    await Promise.all(
      [...new Set([target.currencyCode, ...currencyByAccount.values()])].map(
        async (currencyCode) =>
          [currencyCode, await requireRateToBase({ userId, currencyCode, baseCurrencyCode })] as const,
      ),
    ),
  );
  const decimalsByCurrency = await loadConversionDecimals({
    userId,
    currencyCodes: [...rateByCurrency.keys()],
    baseCurrencyCode,
  });
  const toBase = ({ amount, currencyCode }: { amount: Money; currencyCode: string }) =>
    calculateRefAmountFromParams({
      amount,
      rate: rateByCurrency.get(currencyCode)!,
      ...decimalsByCurrency.get(currencyCode)!,
    });

  const total = shares.reduce(
    (sum, share) =>
      sum.add(
        toBase({
          amount: Money.fromDecimal(share.fixedAmount!),
          currencyCode: currencyByAccount.get(share.accountId)!,
        }),
      ),
    Money.zero(),
  );
  if (total.gte(toBase({ amount: target.amount, currencyCode: target.currencyCode }))) return;

  throw new ValidationError({
    code: API_ERROR_CODES.goalFixedAmountsBelowTarget,
    message: t({
      key: 'goals.fixedAmountsBelowTarget',
      variables: {
        total: toGoalCurrency({
          amount: total.toNumber(),
          rateToBase: rateByCurrency.get(target.currencyCode)!,
          decimals: decimalsByCurrency.get(target.currencyCode)!.baseDecimals,
        }),
        target: target.amount.toNumber(),
        currencyCode: target.currencyCode,
      },
    }),
  });
};

/**
 * Places the goal's fixed amounts in each account's order: at `fixedPosition` when sent, else at
 * the stored place, else last. The other share-holding goals' amounts are renumbered around it.
 */
const placeFixedAmounts = async ({
  userId,
  goalId,
  shares,
}: {
  userId: number;
  goalId: RecordId;
  shares: GoalAccountShareInput[];
}): Promise<Map<RecordId, number>> => {
  const positions = new Map<RecordId, number>();
  const fixedShares = shares.filter((share) => share.fixedAmount != null);
  if (!fixedShares.length) return positions;

  const rows = await loadHeldFixedAmounts({ userId, accountIds: fixedShares.map((share) => share.accountId) });

  for (const share of fixedShares) {
    const onAccount = rows.filter((row) => row.accountId === share.accountId);
    const others = onAccount.filter((row) => row.goalId !== goalId);
    const stored = onAccount.findIndex((row) => row.goalId === goalId);
    const position = Math.min(share.fixedPosition ?? (stored === -1 ? others.length : stored), others.length);

    for (const [index, row] of others.entries()) {
      const next = index < position ? index : index + 1;
      if (row.fixedPosition !== next) {
        await GoalAccounts.update({ fixedPosition: next }, { where: { goalId: row.goalId, accountId: row.accountId } });
      }
    }
    positions.set(share.accountId, position);
  }
  return positions;
};

/** Replaces the goal's shares with `shares`, or re-checks and re-places the stored ones when `shares` is omitted. */
export const writeGoalShares = async ({
  userId,
  goalId,
  status,
  target,
  shares,
}: {
  userId: number;
  goalId: RecordId;
  status: GoalStatus;
  target: { amount: Money; currencyCode: string };
  shares?: GoalAccountShareInput[];
}): Promise<void> => {
  const sentOrStoredShares: GoalAccountShareInput[] =
    shares ??
    (await GoalAccounts.findAll({ where: { goalId } })).map(({ accountId, sharePercent, fixedAmount }) => ({
      accountId,
      sharePercent,
      fixedAmount: fixedAmount?.toNumber() ?? null,
    }));

  const countsTowardCapacity = GOAL_STATUSES_HOLDING_SHARES.includes(status);
  const accounts = await assertGoalAccounts({ userId, goalId, shares: sentOrStoredShares, countsTowardCapacity });
  // A sent fixed amount is entered in its account's currency and rounds half-up to that currency's
  // decimals. Stored ones are re-checked as they are: the write did not touch them.
  const currencyByAccount = new Map(accounts.map((account) => [account.id, account.currencyCode]));
  const nextShares = await Promise.all(
    sentOrStoredShares.map(async (share) =>
      !shares || share.fixedAmount == null
        ? share
        : {
            ...share,
            fixedAmount: (
              await roundGoalAmount({
                money: Money.fromDecimal(share.fixedAmount),
                userId,
                currencyCode: currencyByAccount.get(share.accountId)!,
              })
            ).toNumber(),
          },
    ),
  );
  await assertFixedAmountsReachTarget({ userId, shares: nextShares, accounts, target });
  const positions = countsTowardCapacity ? await placeFixedAmounts({ userId, goalId, shares: nextShares }) : null;
  await GoalAccounts.destroy({ where: { goalId } });
  await GoalAccounts.bulkCreate(
    nextShares.map(({ accountId, sharePercent, fixedAmount, fixedPosition }) =>
      fixedAmount == null
        ? { goalId, accountId, sharePercent: sharePercent!, fixedAmount: null, fixedPosition: null }
        : {
            goalId,
            accountId,
            sharePercent: null,
            fixedAmount: Money.fromDecimal(fixedAmount),
            fixedPosition: positions?.get(accountId) ?? fixedPosition ?? 0,
          },
    ),
  );
};
