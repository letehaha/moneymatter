import { computeGoalProgress } from '@bt/shared/goals/goal-math';
import {
  API_ERROR_CODES,
  GOAL_STATUSES_HOLDING_SHARES,
  type GoalAccountHistory,
  type GoalInsights,
  type RecordId,
} from '@bt/shared/types';
import {
  type ConversionDecimals,
  getBaseCurrencyPrecision,
  getConversionDecimals,
} from '@common/lib/currency-precision';
import { type Money, minorUnitsToApiDecimal } from '@common/types/money';
import { t } from '@i18n/index';
import { ExchangeRateUnavailableError, UnexpectedError, ValidationError } from '@js/errors';
import { logger } from '@js/utils';
import Accounts from '@models/accounts.model';
import Balances from '@models/balances.model';
import GoalAccounts from '@models/goal-accounts.model';
import Goals from '@models/goals.model';
import { getBaseCurrency } from '@models/users-currencies.model';
import { calculateRefAmountFromParams } from '@services/calculate-ref-amount.service';
import { assertCurrencyCodesVisible } from '@services/currencies/assert-currency-codes-visible';
import { getPerAccountBalanceHistory, toBalanceDateKey } from '@services/stats/get-balance-history';
import { getExchangeRate } from '@services/user-exchange-rate';
import { eachMonthOfInterval, endOfMonth, format, min, startOfMonth, subMonths } from 'date-fns';
import { col, fn, Op } from 'sequelize';

const HISTORY_MONTHS = 12;

/**
 * Base-currency units per one goal-currency unit, today; null when no rate is available. Any
 * target currency is allowed, so one the user never connected falls back to the market rate.
 */
const fetchRateToBase = async ({
  userId,
  currencyCode,
  baseCurrencyCode,
}: {
  userId: number;
  currencyCode: string;
  baseCurrencyCode: string;
}): Promise<number | null> => {
  try {
    const { rate } = await getExchangeRate({
      userId,
      date: new Date(),
      baseCode: currencyCode,
      quoteCode: baseCurrencyCode,
      requireUserConnection: false,
    });
    return rate;
  } catch (error) {
    if (error instanceof ExchangeRateUnavailableError) return null;
    throw error;
  }
};

/** Like `fetchRateToBase`, but a missing rate refuses the write. */
export const requireRateToBase = async (params: {
  userId: number;
  currencyCode: string;
  baseCurrencyCode: string;
}): Promise<number> => {
  const rate = await fetchRateToBase(params);
  if (rate === null) {
    throw new ValidationError({
      code: API_ERROR_CODES.goalCurrencyRateUnavailable,
      message: t({ key: 'goals.currencyRateUnavailable', variables: { currencyCode: params.currencyCode } }),
    });
  }
  return rate;
};

export const assertGoalCurrencyConvertible = async ({
  userId,
  currencyCode,
}: {
  userId: number;
  currencyCode: string;
}): Promise<void> => {
  await assertCurrencyCodesVisible({ userId, codes: [currencyCode] });
  const { currencyCode: baseCurrencyCode } = await getBaseCurrency({ userId });
  await requireRateToBase({ userId, currencyCode, baseCurrencyCode });
};

/** The fixed amounts share-holding goals take from the accounts, in each account's fill order. */
export const loadHeldFixedAmounts = ({
  userId,
  accountIds,
}: {
  userId: number;
  accountIds: RecordId[];
}): Promise<GoalAccounts[]> =>
  GoalAccounts.findAll({
    where: { accountId: { [Op.in]: accountIds }, fixedAmount: { [Op.ne]: null } },
    attributes: ['goalId', 'accountId', 'fixedAmount', 'fixedPosition'],
    include: [{ model: Goals, attributes: [], where: { userId, status: GOAL_STATUSES_HOLDING_SHARES } }],
    order: [
      ['fixedPosition', 'ASC'],
      ['goalId', 'ASC'],
    ],
  });

/** Decimals of converting each of `currencyCodes` to the base currency, keyed by code. */
export const loadConversionDecimals = async ({
  userId,
  currencyCodes,
  baseCurrencyCode,
}: {
  userId: number;
  currencyCodes: string[];
  baseCurrencyCode: string;
}): Promise<Map<string, ConversionDecimals>> =>
  new Map(
    await Promise.all(
      [...new Set(currencyCodes)].map(
        async (currencyCode) =>
          [
            currencyCode,
            await getConversionDecimals({
              userId,
              definitionOwnerUserId: userId,
              baseCode: currencyCode,
              quoteCode: baseCurrencyCode,
            }),
          ] as const,
      ),
    ),
  );

const sumOf = ({ rows }: { rows: { value: number }[] }) => rows.reduce((sum, row) => sum + row.value, 0);

/**
 * One read for any number of goals: each linked account and its history load once. A goal whose
 * currency has no rate today gets null, without failing the others.
 */
export const loadGoalInsights = async ({
  userId,
  goals,
  heldFixedAmounts,
}: {
  userId: number;
  goals: Goals[];
  /** `loadHeldFixedAmounts` over the goals' accounts. */
  heldFixedAmounts: GoalAccounts[];
}): Promise<Map<RecordId, GoalInsights | null>> => {
  if (!goals.length) return new Map();

  const now = new Date();
  const today = format(now, 'yyyy-MM-dd');
  const monthStarts = eachMonthOfInterval({ start: startOfMonth(subMonths(now, HISTORY_MONTHS)), end: now });
  const from = format(monthStarts[0]!, 'yyyy-MM-dd');
  const months = monthStarts.map((month) => format(min([endOfMonth(month), now]), 'yyyy-MM-dd'));
  const accountIds = [...new Set(goals.flatMap((goal) => (goal.goalAccounts ?? []).map((link) => link.accountId)))];
  const { code: baseCurrencyCode, decimals: baseDecimals } = await getBaseCurrencyPrecision({ userId });

  const [accounts, seriesByAccount, firstDates, rates] = await Promise.all([
    Accounts.findAll({
      where: { id: { [Op.in]: accountIds }, userId },
      attributes: ['id', 'currencyCode', 'refCurrentBalance', 'refCreditLimit'],
    }),
    getPerAccountBalanceHistory({
      userId,
      accountScope: 'owned',
      from,
      to: today,
      accountIds,
      ignoreExcludeFromStats: true,
      decimals: baseDecimals,
    }),
    Balances.findAll({
      where: { accountId: { [Op.in]: accountIds } },
      attributes: ['accountId', [fn('to_char', fn('MIN', col('date')), 'YYYY-MM-DD'), 'firstDate']],
      group: ['accountId'],
    }),
    Promise.all(
      [...new Set(goals.map((goal) => goal.currencyCode))].map(
        async (currencyCode) =>
          [currencyCode, await fetchRateToBase({ userId, currencyCode, baseCurrencyCode })] as const,
      ),
    ),
  ]);

  const rateByCurrency = new Map(rates);
  const fixedAccountIds = new Set([
    ...heldFixedAmounts.map((row) => row.accountId),
    ...goals.flatMap((goal) =>
      (goal.goalAccounts ?? []).filter((link) => link.fixedAmount !== null).map((link) => link.accountId),
    ),
  ]);
  const fixedAccounts = accounts.filter((account) => fixedAccountIds.has(account.id));
  const accountRates = new Map(
    await Promise.all(
      [...new Set(fixedAccounts.map((account) => account.currencyCode))].map(
        async (currencyCode) =>
          [currencyCode, await fetchRateToBase({ userId, currencyCode, baseCurrencyCode })] as const,
      ),
    ),
  );
  const currencyByAccount = new Map(accounts.map((account) => [account.id, account.currencyCode]));
  /** Accounts carrying fixed amounts; a null rate leaves their goals without insights. */
  const rateByFixedAccount = new Map(
    fixedAccounts.map((account) => [account.id, accountRates.get(account.currencyCode)!]),
  );
  const decimalsByCurrency = await loadConversionDecimals({
    userId,
    currencyCodes: [...goals.map((goal) => goal.currencyCode), ...accountRates.keys()],
    baseCurrencyCode,
  });

  // ponytail: today's rate for every month-end too; per-month rates if a foreign fixed amount's history matters
  const fixedToBase = ({ accountId, amount }: { accountId: RecordId; amount: Money }): number =>
    calculateRefAmountFromParams({
      amount,
      rate: rateByFixedAccount.get(accountId)!,
      ...decimalsByCurrency.get(currencyByAccount.get(accountId)!)!,
    }).toNumber();

  const heldByAccount = new Map<RecordId, { goalId: RecordId; value: number }[]>();
  for (const { goalId, accountId, fixedAmount } of heldFixedAmounts) {
    if (rateByFixedAccount.get(accountId) == null) continue;
    heldByAccount.set(accountId, [
      ...(heldByAccount.get(accountId) ?? []),
      { goalId, value: fixedToBase({ accountId, amount: fixedAmount! }) },
    ]);
  }
  const firstDateByAccount = new Map(firstDates.map((row) => [row.accountId, row.get('firstDate') as string]));

  const monthEndBalancesOf = (accountId: RecordId): number[] => {
    const series = seriesByAccount[accountId];
    if (!series) return months.map(() => 0);
    return months.map((month) => {
      const minor = series[toBalanceDateKey(month)];
      if (minor === undefined) {
        throw new UnexpectedError({ message: `Goal insights: balance series of ${accountId} is missing ${month}.` });
      }
      return minorUnitsToApiDecimal({ value: minor, decimals: baseDecimals });
    });
  };

  const historyByAccount = new Map(
    accounts.map((account) => [
      account.id,
      {
        currentBalance: account.refCurrentBalance.toNumber(),
        creditLimit: account.refCreditLimit.toNumber(),
        firstDataDate: firstDateByAccount.get(account.id) ?? null,
        monthEndBalances: monthEndBalancesOf(account.id),
      },
    ]),
  );

  return new Map(
    goals.map((goal): [RecordId, GoalInsights | null] => {
      const rateToBase = rateByCurrency.get(goal.currencyCode)!;
      if (rateToBase === null) {
        logger.warn('[Goals] Insights skipped: no exchange rate', { goalId: goal.id, currencyCode: goal.currencyCode });
        return [goal.id, null];
      }
      const toBase = (amount: Money) =>
        calculateRefAmountFromParams({
          amount,
          rate: rateToBase,
          ...decimalsByCurrency.get(goal.currencyCode)!,
        }).toNumber();

      const links = goal.goalAccounts ?? [];
      const rateless = links.find(({ accountId }) => rateByFixedAccount.get(accountId) === null);
      if (rateless) {
        logger.warn('[Goals] Insights skipped: no exchange rate for a fixed amount', {
          goalId: goal.id,
          accountId: rateless.accountId,
          currencyCode: currencyByAccount.get(rateless.accountId),
        });
        return [goal.id, null];
      }

      const linkedAccounts = links.flatMap(({ accountId, sharePercent, fixedAmount }): GoalAccountHistory[] => {
        const history = historyByAccount.get(accountId);
        if (!history) {
          logger.warn('[Goals] Linked account missing from the owned accounts', { goalId: goal.id, accountId });
          return [];
        }
        const held = heldByAccount.get(accountId) ?? [];
        const own = held.findIndex((row) => row.goalId === goal.id);
        const fixedOthers = sumOf({ rows: held.filter((row) => row.goalId !== goal.id) });
        return [
          {
            accountId,
            sharePercent,
            fixedAmount: fixedAmount === null ? null : fixedToBase({ accountId, amount: fixedAmount }),
            fixedAhead: own === -1 ? fixedOthers : sumOf({ rows: held.slice(0, own) }),
            fixedOthers,
            ...history,
          },
        ];
      });

      const input = {
        today,
        months,
        accounts: linkedAccounts,
        targetAmount: toBase(goal.targetAmount),
        targetDate: goal.targetDate,
        plannedMonthly: goal.plannedMonthly ? toBase(goal.plannedMonthly) : null,
        decimals: baseDecimals,
      };
      const goalDecimals = decimalsByCurrency.get(goal.currencyCode)!.baseDecimals;

      return [goal.id, { ...computeGoalProgress(input), input, rateToBase, goalDecimals, baseCurrencyCode }];
    }),
  );
};
