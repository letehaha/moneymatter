import { TRANSACTION_TYPES } from '@bt/shared/types';
import { generateRandomRecordId } from '@common/lib/record-id-helpers';
import { describe, expect, it } from '@jest/globals';
import * as helpers from '@tests/helpers';

// A fixed two-month window in the past: bucket edges are exact calendar months and
// no bucket is the in-progress one, so every assertion is deterministic.
const JAN = { start: '2026-01-01', end: '2026-01-31' };
const FEB = { start: '2026-02-01', end: '2026-02-28' };
const RANGE = { from: JAN.start, to: FEB.end, granularity: 'monthly' as const };

/** Unique portfolio name so seeded/default records can never collide with a fixture. */
const createNamedPortfolio = async ({ name }: { name: string }) =>
  helpers.createPortfolio({ payload: { name: `${name} ${generateRandomRecordId()}` }, raw: true });

/** A deposit is an inbound contribution: cash entered the portfolio from outside. */
const deposit = async ({ portfolioId, amount, date }: { portfolioId: string; amount: string; date: string }) =>
  helpers.directCashTransaction({
    portfolioId,
    payload: { type: 'deposit', amount, currencyCode: global.BASE_CURRENCY_CODE, date },
    raw: true,
  });

/** A withdrawal is an outbound contribution: cash left the portfolio to outside. */
const withdraw = async ({ portfolioId, amount, date }: { portfolioId: string; amount: string; date: string }) =>
  helpers.directCashTransaction({
    portfolioId,
    payload: { type: 'withdrawal', amount, currencyCode: global.BASE_CURRENCY_CODE, date },
    raw: true,
  });

describe('GET /stats/investment-contributions', () => {
  it('reports a single deposit as the bucket total and the portfolio legend', async () => {
    const portfolio = await createNamedPortfolio({ name: 'Brokerage' });
    await deposit({ portfolioId: portfolio.id, amount: '500', date: '2026-01-15' });

    const { buckets, portfolios } = await helpers.getInvestmentContributions({ ...RANGE, raw: true });

    expect(buckets).toHaveLength(2);
    expect(buckets[0]!.total).toBe(500);
    expect(buckets[0]!.byPortfolio).toEqual([{ portfolioId: portfolio.id, amount: 500 }]);
    expect(buckets[0]!.savingsNet).toBe(0);
    // No activity in February, so the second bucket is empty rather than absent.
    expect(buckets[1]!.total).toBe(0);
    expect(buckets[1]!.byPortfolio).toEqual([]);
    expect(portfolios).toEqual([{ portfolioId: portfolio.id, name: portfolio.name }]);
  });

  it('stacks two funded portfolios and orders the legend by absolute total desc', async () => {
    const small = await createNamedPortfolio({ name: 'Small' });
    const large = await createNamedPortfolio({ name: 'Large' });
    await deposit({ portfolioId: small.id, amount: '300', date: '2026-01-10' });
    await deposit({ portfolioId: large.id, amount: '800', date: '2026-01-12' });

    const { buckets, portfolios } = await helpers.getInvestmentContributions({ ...RANGE, raw: true });

    expect(buckets[0]!.total).toBe(1100);
    expect(buckets[0]!.byPortfolio).toHaveLength(2);
    expect(buckets[0]!.byPortfolio.find((slice) => slice.portfolioId === small.id)!.amount).toBe(300);
    expect(buckets[0]!.byPortfolio.find((slice) => slice.portfolioId === large.id)!.amount).toBe(800);
    // 800 moves more than 300, so the larger portfolio leads the legend.
    expect(portfolios.map((portfolio) => portfolio.portfolioId)).toEqual([large.id, small.id]);
  });

  it('nets a withdrawal against a deposit in the same bucket down to a signed total', async () => {
    const portfolio = await createNamedPortfolio({ name: 'Trading' });
    await deposit({ portfolioId: portfolio.id, amount: '300', date: '2026-01-05' });
    await withdraw({ portfolioId: portfolio.id, amount: '800', date: '2026-01-20' });

    const { buckets } = await helpers.getInvestmentContributions({ ...RANGE, raw: true });

    // Withdrew 500 more than contributed, so the net contribution is negative.
    expect(buckets[0]!.total).toBe(-500);
    expect(buckets[0]!.byPortfolio).toEqual([{ portfolioId: portfolio.id, amount: -500 }]);
  });

  it('excludes a portfolio-to-portfolio transfer from contributions on both legs', async () => {
    const source = await createNamedPortfolio({ name: 'Source' });
    const destination = await createNamedPortfolio({ name: 'Destination' });
    await deposit({ portfolioId: source.id, amount: '1000', date: '2026-01-08' });

    // A real portfolio<->portfolio move: names both sides, so it never crosses the
    // outer boundary and must add nothing to either portfolio's contribution.
    const transfer = await helpers.createPortfolioTransfer({
      fromPortfolioId: source.id,
      payload: helpers.buildPortfolioTransferPayload({
        toPortfolioId: destination.id,
        currencyCode: global.BASE_CURRENCY_CODE,
        amount: '300',
        date: '2026-01-20',
      }),
      raw: true,
    });
    expect(transfer.id).toBeDefined();

    const { buckets, portfolios } = await helpers.getInvestmentContributions({ ...RANGE, raw: true });

    // Only the source's deposit counts: the transfer neither subtracts from the
    // source nor adds to the destination.
    expect(buckets[0]!.total).toBe(1000);
    expect(buckets[0]!.byPortfolio).toEqual([{ portfolioId: source.id, amount: 1000 }]);
    expect(portfolios.map((portfolio) => portfolio.portfolioId)).toEqual([source.id]);
  });

  it('scopes contributions to the portfolios named in the filter', async () => {
    const kept = await createNamedPortfolio({ name: 'Kept' });
    const dropped = await createNamedPortfolio({ name: 'Dropped' });
    await deposit({ portfolioId: kept.id, amount: '400', date: '2026-01-10' });
    await deposit({ portfolioId: dropped.id, amount: '600', date: '2026-01-11' });

    const { buckets, portfolios } = await helpers.getInvestmentContributions({
      ...RANGE,
      portfolioIds: [kept.id],
      raw: true,
    });

    // The filtered-out portfolio's 600 never enters the total, so it reads 400 not 1,000.
    expect(buckets[0]!.total).toBe(400);
    expect(buckets[0]!.byPortfolio).toEqual([{ portfolioId: kept.id, amount: 400 }]);
    expect(portfolios).toEqual([{ portfolioId: kept.id, name: kept.name }]);
  });

  it('reports user-wide savings as income minus expenses per bucket, independent of contributions', async () => {
    const account = await helpers.createAccount({ raw: true });

    await helpers.createTransaction({
      payload: helpers.buildTransactionPayload({
        accountId: account.id,
        amount: 5000,
        transactionType: TRANSACTION_TYPES.income,
        time: `${JAN.start}T10:00:00.000Z`,
      }),
      raw: true,
    });
    await helpers.createTransaction({
      payload: helpers.buildTransactionPayload({
        accountId: account.id,
        amount: 2000,
        transactionType: TRANSACTION_TYPES.expense,
        time: `${JAN.start}T11:00:00.000Z`,
      }),
      raw: true,
    });
    await helpers.createTransaction({
      payload: helpers.buildTransactionPayload({
        accountId: account.id,
        amount: 1000,
        transactionType: TRANSACTION_TYPES.income,
        time: `${FEB.start}T10:00:00.000Z`,
      }),
      raw: true,
    });

    const { buckets, portfolios } = await helpers.getInvestmentContributions({ ...RANGE, raw: true });

    expect(buckets[0]!.savingsNet).toBe(3000);
    expect(buckets[1]!.savingsNet).toBe(1000);
    // Savings rides alongside contributions: with no portfolios the bars are empty.
    expect(buckets[0]!.total).toBe(0);
    expect(buckets[0]!.byPortfolio).toEqual([]);
    expect(portfolios).toEqual([]);
  });

  it('returns zeroed buckets and an empty legend for a user with no portfolios', async () => {
    const { buckets, portfolios } = await helpers.getInvestmentContributions({ ...RANGE, raw: true });

    expect(buckets).toHaveLength(2);
    expect(buckets[0]!.total).toBe(0);
    expect(buckets[0]!.byPortfolio).toEqual([]);
    expect(buckets[0]!.savingsNet).toBe(0);
    expect(portfolios).toEqual([]);
  });

  it('counts an account-to-portfolio funding as a contribution and never as savings', async () => {
    const account = await helpers.createAccount({ raw: true });
    const portfolio = await createNamedPortfolio({ name: 'Funded' });

    await helpers.accountToPortfolioTransfer({
      portfolioId: portfolio.id,
      payload: { accountId: account.id, amount: '500', date: '2026-01-10' },
      raw: true,
    });

    // A plain income/expense pair in the same bucket gives savingsNet something real
    // to net down to: if the funding expense leaked into savings, this would read
    // 400 (900 - 300 - 500 funding) instead of the correct 600.
    await helpers.createTransaction({
      payload: helpers.buildTransactionPayload({
        accountId: account.id,
        amount: 900,
        transactionType: TRANSACTION_TYPES.income,
        time: `${JAN.start}T10:00:00.000Z`,
      }),
      raw: true,
    });
    await helpers.createTransaction({
      payload: helpers.buildTransactionPayload({
        accountId: account.id,
        amount: 300,
        transactionType: TRANSACTION_TYPES.expense,
        time: `${JAN.start}T11:00:00.000Z`,
      }),
      raw: true,
    });

    const { buckets, portfolios } = await helpers.getInvestmentContributions({ ...RANGE, raw: true });

    // The funding moved cash into the portfolio from outside, so it counts as a
    // contribution just like a direct deposit would.
    expect(buckets[0]!.total).toBe(500);
    expect(buckets[0]!.byPortfolio).toEqual([{ portfolioId: portfolio.id, amount: 500 }]);
    expect(portfolios).toEqual([{ portfolioId: portfolio.id, name: portfolio.name }]);

    // The core no-double-count invariant: the funding expense carries
    // transferNature=transfer_to_portfolio, so it must never also surface in savings.
    // savingsNet here is only the 900 income minus the 300 expense — the 500 funding
    // leg is entirely absent from it.
    expect(buckets[0]!.savingsNet).toBe(600);
  });

  it('excludes contributions to a disabled portfolio', async () => {
    const portfolio = await createNamedPortfolio({ name: 'Disabled' });
    await deposit({ portfolioId: portfolio.id, amount: '500', date: '2026-01-15' });
    // Disable after funding: a disabled portfolio must drop out of scope entirely,
    // not merely reject new activity.
    await helpers.updatePortfolio({ portfolioId: portfolio.id, payload: { isEnabled: false }, raw: true });

    const { buckets, portfolios } = await helpers.getInvestmentContributions({ ...RANGE, raw: true });

    expect(buckets[0]!.total).toBe(0);
    expect(buckets[0]!.byPortfolio).toEqual([]);
    expect(buckets[1]!.total).toBe(0);
    expect(buckets[1]!.byPortfolio).toEqual([]);
    expect(portfolios).toEqual([]);
  });

  it('a portfolioIds filter naming only a non-owned portfolio yields no contributions', async () => {
    const portfolio = await createNamedPortfolio({ name: 'Owned' });
    await deposit({ portfolioId: portfolio.id, amount: '400', date: '2026-01-10' });

    const { buckets, portfolios } = await helpers.getInvestmentContributions({
      ...RANGE,
      portfolioIds: [generateRandomRecordId()],
      raw: true,
    });

    // The client-supplied list can never widen scope to unowned data: an unknown id
    // intersects to an empty scope rather than falling back to all of the user's
    // portfolios, even though the user genuinely has a contribution to report.
    expect(buckets[0]!.total).toBe(0);
    expect(buckets[0]!.byPortfolio).toEqual([]);
    expect(buckets[1]!.total).toBe(0);
    expect(buckets[1]!.byPortfolio).toEqual([]);
    expect(portfolios).toEqual([]);
  });

  it('aggregates contributions into quarterly buckets', async () => {
    const portfolio = await createNamedPortfolio({ name: 'Quarterly' });
    await deposit({ portfolioId: portfolio.id, amount: '300', date: '2026-01-15' });
    await deposit({ portfolioId: portfolio.id, amount: '700', date: '2026-03-05' });

    const { buckets } = await helpers.getInvestmentContributions({
      from: JAN.start,
      to: '2026-03-31',
      granularity: 'quarterly',
      raw: true,
    });

    // January and March fall in the same quarter, so both deposits land in one bucket.
    expect(buckets).toHaveLength(1);
    expect(buckets[0]!.total).toBe(1000);
  });

  describe('adjustments', () => {
    it('excludes a deposit created as an adjustment while still moving its portfolio cash', async () => {
      const portfolio = await createNamedPortfolio({ name: 'Reconciled' });
      await deposit({ portfolioId: portfolio.id, amount: '500', date: '2026-01-10' });
      await helpers.directCashTransaction({
        portfolioId: portfolio.id,
        payload: {
          type: 'deposit',
          amount: '9000',
          currencyCode: global.BASE_CURRENCY_CODE,
          date: '2026-01-20',
          isAdjustment: true,
        },
        raw: true,
      });

      const { buckets } = await helpers.getInvestmentContributions({ ...RANGE, raw: true });

      expect(buckets[0]!.total).toBe(500);
      expect(buckets[0]!.byPortfolio).toEqual([{ portfolioId: portfolio.id, amount: 500 }]);

      const [balance] = await helpers.getPortfolioBalance({
        portfolioId: portfolio.id,
        currencyCode: global.BASE_CURRENCY_CODE,
        raw: true,
      });

      // The correction is not a contribution, but the money is genuinely there.
      expect(balance!.totalCash).toBeNumericEqual(9500);
    }, 60_000);

    it('drops a deposit from contributions once it is flagged as an adjustment and restores it when cleared', async () => {
      const portfolio = await createNamedPortfolio({ name: 'Reclassified' });
      const transfer = await deposit({ portfolioId: portfolio.id, amount: '700', date: '2026-01-12' });

      const before = await helpers.getInvestmentContributions({ ...RANGE, raw: true });
      expect(before.buckets[0]!.total).toBe(700);

      await helpers.setTransferAdjustment({
        portfolioId: portfolio.id,
        transferId: transfer.id,
        payload: { isAdjustment: true },
        raw: true,
      });

      const flagged = await helpers.getInvestmentContributions({ ...RANGE, raw: true });
      expect(flagged.buckets[0]!.total).toBe(0);
      expect(flagged.buckets[0]!.byPortfolio).toEqual([]);

      await helpers.setTransferAdjustment({
        portfolioId: portfolio.id,
        transferId: transfer.id,
        payload: { isAdjustment: false },
        raw: true,
      });

      const cleared = await helpers.getInvestmentContributions({ ...RANGE, raw: true });
      expect(cleared.buckets[0]!.total).toBe(700);
    }, 60_000);

    it('returns 404 for a transfer that does not exist', async () => {
      const portfolio = await createNamedPortfolio({ name: 'Missing' });

      const response = await helpers.setTransferAdjustment({
        portfolioId: portfolio.id,
        transferId: generateRandomRecordId(),
        payload: { isAdjustment: true },
      });

      expect(response.statusCode).toBe(404);
    });

    it('rejects a non-boolean isAdjustment and leaves the contribution untouched', async () => {
      const portfolio = await createNamedPortfolio({ name: 'Bad flag' });
      const transfer = await deposit({ portfolioId: portfolio.id, amount: '300', date: '2026-01-12' });

      const response = await helpers.setTransferAdjustment({
        portfolioId: portfolio.id,
        transferId: transfer.id,
        payload: { isAdjustment: 'yes' as unknown as boolean },
      });
      expect(response.statusCode).toBe(422);

      const after = await helpers.getInvestmentContributions({ ...RANGE, raw: true });
      expect(after.buckets[0]!.total).toBe(300);
    }, 60_000);
  });

  describe('validation', () => {
    it('rejects malformed contribution queries with 422', async () => {
      const unknownGranularity = await helpers.makeRequest({
        method: 'get',
        url: `/stats/investment-contributions?from=${JAN.start}&to=${FEB.end}&granularity=weekly`,
      });
      const missingFrom = await helpers.makeRequest({
        method: 'get',
        url: `/stats/investment-contributions?to=${FEB.end}&granularity=monthly`,
      });
      const malformedFrom = await helpers.makeRequest({
        method: 'get',
        url: `/stats/investment-contributions?from=not-a-date&to=${FEB.end}&granularity=monthly`,
      });
      const invertedRange = await helpers.getInvestmentContributions({
        from: FEB.end,
        to: JAN.start,
        granularity: 'monthly',
      });

      expect(unknownGranularity.statusCode).toBe(422);
      expect(missingFrom.statusCode).toBe(422);
      expect(malformedFrom.statusCode).toBe(422);
      expect(invertedRange.statusCode).toBe(422);
    }, 60_000);
  });
});
