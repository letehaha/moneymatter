import { computeGoalProgress } from '@bt/shared/goals/goal-math';
import { API_ERROR_CODES, type GoalAccountHistory, type GoalInsights, type RecordId } from '@bt/shared/types';
import { centsToApiDecimal, type Money } from '@common/types/money';
import { t } from '@i18n/index';
import { ExchangeRateUnavailableError, UnexpectedError, ValidationError } from '@js/errors';
import { logger } from '@js/utils';
import Accounts from '@models/accounts.model';
import Balances from '@models/balances.model';
import type Goals from '@models/goals.model';
import { getBaseCurrency } from '@models/users-currencies.model';
import { calculateRefAmountFromParams } from '@services/calculate-ref-amount.service';
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

export const assertGoalCurrencyConvertible = async ({
  userId,
  currencyCode,
}: {
  userId: number;
  currencyCode: string;
}): Promise<void> => {
  const { currencyCode: baseCurrencyCode } = await getBaseCurrency({ userId });
  if ((await fetchRateToBase({ userId, currencyCode, baseCurrencyCode })) === null) {
    throw new ValidationError({
      code: API_ERROR_CODES.goalCurrencyRateUnavailable,
      message: t({ key: 'goals.currencyRateUnavailable', variables: { currencyCode } }),
    });
  }
};

/**
 * One read for any number of goals: each linked account and its history load once. A goal whose
 * currency has no rate today gets null, without failing the others.
 */
export const loadGoalInsights = async ({
  userId,
  goals,
}: {
  userId: number;
  goals: Goals[];
}): Promise<Map<RecordId, GoalInsights | null>> => {
  if (!goals.length) return new Map();

  const now = new Date();
  const today = format(now, 'yyyy-MM-dd');
  const monthStarts = eachMonthOfInterval({ start: startOfMonth(subMonths(now, HISTORY_MONTHS)), end: now });
  const from = format(monthStarts[0]!, 'yyyy-MM-dd');
  const months = monthStarts.map((month) => format(min([endOfMonth(month), now]), 'yyyy-MM-dd'));
  const accountIds = [...new Set(goals.flatMap((goal) => (goal.goalAccounts ?? []).map((link) => link.accountId)))];
  const { currencyCode: baseCurrencyCode } = await getBaseCurrency({ userId });

  const [accounts, seriesByAccount, firstDates, rates] = await Promise.all([
    Accounts.findAll({
      where: { id: { [Op.in]: accountIds }, userId },
      attributes: ['id', 'refCurrentBalance', 'refCreditLimit'],
    }),
    getPerAccountBalanceHistory({
      userId,
      accountScope: 'owned',
      from,
      to: today,
      accountIds,
      ignoreExcludeFromStats: true,
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
  const firstDateByAccount = new Map(firstDates.map((row) => [row.accountId, row.get('firstDate') as string]));

  const monthEndBalancesOf = (accountId: RecordId): number[] => {
    const series = seriesByAccount[accountId];
    if (!series) return months.map(() => 0);
    return months.map((month) => {
      const cents = series[toBalanceDateKey(month)];
      if (cents === undefined) {
        throw new UnexpectedError({ message: `Goal insights: balance series of ${accountId} is missing ${month}.` });
      }
      return centsToApiDecimal(cents);
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
      const toBase = (amount: Money) => calculateRefAmountFromParams({ amount, rate: rateToBase }).toNumber();

      const linkedAccounts = (goal.goalAccounts ?? []).flatMap(({ accountId, sharePercent }): GoalAccountHistory[] => {
        const history = historyByAccount.get(accountId);
        if (!history) {
          logger.warn('[Goals] Linked account missing from the owned accounts', { goalId: goal.id, accountId });
          return [];
        }
        return [{ accountId, sharePercent, ...history }];
      });

      const input = {
        today,
        months,
        accounts: linkedAccounts,
        targetAmount: toBase(goal.targetAmount),
        targetDate: goal.targetDate,
        plannedMonthly: goal.plannedMonthly ? toBase(goal.plannedMonthly) : null,
      };

      return [goal.id, { ...computeGoalProgress(input), input, rateToBase, baseCurrencyCode }];
    }),
  );
};
