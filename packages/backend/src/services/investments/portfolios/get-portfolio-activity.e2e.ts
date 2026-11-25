import { INVESTMENT_TRANSACTION_CATEGORY, PORTFOLIO_ACTIVITY_FILTERS } from '@bt/shared/types/investments';
import { beforeEach, describe, expect, it } from '@jest/globals';
import { ERROR_CODES } from '@js/errors';
import Portfolios from '@models/investments/portfolios.model';
import Securities from '@models/investments/securities.model';
import * as helpers from '@tests/helpers';

describe('GET /investments/portfolios/:id/activity', () => {
  let portfolio: Portfolios;
  let otherPortfolio: Portfolios;
  let security: Securities;
  let cashCurrencyCode: string;

  beforeEach(async () => {
    [portfolio, otherPortfolio] = await Promise.all([
      helpers.createPortfolio({ payload: { name: 'Main' }, raw: true }),
      helpers.createPortfolio({ payload: { name: 'Other' }, raw: true }),
    ]);

    const [seeded] = await helpers.seedSecurities([{ symbol: 'VOO', name: 'Vanguard S&P 500 ETF' }]);
    security = seeded!;

    await helpers.createHolding({ payload: { portfolioId: portfolio.id, securityId: security.id } });
    await helpers.updatePortfolioBalance({
      portfolioId: portfolio.id,
      currencyCode: security.currencyCode,
      setAvailableCash: '10000',
      setTotalCash: '10000',
    });

    const account = await helpers.createAccount({ raw: true });
    cashCurrencyCode = account.currencyCode;
  });

  const cashMove = async ({ type, date }: { type: 'deposit' | 'withdrawal'; date: string }) =>
    helpers.directCashTransaction({
      portfolioId: portfolio.id,
      payload: { type, amount: type === 'deposit' ? '1000' : '100', currencyCode: cashCurrencyCode, date },
      raw: true,
    });

  const trade = async ({ category, date }: { category: INVESTMENT_TRANSACTION_CATEGORY; date: string }) =>
    helpers.createInvestmentTransaction({
      payload: { portfolioId: portfolio.id, securityId: security.id, category, date, quantity: '1', price: '10' },
      raw: true,
    });

  const seedInterleavedActivity = async () => {
    const firstDeposit = await cashMove({ type: 'deposit', date: '2025-01-10' });
    const buy = await trade({ category: INVESTMENT_TRANSACTION_CATEGORY.buy, date: '2025-01-12' });
    const withdrawal = await cashMove({ type: 'withdrawal', date: '2025-01-15' });
    const portfolioTransfer = await helpers.createPortfolioTransfer({
      fromPortfolioId: portfolio.id,
      payload: helpers.buildPortfolioTransferPayload({
        toPortfolioId: otherPortfolio.id,
        currencyCode: cashCurrencyCode,
        date: '2025-01-18',
      }),
      raw: true,
    });
    const dividend = await trade({ category: INVESTMENT_TRANSACTION_CATEGORY.dividend, date: '2025-01-20' });
    const sell = await trade({ category: INVESTMENT_TRANSACTION_CATEGORY.sell, date: '2025-01-25' });
    // Same day as the sell, created later, so the createdAt tiebreak puts it first.
    const sameDayDeposit = await cashMove({ type: 'deposit', date: '2025-01-25' });

    return { firstDeposit, buy, withdrawal, portfolioTransfer, dividend, sell, sameDayDeposit };
  };

  it('merges trades and transfers newest first', async () => {
    const seeded = await seedInterleavedActivity();

    const result = await helpers.getPortfolioActivity({ portfolioId: portfolio.id, raw: true });

    expect(result.data.map((item) => [item.kind, item.id])).toEqual([
      ['transfer', seeded.sameDayDeposit.id],
      ['trade', seeded.sell.id],
      ['trade', seeded.dividend.id],
      ['transfer', seeded.portfolioTransfer.id],
      ['transfer', seeded.withdrawal.id],
      ['trade', seeded.buy.id],
      ['transfer', seeded.firstDeposit.id],
    ]);
    expect(result.pagination).toMatchObject({ limit: 20, offset: 0, page: 1, totalCount: 7 });

    const sellRow = result.data[1]!;
    expect(sellRow.kind === 'trade' && sellRow.security?.symbol).toBe('VOO');
    expect(sellRow).toMatchObject({ category: INVESTMENT_TRANSACTION_CATEGORY.sell, quantity: expect.anything() });

    const transferRow = result.data[3]!;
    expect(transferRow).toMatchObject({
      fromPortfolioId: portfolio.id,
      toPortfolioId: otherPortfolio.id,
      amount: expect.toBeNumericEqual(100),
      currencyCode: cashCurrencyCode,
    });
  });

  it('filters by type', async () => {
    const seeded = await seedInterleavedActivity();

    const [trades, cash, income] = await Promise.all(
      [PORTFOLIO_ACTIVITY_FILTERS.trades, PORTFOLIO_ACTIVITY_FILTERS.cash, PORTFOLIO_ACTIVITY_FILTERS.income].map(
        (type) => helpers.getPortfolioActivity({ portfolioId: portfolio.id, type, raw: true }),
      ),
    );

    expect(trades!.data.map((item) => item.id)).toEqual([seeded.sell.id, seeded.buy.id]);
    expect(trades!.pagination.totalCount).toBe(2);

    expect(cash!.data.map((item) => item.id)).toEqual([
      seeded.sameDayDeposit.id,
      seeded.portfolioTransfer.id,
      seeded.withdrawal.id,
      seeded.firstDeposit.id,
    ]);
    expect(cash!.data.every((item) => item.kind === 'transfer')).toBe(true);
    expect(cash!.pagination.totalCount).toBe(4);

    expect(income!.data.map((item) => item.id)).toEqual([seeded.dividend.id]);
    expect(income!.pagination.totalCount).toBe(1);
  });

  it('pages across the boundary without duplicates or gaps', async () => {
    await seedInterleavedActivity();

    const full = await helpers.getPortfolioActivity({ portfolioId: portfolio.id, raw: true });
    const pages = await Promise.all(
      [0, 3, 6].map((offset) =>
        helpers.getPortfolioActivity({ portfolioId: portfolio.id, limit: 3, offset, raw: true }),
      ),
    );

    expect(pages.map((page) => page.data.length)).toEqual([3, 3, 1]);
    expect(pages.flatMap((page) => page.data.map((item) => item.id))).toEqual(full.data.map((item) => item.id));
    expect(pages[1]!.pagination).toMatchObject({ limit: 3, offset: 3, page: 2, totalCount: 7 });
  });

  it('lists the other side of a portfolio-to-portfolio transfer', async () => {
    const { portfolioTransfer } = await seedInterleavedActivity();

    const result = await helpers.getPortfolioActivity({ portfolioId: otherPortfolio.id, raw: true });

    expect(result.data.map((item) => item.id)).toEqual([portfolioTransfer.id]);
  });

  it('returns an empty list for a portfolio without activity', async () => {
    const result = await helpers.getPortfolioActivity({ portfolioId: otherPortfolio.id, raw: true });

    expect(result.data).toEqual([]);
    expect(result.pagination.totalCount).toBe(0);
  });

  it("returns 404 for another user's portfolio", async () => {
    const { cookies } = await helpers.signUpSecondUser();
    const response = await helpers.asUser({
      cookies,
      fn: () => helpers.getPortfolioActivity({ portfolioId: portfolio.id }),
    });

    expect(response.statusCode).toBe(ERROR_CODES.NotFoundError);
  });

  it('rejects an unknown type filter', async () => {
    const response = await helpers.getPortfolioActivity({
      portfolioId: portfolio.id,
      type: 'unknown' as never,
    });

    expect(response.statusCode).toBe(ERROR_CODES.ValidationError);
  });
});
