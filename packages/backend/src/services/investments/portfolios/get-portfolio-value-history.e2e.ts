import { ASSET_CLASS, INVESTMENT_TRANSACTION_CATEGORY, SECURITY_PROVIDER, TRANSACTION_TYPES } from '@bt/shared/types';
import { describe, expect, it } from '@jest/globals';
import { ERROR_CODES } from '@js/errors';
import ExchangeRates from '@models/exchange-rates.model';
import Portfolios from '@models/investments/portfolios.model';
import Securities from '@models/investments/securities.model';
import SecurityPricing from '@models/investments/security-pricing.model';
import { API_LAYER_BASE_CURRENCY_CODE } from '@services/exchange-rates/constants';
import * as helpers from '@tests/helpers';
import { AED_PER_USD, EUR_PER_USD } from '@tests/mocks/exchange-rates/data';
import { format, getISODay, parseISO, subDays } from 'date-fns';

// getHoldingValues deduplicates identical requests for 1 second; the summary
// call must outwait it after the setup calls primed it.
const DEDUP_CACHE_MS = 1100;

const daysAgo = (days: number) => format(subDays(new Date(), days), 'yyyy-MM-dd');
const DEPOSIT_DATE = daysAgo(10);
const BUY_DATE = daysAgo(8);
const SELL_DATE = daysAgo(5);
const TODAY = daysAgo(0);

const seedTodayUsdRates = async ({ rates }: { rates: [string, number][] }) => {
  const date = new Date(`${TODAY}T00:00:00.000Z`);
  for (const [quoteCode, rate] of rates) {
    await ExchangeRates.destroy({ where: { baseCode: API_LAYER_BASE_CURRENCY_CODE, quoteCode, date } });
    await ExchangeRates.create({ baseCode: API_LAYER_BASE_CURRENCY_CODE, quoteCode, rate, date });
  }
};

/**
 * Deposit 2000, buy 10 @ 100, sell 4 @ 150, then price the security at 120
 * today. All in the base currency: cash 2000 → 1000 → 1600, cost basis
 * 1000 → 600, realized gain 0 → 200, holdings today 6 × 120 = 720.
 */
const seedPortfolio = async ({
  displayCurrencyCode,
  securityCurrencyCode = global.BASE_CURRENCY_CODE,
}: { displayCurrencyCode?: string; securityCurrencyCode?: string } = {}) => {
  const portfolio: Portfolios = await helpers.createPortfolio({
    payload: helpers.buildPortfolioPayload({ name: 'Value History Portfolio' }),
    raw: true,
  });
  const account = await helpers.createAccount({
    payload: helpers.buildAccountPayload({ name: 'Value History Source' }),
    raw: true,
  });
  await helpers.accountToPortfolioTransfer({
    portfolioId: portfolio.id,
    payload: { accountId: account.id, amount: '2000', date: DEPOSIT_DATE },
    raw: true,
  });

  const security = await Securities.create({
    symbol: 'VHST',
    providerSymbol: 'VHST',
    currencyCode: securityCurrencyCode,
    providerName: SECURITY_PROVIDER.fmp,
    assetClass: ASSET_CLASS.stocks,
    name: 'Value History Test Security',
  });
  await helpers.createHolding({ payload: { portfolioId: portfolio.id, securityId: security.id } });

  await helpers.createInvestmentTransaction({
    payload: { portfolioId: portfolio.id, securityId: security.id, date: BUY_DATE, quantity: '10', price: '100' },
  });
  await helpers.createInvestmentTransaction({
    payload: {
      portfolioId: portfolio.id,
      securityId: security.id,
      category: INVESTMENT_TRANSACTION_CATEGORY.sell,
      date: SELL_DATE,
      quantity: '4',
      price: '150',
    },
  });

  // Drain the background price sync triggered by createHolding, then keep only
  // the price point we control.
  await helpers.sleep(200);
  await SecurityPricing.destroy({ where: { securityId: security.id } });
  await SecurityPricing.create({
    securityId: security.id,
    date: new Date(),
    priceClose: '120',
    source: SECURITY_PROVIDER.fmp,
  });

  if (displayCurrencyCode) {
    await helpers.addUserCurrencyByCode({ code: displayCurrencyCode, raw: true });
    await helpers.updatePortfolio({ portfolioId: portfolio.id, payload: { displayCurrencyCode } });
  }

  return portfolio;
};

const createEmptyPortfolio = ({ name }: { name: string }): Promise<Portfolios> =>
  helpers.createPortfolio({ payload: helpers.buildPortfolioPayload({ name }), raw: true });

const directCash = ({
  portfolioId,
  type,
  amount,
  date,
}: {
  portfolioId: string;
  type: 'deposit' | 'withdrawal';
  amount: string;
  date: string;
}) =>
  helpers.directCashTransaction({
    portfolioId,
    payload: { type, amount, currencyCode: global.BASE_CURRENCY_CODE, date },
    raw: true,
  });

const getPointsByDate = async ({ portfolioId }: { portfolioId: string }) => {
  const history = await helpers.getPortfolioValueHistory({ portfolioId, raw: true });
  return new Map(history.points.map((point) => [point.date, point]));
};

const createHeldSecurity = async ({ portfolioId, symbol }: { portfolioId: string; symbol: string }) => {
  const security = await Securities.create({
    symbol,
    providerSymbol: symbol,
    currencyCode: global.BASE_CURRENCY_CODE,
    providerName: SECURITY_PROVIDER.fmp,
    assetClass: ASSET_CLASS.stocks,
    name: `${symbol} Test Security`,
  });
  await helpers.createHolding({ payload: { portfolioId, securityId: security.id } });
  return security;
};

/** Drains the background price sync createHolding triggers, then keeps only the given closes. */
const setPrices = async ({ securityId, prices }: { securityId: string; prices: [string, string][] }) => {
  await helpers.sleep(200);
  await SecurityPricing.destroy({ where: { securityId } });
  for (const [date, priceClose] of prices) {
    await SecurityPricing.create({
      securityId,
      date: new Date(`${date}T12:00:00.000Z`),
      priceClose,
      source: SECURITY_PROVIDER.fmp,
    });
  }
};

const trade = ({
  portfolioId,
  securityId,
  category = INVESTMENT_TRANSACTION_CATEGORY.buy,
  date,
  quantity,
  price,
}: {
  portfolioId: string;
  securityId: string;
  category?: INVESTMENT_TRANSACTION_CATEGORY;
  date: string;
  quantity: string;
  price: string;
}) => helpers.createInvestmentTransaction({ payload: { portfolioId, securityId, category, date, quantity, price } });

describe('Portfolio value history (GET /investments/portfolios/:id/value-history)', () => {
  it('replays daily values from the first event to today, ending at the summary', async () => {
    const portfolio = await seedPortfolio();
    await helpers.sleep(DEDUP_CACHE_MS);

    const [history, summary] = await Promise.all([
      helpers.getPortfolioValueHistory({ portfolioId: portfolio.id, raw: true }),
      helpers.getPortfolioSummary({ portfolioId: portfolio.id, raw: true }),
    ]);

    expect(history.currencyCode).toBe(global.BASE_CURRENCY_CODE);
    expect(history.points).toHaveLength(11);
    expect(history.points[0]!.date).toBe(DEPOSIT_DATE);
    expect(history.points.at(-1)!.date).toBe(TODAY);

    for (const point of history.points) {
      expect(Number(point.totalValue)).toBeCloseTo(Number(point.holdingsValue) + Number(point.cashValue), 2);
    }

    const byDate = new Map(history.points.map((point) => [point.date, point]));
    expect(byDate.get(DEPOSIT_DATE)).toEqual({
      date: DEPOSIT_DATE,
      totalValue: '2000.00',
      holdingsValue: '0.00',
      cashValue: '2000.00',
      costBasis: '0.00',
      realizedGain: '0.00',
      netDeposits: '2000.00',
      timeWeightedReturn: expect.toBeNumericEqual(0),
    });
    // Unpriced days carry the holding at cost basis.
    expect(byDate.get(BUY_DATE)).toMatchObject({
      totalValue: '2000.00',
      holdingsValue: '1000.00',
      cashValue: '1000.00',
      costBasis: '1000.00',
      realizedGain: '0.00',
    });
    expect(byDate.get(SELL_DATE)).toMatchObject({
      totalValue: '2200.00',
      holdingsValue: '600.00',
      cashValue: '1600.00',
      costBasis: '600.00',
      realizedGain: '200.00',
    });

    const today = byDate.get(TODAY)!;
    expect(today).toEqual({
      date: TODAY,
      totalValue: '2320.00',
      holdingsValue: '720.00',
      cashValue: '1600.00',
      costBasis: '600.00',
      realizedGain: '200.00',
      netDeposits: '2000.00',
      timeWeightedReturn: expect.any(String),
    });
    expect(today.totalValue).toBe(summary.totalPortfolioValue);
    expect(today.holdingsValue).toBe(summary.totalCurrentValue);
    expect(today.cashValue).toBe(summary.totalCashInBaseCurrency);
    expect(today.costBasis).toBe(summary.totalCostBasis);
    expect(today.realizedGain).toBe(summary.realizedGainValue);
  });

  it('limits the points to the requested range', async () => {
    const portfolio = await seedPortfolio();

    const history = await helpers.getPortfolioValueHistory({
      portfolioId: portfolio.id,
      from: BUY_DATE,
      to: SELL_DATE,
      raw: true,
    });

    expect(history.points.map((point) => point.date)).toEqual([BUY_DATE, daysAgo(7), daysAgo(6), SELL_DATE]);
    expect(history.points[0]).toMatchObject({ cashValue: '1000.00', costBasis: '1000.00' });
  });

  it('reports values in the display currency, matching the summary today', async () => {
    const portfolio = await seedPortfolio({ displayCurrencyCode: 'EUR' });

    // The history converts at the latest stored daily rate, the summary at the
    // provider's live one; storing today's rates makes the two sources agree.
    await seedTodayUsdRates({
      rates: [
        [global.BASE_CURRENCY_CODE, AED_PER_USD],
        ['EUR', EUR_PER_USD],
      ],
    });
    await helpers.sleep(DEDUP_CACHE_MS);

    const [history, summary] = await Promise.all([
      helpers.getPortfolioValueHistory({ portfolioId: portfolio.id, raw: true }),
      helpers.getPortfolioSummary({ portfolioId: portfolio.id, raw: true }),
    ]);

    expect(history.currencyCode).toBe('EUR');
    expect(summary.currencyCode).toBe('EUR');
    const today = history.points.at(-1)!;
    expect(Number(today.totalValue)).toBeCloseTo(Number(summary.totalPortfolioValue), 1);
    expect(Number(today.holdingsValue)).toBeCloseTo(Number(summary.totalCurrentValue), 1);
    expect(Number(today.cashValue)).toBeCloseTo(Number(summary.totalCashInBaseCurrency), 1);
    expect(Number(today.costBasis)).toBeCloseTo(Number(summary.totalCostBasis), 1);
    expect(Number(today.realizedGain)).toBeCloseTo(Number(summary.realizedGainValue), 1);
  });

  it('converts a foreign-currency holding at the day rate, matching the summary today', async () => {
    const portfolio = await seedPortfolio({ securityCurrencyCode: 'USD' });
    await seedTodayUsdRates({ rates: [[global.BASE_CURRENCY_CODE, AED_PER_USD]] });
    await helpers.sleep(DEDUP_CACHE_MS);

    const [history, summary] = await Promise.all([
      helpers.getPortfolioValueHistory({ portfolioId: portfolio.id, raw: true }),
      helpers.getPortfolioSummary({ portfolioId: portfolio.id, raw: true }),
    ]);

    const today = history.points.at(-1)!;
    expect(Number(today.holdingsValue)).toBeCloseTo(720 * AED_PER_USD, 1);
    expect(Number(today.costBasis)).toBeCloseTo(600 * AED_PER_USD, 1);
    expect(Number(today.realizedGain)).toBeCloseTo(200 * AED_PER_USD, 1);
    expect(Number(today.holdingsValue)).toBeCloseTo(Number(summary.totalCurrentValue), 1);
    expect(Number(today.costBasis)).toBeCloseTo(Number(summary.totalCostBasis), 1);
    expect(Number(today.realizedGain)).toBeCloseTo(Number(summary.realizedGainValue), 1);
    expect(Number(today.cashValue)).toBeCloseTo(Number(summary.totalCashInBaseCurrency), 1);
  });

  it('converts each deposit at its own day rate and carries the currency move into the TWR', async () => {
    const portfolio = await createEmptyPortfolio({ name: 'Display Rate Days' });
    await directCash({ portfolioId: portfolio.id, type: 'deposit', amount: '1000', date: DEPOSIT_DATE });
    await helpers.addUserCurrencyByCode({ code: 'EUR', raw: true });
    await helpers.updatePortfolio({ portfolioId: portfolio.id, payload: { displayCurrencyCode: 'EUR' } });
    await seedTodayUsdRates({
      rates: [
        [global.BASE_CURRENCY_CODE, AED_PER_USD],
        ['EUR', EUR_PER_USD],
      ],
    });

    const history = await helpers.getPortfolioValueHistory({ portfolioId: portfolio.id, raw: true });

    expect(history.currencyCode).toBe('EUR');
    const depositDay = history.points[0]!;
    const today = history.points.at(-1)!;
    expect(depositDay.date).toBe(DEPOSIT_DATE);
    expect(depositDay.netDeposits).toBe(depositDay.totalValue);
    expect(Number(today.totalValue)).toBeCloseTo((1000 * EUR_PER_USD) / AED_PER_USD, 1);
    expect(today.netDeposits).toBe(depositDay.netDeposits);
    expect(today.netDeposits).not.toBe(today.totalValue);
    expect(Number(today.timeWeightedReturn)).toBeCloseTo(
      Number(today.totalValue) / Number(depositDay.totalValue) - 1,
      3,
    );
  });

  it('falls back to the base currency when the display currency has no rate', async () => {
    // Neither the mocked providers nor the stored rates carry an SSP rate.
    const portfolio = await seedPortfolio({ displayCurrencyCode: 'SSP' });

    const history = await helpers.getPortfolioValueHistory({ portfolioId: portfolio.id, raw: true });

    expect(history.currencyCode).toBe(global.BASE_CURRENCY_CODE);
    expect(history.points.at(-1)).toMatchObject({ totalValue: '2320.00', costBasis: '600.00' });
  });

  it('starts at the first event when the requested range reaches further back', async () => {
    const portfolio = await seedPortfolio();

    const history = await helpers.getPortfolioValueHistory({
      portfolioId: portfolio.id,
      from: '2000-01-01',
      raw: true,
    });

    expect(history.points[0]!.date).toBe(DEPOSIT_DATE);
  });

  it('returns a single zero point for a portfolio with no activity', async () => {
    const portfolio: Portfolios = await helpers.createPortfolio({
      payload: helpers.buildPortfolioPayload({ name: 'Empty Value History' }),
      raw: true,
    });

    const history = await helpers.getPortfolioValueHistory({ portfolioId: portfolio.id, raw: true });

    expect(history).toEqual({
      currencyCode: global.BASE_CURRENCY_CODE,
      points: [
        {
          date: TODAY,
          totalValue: '0.00',
          holdingsValue: '0.00',
          cashValue: '0.00',
          costBasis: '0.00',
          realizedGain: '0.00',
          netDeposits: '0.00',
          timeWeightedReturn: expect.toBeNumericEqual(0),
        },
      ],
    });
  });

  it("returns 404 for another user's portfolio", async () => {
    const portfolio = await seedPortfolio();

    const { cookies } = await helpers.signUpSecondUser();
    const response = await helpers.asUser({
      cookies,
      fn: () => helpers.getPortfolioValueHistory({ portfolioId: portfolio.id }),
    });

    expect(response.statusCode).toBe(ERROR_CODES.NotFoundError);
  });

  it('returns 404 for a portfolio that does not exist', async () => {
    const response = await helpers.getPortfolioValueHistory({ portfolioId: '00000000-0000-4000-8000-000000000000' });

    expect(response.statusCode).toBe(ERROR_CODES.NotFoundError);
  });

  it('rejects a range whose start is after its end', async () => {
    const portfolio: Portfolios = await helpers.createPortfolio({ raw: true });

    const response = await helpers.getPortfolioValueHistory({
      portfolioId: portfolio.id,
      from: TODAY,
      to: DEPOSIT_DATE,
    });

    expect(response.statusCode).toBe(ERROR_CODES.ValidationError);
  });

  describe('interval=auto', () => {
    it('keeps daily points for a history of two years or less', async () => {
      const portfolio = await createEmptyPortfolio({ name: 'Short Auto' });
      await directCash({ portfolioId: portfolio.id, type: 'deposit', amount: '100', date: daysAgo(700) });

      const history = await helpers.getPortfolioValueHistory({
        portfolioId: portfolio.id,
        interval: 'auto',
        raw: true,
      });

      expect(history.points).toHaveLength(701);
    });

    it('sends the first day, each week end and today for a longer history', async () => {
      const portfolio = await createEmptyPortfolio({ name: 'Long Auto' });
      await directCash({ portfolioId: portfolio.id, type: 'deposit', amount: '100', date: daysAgo(1000) });
      await directCash({ portfolioId: portfolio.id, type: 'deposit', amount: '50', date: daysAgo(400) });

      const history = await helpers.getPortfolioValueHistory({
        portfolioId: portfolio.id,
        interval: 'auto',
        raw: true,
      });
      const dates = history.points.map((point) => point.date);

      expect(dates[0]).toBe(daysAgo(1000));
      expect(dates.at(-1)).toBe(TODAY);
      expect(dates.slice(1, -1).every((date) => getISODay(parseISO(date)) === 7)).toBe(true);
      expect(history.points.length).toBeLessThan(150);
      expect(history.points.at(-1)!.netDeposits).toBe('150.00');
    });

    it('keeps daily points without the param', async () => {
      const portfolio = await createEmptyPortfolio({ name: 'Long Daily' });
      await directCash({ portfolioId: portfolio.id, type: 'deposit', amount: '100', date: daysAgo(1000) });

      const history = await helpers.getPortfolioValueHistory({ portfolioId: portfolio.id, raw: true });

      expect(history.points).toHaveLength(1001);
    });
  });

  describe('net deposits', () => {
    const seedTwoDeposits = async () => {
      const portfolio = await createEmptyPortfolio({ name: 'Deposits' });
      const account = await helpers.createAccount({
        payload: helpers.buildAccountPayload({ name: 'Deposits Source' }),
        raw: true,
      });
      await helpers.accountToPortfolioTransfer({
        portfolioId: portfolio.id,
        payload: { accountId: account.id, amount: '2000', date: daysAgo(6) },
        raw: true,
      });
      await directCash({ portfolioId: portfolio.id, type: 'deposit', amount: '500', date: daysAgo(3) });
      return portfolio;
    };

    it('raises on an account transfer and a direct deposit, carrying the running total forward', async () => {
      const portfolio = await seedTwoDeposits();

      const byDate = await getPointsByDate({ portfolioId: portfolio.id });

      expect(byDate.get(daysAgo(6))!.netDeposits).toBe('2000.00');
      expect(byDate.get(daysAgo(4))!.netDeposits).toBe('2000.00');
      expect(byDate.get(daysAgo(3))!.netDeposits).toBe('2500.00');
      expect(byDate.get(TODAY)!.netDeposits).toBe('2500.00');
    });

    it('opens a ranged series with the deposits made before its first day', async () => {
      const portfolio = await seedTwoDeposits();

      const history = await helpers.getPortfolioValueHistory({
        portfolioId: portfolio.id,
        from: daysAgo(4),
        raw: true,
      });

      expect(history.points[0]).toMatchObject({
        date: daysAgo(4),
        netDeposits: '2000.00',
        timeWeightedReturn: expect.toBeNumericEqual(0),
      });
      expect(history.points.at(-1)).toMatchObject({ date: TODAY, netDeposits: '2500.00' });
    });

    it('lowers on a direct withdrawal', async () => {
      const portfolio = await createEmptyPortfolio({ name: 'Withdrawals' });
      await directCash({ portfolioId: portfolio.id, type: 'deposit', amount: '1000', date: daysAgo(5) });
      await directCash({ portfolioId: portfolio.id, type: 'withdrawal', amount: '300', date: daysAgo(2) });

      const byDate = await getPointsByDate({ portfolioId: portfolio.id });

      expect(byDate.get(daysAgo(3))!.netDeposits).toBe('1000.00');
      expect(byDate.get(daysAgo(2))!.netDeposits).toBe('700.00');
      expect(byDate.get(TODAY)!.netDeposits).toBe('700.00');
    });

    it('counts a portfolio-to-portfolio transfer as a deposit for the receiver and a withdrawal for the sender', async () => {
      const sender = await createEmptyPortfolio({ name: 'Sender' });
      const receiver = await createEmptyPortfolio({ name: 'Receiver' });
      await directCash({ portfolioId: sender.id, type: 'deposit', amount: '1000', date: daysAgo(5) });
      await helpers.createPortfolioTransfer({
        fromPortfolioId: sender.id,
        payload: helpers.buildPortfolioTransferPayload({
          toPortfolioId: receiver.id,
          currencyCode: global.BASE_CURRENCY_CODE,
          amount: '400',
          date: daysAgo(2),
        }),
        raw: true,
      });

      const [senderByDate, receiverHistory] = await Promise.all([
        getPointsByDate({ portfolioId: sender.id }),
        helpers.getPortfolioValueHistory({ portfolioId: receiver.id, raw: true }),
      ]);

      expect(senderByDate.get(daysAgo(3))!.netDeposits).toBe('1000.00');
      expect(senderByDate.get(daysAgo(2))!.netDeposits).toBe('600.00');
      expect(senderByDate.get(TODAY)!.netDeposits).toBe('600.00');

      expect(receiverHistory.points[0]).toMatchObject({ date: daysAgo(2), netDeposits: '400.00' });
      expect(receiverHistory.points.at(-1)).toMatchObject({ date: TODAY, netDeposits: '400.00' });
    });

    it('ignores a transfer flagged as an adjustment while its cash still lands', async () => {
      const portfolio = await createEmptyPortfolio({ name: 'Adjusted' });
      const account = await helpers.createAccount({
        payload: helpers.buildAccountPayload({ name: 'Adjustment Source' }),
        raw: true,
      });
      await directCash({ portfolioId: portfolio.id, type: 'deposit', amount: '1000', date: daysAgo(5) });
      const transfer = await helpers.accountToPortfolioTransfer({
        portfolioId: portfolio.id,
        payload: { accountId: account.id, amount: '300', date: daysAgo(3) },
        raw: true,
      });
      const flagged = await helpers.setTransferAdjustment({
        portfolioId: portfolio.id,
        transferId: transfer.id,
        payload: { isAdjustment: true },
        raw: true,
      });
      expect(flagged.isAdjustment).toBe(true);

      const byDate = await getPointsByDate({ portfolioId: portfolio.id });

      expect(byDate.get(daysAgo(3))).toMatchObject({ cashValue: '1300.00', netDeposits: '1000.00' });
      expect(byDate.get(TODAY)!.netDeposits).toBe('1000.00');
    });

    it('counts a link whose money is already in stored cash, without moving the TWR', async () => {
      const portfolio = await createEmptyPortfolio({ name: 'Backfilled' });
      const account = await helpers.createAccount({
        payload: helpers.buildAccountPayload({ name: 'Backfill Source' }),
        raw: true,
      });
      await directCash({ portfolioId: portfolio.id, type: 'deposit', amount: '1000', date: daysAgo(8) });
      await helpers.updatePortfolioBalance({
        portfolioId: portfolio.id,
        currencyCode: global.BASE_CURRENCY_CODE,
        setAvailableCash: '1500',
        setTotalCash: '1500',
      });
      const [expenseTx] = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account.id,
          amount: 500,
          transactionType: TRANSACTION_TYPES.expense,
          time: new Date(`${daysAgo(4)}T12:00:00.000Z`).toISOString(),
        }),
        raw: true,
      });
      await helpers.linkTransactionToPortfolio({
        transactionId: expenseTx!.id,
        payload: { portfolioId: portfolio.id, affectsCash: false },
        raw: true,
      });

      const byDate = await getPointsByDate({ portfolioId: portfolio.id });

      expect(byDate.get(daysAgo(5))).toMatchObject({ totalValue: '1500.00', netDeposits: '1000.00' });
      expect(byDate.get(daysAgo(4))).toMatchObject({ totalValue: '1500.00', netDeposits: '1500.00' });
      expect(byDate.get(TODAY)).toMatchObject({ totalValue: '1500.00', netDeposits: '1500.00' });
      expect(Number(byDate.get(TODAY)!.timeWeightedReturn)).toBeCloseTo(0, 6);
    });

    it('ignores a currency exchange inside the portfolio', async () => {
      const portfolio = await createEmptyPortfolio({ name: 'Exchanged' });
      await helpers.addUserCurrencies({ currencyCodes: ['USD'], raw: true });
      await directCash({ portfolioId: portfolio.id, type: 'deposit', amount: '1000', date: daysAgo(5) });
      const exchange = await helpers.exchangeCurrency({
        portfolioId: portfolio.id,
        payload: helpers.buildExchangeCurrencyPayload({
          fromCurrencyCode: global.BASE_CURRENCY_CODE,
          toCurrencyCode: 'USD',
          fromAmount: '200',
          toAmount: '55',
          date: daysAgo(2),
        }),
        raw: true,
      });

      expect(exchange.toCurrencyCode).toBe('USD');

      const history = await helpers.getPortfolioValueHistory({ portfolioId: portfolio.id, raw: true });

      expect(history.points.map((point) => point.netDeposits)).toEqual(history.points.map(() => '1000.00'));
    });
  });

  describe('time-weighted return', () => {
    /**
     * Deposit 2000 and buy 10 @ 100, price 110 (+5%), deposit 1000, price 121.
     * Values: 2000 → 2100 → 3100 → 3210. TWR ends at 1.05 × 3210/3100 − 1,
     * where the simple return on net deposits would be 210/3000 = 0.07.
     */
    it('stays flat on a deposit day and moves with the security price', async () => {
      const portfolio = await createEmptyPortfolio({ name: 'TWR Portfolio' });
      await directCash({ portfolioId: portfolio.id, type: 'deposit', amount: '2000', date: daysAgo(10) });

      const security = await Securities.create({
        symbol: 'TWRT',
        providerSymbol: 'TWRT',
        currencyCode: global.BASE_CURRENCY_CODE,
        providerName: SECURITY_PROVIDER.fmp,
        assetClass: ASSET_CLASS.stocks,
        name: 'TWR Test Security',
      });
      await helpers.createHolding({ payload: { portfolioId: portfolio.id, securityId: security.id } });
      await helpers.createInvestmentTransaction({
        payload: { portfolioId: portfolio.id, securityId: security.id, date: daysAgo(9), quantity: '10', price: '100' },
      });

      await helpers.sleep(200);
      await SecurityPricing.destroy({ where: { securityId: security.id } });
      for (const [date, priceClose] of [
        [daysAgo(9), '100'],
        [daysAgo(7), '110'],
        [daysAgo(3), '121'],
      ] as const) {
        await SecurityPricing.create({
          securityId: security.id,
          date: new Date(`${date}T12:00:00.000Z`),
          priceClose,
          source: SECURITY_PROVIDER.fmp,
        });
      }

      await directCash({ portfolioId: portfolio.id, type: 'deposit', amount: '1000', date: daysAgo(5) });

      const byDate = await getPointsByDate({ portfolioId: portfolio.id });
      const twrOn = ({ days }: { days: number }) => Number(byDate.get(daysAgo(days))!.timeWeightedReturn);

      expect(byDate.get(daysAgo(5))).toMatchObject({ totalValue: '3100.00', netDeposits: '3000.00' });
      expect(byDate.get(daysAgo(3))).toMatchObject({ totalValue: '3210.00', netDeposits: '3000.00' });

      expect(twrOn({ days: 10 })).toBeCloseTo(0, 4);
      expect(twrOn({ days: 9 })).toBeCloseTo(0, 4);
      expect(twrOn({ days: 7 })).toBeCloseTo(0.05, 4);
      expect(twrOn({ days: 6 })).toBeCloseTo(0.05, 4);
      expect(twrOn({ days: 5 })).toBeCloseTo(0.05, 4);
      expect(twrOn({ days: 4 })).toBeCloseTo(0.05, 4);
      expect(twrOn({ days: 3 })).toBeCloseTo(1.05 * (3210 / 3100) - 1, 4);
      expect(twrOn({ days: 0 })).toBeCloseTo(1.05 * (3210 / 3100) - 1, 4);
    });

    it('measures a trades-only portfolio on its holdings, not on the near-zero net value', async () => {
      const portfolio = await createEmptyPortfolio({ name: 'Trades Only' });
      const security = await createHeldSecurity({ portfolioId: portfolio.id, symbol: 'TRDO' });
      await trade({
        portfolioId: portfolio.id,
        securityId: security.id,
        date: daysAgo(5),
        quantity: '10',
        price: '100',
      });
      await setPrices({
        securityId: security.id,
        prices: [
          [daysAgo(5), '100'],
          [daysAgo(3), '101'],
          [daysAgo(1), '101.505'],
        ],
      });

      const byDate = await getPointsByDate({ portfolioId: portfolio.id });

      expect(byDate.get(daysAgo(5))).toMatchObject({ cashValue: '-1000.00', netDeposits: '0.00' });
      expect(Number(byDate.get(daysAgo(3))!.timeWeightedReturn)).toBeCloseTo(0.01, 4);
      expect(Number(byDate.get(TODAY)!.timeWeightedReturn)).toBeCloseTo(0.01505, 4);
    });

    /**
     * Deposit 1000, buy 10 @ 100, sell 9.995 and withdraw the cash, leaving 0.50 of holdings that halve.
     * A new deposit buys 10 @ 50 and the price rises 10%: the index resumes at 0, not at -50%.
     */
    it('carries the index across a full withdrawal that leaves a small residue', async () => {
      const portfolio = await createEmptyPortfolio({ name: 'Withdrawn' });
      const security = await createHeldSecurity({ portfolioId: portfolio.id, symbol: 'WDRN' });
      await directCash({ portfolioId: portfolio.id, type: 'deposit', amount: '1000', date: daysAgo(10) });
      await trade({
        portfolioId: portfolio.id,
        securityId: security.id,
        date: daysAgo(10),
        quantity: '10',
        price: '100',
      });
      await trade({
        portfolioId: portfolio.id,
        securityId: security.id,
        category: INVESTMENT_TRANSACTION_CATEGORY.sell,
        date: daysAgo(8),
        quantity: '9.995',
        price: '100',
      });
      await directCash({ portfolioId: portfolio.id, type: 'withdrawal', amount: '999.5', date: daysAgo(7) });
      await directCash({ portfolioId: portfolio.id, type: 'deposit', amount: '1000', date: daysAgo(4) });
      await trade({
        portfolioId: portfolio.id,
        securityId: security.id,
        date: daysAgo(4),
        quantity: '10',
        price: '50',
      });
      await setPrices({
        securityId: security.id,
        prices: [
          [daysAgo(10), '100'],
          [daysAgo(6), '50'],
          [daysAgo(2), '55'],
        ],
      });

      const byDate = await getPointsByDate({ portfolioId: portfolio.id });

      expect(byDate.get(daysAgo(6))).toMatchObject({ totalValue: '0.25', cashValue: '0.00' });
      expect(Number(byDate.get(daysAgo(6))!.timeWeightedReturn)).toBeCloseTo(0, 6);
      expect(Number(byDate.get(TODAY)!.timeWeightedReturn)).toBeCloseTo(1050.275 / 1000.25 - 1, 4);
    });
  });
});
