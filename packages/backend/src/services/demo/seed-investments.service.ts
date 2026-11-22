import {
  ACCOUNT_TYPES,
  PAYMENT_TYPES,
  TRANSACTION_TRANSFER_NATURE,
  TRANSACTION_TYPES,
  USER_ROLES,
} from '@bt/shared/types';
import {
  ASSET_CLASS,
  INVESTMENT_TRANSACTION_CATEGORY,
  PORTFOLIO_TYPE,
  SECURITY_PROVIDER,
} from '@bt/shared/types/investments';
import { Money } from '@common/types/money';
import { logger } from '@js/utils/logger';
import { connection } from '@models/index';
import Holdings from '@models/investments/holdings.model';
import InvestmentTransaction from '@models/investments/investment-transaction.model';
import PortfolioBalances from '@models/investments/portfolio-balances.model';
import PortfolioTransfers from '@models/investments/portfolio-transfers.model';
import Portfolios from '@models/investments/portfolios.model';
import Securities from '@models/investments/securities.model';
import SecurityPricing from '@models/investments/security-pricing.model';
import Transactions from '@models/transactions.model';
import { findSecurityByIdentity } from '@services/investments/securities/identity';
import { Big } from 'big.js';
import { addMonths, format, subDays } from 'date-fns';
import { QueryTypes, type Transaction } from 'sequelize';
import { v7 as uuidv7 } from 'uuid';

import { DEMO_CONFIG } from './demo-config';
import { fitPurchaseToPrices } from './fit-purchase-to-prices';
import { type ContributionPlan, type DemoContributionConfig, resolveContributions } from './investment-contributions';

interface DemoSecurityConfig {
  symbol: string;
  providerSymbol: string;
  name: string;
  assetClass: ASSET_CLASS;
  providerName: SECURITY_PROVIDER;
  currencyCode: string;
  cryptoCurrencyCode?: string | null;
  exchangeAcronym?: string | null;
  exchangeMic?: string | null;
  exchangeName?: string | null;
  /**
   * Logo shown in the holdings UI. Stocks leave this null and the frontend
   * derives a logo.dev URL from the ticker (needs VITE_LOGO_DEV_TOKEN); crypto
   * stores the CoinGecko CDN URL the live sync would produce, so demo crypto
   * logos render even without a logo.dev token configured.
   */
  logoUrl?: string | null;
  currentPrice: number;
  purchasePrice: number;
  quantity: number;
  purchaseDaysAgo: number;
}

const DEMO_SECURITIES: DemoSecurityConfig[] = [
  {
    symbol: 'AAPL',
    providerSymbol: 'AAPL',
    name: 'Apple Inc.',
    assetClass: ASSET_CLASS.stocks,
    providerName: SECURITY_PROVIDER.yahoo,
    currencyCode: 'USD',
    exchangeAcronym: 'NASDAQ',
    exchangeMic: 'XNAS',
    exchangeName: 'NASDAQ',
    currentPrice: 185.5,
    purchasePrice: 150.0,
    quantity: 10,
    purchaseDaysAgo: 640,
  },
  {
    symbol: 'VOO',
    providerSymbol: 'VOO',
    name: 'Vanguard S&P 500 ETF',
    assetClass: ASSET_CLASS.stocks,
    providerName: SECURITY_PROVIDER.yahoo,
    currencyCode: 'USD',
    exchangeAcronym: 'NYSEARCA',
    exchangeMic: 'ARCX',
    exchangeName: 'NYSE Arca',
    currentPrice: 480.25,
    purchasePrice: 410.0,
    quantity: 5,
    purchaseDaysAgo: 900,
  },
  {
    symbol: 'MSFT',
    providerSymbol: 'MSFT',
    name: 'Microsoft Corporation',
    assetClass: ASSET_CLASS.stocks,
    providerName: SECURITY_PROVIDER.yahoo,
    currencyCode: 'USD',
    exchangeAcronym: 'NASDAQ',
    exchangeMic: 'XNAS',
    exchangeName: 'NASDAQ',
    currentPrice: 415.75,
    purchasePrice: 370.0,
    quantity: 8,
    purchaseDaysAgo: 420,
  },
];

// CoinGecko-sourced crypto holdings. `providerSymbol` is the CoinGecko coin id
// (what the price-sync pipeline queries), while `symbol`/`cryptoCurrencyCode`
// hold the ticker. Shape mirrors `coingecko-provider.ts` so the demo holdings
// are indistinguishable from a real synced crypto security.
const DEMO_CRYPTO: DemoSecurityConfig[] = [
  {
    symbol: 'BTC',
    providerSymbol: 'bitcoin',
    name: 'Bitcoin',
    assetClass: ASSET_CLASS.crypto,
    providerName: SECURITY_PROVIDER.coingecko,
    currencyCode: 'USD',
    cryptoCurrencyCode: 'BTC',
    exchangeName: 'CoinGecko',
    logoUrl: 'https://coin-images.coingecko.com/coins/images/1/small/bitcoin.png',
    currentPrice: 67500,
    purchasePrice: 42000,
    quantity: 0.15,
    purchaseDaysAgo: 820,
  },
  {
    symbol: 'ETH',
    providerSymbol: 'ethereum',
    name: 'Ethereum',
    assetClass: ASSET_CLASS.crypto,
    providerName: SECURITY_PROVIDER.coingecko,
    currencyCode: 'USD',
    cryptoCurrencyCode: 'ETH',
    exchangeName: 'CoinGecko',
    logoUrl: 'https://coin-images.coingecko.com/coins/images/279/small/ethereum.png',
    currentPrice: 3500,
    purchasePrice: 2400,
    quantity: 2,
    purchaseDaysAgo: 560,
  },
  {
    symbol: 'SOL',
    providerSymbol: 'solana',
    name: 'Solana',
    assetClass: ASSET_CLASS.crypto,
    providerName: SECURITY_PROVIDER.coingecko,
    currencyCode: 'USD',
    cryptoCurrencyCode: 'SOL',
    exchangeName: 'CoinGecko',
    logoUrl: 'https://coin-images.coingecko.com/coins/images/4128/small/solana.png',
    currentPrice: 145,
    purchasePrice: 95,
    quantity: 25,
    purchaseDaysAgo: 300,
  },
];

const DEMO_INVESTMENT_STARTING_CASH = 5000;
const DEMO_CRYPTO_STARTING_CASH = 1500;

interface DemoPortfolioPlan {
  name: string;
  description: string;
  securities: DemoSecurityConfig[];
  /** Cash left sitting in the portfolio after every buy has settled. */
  endingCash: number;
  contributions: DemoContributionConfig[];
}

// Each portfolio's funding lands a few weeks ahead of the buy it pays for, so the
// cash balance never dips below zero when the trades are replayed in date order.
const DEMO_PORTFOLIO_PLANS: DemoPortfolioPlan[] = [
  {
    name: 'Growth Portfolio',
    description: 'Demo portfolio of US equities and ETFs',
    securities: DEMO_SECURITIES,
    endingCash: DEMO_INVESTMENT_STARTING_CASH,
    contributions: [
      { daysAgo: 950, share: 0.22, description: 'Brokerage account funding' },
      { daysAgo: 700, share: 0.17, description: 'Monthly investing transfer' },
      { daysAgo: 500, share: 0.26, description: 'Monthly investing transfer' },
      { daysAgo: 300, share: 0.17, description: 'Monthly investing transfer' },
      { daysAgo: 120, share: null, description: 'Brokerage top-up' },
    ],
  },
  {
    name: 'Crypto Portfolio',
    description: 'Demo portfolio of crypto holdings',
    securities: DEMO_CRYPTO,
    endingCash: DEMO_CRYPTO_STARTING_CASH,
    contributions: [
      { daysAgo: 860, share: 0.43, description: 'Crypto exchange funding' },
      { daysAgo: 600, share: 0.33, description: 'Crypto exchange funding' },
      { daysAgo: 350, share: 0.16, description: 'Monthly crypto transfer' },
      { daysAgo: 180, share: 0.03, description: 'Monthly crypto transfer' },
      { daysAgo: 60, share: null, description: 'Crypto exchange top-up' },
    ],
  },
];

/** Fraction of the trend price the monthly wobble may swing, per asset class. */
const STOCK_VOLATILITY = 0.06;
const CRYPTO_VOLATILITY = 0.22;

/** Floor so a wide swing can never produce a zero or negative price. */
const MIN_PRICE = 0.0001;

/**
 * FNV-1a hash. The price path has to be reproducible per demo user and must not
 * consume faker's seeded global state, so the wobble is derived from the symbol
 * and month index rather than any RNG.
 */
function hashSeed({ seed }: { seed: string }): number {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  // FNV alone barely changes its high bits when only the last character differs,
  // and those are the bits the wobble reads. This finalizer spreads them so
  // consecutive months get different offsets.
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x85ebca6b);
  hash ^= hash >>> 13;
  hash = Math.imul(hash, 0xc2b2ae35);
  hash ^= hash >>> 16;
  return hash >>> 0;
}

/** Deterministic value in [-1, 1) for a seed string. */
function wobble({ seed }: { seed: string }): number {
  return (hashSeed({ seed }) / 0x100000000) * 2 - 1;
}

// A type alias: `bulkCreate` needs an index-signature type, which only a type
// alias implicitly satisfies.
type SecurityPricingRow = {
  securityId: string;
  date: Date;
  priceClose: string;
  priceAsOf: Date;
  source: string;
};

/**
 * Monthly price rows from purchase date to reference date, dense enough for
 * the price lookup (latest row on or before a bucket date) to track the
 * market instead of cost basis. The wobble tapers to zero at both ends, so
 * the first and last rows are the exact purchase and current prices.
 */
function buildPriceHistory({
  securityId,
  config,
  purchaseDate,
  referenceDate,
}: {
  securityId: string;
  config: DemoSecurityConfig;
  purchaseDate: Date;
  referenceDate: Date;
}): SecurityPricingRow[] {
  const dates: Date[] = [];
  let cursor = purchaseDate;
  while (cursor < referenceDate) {
    dates.push(cursor);
    cursor = addMonths(cursor, 1);
  }
  dates.push(referenceDate);

  const lastIndex = dates.length - 1;
  const volatility = config.assetClass === ASSET_CLASS.crypto ? CRYPTO_VOLATILITY : STOCK_VOLATILITY;

  return dates.map((date, index) => {
    let price: number;
    if (index === lastIndex) {
      price = config.currentPrice;
    } else if (index === 0) {
      price = config.purchasePrice;
    } else {
      const progress = index / lastIndex;
      const trend = config.purchasePrice + (config.currentPrice - config.purchasePrice) * progress;
      const swing = Math.sin(Math.PI * progress) * volatility * wobble({ seed: `${config.symbol}:${index}` });
      price = Math.max(trend * (1 + swing), MIN_PRICE);
    }

    return {
      securityId,
      date,
      priceClose: new Big(price).toFixed(10),
      priceAsOf: date,
      source: 'demo',
    };
  });
}

/**
 * Resolves the shared `Securities` row for a demo config, creating it only when
 * the instance has never seen the symbol.
 *
 * Looked up through `findSecurityByIdentity` rather than by
 * `(providerName, providerSymbol)`: the demo hardcodes `yahoo` for its stocks,
 * but an instance may already carry AAPL under fmp or polygon, and a second
 * AAPL/USD row makes security resolution nondeterministic for every user.
 * `findOrCreate` still guards the insert so two concurrent demo signups racing
 * on the same new symbol don't collide.
 */
async function resolveDemoSecurity({
  config,
  transaction,
}: {
  config: DemoSecurityConfig;
  transaction: Transaction;
}): Promise<Securities> {
  const existing = await findSecurityByIdentity({
    assetClass: config.assetClass,
    providerName: config.providerName,
    providerSymbol: config.providerSymbol,
    symbol: config.symbol,
    currencyCode: config.currencyCode,
  });

  if (existing) return existing;

  const [security] = await Securities.findOrCreate({
    where: {
      providerName: config.providerName,
      providerSymbol: config.providerSymbol,
    },
    defaults: {
      symbol: config.symbol,
      providerSymbol: config.providerSymbol,
      name: config.name,
      assetClass: config.assetClass,
      currencyCode: config.currencyCode,
      cryptoCurrencyCode: config.cryptoCurrencyCode ?? null,
      providerName: config.providerName,
      exchangeAcronym: config.exchangeAcronym ?? null,
      exchangeMic: config.exchangeMic ?? null,
      exchangeName: config.exchangeName ?? null,
      logoUrl: config.logoUrl ?? null,
      isBrokerageCash: false,
    },
    transaction,
  });

  return security;
}

/**
 * True when a real (non-demo) user holds this security. Their holding renders
 * from whatever prices the table carries, so the demo must not invent any.
 */
async function hasNonDemoHolders({
  securityId,
  transaction,
}: {
  securityId: string;
  transaction: Transaction;
}): Promise<boolean> {
  const rows = await connection.sequelize.query(
    `SELECT 1
       FROM "Holdings" h
       JOIN "Portfolios" p ON p.id = h."portfolioId" AND p."deletedAt" IS NULL
       JOIN "Users" u ON u.id = p."userId"
      WHERE h."securityId" = :securityId AND u."role" <> :demoRole
      LIMIT 1`,
    {
      replacements: { securityId, demoRole: USER_ROLES.demo },
      type: QueryTypes.SELECT,
      transaction,
    },
  );

  return rows.length > 0;
}

/** What one seeded holding contributes to its portfolio's funding math. */
interface SeededHolding {
  costBasis: Money;
}

/**
 * Seeds securities, holdings and the opening buy transaction for a single
 * portfolio. Shared by the stock and crypto portfolios so both asset classes
 * follow the exact same holding-creation path.
 *
 * `Securities` and `SecurityPricings` are global tables that every user reads,
 * so the demo values its holdings from the prices already there and writes its
 * own series only for a security nobody has ever priced.
 */
async function seedPortfolioHoldings({
  portfolioId,
  securities,
  referenceDate,
  transaction,
}: {
  portfolioId: string;
  securities: DemoSecurityConfig[];
  referenceDate: Date;
  transaction: Transaction;
}): Promise<SeededHolding[]> {
  const pricingRows: SecurityPricingRow[] = [];
  const seeded: SeededHolding[] = [];

  for (const sec of securities) {
    const security = await resolveDemoSecurity({ config: sec, transaction });

    const existingPrices = await SecurityPricing.findAll({
      where: { securityId: security.id },
      order: [['date', 'ASC']],
      transaction,
    });

    const targetDate = subDays(referenceDate, sec.purchaseDaysAgo);

    let purchaseDate: Date;
    let purchasePrice: number;

    if (existingPrices.length > 0) {
      // Real coverage exists. It may not reach as far back as the configured
      // purchase date (CoinGecko's free tier stops at one year), so the buy
      // moves forward onto a day that has a price.
      const fitted = fitPurchaseToPrices({
        prices: existingPrices.map((row) => ({ date: row.date, price: row.priceClose.toNumber() })),
        targetDate,
      })!;

      purchaseDate = fitted.date;
      purchasePrice = fitted.price;
    } else if (await hasNonDemoHolders({ securityId: security.id, transaction })) {
      // Held but unpriced. A synthetic series here would put demo numbers on
      // someone's real holding, so the demo goes without this security.
      logger.info(`Demo investments: skipping ${sec.symbol}, a real user holds it and it has no prices.`);
      continue;
    } else {
      // Nobody has ever priced this security and nobody holds it, so there is
      // no one a synthetic series could mislead. This is what keeps the demo
      // usable on a fresh install.
      purchaseDate = targetDate;
      purchasePrice = sec.purchasePrice;
      pricingRows.push(
        ...buildPriceHistory({
          securityId: security.id,
          config: sec,
          purchaseDate,
          referenceDate,
        }),
      );
    }

    const quantityStr = new Big(sec.quantity).toFixed(10);
    const priceStr = new Big(purchasePrice).toFixed(10);
    const costBasisStr = new Big(purchasePrice).times(sec.quantity).toFixed(10);

    await Holdings.create(
      {
        portfolioId,
        securityId: security.id,
        currencyCode: sec.currencyCode,
        quantity: quantityStr,
        costBasis: costBasisStr,
        refCostBasis: costBasisStr,
        excluded: false,
      },
      { transaction },
    );

    await InvestmentTransaction.create(
      {
        portfolioId,
        securityId: security.id,
        transactionType: TRANSACTION_TYPES.expense,
        date: format(purchaseDate, 'yyyy-MM-dd'),
        name: `Bought ${sec.quantity} ${sec.symbol}`,
        amount: costBasisStr,
        refAmount: costBasisStr,
        fees: '0',
        refFees: '0',
        quantity: quantityStr,
        price: priceStr,
        refPrice: priceStr,
        currencyCode: sec.currencyCode,
        settlementCurrencyCode: sec.currencyCode,
        settlementAmount: costBasisStr,
        settlementFees: '0',
        settlementRate: '1',
        category: INVESTMENT_TRANSACTION_CATEGORY.buy,
      },
      { transaction },
    );

    seeded.push({ costBasis: Money.fromDecimal(costBasisStr) });
  }

  if (pricingRows.length > 0) {
    await SecurityPricing.bulkCreate(pricingRows, {
      ignoreDuplicates: true,
      transaction,
    });
  }

  return seeded;
}

/**
 * Money moving from the savings account into a portfolio: an expense on the
 * account plus the PortfolioTransfers row, which is the only table the
 * Investment Contributions report reads.
 */
async function seedPortfolioFunding({
  userId,
  portfolioId,
  portfolioName,
  savingsAccountId,
  contributions,
  referenceDate,
  transaction,
}: {
  userId: number;
  portfolioId: string;
  portfolioName: string;
  savingsAccountId: string;
  contributions: ContributionPlan[];
  referenceDate: Date;
  transaction: Transaction;
}): Promise<void> {
  const currencyCode = DEMO_CONFIG.baseCurrency;

  const planned = contributions.map((item) => {
    const time = subDays(referenceDate, item.daysAgo);
    return {
      transactionId: uuidv7(),
      time,
      amount: item.amount,
      amountDecimal: item.amount.toDecimalString(10),
      description: `${item.description} (${portfolioName})`,
    };
  });

  // Hooks stay off: the orchestrator recomputes account balances and history with
  // raw SQL once every demo transaction is in place.
  await Transactions.bulkCreate(
    planned.map((item) => ({
      id: item.transactionId,
      userId,
      amount: item.amount,
      refAmount: item.amount,
      transactionType: TRANSACTION_TYPES.expense,
      paymentType: PAYMENT_TYPES.bankTransfer,
      accountId: savingsAccountId,
      accountType: ACCOUNT_TYPES.system,
      categoryId: null,
      currencyCode,
      refCurrencyCode: currencyCode,
      // Account -> portfolio funding is single-leg, so there is no `transferId`
      // pairing this row with a counterpart transaction.
      transferNature: TRANSACTION_TRANSFER_NATURE.transfer_to_portfolio,
      note: item.description,
      time: item.time,
      commissionRate: 0,
      refCommissionRate: 0,
      cashbackAmount: 0,
      refundLinked: false,
    })),
    { hooks: false, validate: false, transaction },
  );

  // `fromPortfolioId`/`toAccountId` stay null: the report counts a row as an
  // inbound contribution only when the portfolio is the destination and no
  // portfolio is the source.
  await PortfolioTransfers.bulkCreate(
    planned.map((item) => ({
      userId,
      fromAccountId: savingsAccountId,
      toPortfolioId: portfolioId,
      fromPortfolioId: null,
      toAccountId: null,
      amount: item.amountDecimal,
      refAmount: item.amountDecimal,
      currencyCode,
      date: format(item.time, 'yyyy-MM-dd'),
      description: item.description,
      transactionId: item.transactionId,
    })),
    { transaction },
  );
}

export async function setupInvestments({
  userId,
  referenceDate,
  savingsAccountId,
}: {
  userId: number;
  referenceDate: Date;
  savingsAccountId: string;
}): Promise<void> {
  const transaction = await connection.sequelize.transaction();

  try {
    for (const plan of DEMO_PORTFOLIO_PLANS) {
      const portfolio = await Portfolios.create(
        {
          userId,
          name: plan.name,
          portfolioType: PORTFOLIO_TYPE.investment,
          description: plan.description,
          isEnabled: true,
        },
        { transaction },
      );

      const seeded = await seedPortfolioHoldings({
        portfolioId: portfolio.id,
        securities: plan.securities,
        referenceDate,
        transaction,
      });

      // Summed from what the holdings actually cost, since market prices decide
      // that now rather than the config.
      const totalBuyCost = Money.sum(seeded.map((holding) => holding.costBasis));
      const contributions = resolveContributions({
        contributions: plan.contributions,
        totalNeeded: totalBuyCost.add(Money.fromDecimal(plan.endingCash)),
      });

      await seedPortfolioFunding({
        userId,
        portfolioId: portfolio.id,
        portfolioName: plan.name,
        savingsAccountId,
        contributions,
        referenceDate,
        transaction,
      });

      // Written directly rather than through the transfer service, whose balance
      // updates are additive and would double-count against these rows.
      const endingCash = Money.sum(contributions.map((item) => item.amount))
        .subtract(totalBuyCost)
        .toDecimalString(10);

      // Demo base currency is USD, so ref amounts mirror direct amounts 1:1.
      await PortfolioBalances.create(
        {
          portfolioId: portfolio.id,
          currencyCode: DEMO_CONFIG.baseCurrency,
          availableCash: endingCash,
          totalCash: endingCash,
          refAvailableCash: endingCash,
          refTotalCash: endingCash,
        },
        { transaction },
      );
    }

    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    throw error;
  }

  logger.info(
    `Created demo portfolios (${DEMO_SECURITIES.length} stock + ${DEMO_CRYPTO.length} crypto holdings) for user ${userId}`,
  );
}
