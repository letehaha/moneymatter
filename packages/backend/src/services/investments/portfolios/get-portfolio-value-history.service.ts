import type { PortfolioValueHistoryModel } from '@bt/shared/types';
import { INVESTMENT_TRANSACTION_CATEGORY } from '@bt/shared/types/investments';
import { Money } from '@common/types/money';
import { toUtcDateString } from '@common/utils/date';
import { findOrThrowNotFound } from '@common/utils/find-or-throw-not-found';
import { t } from '@i18n/index';
import { logger } from '@js/utils';
import InvestmentTransaction from '@models/investments/investment-transaction.model';
import PortfolioTransfers from '@models/investments/portfolio-transfers.model';
import Portfolios from '@models/investments/portfolios.model';
import * as UsersCurrencies from '@models/users-currencies.model';
import { calculateRealizedGains } from '@services/investments/gains/gains-calculator.utils';
import { computeHoldingTotals } from '@services/investments/holdings/holding-totals';
import type { SecurityRow } from '@services/stats/get-combined-balance-history/types';
import { buildDenseDateRange } from '@services/stats/get-net-worth-drivers/date-range';
import {
  replayPortfolioValuation,
  type ValuationTransactionRow,
} from '@services/stats/get-net-worth-history/portfolio-value';
import { Big } from 'big.js';
import { format } from 'date-fns';
import { Op } from 'sequelize';

/** One security's cost basis and cumulative FIFO realized gain, in its own currency, at the end of each trading day. */
interface SecurityTimeline {
  currencyCode: string;
  entries: { day: string; costBasis: number; realizedGain: number }[];
}

// Same calculators the summary reads, run on each trading day's prefix, so the
// latest point matches the summary.
const buildSecurityTimelines = ({
  transactions,
  securitiesById,
}: {
  transactions: ValuationTransactionRow[];
  securitiesById: Map<string, SecurityRow>;
}): SecurityTimeline[] =>
  // ponytail: O(n²) per security via prefix replays; fold incrementally if a security reaches thousands of trades
  Array.from(
    Map.groupBy(transactions, (tx) => tx.securityId),
    ([securityId, txs]) => {
      const timeline: SecurityTimeline = {
        currencyCode: securitiesById.get(securityId)?.currencyCode ?? txs[0]!.currencyCode,
        entries: [],
      };
      let realizedGain = 0;
      let soldToday = false;

      txs.forEach((tx, index) => {
        const day = toUtcDateString(tx.date);
        soldToday ||= tx.category === INVESTMENT_TRANSACTION_CATEGORY.sell;
        const next = txs[index + 1];
        if (next && toUtcDateString(next.date) === day) return;

        const prefix = txs.slice(0, index + 1);
        if (soldToday) realizedGain = calculateRealizedGains(prefix).realizedGainValue;
        soldToday = false;

        const { costBasis } = computeHoldingTotals({
          transactions: prefix.map((leg) => ({
            category: leg.category,
            quantity: new Big(leg.quantity),
            amount: new Big(leg.amount),
            refAmount: new Big(leg.refAmount),
          })),
        });
        timeline.entries.push({ day, costBasis: costBasis.toNumber(), realizedGain });
      });

      return timeline;
    },
  );

const resolveFirstEventDate = async ({ portfolioId }: { portfolioId: string }): Promise<string | null> => {
  const [oldestTransaction, oldestTransfer] = await Promise.all([
    InvestmentTransaction.findOne({
      where: { portfolioId },
      order: [['date', 'ASC']],
      attributes: ['date'],
      raw: true,
    }),
    PortfolioTransfers.findOne({
      where: { [Op.or]: [{ fromPortfolioId: portfolioId }, { toPortfolioId: portfolioId }] },
      order: [['date', 'ASC']],
      attributes: ['date'],
      raw: true,
    }),
  ]);

  return (
    [oldestTransaction && toUtcDateString(oldestTransaction.date), oldestTransfer?.date]
      .filter((date): date is string => !!date)
      .toSorted()[0] ?? null
  );
};

const toDecimalString = (amount: number): string => Money.fromDecimal(amount).toNumber().toFixed(2);

/**
 * Daily portfolio value in the summary's currency. Cost basis and realized gain
 * are converted at each day's rate, as the summary converts them at today's.
 */
export const getPortfolioValueHistory = async ({
  userId,
  portfolioId,
  from,
  to,
}: {
  userId: number;
  portfolioId: string;
  from?: string;
  to?: string;
}): Promise<PortfolioValueHistoryModel> => {
  const portfolio = await findOrThrowNotFound({
    query: Portfolios.findOne({ where: { id: portfolioId, userId } }),
    message: t({ key: 'investments.portfolioNotFound' }),
  });

  const userCurrency = await findOrThrowNotFound({
    query: UsersCurrencies.getCurrency({ userId, isDefaultCurrency: true }),
    message: t({ key: 'investments.userBaseCurrencyNotFound' }),
  });
  const baseCurrencyCode = userCurrency.currency.code;
  let currencyCode = portfolio.displayCurrencyCode ?? baseCurrencyCode;

  const todayKey = format(new Date(), 'yyyy-MM-dd');
  const endDate = to && to < todayKey ? to : todayKey;
  // Days before the first event are all zero, so they are never emitted.
  const firstEventDate = await resolveFirstEventDate({ portfolioId });
  const startDate = firstEventDate ? (from && from > firstEventDate ? from : firstEventDate) : endDate;
  const dates = buildDenseDateRange({ boundaryDates: [startDate < endDate ? startDate : endDate, endDate] });

  const valuation = await replayPortfolioValuation({
    userId,
    portfolioIds: [portfolioId],
    baseCurrencyCode,
    snapshotDates: dates,
    denseDates: dates,
    extraCurrencyCodes: [currencyCode],
    floorHoldingValues: false,
  });

  if (!valuation) {
    return {
      currencyCode,
      points: dates.map((date) => ({
        date,
        totalValue: '0.00',
        holdingsValue: '0.00',
        cashValue: '0.00',
        costBasis: '0.00',
        realizedGain: '0.00',
      })),
    };
  }

  const { transactions, securitiesById, holdingsValueByDate, cashInBaseByDate, getExchangeRate } = valuation;

  // A currency lands in `missingRateCurrencies` only when no rate is stored for it at all, so probing a
  // single day decides the whole series: fall back to the base currency rather than convert 1:1.
  if (currencyCode !== baseCurrencyCode) {
    getExchangeRate(currencyCode, endDate);
    if (valuation.missingRateCurrencies.delete(currencyCode)) currencyCode = baseCurrencyCode;
  }

  const timelines = buildSecurityTimelines({ transactions, securitiesById });
  const cursors = timelines.map(() => -1);

  const points = dates.map((date) => {
    let costBasis = 0;
    let realizedGain = 0;
    timelines.forEach(({ currencyCode: securityCurrency, entries }, index) => {
      let cursor = cursors[index]!;
      while (cursor + 1 < entries.length && entries[cursor + 1]!.day <= date) cursor += 1;
      cursors[index] = cursor;
      const entry = entries[cursor];
      if (!entry) return;
      const rate = getExchangeRate(securityCurrency, date);
      costBasis += entry.costBasis * rate;
      realizedGain += entry.realizedGain * rate;
    });

    const toDisplayRate = currencyCode === baseCurrencyCode ? 1 : 1 / getExchangeRate(currencyCode, date);
    const holdingsValue = toDecimalString((holdingsValueByDate.get(date) ?? 0) * toDisplayRate);
    const cashValue = toDecimalString((cashInBaseByDate.get(date) ?? 0) * toDisplayRate);

    return {
      date,
      totalValue: toDecimalString(Number(holdingsValue) + Number(cashValue)),
      holdingsValue,
      cashValue,
      costBasis: toDecimalString(costBasis * toDisplayRate),
      realizedGain: toDecimalString(realizedGain * toDisplayRate),
    };
  });

  if (valuation.missingRateCurrencies.size > 0) {
    logger.error('Portfolio value history exchange rate fallback to 1:1', {
      userId,
      portfolioId,
      baseCurrency: baseCurrencyCode,
      currencies: Array.from(valuation.missingRateCurrencies),
    });
  }

  if (valuation.unpricedSecurityIds.size > 0) {
    logger.info('Portfolio value history valued holdings at cost basis for unpriced days', {
      userId,
      portfolioId,
      unpricedSecurityIds: Array.from(valuation.unpricedSecurityIds),
    });
  }

  return { currencyCode, points };
};
