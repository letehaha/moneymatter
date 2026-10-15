import { Money } from '@common/types/money';
import { findOrThrowNotFound } from '@common/utils/find-or-throw-not-found';
import { t } from '@i18n/index';
import { logger } from '@js/utils';
import PortfolioBalances from '@models/investments/portfolio-balances.model';
import Portfolios from '@models/investments/portfolios.model';
import * as UsersCurrencies from '@models/users-currencies.model';
import { calculateRefAmountFromParams } from '@services/calculate-ref-amount.service';
import { withTransaction } from '@services/common/with-transaction';
import { getHoldingValues } from '@services/investments/holdings/get-holding-values.service';
import * as userExchangeRateService from '@services/user-exchange-rate';

interface GetPortfolioSummaryParams {
  userId: number;
  portfolioId: string;
  date?: Date;
}

interface PortfolioSummaryResult {
  portfolioId: string;
  portfolioName: string;
  totalCurrentValue: string;
  totalCostBasis: string;
  unrealizedGainValue: string;
  unrealizedGainPercent: string;
  realizedGainValue: string;
  realizedGainPercent: string;
  currencyCode: string; // Portfolio's displayCurrencyCode, or user's base currency when unset
  totalCashInBaseCurrency: string;
  availableCashInBaseCurrency: string;
  totalPortfolioValue: string; // Holdings value + cash
  baseCurrencyCode: string; // User's base currency, regardless of display currency
  // Holdings value + cash in the user's base currency; equals totalPortfolioValue when no display currency is set
  totalPortfolioValueInBaseCurrency: string;
}

/**
 * Resolves the summary's display currency code and the base→display rate for the
 * requested date. Falls back to the base currency when the display currency is
 * unset, equal to base, not connected to the user, or its rate is unavailable.
 */
const resolveDisplayCurrency = async ({
  userId,
  portfolio,
  baseCurrencyCode,
  date,
}: {
  userId: number;
  portfolio: Portfolios;
  baseCurrencyCode: string;
  date: Date;
}): Promise<{ code: string; rate: number }> => {
  const displayCode = portfolio.displayCurrencyCode;

  if (!displayCode || displayCode === baseCurrencyCode) {
    return { code: baseCurrencyCode, rate: 1 };
  }

  const connectedCurrency = await UsersCurrencies.getCurrency({ userId, currencyCode: displayCode });
  if (!connectedCurrency) {
    logger.warn(
      'Portfolio displayCurrencyCode is no longer connected to the user; summary falls back to base currency',
      {
        portfolioId: portfolio.id,
        displayCurrencyCode: displayCode,
      },
    );
    return { code: baseCurrencyCode, rate: 1 };
  }

  try {
    const { rate } = await userExchangeRateService.getExchangeRate({
      userId,
      date,
      baseCode: baseCurrencyCode,
      quoteCode: displayCode,
    });

    return { code: displayCode, rate };
  } catch (error) {
    logger.error('Failed to resolve display currency rate; summary falls back to base currency', {
      portfolioId: portfolio.id,
      displayCurrencyCode: displayCode,
      error,
    });
    return { code: baseCurrencyCode, rate: 1 };
  }
};

const getPortfolioSummaryImpl = async ({
  userId,
  portfolioId,
  date,
}: GetPortfolioSummaryParams): Promise<PortfolioSummaryResult> => {
  // Verify portfolio exists and belongs to user
  const portfolio = await findOrThrowNotFound({
    query: Portfolios.findOne({
      where: { id: portfolioId, userId },
    }),
    message: t({ key: 'investments.portfolioNotFound' }),
  });

  // Get user's base currency
  const userCurrency = await findOrThrowNotFound({
    query: UsersCurrencies.getCurrency({
      userId,
      isDefaultCurrency: true,
    }),
    message: t({ key: 'investments.userBaseCurrencyNotFound' }),
  });

  const baseCurrencyCode = userCurrency.currency.code;

  const conversionDate = date || new Date();
  const display = await resolveDisplayCurrency({ userId, portfolio, baseCurrencyCode, date: conversionDate });
  const toDisplay = (amount: Money): string =>
    calculateRefAmountFromParams({ amount, rate: display.rate }).toNumber().toFixed(2);

  // Fetch portfolio cash balances across all currencies
  const balances = await PortfolioBalances.findAll({
    where: { portfolioId },
  });

  let totalCashInBase = Money.zero();
  let availableCashInBase = Money.zero();

  for (const balance of balances) {
    totalCashInBase = totalCashInBase.add(balance.refTotalCash);
    availableCashInBase = availableCashInBase.add(balance.refAvailableCash);
  }

  // Get all holdings with their gain/loss calculations
  const holdings = await getHoldingValues({ portfolioId, date, userId });

  if (holdings.length === 0) {
    // Return zero values for holdings but include cash
    return {
      portfolioId,
      portfolioName: portfolio.name,
      totalCurrentValue: '0.00',
      totalCostBasis: '0.00',
      unrealizedGainValue: '0.00',
      unrealizedGainPercent: '0.00',
      realizedGainValue: '0.00',
      realizedGainPercent: '0.00',
      currencyCode: display.code,
      totalCashInBaseCurrency: toDisplay(totalCashInBase),
      availableCashInBaseCurrency: toDisplay(availableCashInBase),
      totalPortfolioValue: toDisplay(totalCashInBase),
      baseCurrencyCode,
      totalPortfolioValueInBaseCurrency: totalCashInBase.toNumber().toFixed(2),
    };
  }

  // Aggregate everything in the user's base currency at `conversionDate`
  let totalCurrentValueInBase = Money.zero();
  let totalCostBasisInBase = Money.zero();
  let totalUnrealizedGainInBase = Money.zero();
  let totalRealizedGainInBase = Money.zero();

  // One rate lookup per distinct holding currency: every lookup queries the user's
  // currency connection before any cache, so a per-holding call is an N+1.
  const baseRates = new Map<string, number>();
  for (const h of holdings) if (h.baseRate !== undefined) baseRates.set(h.currencyCode, h.baseRate);
  const toBase = async ({ amount, currencyCode }: { amount: Money; currencyCode: string }): Promise<Money> => {
    let rate = baseRates.get(currencyCode);
    if (rate === undefined) {
      ({ rate } = await userExchangeRateService.getExchangeRate({
        userId,
        date: conversionDate,
        baseCode: currencyCode,
        quoteCode: baseCurrencyCode,
        requireUserConnection: false,
      }));
      baseRates.set(currencyCode, rate);
    }
    return calculateRefAmountFromParams({ amount, rate });
  };

  for (const holding of holdings) {
    const marketValueInBase = Money.fromDecimal(holding.refMarketValue || '0');

    // Cost basis is converted at the same date as the market value, so the unrealized
    // gain reflects one FX rate instead of mixing today's rate with historical ones.
    const costBasisInBase = await toBase({
      amount: Money.fromDecimal(holding.costBasis || '0'),
      currencyCode: holding.currencyCode,
    });

    const unrealizedGainInBase = marketValueInBase.subtract(costBasisInBase);

    const realizedGainInBase = await toBase({
      amount: Money.fromDecimal(holding.realizedGainValue || '0'),
      currencyCode: holding.currencyCode,
    });

    totalCurrentValueInBase = totalCurrentValueInBase.add(marketValueInBase);
    totalCostBasisInBase = totalCostBasisInBase.add(costBasisInBase);
    totalUnrealizedGainInBase = totalUnrealizedGainInBase.add(unrealizedGainInBase);
    totalRealizedGainInBase = totalRealizedGainInBase.add(realizedGainInBase);
  }

  // Calculate percentages
  const costBasisNum = totalCostBasisInBase.toNumber();
  const unrealizedGainPercent = costBasisNum !== 0 ? (totalUnrealizedGainInBase.toNumber() / costBasisNum) * 100 : 0;

  const realizedGainPercent = costBasisNum !== 0 ? (totalRealizedGainInBase.toNumber() / costBasisNum) * 100 : 0;

  return {
    portfolioId,
    portfolioName: portfolio.name,
    totalCurrentValue: toDisplay(totalCurrentValueInBase),
    totalCostBasis: toDisplay(totalCostBasisInBase),
    unrealizedGainValue: toDisplay(totalUnrealizedGainInBase),
    unrealizedGainPercent: unrealizedGainPercent.toFixed(2),
    realizedGainValue: toDisplay(totalRealizedGainInBase),
    realizedGainPercent: realizedGainPercent.toFixed(2),
    currencyCode: display.code,
    totalCashInBaseCurrency: toDisplay(totalCashInBase),
    availableCashInBaseCurrency: toDisplay(availableCashInBase),
    totalPortfolioValue: toDisplay(totalCurrentValueInBase.add(totalCashInBase)),
    baseCurrencyCode,
    totalPortfolioValueInBaseCurrency: totalCurrentValueInBase.add(totalCashInBase).toNumber().toFixed(2),
  };
};

export const getPortfolioSummary = withTransaction(getPortfolioSummaryImpl);
