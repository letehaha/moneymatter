import { ASSET_CLASS, INVESTMENT_TRANSACTION_CATEGORY, SECURITY_PROVIDER } from '@bt/shared/types/investments';
import { generateRandomRecordId } from '@common/lib/record-id-helpers';
import { beforeEach, describe, expect, it } from '@jest/globals';
import { ERROR_CODES } from '@js/errors';
import Portfolios from '@models/investments/portfolios.model';
import Securities from '@models/investments/securities.model';
import * as helpers from '@tests/helpers';

describe('POST /transaction (create investment transaction)', () => {
  let investmentPortfolio: Portfolios;
  let vooSecurity: Securities;

  beforeEach(async () => {
    investmentPortfolio = await helpers.createPortfolio({
      payload: helpers.buildPortfolioPayload({
        name: 'Test Investment Portfolio',
      }),
      raw: true,
    });

    const seededSecurities: Securities[] = await helpers.seedSecurities([
      { symbol: 'VOO', name: 'Vanguard S&P 500 ETF' },
    ]);
    vooSecurity = seededSecurities.find((s) => s.symbol === 'VOO')!;
    if (!vooSecurity) throw new Error('VOO security not found after seeding');

    await helpers.createHolding({
      payload: {
        portfolioId: investmentPortfolio.id,
        securityId: vooSecurity.id,
      },
    });
  });

  it('should create a buy transaction successfully', async () => {
    const response = await helpers.createInvestmentTransaction({
      payload: {
        portfolioId: investmentPortfolio.id,
        securityId: vooSecurity.id,
        category: INVESTMENT_TRANSACTION_CATEGORY.buy,
        quantity: '2',
        price: '50',
      },
    });

    expect(response.statusCode).toBe(201);
    const transaction = helpers.extractResponse(response);
    expect(transaction.portfolioId).toBe(investmentPortfolio.id);
    expect(transaction.securityId).toBe(vooSecurity.id);
    expect(transaction.category).toBe(INVESTMENT_TRANSACTION_CATEGORY.buy);
    expect(transaction.quantity).toBeNumericEqual(2);
    expect(transaction.price).toBeNumericEqual(50);

    // Verify holding was updated
    const [holding] = await helpers.getHoldings({
      portfolioId: investmentPortfolio.id,
      payload: { securityId: vooSecurity.id },
      raw: true,
    });
    expect(holding).toBeTruthy();
    expect(holding!.quantity).toBeNumericEqual(2);
    expect(holding!.costBasis).toBeNumericEqual(100);
  });

  it('should create a sell transaction successfully', async () => {
    // First create a buy transaction to have shares to sell
    await helpers.createInvestmentTransaction({
      payload: {
        portfolioId: investmentPortfolio.id,
        securityId: vooSecurity.id,
        category: INVESTMENT_TRANSACTION_CATEGORY.buy,
        quantity: '5',
        price: '40',
      },
    });

    // Now create the sell transaction
    const response = await helpers.createInvestmentTransaction({
      payload: {
        portfolioId: investmentPortfolio.id,
        securityId: vooSecurity.id,
        category: INVESTMENT_TRANSACTION_CATEGORY.sell,
        quantity: '2',
        price: '50',
      },
    });

    expect(response.statusCode).toBe(201);
    const transaction = helpers.extractResponse(response);
    expect(transaction.portfolioId).toBe(investmentPortfolio.id);
    expect(transaction.securityId).toBe(vooSecurity.id);
    expect(transaction.category).toBe(INVESTMENT_TRANSACTION_CATEGORY.sell);
    expect(transaction.quantity).toBeNumericEqual(2);
    expect(transaction.price).toBeNumericEqual(50);

    // Verify holding was updated
    const [holding] = await helpers.getHoldings({
      portfolioId: investmentPortfolio.id,
      payload: { securityId: vooSecurity.id },
      raw: true,
    });
    expect(holding).toBeTruthy();
    expect(holding!.quantity).toBeNumericEqual(3);
    expect(holding!.costBasis).toBeNumericEqual(120);
  });

  it('rejects invalid create requests', async () => {
    // Runs first, while the holding is still at quantity 0
    const insufficientShares = await helpers.createInvestmentTransaction({
      payload: {
        portfolioId: investmentPortfolio.id,
        securityId: vooSecurity.id,
        category: INVESTMENT_TRANSACTION_CATEGORY.sell,
        quantity: '1',
        price: '50',
      },
    });
    expect(insufficientShares.statusCode).toBe(ERROR_CODES.ValidationError);

    const unknownPortfolio = await helpers.createInvestmentTransaction({
      payload: {
        portfolioId: generateRandomRecordId(),
        securityId: vooSecurity.id,
        category: INVESTMENT_TRANSACTION_CATEGORY.buy,
        quantity: '1',
        price: '50',
      },
    });
    expect(unknownPortfolio.statusCode).toBe(ERROR_CODES.NotFoundError);

    const unknownSecurity = await helpers.createInvestmentTransaction({
      payload: {
        portfolioId: investmentPortfolio.id,
        securityId: generateRandomRecordId(),
        category: INVESTMENT_TRANSACTION_CATEGORY.buy,
        quantity: '1',
        price: '50',
      },
    });
    expect(unknownSecurity.statusCode).toBe(ERROR_CODES.NotFoundError);

    const negativeQuantity = await helpers.createInvestmentTransaction({
      payload: {
        portfolioId: investmentPortfolio.id,
        securityId: vooSecurity.id,
        category: INVESTMENT_TRANSACTION_CATEGORY.buy,
        quantity: '-1',
        price: '50',
      },
    });
    expect(negativeQuantity.statusCode).toBe(ERROR_CODES.ValidationError);

    const negativePrice = await helpers.createInvestmentTransaction({
      payload: {
        portfolioId: investmentPortfolio.id,
        securityId: vooSecurity.id,
        category: INVESTMENT_TRANSACTION_CATEGORY.buy,
        quantity: '1',
        price: '-50',
      },
    });
    expect(negativePrice.statusCode).toBe(ERROR_CODES.ValidationError);
  }, 30000);

  it('accepts a zero-price buy (staking reward, airdrop, balance adjustment)', async () => {
    // A zero-price BUY is a real position change with no cash consideration —
    // staking rewards, airdrops, "balance adjustment for missing tokens", etc.
    // Quantity must still go up; cost basis is just the fee (often zero too).
    const response = await helpers.createInvestmentTransaction({
      payload: {
        portfolioId: investmentPortfolio.id,
        securityId: vooSecurity.id,
        category: INVESTMENT_TRANSACTION_CATEGORY.buy,
        quantity: '3',
        price: '0',
      },
    });

    expect(response.statusCode).toBe(201);
    const tx = helpers.extractResponse(response);
    expect(tx.price).toBeNumericEqual(0);
    expect(tx.quantity).toBeNumericEqual(3);

    const [holding] = await helpers.getHoldings({
      portfolioId: investmentPortfolio.id,
      payload: { securityId: vooSecurity.id },
      raw: true,
    });
    expect(holding!.quantity).toBeNumericEqual(3);
    // No price paid, no fees → cost basis stays at zero.
    expect(holding!.costBasis).toBeNumericEqual(0);

    // The frontend InputField with type="number" emits a JS number, so the
    // payload sends `price: 0` rather than `price: "0"`. Both must be valid —
    // the zod schema is a union of string/number on numericString.
    const numericPayloadResponse = await helpers.createInvestmentTransaction({
      payload: {
        portfolioId: investmentPortfolio.id,
        securityId: vooSecurity.id,
        category: INVESTMENT_TRANSACTION_CATEGORY.buy,
        quantity: 2,
        price: 0,
        fees: 0,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
    });

    expect(numericPayloadResponse.statusCode).toBe(201);
    const numericPayloadTx = helpers.extractResponse(numericPayloadResponse);
    expect(numericPayloadTx.price).toBeNumericEqual(0);
    expect(numericPayloadTx.quantity).toBeNumericEqual(2);
  }, 30000);

  it('creates fee, tax and dividend transactions', async () => {
    // FEE and TAX record standalone broker/withholding events against the
    // holding without changing the share count; DIVIDEND records cash income.
    const feeResponse = await helpers.createInvestmentTransaction({
      payload: {
        portfolioId: investmentPortfolio.id,
        securityId: vooSecurity.id,
        category: INVESTMENT_TRANSACTION_CATEGORY.fee,
        quantity: '1',
        price: '10',
        fees: '0',
      },
    });

    expect(feeResponse.statusCode).toBe(201);
    const feeTx = helpers.extractResponse(feeResponse);
    expect(feeTx.category).toBe(INVESTMENT_TRANSACTION_CATEGORY.fee);
    expect(feeTx.price).toBeNumericEqual(10);

    const taxResponse = await helpers.createInvestmentTransaction({
      payload: {
        portfolioId: investmentPortfolio.id,
        securityId: vooSecurity.id,
        category: INVESTMENT_TRANSACTION_CATEGORY.tax,
        quantity: '1',
        price: '5',
        fees: '0',
      },
    });

    expect(taxResponse.statusCode).toBe(201);
    const taxTx = helpers.extractResponse(taxResponse);
    expect(taxTx.category).toBe(INVESTMENT_TRANSACTION_CATEGORY.tax);
    expect(taxTx.price).toBeNumericEqual(5);

    const dividendResponse = await helpers.createInvestmentTransaction({
      payload: {
        portfolioId: investmentPortfolio.id,
        securityId: vooSecurity.id,
        category: INVESTMENT_TRANSACTION_CATEGORY.dividend,
        quantity: '1',
        price: '25',
        fees: '0',
      },
    });

    expect(dividendResponse.statusCode).toBe(201);
    const dividendTx = helpers.extractResponse(dividendResponse);
    expect(dividendTx.category).toBe(INVESTMENT_TRANSACTION_CATEGORY.dividend);
    expect(dividendTx.price).toBeNumericEqual(25);
  }, 30000);

  it('stores amount as cash paid for outflows and cash received for inflows', async () => {
    const create = async ({
      category,
      quantity,
      price,
      fees,
    }: {
      category: INVESTMENT_TRANSACTION_CATEGORY;
      quantity: string;
      price: string;
      fees: string;
    }) =>
      helpers.createInvestmentTransaction({
        payload: { portfolioId: investmentPortfolio.id, securityId: vooSecurity.id, category, quantity, price, fees },
        raw: true,
      });

    const buyTx = await create({
      category: INVESTMENT_TRANSACTION_CATEGORY.buy,
      quantity: '10',
      price: '100',
      fees: '5',
    });
    expect(buyTx.amount).toBeNumericEqual(1005);

    const sellTx = await create({
      category: INVESTMENT_TRANSACTION_CATEGORY.sell,
      quantity: '2',
      price: '150',
      fees: '3',
    });
    expect(sellTx.amount).toBeNumericEqual(297);

    const dividendTx = await create({
      category: INVESTMENT_TRANSACTION_CATEGORY.dividend,
      quantity: '1',
      price: '1.51',
      fees: '0.46',
    });
    expect(dividendTx.amount).toBeNumericEqual(1.05);
  }, 30000);

  it('rejects a dividend whose fees exceed the gross payout', async () => {
    const response = await helpers.createInvestmentTransaction({
      payload: {
        portfolioId: investmentPortfolio.id,
        securityId: vooSecurity.id,
        category: INVESTMENT_TRANSACTION_CATEGORY.dividend,
        quantity: '1',
        price: '0.10',
        fees: '0.46',
      },
    });

    expect(response.statusCode).toBe(ERROR_CODES.ValidationError);
  });

  it('stores a date-only input as UTC midnight', async () => {
    // A date-only string (no time component) must be stored as UTC midnight so
    // the persisted instant is deterministic and independent of the DB session
    // timezone. `new Date('2026-03-01')` in JS parses as 2026-03-01T00:00:00Z,
    // which is exactly what the column should contain.
    const response = await helpers.createInvestmentTransaction({
      payload: {
        portfolioId: investmentPortfolio.id,
        securityId: vooSecurity.id,
        category: INVESTMENT_TRANSACTION_CATEGORY.buy,
        quantity: '1',
        price: '100',
        date: '2026-03-01',
      },
    });

    expect(response.statusCode).toBe(201);
    const tx = helpers.extractResponse(response);
    expect(tx.date).toBe('2026-03-01T00:00:00.000Z');
  });

  describe('crypto sell oversell', () => {
    let btcSecurity: Securities;

    beforeEach(async () => {
      btcSecurity = await Securities.create({
        symbol: 'BTC',
        providerSymbol: 'bitcoin',
        name: 'Bitcoin',
        assetClass: ASSET_CLASS.crypto,
        providerName: SECURITY_PROVIDER.coingecko,
        currencyCode: 'USD',
      });

      await helpers.createHolding({
        payload: {
          portfolioId: investmentPortfolio.id,
          securityId: btcSecurity.id,
        },
      });
    });

    it('records a crypto staking reward as a zero-price buy', async () => {
      // Real-world flow: user stakes ETH/SOL/etc. and earns more of the same
      // token over time. The position quantity grows, no cash leaves the
      // account, and average cost basis dilutes — which is exactly what a BUY
      // with price=0 produces. This test locks the supported pattern in so a
      // future regression on the zero-price validator gets caught.
      const buyResponse = await helpers.createInvestmentTransaction({
        payload: {
          portfolioId: investmentPortfolio.id,
          securityId: btcSecurity.id,
          category: INVESTMENT_TRANSACTION_CATEGORY.buy,
          quantity: '0.5',
          price: '50000',
        },
      });
      expect(buyResponse.statusCode).toBe(201);

      // Stake reward: +0.01 BTC, no cash impact.
      const stakeResponse = await helpers.createInvestmentTransaction({
        payload: {
          portfolioId: investmentPortfolio.id,
          securityId: btcSecurity.id,
          category: INVESTMENT_TRANSACTION_CATEGORY.buy,
          quantity: '0.01',
          price: '0',
        },
      });
      expect(stakeResponse.statusCode).toBe(201);

      const [holding] = await helpers.getHoldings({
        portfolioId: investmentPortfolio.id,
        payload: { securityId: btcSecurity.id },
        raw: true,
      });
      expect(holding!.quantity).toBeNumericEqual(0.51);
      // Cost basis unchanged from the original buy — the staked tokens cost
      // nothing, so the average cost per token drops naturally.
      expect(holding!.costBasis).toBeNumericEqual(25000);
    });

    it('allows selling crypto with no prior holdings (drift correction)', async () => {
      const response = await helpers.createInvestmentTransaction({
        payload: {
          portfolioId: investmentPortfolio.id,
          securityId: btcSecurity.id,
          category: INVESTMENT_TRANSACTION_CATEGORY.sell,
          quantity: '0.5',
          price: '60000',
        },
      });

      expect(response.statusCode).toBe(201);
      const transaction = helpers.extractResponse(response);
      expect(transaction.quantity).toBeNumericEqual(0.5);

      const [holding] = await helpers.getHoldings({
        portfolioId: investmentPortfolio.id,
        payload: { securityId: btcSecurity.id },
        raw: true,
      });
      expect(holding!.quantity).toBeNumericEqual(-0.5);
    });

    it('allows selling more crypto than owned (staking/fee drift)', async () => {
      // Buy 1 BTC first
      await helpers.createInvestmentTransaction({
        payload: {
          portfolioId: investmentPortfolio.id,
          securityId: btcSecurity.id,
          category: INVESTMENT_TRANSACTION_CATEGORY.buy,
          quantity: '1',
          price: '50000',
        },
      });

      // Now sell 1.5 BTC even though only 1 is tracked
      const response = await helpers.createInvestmentTransaction({
        payload: {
          portfolioId: investmentPortfolio.id,
          securityId: btcSecurity.id,
          category: INVESTMENT_TRANSACTION_CATEGORY.sell,
          quantity: '1.5',
          price: '60000',
        },
      });

      expect(response.statusCode).toBe(201);

      const [holding] = await helpers.getHoldings({
        portfolioId: investmentPortfolio.id,
        payload: { securityId: btcSecurity.id },
        raw: true,
      });
      expect(holding!.quantity).toBeNumericEqual(-0.5);
    });

    it('does not inflate cost basis when sells happen while quantity is negative', async () => {
      // Regression test for a bug observed after importing a Yahoo crypto CSV
      // (weighted-average accounting on FIFO-style data): once running quantity
      // dipped negative and subsequent BUYs accumulated cost while still short,
      // each later SELL flipped the `quantity / totalQuantity` proportion sign
      // and ADDED to cost basis instead of reducing it. A 0.28 BTC ending
      // position ended up showing $1.27M cost basis on production data.
      const txs: { category: INVESTMENT_TRANSACTION_CATEGORY; quantity: string; price: string; date: string }[] = [
        // Build a long position
        { category: INVESTMENT_TRANSACTION_CATEGORY.buy, quantity: '0.5', price: '50000', date: '2024-01-01' },
        // Oversell — qty drops to -0.5 (allowed for crypto)
        { category: INVESTMENT_TRANSACTION_CATEGORY.sell, quantity: '1.0', price: '60000', date: '2024-02-01' },
        // Buy that does NOT bring qty above zero (would have leaked +cost in old code)
        { category: INVESTMENT_TRANSACTION_CATEGORY.buy, quantity: '0.2', price: '100000', date: '2024-03-01' },
        // Two sells while still short — old code would inflate cost basis here
        { category: INVESTMENT_TRANSACTION_CATEGORY.sell, quantity: '0.1', price: '120000', date: '2024-04-01' },
        { category: INVESTMENT_TRANSACTION_CATEGORY.sell, quantity: '0.1', price: '120000', date: '2024-05-01' },
      ];

      for (const tx of txs) {
        const res = await helpers.createInvestmentTransaction({
          payload: {
            portfolioId: investmentPortfolio.id,
            securityId: btcSecurity.id,
            category: tx.category,
            quantity: tx.quantity,
            price: tx.price,
            date: tx.date,
          },
        });
        expect(res.statusCode).toBe(201);
      }

      const [holding] = await helpers.getHoldings({
        portfolioId: investmentPortfolio.id,
        payload: { securityId: btcSecurity.id },
        raw: true,
      });

      // qty: 0.5 - 1.0 + 0.2 - 0.1 - 0.1 = -0.5
      expect(holding!.quantity).toBeNumericEqual(-0.5);

      // Position is net short — there is no long position to attribute cost to,
      // so cost basis must be zero. Old buggy code produced a positive cost
      // basis here (the proportion flip kept inflating it).
      expect(holding!.costBasis).toBeNumericEqual(0);
      expect(holding!.refCostBasis).toBeNumericEqual(0);
    });

    it('starts a fresh cost basis when a buy brings a short position back to long', async () => {
      // After a crypto position goes short and a later buy crosses back into a
      // long position, only the qty *above zero* should establish new basis —
      // the portion that covered the short is a separate P&L event, not a cost.
      // Buy 0.5, sell 1.0 → qty=-0.5
      // Buy 2.0 at $100k → covers 0.5 short + leaves 1.5 long; long basis = 1.5 * $100k
      await helpers.createInvestmentTransaction({
        payload: {
          portfolioId: investmentPortfolio.id,
          securityId: btcSecurity.id,
          category: INVESTMENT_TRANSACTION_CATEGORY.buy,
          quantity: '0.5',
          price: '50000',
          date: '2024-01-01',
        },
      });
      await helpers.createInvestmentTransaction({
        payload: {
          portfolioId: investmentPortfolio.id,
          securityId: btcSecurity.id,
          category: INVESTMENT_TRANSACTION_CATEGORY.sell,
          quantity: '1.0',
          price: '60000',
          date: '2024-02-01',
        },
      });
      await helpers.createInvestmentTransaction({
        payload: {
          portfolioId: investmentPortfolio.id,
          securityId: btcSecurity.id,
          category: INVESTMENT_TRANSACTION_CATEGORY.buy,
          quantity: '2.0',
          price: '100000',
          date: '2024-03-01',
        },
      });

      const [holding] = await helpers.getHoldings({
        portfolioId: investmentPortfolio.id,
        payload: { securityId: btcSecurity.id },
        raw: true,
      });

      expect(holding!.quantity).toBeNumericEqual(1.5);
      // 1.5 BTC at $100k each = $150k. The covering 0.5 BTC of the same buy is
      // P&L on the short, not cost basis on the new long.
      expect(holding!.costBasis).toBeNumericEqual(150000);
    });
  });
});
