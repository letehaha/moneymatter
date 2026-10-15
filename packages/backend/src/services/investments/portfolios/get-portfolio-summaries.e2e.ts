import { ASSET_CLASS, SECURITY_PROVIDER } from '@bt/shared/types';
import { describe, expect, it } from '@jest/globals';
import Securities from '@models/investments/securities.model';
import UsersCurrencies from '@models/users-currencies.model';
import * as helpers from '@tests/helpers';

// Deposits come from a base-currency account, so the portfolio value in base equals `amount`.
const createFundedPortfolio = async ({ name, amount }: { name: string; amount: string }) => {
  const portfolio = await helpers.createPortfolio({
    payload: helpers.buildPortfolioPayload({ name }),
    raw: true,
  });
  const account = await helpers.createAccount({
    payload: helpers.buildAccountPayload({ name: `${name} Cash Source` }),
    raw: true,
  });

  await helpers.accountToPortfolioTransfer({
    portfolioId: portfolio.id,
    payload: { accountId: account.id, amount, date: '2025-06-15' },
    raw: true,
  });

  return portfolio;
};

// SSP exists in the Currencies table but the mocked rate providers serve no
// rate for it, so converting this holding's cost basis to base throws.
const createBrokenPortfolio = async () => {
  const portfolio = await helpers.createPortfolio({
    payload: helpers.buildPortfolioPayload({ name: 'Broken Portfolio' }),
    raw: true,
  });
  const security = await Securities.create({
    symbol: 'NORATE',
    providerSymbol: 'NORATE',
    currencyCode: 'SSP',
    providerName: SECURITY_PROVIDER.fmp,
    assetClass: ASSET_CLASS.stocks,
    name: 'Rateless Currency Test Security',
  });
  await helpers.createHolding({
    payload: { portfolioId: portfolio.id, securityId: security.id },
  });

  return portfolio;
};

describe('Portfolio Summaries (GET /investments/portfolios/summaries)', () => {
  it('returns an empty list when the user has no portfolios', async () => {
    const summaries = await helpers.getPortfolioSummaries({ raw: true });

    expect(summaries).toEqual([]);
  });

  it('returns every portfolio summary exactly as the single-summary endpoint reports it', async () => {
    const first = await createFundedPortfolio({ name: 'First Portfolio', amount: '1000' });
    const second = await createFundedPortfolio({ name: 'Second Portfolio', amount: '250' });

    const summaries = await helpers.getPortfolioSummaries({ raw: true });

    expect(summaries).toHaveLength(2);

    for (const portfolio of [first, second]) {
      const single = await helpers.getPortfolioSummary({ portfolioId: portfolio.id, raw: true });

      expect(summaries.find((summary) => summary.portfolioId === portfolio.id)).toEqual(single);
    }

    const valueInBaseById = Object.fromEntries(
      summaries.map((summary) => [summary.portfolioId, summary.totalPortfolioValueInBaseCurrency]),
    );
    expect(valueInBaseById).toEqual({ [first.id]: '1000.00', [second.id]: '250.00' });
  });

  it('excludes a trashed portfolio', async () => {
    const kept = await helpers.createPortfolio({
      payload: helpers.buildPortfolioPayload({ name: 'Kept Portfolio' }),
      raw: true,
    });
    const trashed = await helpers.createPortfolio({
      payload: helpers.buildPortfolioPayload({ name: 'Trashed Portfolio' }),
      raw: true,
    });

    const deleteResponse = await helpers.deletePortfolio({ portfolioId: trashed.id });
    expect(deleteResponse.statusCode).toBe(200);

    const summaries = await helpers.getPortfolioSummaries({ raw: true });

    expect(summaries.map((summary) => summary.portfolioId)).toEqual([kept.id]);
  });

  it("does not return another user's portfolios", async () => {
    await helpers.createPortfolio({ raw: true });

    const { cookies } = await helpers.signUpSecondUser();
    const summaries = await helpers.asUser({
      cookies,
      fn: () => helpers.getPortfolioSummaries({ raw: true }),
    });

    expect(summaries).toEqual([]);
  });

  it('responds 401 without a session', async () => {
    const response = await helpers.withoutSession(() => helpers.getPortfolioSummaries());

    expect(response.statusCode).toBe(401);
  });

  it('omits a portfolio whose summary cannot be computed and still returns the others', async () => {
    const healthyBefore = await createFundedPortfolio({ name: 'Healthy Before', amount: '1000' });
    const broken = await createBrokenPortfolio();
    const healthyAfter = await createFundedPortfolio({ name: 'Healthy After', amount: '250' });

    const single = await helpers.getPortfolioSummary({ portfolioId: broken.id });
    expect(single.statusCode).not.toBe(200);

    const summaries = await helpers.getPortfolioSummaries({ raw: true });

    expect(summaries).toHaveLength(2);
    expect(summaries.map((summary) => summary.portfolioId)).toEqual(
      expect.arrayContaining([healthyBefore.id, healthyAfter.id]),
    );
  });

  it('keeps a portfolio whose holding currency is no longer connected to the user', async () => {
    const [eurSecurity] = await helpers.seedSecurities([{ symbol: 'ASML', name: 'ASML Holding', currencyCode: 'EUR' }]);
    const portfolio = await helpers.createPortfolio({
      payload: helpers.buildPortfolioPayload({ name: 'Orphan Currency Portfolio' }),
      raw: true,
    });
    await helpers.createHolding({ payload: { portfolioId: portfolio.id, securityId: eurSecurity!.id } });

    // The API guard blocks this disconnect; the orphan state exists in production data.
    await UsersCurrencies.destroy({ where: { currencyCode: 'EUR' } });

    const single = await helpers.getPortfolioSummary({ portfolioId: portfolio.id });
    expect(single.statusCode).toBe(200);

    const summaries = await helpers.getPortfolioSummaries({ raw: true });
    expect(summaries.map((summary) => summary.portfolioId)).toEqual([portfolio.id]);
  });

  it('fails with the single-summary status when no portfolio summary can be computed', async () => {
    const broken = await createBrokenPortfolio();

    const single = await helpers.getPortfolioSummary({ portfolioId: broken.id });
    expect(single.statusCode).not.toBe(200);

    const response = await helpers.getPortfolioSummaries();

    expect(response.statusCode).toBe(single.statusCode);
  });
});
