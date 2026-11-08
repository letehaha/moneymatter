import { TRANSACTION_TRANSFER_NATURE } from '@bt/shared/types';
import { generateRandomRecordId } from '@common/lib/record-id-helpers';
import { beforeEach, describe, expect, it } from '@jest/globals';
import { ERROR_CODES } from '@js/errors';
import Accounts from '@models/accounts.model';
import Portfolios from '@models/investments/portfolios.model';
import * as helpers from '@tests/helpers';

describe('Delete Portfolio Transfer (DELETE /investments/portfolios/:id/transfers/:transferId)', () => {
  let portfolio: Portfolios;
  let account: Accounts;
  let currencyCode: string;

  beforeEach(async () => {
    portfolio = await helpers.createPortfolio({
      payload: helpers.buildPortfolioPayload({ name: 'Investment Portfolio' }),
      raw: true,
    });

    account = await helpers.createAccount({
      payload: helpers.buildAccountPayload({ name: 'Main Account' }),
      raw: true,
    });

    currencyCode = account.currencyCode;
  });

  describe('account-to-portfolio transfer deletion', () => {
    it('should reverse portfolio balance and keep the account transaction as out-of-wallet, by default and with deleteLinkedTransaction=false', async () => {
      const transfer = await helpers.accountToPortfolioTransfer({
        portfolioId: portfolio.id,
        payload: {
          accountId: account.id,
          amount: '500',
          date: '2025-06-15',
        },
        raw: true,
      });

      const [balanceBefore] = await helpers.getPortfolioBalance({
        portfolioId: portfolio.id,
        currencyCode,
        raw: true,
      });
      expect(balanceBefore!.availableCash).toBeNumericEqual(500);

      await helpers.deletePortfolioTransfer({
        portfolioId: portfolio.id,
        transferId: transfer.id,
        raw: true,
      });

      // The balance record might be zeroed or removed entirely.
      const balancesAfter = await helpers.getPortfolioBalance({
        portfolioId: portfolio.id,
        currencyCode,
        raw: true,
      });

      if (balancesAfter.length > 0) {
        expect(balancesAfter[0]!.availableCash).toBeNumericEqual(0);
        expect(balancesAfter[0]!.totalCash).toBeNumericEqual(0);
      }

      const transactions = await helpers.getTransactions({ raw: true });
      expect(transactions.length).toBe(1);
      expect(transactions[0]!.transferNature).toBe(TRANSACTION_TRANSFER_NATURE.transfer_out_wallet);

      const secondTransfer = await helpers.accountToPortfolioTransfer({
        portfolioId: portfolio.id,
        payload: {
          accountId: account.id,
          amount: '500',
          date: '2025-06-16',
        },
        raw: true,
      });

      await helpers.deletePortfolioTransfer({
        portfolioId: portfolio.id,
        transferId: secondTransfer.id,
        deleteLinkedTransaction: false,
        raw: true,
      });

      const transactionsAfter = await helpers.getTransactions({ raw: true });
      expect(transactionsAfter.length).toBe(2);
      expect(
        transactionsAfter.every((tx) => tx.transferNature === TRANSACTION_TRANSFER_NATURE.transfer_out_wallet),
      ).toBe(true);
    }, 30000);

    it('should delete linked account transaction when deleteLinkedTransaction=true', async () => {
      const transfer = await helpers.accountToPortfolioTransfer({
        portfolioId: portfolio.id,
        payload: {
          accountId: account.id,
          amount: '500',
          date: '2025-06-15',
        },
        raw: true,
      });

      // Delete the transfer AND the linked transaction
      await helpers.deletePortfolioTransfer({
        portfolioId: portfolio.id,
        transferId: transfer.id,
        deleteLinkedTransaction: true,
        raw: true,
      });

      // The account transaction should be deleted
      const transactions = await helpers.getTransactions({ raw: true });
      expect(transactions.length).toBe(0);
    });
  });

  describe('portfolio-to-account transfer deletion', () => {
    it('should reverse portfolio balance and keep the account transaction as out-of-wallet, by default and with deleteLinkedTransaction=false', async () => {
      await helpers.updatePortfolioBalance({
        portfolioId: portfolio.id,
        currencyCode,
        setAvailableCash: '1000',
        setTotalCash: '1000',
      });

      const transfer = await helpers.portfolioToAccountTransfer({
        portfolioId: portfolio.id,
        payload: {
          accountId: account.id,
          amount: '300',
          currencyCode,
          date: '2025-06-15',
        },
        raw: true,
      });

      // Balance should be 700 after withdrawal
      const [balanceBefore] = await helpers.getPortfolioBalance({
        portfolioId: portfolio.id,
        currencyCode,
        raw: true,
      });
      expect(balanceBefore!.availableCash).toBeNumericEqual(700);

      // Delete the transfer → should restore to 1000
      await helpers.deletePortfolioTransfer({
        portfolioId: portfolio.id,
        transferId: transfer.id,
        raw: true,
      });

      const [balanceAfter] = await helpers.getPortfolioBalance({
        portfolioId: portfolio.id,
        currencyCode,
        raw: true,
      });
      expect(balanceAfter!.availableCash).toBeNumericEqual(1000);
      expect(balanceAfter!.totalCash).toBeNumericEqual(1000);

      const transactions = await helpers.getTransactions({ raw: true });
      expect(transactions.length).toBe(1);
      expect(transactions[0]!.transferNature).toBe(TRANSACTION_TRANSFER_NATURE.transfer_out_wallet);

      const secondTransfer = await helpers.portfolioToAccountTransfer({
        portfolioId: portfolio.id,
        payload: {
          accountId: account.id,
          amount: '300',
          currencyCode,
          date: '2025-06-16',
        },
        raw: true,
      });

      await helpers.deletePortfolioTransfer({
        portfolioId: portfolio.id,
        transferId: secondTransfer.id,
        deleteLinkedTransaction: false,
        raw: true,
      });

      const transactionsAfter = await helpers.getTransactions({ raw: true });
      expect(transactionsAfter.length).toBe(2);
      expect(
        transactionsAfter.every((tx) => tx.transferNature === TRANSACTION_TRANSFER_NATURE.transfer_out_wallet),
      ).toBe(true);
    }, 30000);

    it('should delete linked account transaction when deleteLinkedTransaction=true', async () => {
      await helpers.updatePortfolioBalance({
        portfolioId: portfolio.id,
        currencyCode,
        setAvailableCash: '1000',
        setTotalCash: '1000',
      });

      const transfer = await helpers.portfolioToAccountTransfer({
        portfolioId: portfolio.id,
        payload: {
          accountId: account.id,
          amount: '300',
          currencyCode,
          date: '2025-06-15',
        },
        raw: true,
      });

      // Delete the transfer AND the linked transaction
      await helpers.deletePortfolioTransfer({
        portfolioId: portfolio.id,
        transferId: transfer.id,
        deleteLinkedTransaction: true,
        raw: true,
      });

      // The account transaction should be deleted
      const transactions = await helpers.getTransactions({ raw: true });
      expect(transactions.length).toBe(0);
    });
  });

  describe('portfolio-to-portfolio transfer deletion', () => {
    it('should reverse both portfolio balances when deleting p2p transfer', async () => {
      const destPortfolio = await helpers.createPortfolio({
        payload: helpers.buildPortfolioPayload({ name: 'Destination Portfolio' }),
        raw: true,
      });

      const {
        currencies: [usdCurrency],
      } = await helpers.addUserCurrencies({ currencyCodes: ['USD'], raw: true });

      // Seed source with cash
      await helpers.updatePortfolioBalance({
        portfolioId: portfolio.id,
        currencyCode: usdCurrency!.currencyCode,
        setAvailableCash: '1000',
        setTotalCash: '1000',
      });

      // Create p2p transfer
      const transfer = await helpers.createPortfolioTransfer({
        fromPortfolioId: portfolio.id,
        payload: helpers.buildPortfolioTransferPayload({
          toPortfolioId: destPortfolio.id,
          currencyCode: usdCurrency!.currencyCode,
          amount: '400',
        }),
        raw: true,
      });

      // Verify balances
      const [srcBefore] = await helpers.getPortfolioBalance({
        portfolioId: portfolio.id,
        currencyCode: usdCurrency!.currencyCode,
        raw: true,
      });
      expect(srcBefore!.availableCash).toBeNumericEqual(600);

      const [destBefore] = await helpers.getPortfolioBalance({
        portfolioId: destPortfolio.id,
        currencyCode: usdCurrency!.currencyCode,
        raw: true,
      });
      expect(destBefore!.availableCash).toBeNumericEqual(400);

      // Delete the transfer
      await helpers.deletePortfolioTransfer({
        portfolioId: portfolio.id,
        transferId: transfer.id,
        raw: true,
      });

      // Source should be back to 1000
      const [srcAfter] = await helpers.getPortfolioBalance({
        portfolioId: portfolio.id,
        currencyCode: usdCurrency!.currencyCode,
        raw: true,
      });
      expect(srcAfter!.availableCash).toBeNumericEqual(1000);

      // Dest should be back to 0
      const destAfter = await helpers.getPortfolioBalance({
        portfolioId: destPortfolio.id,
        currencyCode: usdCurrency!.currencyCode,
        raw: true,
      });
      if (destAfter.length > 0) {
        expect(destAfter[0]!.availableCash).toBeNumericEqual(0);
      }
    });
  });

  describe('deleting the linked account transaction', () => {
    it('is rejected while the portfolio transfer exists, leaving the transfer and balance untouched', async () => {
      await helpers.accountToPortfolioTransfer({
        portfolioId: portfolio.id,
        payload: {
          accountId: account.id,
          amount: '750',
          date: '2025-06-15',
        },
        raw: true,
      });

      const transactions = await helpers.getTransactions({ raw: true });
      expect(transactions.length).toBe(1);
      expect(transactions[0]!.transferNature).toBe(TRANSACTION_TRANSFER_NATURE.transfer_to_portfolio);

      const response = await helpers.deleteTransaction({ id: transactions[0]!.id });
      expect(response.statusCode).toBe(ERROR_CODES.ValidationError);

      const transfersAfter = await helpers.listPortfolioTransfers({ portfolioId: portfolio.id, raw: true });
      expect(transfersAfter.data.length).toBe(1);
      const [balanceAfter] = await helpers.getPortfolioBalance({ portfolioId: portfolio.id, currencyCode, raw: true });
      expect(balanceAfter!.availableCash).toBeNumericEqual(750);
      expect(await helpers.getTransactions({ raw: true })).toHaveLength(1);
    });
  });

  describe('idempotent deletion', () => {
    it('should return 204 for a non-existent transfer and for deleting the same transfer twice', async () => {
      const unknownTransfer = await helpers.deletePortfolioTransfer({
        portfolioId: portfolio.id,
        transferId: generateRandomRecordId(),
      });

      expect(unknownTransfer.statusCode).toBe(204);

      const transfer = await helpers.accountToPortfolioTransfer({
        portfolioId: portfolio.id,
        payload: {
          accountId: account.id,
          amount: '500',
          date: '2025-06-15',
        },
        raw: true,
      });

      // First delete should succeed
      const firstResponse = await helpers.deletePortfolioTransfer({
        portfolioId: portfolio.id,
        transferId: transfer.id,
      });
      expect(firstResponse.statusCode).toBe(204);

      // Second delete should also return 204 (idempotent)
      const secondResponse = await helpers.deletePortfolioTransfer({
        portfolioId: portfolio.id,
        transferId: transfer.id,
      });
      expect(secondResponse.statusCode).toBe(204);
    }, 30000);
  });

  describe('deleting the linked account transaction of a portfolio-to-account transfer', () => {
    it('is rejected while the portfolio transfer exists, leaving the transfer and balance untouched', async () => {
      await helpers.updatePortfolioBalance({
        portfolioId: portfolio.id,
        currencyCode,
        setAvailableCash: '1000',
        setTotalCash: '1000',
      });

      await helpers.portfolioToAccountTransfer({
        portfolioId: portfolio.id,
        payload: {
          accountId: account.id,
          amount: '300',
          currencyCode,
          date: '2025-06-15',
        },
        raw: true,
      });

      const transactions = await helpers.getTransactions({ raw: true });
      expect(transactions.length).toBe(1);
      expect(transactions[0]!.transferNature).toBe(TRANSACTION_TRANSFER_NATURE.transfer_to_portfolio);

      const response = await helpers.deleteTransaction({ id: transactions[0]!.id });
      expect(response.statusCode).toBe(ERROR_CODES.ValidationError);

      const transfersAfter = await helpers.listPortfolioTransfers({ portfolioId: portfolio.id, raw: true });
      expect(transfersAfter.data.length).toBe(1);
      const [balanceAfter] = await helpers.getPortfolioBalance({ portfolioId: portfolio.id, currencyCode, raw: true });
      expect(balanceAfter!.availableCash).toBeNumericEqual(700);
      expect(await helpers.getTransactions({ raw: true })).toHaveLength(1);
    });
  });
});
