import { INVESTMENT_TRANSACTION_CATEGORY } from '@bt/shared/types/investments';
import { INVESTMENT_DECIMAL_SCALE, Money } from '@common/types/money';
import { logger } from '@js/utils';
import Holdings from '@models/investments/holdings.model';
import InvestmentTransaction from '@models/investments/investment-transaction.model';
import Portfolios from '@models/investments/portfolios.model';
import Securities from '@models/investments/securities.model';
import SecurityPricing from '@models/investments/security-pricing.model';
import * as UsersCurrencies from '@models/users-currencies.model';
import { calculateRefAmountFromParams } from '@services/calculate-ref-amount.service';
import { withDeduplication } from '@services/common/with-deduplication';
import { calculateAllGains } from '@services/investments/gains/gains-calculator.utils';
import * as userExchangeRateService from '@services/user-exchange-rate';
import { Op, WhereOptions, fn, col } from 'sequelize';

interface GetHoldingValuesParams {
  portfolioId: string;
  date?: Date; // If not provided, uses latest available prices
  userId?: number; // For reference currency conversion
}

/**
 * Raw (`raw: true`) projection of `InvestmentTransactions` for the FIFO gains
 * calculation. DECIMAL columns are Postgres decimal strings; `date` is a
 * driver-parsed `Date` (TIMESTAMPTZ).
 */
interface GainsTransactionRow {
  securityId: string;
  date: Date;
  category: INVESTMENT_TRANSACTION_CATEGORY;
  /** DECIMAL(36,18) string. */
  quantity: string;
  /** DECIMAL(20,10) strings. */
  price: string;
  fees: string;
}

interface HoldingValue {
  portfolioId: string;
  securityId: string;
  quantity: string;
  costBasis: string;
  refCostBasis: string;
  currencyCode: string;
  excluded: boolean;
  security?: Securities;
  // Calculated fields
  latestPrice?: string;
  priceDate?: Date;
  marketValue?: string;
  refMarketValue?: string;
  // Gain/Loss fields
  unrealizedGainValue?: string;
  unrealizedGainPercent?: string;
  realizedGainValue?: string;
  realizedGainPercent?: string;
  // Present only when the portfolio has a displayCurrencyCode; percent fields are ratios and need no conversion
  displayCurrencyCode?: string;
  displayCostBasis?: string;
  displayMarketValue?: string;
  displayUnrealizedGainValue?: string;
  displayRealizedGainValue?: string;
  // Internal: holding→base rate already resolved here; not part of the holdings API response
  baseRate?: number;
}

/**
 * Gets holdings with dynamically calculated market values based on prices.
 * This replaces the need to store stale value fields in the Holdings model.
 */
const getHoldingValuesImpl = async ({ portfolioId, date, userId }: GetHoldingValuesParams): Promise<HoldingValue[]> => {
  // Get all holdings for the portfolio
  const holdings = await Holdings.findAll({
    where: { portfolioId },
    include: [
      {
        model: Securities,
        as: 'security',
        required: true,
      },
    ],
  });

  if (holdings.length === 0) {
    return [];
  }

  const securityIds = holdings.map((h) => h.securityId);

  // Get all investment transactions for these securities in this portfolio.
  // `raw: true` + narrow attributes on purpose: this is the portfolio's full,
  // unbounded trade history and the rows only feed the FIFO gains math below —
  // hydrating a Money object per money column per row is avoidable memory
  // pressure on a dashboard-hot path. DECIMAL columns arrive as strings, which
  // is exactly what `calculateAllGains` accepts.
  const transactions = (await InvestmentTransaction.findAll({
    where: {
      portfolioId,
      securityId: { [Op.in]: securityIds },
    },
    // Chronological order for FIFO calculations. `date` is a TIMESTAMPTZ so
    // same-day trades order by their actual time; `createdAt` is the tiebreaker
    // for trades sharing an exact instant (e.g. two date-only imports stored at
    // UTC midnight), matching the cost-basis and balance-history replays.
    order: [
      ['date', 'ASC'],
      ['createdAt', 'ASC'],
    ],
    attributes: ['securityId', 'date', 'category', 'quantity', 'price', 'fees'],
    raw: true,
  })) as unknown as GainsTransactionRow[];

  // Group transactions by securityId
  const transactionsBySecurityId = transactions.reduce(
    (acc, transaction) => {
      if (!acc[transaction.securityId]) {
        acc[transaction.securityId] = [];
      }
      acc[transaction.securityId]!.push(transaction);
      return acc;
    },
    {} as Record<string, GainsTransactionRow[]>,
  );

  // Build price query - fetch only the latest price per security
  const priceWhere: WhereOptions = {
    securityId: { [Op.in]: securityIds },
  };

  if (date) {
    priceWhere.date = { [Op.lte]: date };
  }

  // Step 1: Get the latest price date for each security (fast GROUP BY on index)
  const latestPriceDates = (await SecurityPricing.findAll({
    where: priceWhere,
    attributes: ['securityId', [fn('MAX', col('date')), 'date']],
    group: ['securityId'],
    raw: true,
  })) as unknown as Array<{ securityId: string; date: string }>;

  // Step 2: Fetch only those specific price rows (exactly 1 per security)
  const prices =
    latestPriceDates.length > 0
      ? await SecurityPricing.findAll({
          where: {
            [Op.or]: latestPriceDates.map((pd) => ({
              securityId: pd.securityId,
              date: pd.date,
            })),
          },
        })
      : [];

  const pricesBySecurityId = Object.fromEntries(prices.map((price) => [price.securityId, price])) as Record<
    string,
    SecurityPricing
  >;

  // Base and display rates are resolved once per distinct holding currency below:
  // every rate lookup queries the user's currency connection before any cache,
  // so a per-holding call is an N+1 on GET /portfolios/*/summary.
  let baseCurrencyCode: string | undefined;
  let displayCurrencyCode: string | undefined;
  if (userId) {
    const userCurrency = await UsersCurrencies.getCurrency({ userId, isDefaultCurrency: true });
    baseCurrencyCode = userCurrency?.currency.code;

    // Display currency applies only while it stays connected to the user; otherwise holdings carry no display fields.
    const portfolio = await Portfolios.findByPk(portfolioId);
    if (portfolio?.displayCurrencyCode) {
      const connected = await UsersCurrencies.getCurrency({ userId, currencyCode: portfolio.displayCurrencyCode });
      if (connected) displayCurrencyCode = portfolio.displayCurrencyCode;
    }
  }

  // A failed base-rate lookup is cached as null so those holdings report refMarketValue 0.
  const baseRates = new Map<string, number | null>();
  const getBaseRate = async (holdingCurrencyCode: string): Promise<number | null> => {
    if (!baseCurrencyCode || !userId) return null;
    if (!baseRates.has(holdingCurrencyCode)) {
      try {
        const { rate } = await userExchangeRateService.getExchangeRate({
          userId,
          date: date || new Date(),
          baseCode: holdingCurrencyCode,
          quoteCode: baseCurrencyCode,
          requireUserConnection: false,
        });
        baseRates.set(holdingCurrencyCode, rate);
      } catch (error) {
        logger.error('Failed to resolve holding base rate; refMarketValue defaults to 0', {
          portfolioId,
          holdingCurrencyCode,
          baseCurrencyCode,
          error,
        });
        baseRates.set(holdingCurrencyCode, null);
      }
    }
    return baseRates.get(holdingCurrencyCode)!;
  };

  // A failed display-rate lookup is cached as null so those holdings omit display fields.
  const displayRates = new Map<string, number | null>();
  const getDisplayRate = async (holdingCurrencyCode: string): Promise<number | null> => {
    if (!displayCurrencyCode || !userId) return null;
    if (holdingCurrencyCode === displayCurrencyCode) return 1;
    if (!displayRates.has(holdingCurrencyCode)) {
      try {
        const { rate } = await userExchangeRateService.getExchangeRate({
          userId,
          date: date || new Date(),
          baseCode: holdingCurrencyCode,
          quoteCode: displayCurrencyCode,
          requireUserConnection: false,
        });
        displayRates.set(holdingCurrencyCode, rate);
      } catch (error) {
        logger.error('Failed to resolve holding display rate; holding omits display fields', {
          portfolioId,
          holdingCurrencyCode,
          displayCurrencyCode,
          error,
        });
        displayRates.set(holdingCurrencyCode, null);
      }
    }
    return displayRates.get(holdingCurrencyCode)!;
  };

  // oxlint-disable-next-line unicorn/consistent-function-scoping
  const toDisplay = ({ decimal, rate }: { decimal: string; rate: number }): string =>
    calculateRefAmountFromParams({ amount: Money.fromDecimal(decimal), rate })
      .toNumber()
      .toFixed(2);

  // Calculate market values for each holding
  const holdingValues: HoldingValue[] = [];

  for (const holding of holdings) {
    const price = pricesBySecurityId[holding.securityId];
    const quantity = holding.quantity.toBig();

    let marketValue = '0';
    let refMarketValue = '0';
    let latestPrice: string | undefined;
    let priceDate: Date | undefined;
    let baseRate: number | null = null;

    if (price) {
      latestPrice = price.priceClose.toDecimalString(INVESTMENT_DECIMAL_SCALE);
      priceDate = price.date;
      const priceClose = price.priceClose.toBig();
      marketValue = quantity.times(priceClose).toFixed(10);

      if (parseFloat(marketValue) > 0) {
        baseRate = await getBaseRate(holding.currencyCode);
        if (baseRate !== null) {
          refMarketValue = calculateRefAmountFromParams({
            amount: Money.fromDecimal(marketValue),
            rate: baseRate,
          }).toDecimalString(INVESTMENT_DECIMAL_SCALE);
        }
      }
    }

    // Calculate gains/losses
    const securityTransactions = transactionsBySecurityId[holding.securityId] || [];
    const gains = calculateAllGains(
      parseFloat(marketValue),
      holding.costBasis.toNumber(),
      // Raw rows: quantity/price/fees are already decimal strings, the exact
      // shape `TransactionForGains` accepts.
      securityTransactions,
    );

    const displayRate = await getDisplayRate(holding.currencyCode);

    holdingValues.push({
      portfolioId: holding.portfolioId,
      securityId: holding.securityId,
      quantity: holding.quantity.toDecimalString(INVESTMENT_DECIMAL_SCALE),
      costBasis: holding.costBasis.toDecimalString(INVESTMENT_DECIMAL_SCALE),
      refCostBasis: holding.refCostBasis.toDecimalString(INVESTMENT_DECIMAL_SCALE),
      currencyCode: holding.currencyCode,
      excluded: holding.excluded,
      security: holding.security,
      latestPrice,
      priceDate,
      marketValue,
      refMarketValue,
      unrealizedGainValue: gains.unrealizedGainValue.toFixed(2),
      unrealizedGainPercent: gains.unrealizedGainPercent.toFixed(2),
      realizedGainValue: gains.realizedGainValue.toFixed(2),
      realizedGainPercent: gains.realizedGainPercent.toFixed(2),
      ...(baseRate !== null && { baseRate }),
      ...(displayRate !== null && {
        displayCurrencyCode,
        displayCostBasis: toDisplay({
          decimal: holding.costBasis.toDecimalString(INVESTMENT_DECIMAL_SCALE),
          rate: displayRate,
        }),
        displayMarketValue: toDisplay({ decimal: marketValue, rate: displayRate }),
        displayUnrealizedGainValue: toDisplay({ decimal: gains.unrealizedGainValue.toFixed(2), rate: displayRate }),
        displayRealizedGainValue: toDisplay({ decimal: gains.realizedGainValue.toFixed(2), rate: displayRate }),
      }),
    });
  }

  return holdingValues;
};

// Do not call `withTransaction` here because it's fundamentally not compatible
// with `withDeduplication`. Also on 99.99% `withTransaction` will already be
// defined on the level above, since this service is not really callable alone
// It also doesn't really update anything in the DB, so even if it will be called without
// `withTransaction` and something fails, we don't really need to undo anything, since there's nothing to undo

export const getHoldingValues = withDeduplication(getHoldingValuesImpl, {
  keyGenerator: ({ portfolioId, date, userId }) =>
    `holdings-${portfolioId}-${userId || 'no-user'}-${date?.toISOString() || 'latest'}`,
  ttl: 1000, // 1 second cache to handle concurrent requests, yet not that much to be stale
  maxCacheSize: 5, // Reasonable limit for portfolio operations. It's not expected to have huge amount of calls
});
