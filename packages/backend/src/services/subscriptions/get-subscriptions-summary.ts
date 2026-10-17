import { API_ERROR_CODES, SUBSCRIPTION_FREQUENCIES, SUBSCRIPTION_TYPES, TRANSACTION_TYPES } from '@bt/shared/types';
import { getCurrencyDecimals } from '@common/lib/currency-precision';
import { Money } from '@common/types/money';
import { t } from '@i18n/index';
import { CustomError, ValidationError } from '@js/errors';
import { logger } from '@js/utils/logger';
import Subscriptions from '@models/subscriptions.model';
import { calculateRefAmountFromParams } from '@services/calculate-ref-amount.service';
import { withTransaction } from '@services/common/with-transaction';
import { ensureUserBaseCurrency } from '@services/currencies/ensure-base-currency.service';
import { statsTransactions } from '@services/stats/stats-transactions';
import * as userExchangeRateService from '@services/user-exchange-rate';
import { endOfMonth, startOfMonth, subMonths } from 'date-fns';
import { Op } from 'sequelize';

export const INCOME_LOOKBACK_MONTHS_OPTIONS = [1, 3, 6, 12] as const;
type IncomeLookbackMonths = (typeof INCOME_LOOKBACK_MONTHS_OPTIONS)[number];
const DEFAULT_INCOME_LOOKBACK_MONTHS: IncomeLookbackMonths = 6;

const getAverageMonthlyIncome = async ({
  userId,
  lookbackMonths,
}: {
  userId: number;
  lookbackMonths: IncomeLookbackMonths;
}): Promise<Money> => {
  const now = new Date();
  const from = startOfMonth(subMonths(now, lookbackMonths));
  const to = endOfMonth(subMonths(now, 1));

  const { rows: incomeTxs } = await statsTransactions({
    access: { creator: userId },
    planned: 'exclude',
    refunds: 'ignore',
    window: { from, to },
    where: { transactionType: TRANSACTION_TYPES.income },
    attributes: ['refAmount'],
  });

  let total = Money.zero();
  for (const tx of incomeTxs) {
    total = total.add(tx.refAmount);
  }

  return total.divide(lookbackMonths);
};

const MONTHLY_MULTIPLIERS: Record<SUBSCRIPTION_FREQUENCIES, number> = {
  [SUBSCRIPTION_FREQUENCIES.weekly]: 4.33,
  [SUBSCRIPTION_FREQUENCIES.biweekly]: 2.17,
  [SUBSCRIPTION_FREQUENCIES.monthly]: 1,
  [SUBSCRIPTION_FREQUENCIES.quarterly]: 1 / 3,
  [SUBSCRIPTION_FREQUENCIES.semiAnnual]: 1 / 6,
  [SUBSCRIPTION_FREQUENCIES.annual]: 1 / 12,
};

interface GetSubscriptionsSummaryParams {
  userId: number;
  type?: SUBSCRIPTION_TYPES;
  lookbackMonths?: IncomeLookbackMonths;
}

const getSubscriptionsSummaryImpl = async ({
  userId,
  type,
  lookbackMonths = DEFAULT_INCOME_LOOKBACK_MONTHS,
}: GetSubscriptionsSummaryParams) => {
  const where: Record<string, unknown> = {
    userId,
    isActive: true,
    expectedAmount: { [Op.ne]: null },
    expectedCurrencyCode: { [Op.ne]: null },
  };
  if (type) where.type = type;

  const subscriptions = await Subscriptions.findAll({
    where,
    attributes: ['id', 'expectedAmount', 'expectedCurrencyCode', 'frequency', 'transactionType'],
  });

  // A user with no base currency row cannot have subscription amounts converted
  // into a reporting currency. Resolve (and self-heal a missing) base currency,
  // handing a subscription's own expected currency as the last-resort signal
  // when the user has no accounts or connected currencies to adopt from.
  const userCurrency = await ensureUserBaseCurrency({
    userId,
    fallbackCurrencyCode: subscriptions.find((sub) => sub.expectedCurrencyCode)?.expectedCurrencyCode ?? undefined,
  });

  const baseCurrencyCode = userCurrency.currency.code;

  let totalMonthlyCost = Money.zero();
  let totalMonthlyIncome = Money.zero();
  let activeExpenseCount = 0;
  let activeIncomeCount = 0;
  const unconnectedCurrencies = new Set<string>();

  // One rate lookup per distinct currency: every lookup queries the user's
  // currency connection before any cache, so a per-subscription call is an N+1.
  const now = new Date();
  const baseRates = new Map<string, number>();

  for (const sub of subscriptions) {
    const isIncome = sub.transactionType === TRANSACTION_TYPES.income;
    if (isIncome) {
      activeIncomeCount++;
    } else {
      activeExpenseCount++;
    }

    try {
      const currencyCode = sub.expectedCurrencyCode!;
      let rate = baseRates.get(currencyCode);
      if (rate === undefined) {
        ({ rate } = await userExchangeRateService.getExchangeRate({
          userId,
          date: now,
          baseCode: currencyCode,
          quoteCode: baseCurrencyCode,
        }));
        baseRates.set(currencyCode, rate);
      }
      const refAmount = calculateRefAmountFromParams({
        amount: sub.expectedAmount!,
        rate,
        baseDecimals: await getCurrencyDecimals({ userId, code: currencyCode }),
        quoteDecimals: await getCurrencyDecimals({ userId, code: baseCurrencyCode }),
      });

      const multiplier = MONTHLY_MULTIPLIERS[sub.frequency] ?? 1;
      const monthlyAmount = refAmount.multiply(multiplier);
      if (isIncome) {
        totalMonthlyIncome = totalMonthlyIncome.add(monthlyAmount);
      } else {
        totalMonthlyCost = totalMonthlyCost.add(monthlyAmount);
      }
    } catch (e) {
      // A currency the user never connected is user-fixable: collect every
      // offending code and fail the request with an actionable error below,
      // instead of silently understating the totals. Other conversion
      // failures (e.g. provider gaps) keep the skip-and-warn behavior.
      if (e instanceof CustomError && e.code === API_ERROR_CODES.currencyNotConnected && sub.expectedCurrencyCode) {
        unconnectedCurrencies.add(sub.expectedCurrencyCode);
      } else {
        logger.warn(`Skipping subscription ${sub.id} in summary: currency conversion failed`, {
          currencyCode: sub.expectedCurrencyCode,
          error: e,
        });
      }
    }
  }

  if (unconnectedCurrencies.size > 0) {
    const currencyCodes = [...unconnectedCurrencies];
    throw new ValidationError({
      code: API_ERROR_CODES.currencyNotConnected,
      message: t({
        key: 'subscriptions.summaryCurrencyNotConnected',
        variables: { currencyCodes: currencyCodes.join(', ') },
      }),
      details: { currencyCodes },
    });
  }

  const monthlyCostMoney = totalMonthlyCost.round();
  const yearlyCostMoney = monthlyCostMoney.multiply(12);
  const monthlyIncomeMoney = totalMonthlyIncome.round();

  const averageMonthlyIncomeMoney = await getAverageMonthlyIncome({ userId, lookbackMonths });
  const averageMonthlyIncome = averageMonthlyIncomeMoney.toNumber();
  const percentOfIncome =
    averageMonthlyIncome > 0 ? Math.round((monthlyCostMoney.toNumber() / averageMonthlyIncome) * 1000) / 10 : null;

  return {
    estimatedMonthlyCost: monthlyCostMoney.toNumber(),
    projectedYearlyCost: yearlyCostMoney.toNumber(),
    expectedMonthlyIncome: monthlyIncomeMoney.toNumber(),
    activeCount: { expense: activeExpenseCount, income: activeIncomeCount },
    currencyCode: baseCurrencyCode,
    averageMonthlyIncome,
    percentOfIncome,
    lookbackMonths,
  };
};

export const getSubscriptionsSummary = withTransaction(getSubscriptionsSummaryImpl);
