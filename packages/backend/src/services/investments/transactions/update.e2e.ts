import { TRANSACTION_TYPES } from '@bt/shared/types';
import { ASSET_CLASS, INVESTMENT_TRANSACTION_CATEGORY, SECURITY_PROVIDER } from '@bt/shared/types/investments';
import { generateRandomRecordId } from '@common/lib/record-id-helpers';
import { beforeEach, describe, expect, it } from '@jest/globals';
import { ERROR_CODES } from '@js/errors';
import InvestmentTransaction from '@models/investments/investment-transaction.model';
import Portfolios from '@models/investments/portfolios.model';
import Securities from '@models/investments/securities.model';
import * as helpers from '@tests/helpers';

describe('PUT /investments/transaction/:transactionId (update investment transaction)', () => {
  let portfolio: Portfolios;
  let vooSecurity: Securities;
  let transaction: InvestmentTransaction;

  beforeEach(async () => {
    portfolio = await helpers.createPortfolio({
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
        portfolioId: portfolio.id,
        securityId: vooSecurity.id,
      },
    });

    // Create a transaction to update
    transaction = await helpers.createInvestmentTransaction({
      payload: {
        portfolioId: portfolio.id,
        securityId: vooSecurity.id,
        category: INVESTMENT_TRANSACTION_CATEGORY.buy,
        quantity: '2',
        price: '50',
        fees: '5',
      },
      raw: true,
    });
  });

  it('updates single and multiple fields and echoes the recomputed amount', async () => {
    const unchanged = await helpers.updateInvestmentTransaction({
      transactionId: transaction.id,
      payload: {},
      raw: true,
    });

    expect(unchanged.quantity).toBeNumericEqual(2);
    expect(unchanged.price).toBeNumericEqual(50);
    expect(unchanged.fees).toBeNumericEqual(5);
    expect(unchanged.name).toBe(''); // Empty string since no name was provided during creation

    const quantityUpdated = await helpers.updateInvestmentTransaction({
      transactionId: transaction.id,
      payload: {
        quantity: '3',
      },
      raw: true,
    });

    expect(quantityUpdated.quantity).toBeNumericEqual(3);
    expect(quantityUpdated.amount).toBeNumericEqual(155); // (3 * 50) + 5 fees
    expect(quantityUpdated.price).toBeNumericEqual(50);
    expect(quantityUpdated.fees).toBeNumericEqual(5);

    const priceUpdated = await helpers.updateInvestmentTransaction({
      transactionId: transaction.id,
      payload: {
        price: '60',
      },
      raw: true,
    });

    expect(priceUpdated.price).toBeNumericEqual(60);
    expect(priceUpdated.amount).toBeNumericEqual(185); // (3 * 60) + 5 fees
    expect(priceUpdated.quantity).toBeNumericEqual(3);
    expect(priceUpdated.fees).toBeNumericEqual(5);

    const multiFieldUpdated = await helpers.updateInvestmentTransaction({
      transactionId: transaction.id,
      payload: { quantity: '4', price: '75', fees: '10', name: 'Updated transaction' },
      raw: true,
    });

    expect(multiFieldUpdated.quantity).toBeNumericEqual(4);
    expect(multiFieldUpdated.price).toBeNumericEqual(75);
    expect(multiFieldUpdated.fees).toBeNumericEqual(10);
    expect(multiFieldUpdated.amount).toBeNumericEqual(310); // (4 * 75) + 10 fees
    expect(multiFieldUpdated.name).toBe('Updated transaction');
  }, 30000);

  it('should update transaction category successfully', async () => {
    const newTransaction = await helpers.createInvestmentTransaction({
      payload: {
        portfolioId: portfolio.id,
        securityId: vooSecurity.id,
        category: INVESTMENT_TRANSACTION_CATEGORY.buy,
        quantity: '2',
        price: '50',
        fees: '5',
      },
      raw: true,
    });

    const response = await helpers.updateInvestmentTransaction({
      transactionId: newTransaction.id,
      payload: {
        category: INVESTMENT_TRANSACTION_CATEGORY.sell,
      },
      raw: true,
    });

    expect(response.category).toBe(INVESTMENT_TRANSACTION_CATEGORY.sell);
    // Should change from expense to income, because `transactionType` is about
    // cash flow, and when stocks are `selled`, it means we got income for `cash`
    expect(response.transactionType).toBe(TRANSACTION_TYPES.income);
    expect(response.amount).toBeNumericEqual(95); // (2 * 50) - 5 fees
  });

  it('should recalculate holding after transaction update', async () => {
    // Get holding before update
    const [holdingBefore] = await helpers.getHoldings({
      portfolioId: portfolio.id,
      payload: { securityId: vooSecurity.id },
      raw: true,
    });
    expect(holdingBefore).not.toBeNull();
    expect(holdingBefore!.quantity).toBeNumericEqual(2); // From the buy transaction
    expect(holdingBefore!.costBasis).toBeNumericEqual(105); // (2 * 50) + 5 fees

    // Update the transaction quantity
    await helpers.updateInvestmentTransaction({
      transactionId: transaction.id,
      payload: {
        quantity: '5',
      },
      raw: true,
    });

    // Get holding after update
    const [holdingAfter] = await helpers.getHoldings({
      portfolioId: portfolio.id,
      payload: { securityId: vooSecurity.id },
      raw: true,
    });
    expect(holdingAfter).not.toBeNull();
    expect(holdingAfter!.quantity).toBeNumericEqual(5); // Should be updated to 5
    expect(holdingAfter!.costBasis).toBeNumericEqual(255); // (5 * 50) + 5 fees
  });

  it('normalizes date input', async () => {
    const dateOnly = await helpers.updateInvestmentTransaction({
      transactionId: transaction.id,
      payload: { date: '2023-01-15' },
      raw: true,
    });

    // A date-only input is normalized to UTC midnight before storage and
    // returned as a full ISO 8601 datetime string.
    expect(dateOnly.date).toBe('2023-01-15T00:00:00.000Z');

    const fullDatetime = await helpers.updateInvestmentTransaction({
      transactionId: transaction.id,
      payload: {
        date: '2023-01-15T13:45:00.000Z',
      },
      raw: true,
    });

    expect(fullDatetime.date).toBe('2023-01-15T13:45:00.000Z');
  });

  it('should handle complex scenario with multiple transactions', async () => {
    // Create another buy transaction
    await helpers.createInvestmentTransaction({
      payload: {
        portfolioId: portfolio.id,
        securityId: vooSecurity.id,
        category: INVESTMENT_TRANSACTION_CATEGORY.buy,
        quantity: '3',
        price: '60',
        fees: '0',
      },
      raw: true,
    });

    // Verify holding before update
    const [holdingBefore] = await helpers.getHoldings({
      portfolioId: portfolio.id,
      payload: { securityId: vooSecurity.id },
      raw: true,
    });
    expect(holdingBefore!.quantity).toBeNumericEqual(5); // 2 + 3

    // Update the first transaction
    await helpers.updateInvestmentTransaction({
      transactionId: transaction.id,
      payload: {
        quantity: '1', // Change from 2 to 1
      },
      raw: true,
    });

    // Verify holding after update
    const [holdingAfter] = await helpers.getHoldings({
      portfolioId: portfolio.id,
      payload: { securityId: vooSecurity.id },
      raw: true,
    });
    expect(holdingAfter!.quantity).toBeNumericEqual(4); // 1 + 3
  });

  describe('Validation Tests', () => {
    it('should fail to update buy transaction to sell with insufficient shares', async () => {
      // We have only 1 buy transaction (2 shares), so converting it to sell should fail
      const response = await helpers.updateInvestmentTransaction({
        transactionId: transaction.id,
        payload: {
          category: INVESTMENT_TRANSACTION_CATEGORY.sell,
        },
        raw: false,
      });

      expect(response.statusCode).toBe(ERROR_CODES.ValidationError);
    });

    it('should fail to update sell transaction quantity beyond available shares', async () => {
      // First, create additional shares so we can have a sell transaction
      await helpers.createInvestmentTransaction({
        payload: {
          portfolioId: portfolio.id,
          securityId: vooSecurity.id,
          category: INVESTMENT_TRANSACTION_CATEGORY.buy,
          quantity: '10',
          price: '50',
        },
      });

      // Create a sell transaction
      const sellTransaction = await helpers.createInvestmentTransaction({
        payload: {
          portfolioId: portfolio.id,
          securityId: vooSecurity.id,
          category: INVESTMENT_TRANSACTION_CATEGORY.sell,
          quantity: '2',
          price: '55',
        },
        raw: true,
      });

      // Now try to update the sell transaction to sell more than we have
      // We have 12 total shares, selling 2, so 10 remaining. Trying to sell 15 should fail.
      const response = await helpers.updateInvestmentTransaction({
        transactionId: sellTransaction.id,
        payload: {
          quantity: '15',
        },
        raw: false,
      });

      expect(response.statusCode).toBe(ERROR_CODES.ValidationError);
    });

    it('should fail to update quantity of buy transaction if changed to sell category simultaneously', async () => {
      // Create another buy transaction so we have more shares
      await helpers.createInvestmentTransaction({
        payload: {
          portfolioId: portfolio.id,
          securityId: vooSecurity.id,
          category: INVESTMENT_TRANSACTION_CATEGORY.buy,
          quantity: '3',
          price: '50',
        },
      });

      // Total shares: 5 (2 + 3)
      // Try to update the first transaction (2 shares) to be a sell of 10 shares
      // After removing the original buy effect, we'd have 3 shares, but trying to sell 10
      const response = await helpers.updateInvestmentTransaction({
        transactionId: transaction.id,
        payload: {
          category: INVESTMENT_TRANSACTION_CATEGORY.sell,
          quantity: '10',
        },
        raw: false,
      });

      expect(response.statusCode).toBe(ERROR_CODES.ValidationError);
    });

    it('should successfully update buy transaction to smaller sell when sufficient shares exist', async () => {
      // Create additional shares
      await helpers.createInvestmentTransaction({
        payload: {
          portfolioId: portfolio.id,
          securityId: vooSecurity.id,
          category: INVESTMENT_TRANSACTION_CATEGORY.buy,
          quantity: '10',
          price: '50',
        },
      });

      // Total shares: 12 (2 + 10)
      // Update the first transaction (2 shares buy) to be a sell of 1 share
      // After removing original buy effect: 10 shares remaining, selling 1 should work
      const response = await helpers.updateInvestmentTransaction({
        transactionId: transaction.id,
        payload: {
          category: INVESTMENT_TRANSACTION_CATEGORY.sell,
          quantity: '1',
        },
        raw: true,
      });

      expect(response.category).toBe(INVESTMENT_TRANSACTION_CATEGORY.sell);
      expect(response.quantity).toBeNumericEqual(1);

      // Verify holding calculation is correct
      const [holding] = await helpers.getHoldings({
        portfolioId: portfolio.id,
        payload: { securityId: vooSecurity.id },
        raw: true,
      });
      expect(holding!.quantity).toBeNumericEqual(9); // 10 (from second buy) - 1 (from updated sell)
    });

    it('rejects invalid update requests', async () => {
      const negativeQuantity = await helpers.updateInvestmentTransaction({
        transactionId: transaction.id,
        payload: {
          quantity: '-5',
        },
        raw: false,
      });
      expect(negativeQuantity.statusCode).toBe(ERROR_CODES.ValidationError);

      const negativePrice = await helpers.updateInvestmentTransaction({
        transactionId: transaction.id,
        payload: {
          price: '-100',
        },
        raw: false,
      });
      expect(negativePrice.statusCode).toBe(ERROR_CODES.ValidationError);

      const negativeFees = await helpers.updateInvestmentTransaction({
        transactionId: transaction.id,
        payload: {
          fees: '-10',
        },
        raw: false,
      });
      expect(negativeFees.statusCode).toBe(ERROR_CODES.ValidationError);

      const malformedId = await helpers.updateInvestmentTransaction({
        transactionId: 'invalid' as unknown as string,
        payload: { quantity: '3' },
        raw: false,
      });
      expect(malformedId.statusCode).toBe(ERROR_CODES.ValidationError);

      const unknownId = await helpers.updateInvestmentTransaction({
        transactionId: generateRandomRecordId(),
        payload: { quantity: '3' },
        raw: false,
      });
      expect(unknownId.statusCode).toBe(ERROR_CODES.NotFoundError);
    }, 30000);

    it('should handle edge case: updating sell transaction back to buy with same quantity', async () => {
      // Create more shares first
      await helpers.createInvestmentTransaction({
        payload: {
          portfolioId: portfolio.id,
          securityId: vooSecurity.id,
          category: INVESTMENT_TRANSACTION_CATEGORY.buy,
          quantity: '10',
          price: '50',
        },
      });

      // Create a sell transaction
      const sellTransaction = await helpers.createInvestmentTransaction({
        payload: {
          portfolioId: portfolio.id,
          securityId: vooSecurity.id,
          category: INVESTMENT_TRANSACTION_CATEGORY.sell,
          quantity: '3',
          price: '60',
        },
        raw: true,
      });

      // Update sell back to buy - should work fine
      const response = await helpers.updateInvestmentTransaction({
        transactionId: sellTransaction.id,
        payload: {
          category: INVESTMENT_TRANSACTION_CATEGORY.buy,
        },
        raw: true,
      });

      expect(response.category).toBe(INVESTMENT_TRANSACTION_CATEGORY.buy);
      expect(response.transactionType).toBe('expense');

      // Verify holding is recalculated correctly
      const [holding] = await helpers.getHoldings({
        portfolioId: portfolio.id,
        payload: { securityId: vooSecurity.id },
        raw: true,
      });
      expect(holding!.quantity).toBeNumericEqual(15); // 2 + 10 + 3 (all buys now)
    });
  });

  describe('crypto sell oversell', () => {
    let btcSecurity: Securities;
    let cryptoBuy: InvestmentTransaction;

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
          portfolioId: portfolio.id,
          securityId: btcSecurity.id,
        },
      });

      cryptoBuy = await helpers.createInvestmentTransaction({
        payload: {
          portfolioId: portfolio.id,
          securityId: btcSecurity.id,
          category: INVESTMENT_TRANSACTION_CATEGORY.buy,
          quantity: '1',
          price: '50000',
        },
        raw: true,
      });
    });

    it('allows updating a crypto buy to a sell of larger quantity', async () => {
      const response = await helpers.updateInvestmentTransaction({
        transactionId: cryptoBuy.id,
        payload: {
          category: INVESTMENT_TRANSACTION_CATEGORY.sell,
          quantity: '2',
        },
        raw: false,
      });

      expect(response.statusCode).toBe(200);

      const [holding] = await helpers.getHoldings({
        portfolioId: portfolio.id,
        payload: { securityId: btcSecurity.id },
        raw: true,
      });
      expect(holding!.quantity).toBeNumericEqual(-2);
    });
  });
});
