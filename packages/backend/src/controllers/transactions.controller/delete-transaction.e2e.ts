import { RecordId, TRANSACTION_TRANSFER_NATURE, TRANSACTION_TYPES } from '@bt/shared/types';
import { beforeEach, describe, expect, it } from '@jest/globals';
import { ERROR_CODES } from '@js/errors';
import Transactions from '@models/transactions.model';
import * as helpers from '@tests/helpers';

describe('Delete transaction controller', () => {
  it('should return validation error if no data passed', async () => {
    await helpers.createTransaction();
    const res = await helpers.deleteTransaction();

    expect(res.statusCode).toEqual(ERROR_CODES.ValidationError);
  });
  it('should successfully create and delete transaction', async () => {
    const createdTransactions = await helpers.createTransaction({ raw: true });
    const transactions = await helpers.getTransactions({ raw: true });

    expect(createdTransactions.length).toBe(transactions.length);

    const res = await helpers.deleteTransaction({ id: transactions[0]!.id });

    const txsAfterDeletion = await helpers.getTransactions({ raw: true });

    expect(res.statusCode).toEqual(200);
    expect(txsAfterDeletion.length).toBe(0);
  });
  describe('transfer transactions', () => {
    let transactions: Transactions[] = [];

    beforeEach(async () => {
      const currencyA = global.MODELS_CURRENCIES!.find((item) => item.code === 'EUR');
      await helpers.addUserCurrencies({ currencyCodes: [currencyA.code] });
      const accountA = await helpers.createAccount({
        payload: {
          ...helpers.buildAccountPayload(),
          currencyCode: currencyA.code,
        },
        raw: true,
      });

      const currencyB = global.MODELS_CURRENCIES!.find((item) => item.code === 'UAH');
      await helpers.addUserCurrencies({ currencyCodes: [currencyB.code] });
      const accountB = await helpers.createAccount({
        payload: {
          ...helpers.buildAccountPayload(),
          currencyCode: currencyB.code,
        },
        raw: true,
      });

      const DESTINATION_AMOUNT = 25000;
      const txPayload = {
        ...helpers.buildTransactionPayload({ accountId: accountA.id }),
        transferNature: TRANSACTION_TRANSFER_NATURE.common_transfer,
        destinationAmount: DESTINATION_AMOUNT,
        destinationAccountId: accountB.id,
      };
      const createdTransactions = await helpers.createTransaction({
        payload: txPayload,
        raw: true,
      });
      transactions = await helpers.getTransactions({ raw: true });

      expect(createdTransactions.length).toBe(transactions.length);
    });

    it('should successfully delete both tx when deleting "from" transaction', async () => {
      const res = await helpers.deleteTransaction({ id: transactions[0]!.id });

      const txsAfterDeletion = await helpers.getTransactions({ raw: true });

      expect(res.statusCode).toEqual(200);
      expect(txsAfterDeletion.length).toBe(0);
    });
    it('should successfully delete both tx when deleting "to" transaction', async () => {
      const res = await helpers.deleteTransaction({ id: transactions[1]!.id });

      const txsAfterDeletion = await helpers.getTransactions({ raw: true });

      expect(res.statusCode).toEqual(200);
      expect(txsAfterDeletion.length).toBe(0);
    });
  });
  describe('orphaned transfer leg', () => {
    it('should delete a common_transfer transaction whose pair is gone (transferId cleared)', async () => {
      const [tx] = await helpers.createTransaction({ raw: true });

      // Reproduces a corrupt row seen in production (Sentry MONEY-MATTER-BACKEND-6H/6G):
      // a transaction flagged as a common transfer but with its `transferId` cleared, so
      // there's no twin to delete alongside it. Previously this fell through to the
      // "unexpected delete issue" guard and threw a 500.
      await Transactions.update(
        { transferNature: TRANSACTION_TRANSFER_NATURE.common_transfer, transferId: null },
        { where: { id: tx.id } },
      );

      const res = await helpers.deleteTransaction({ id: tx.id });
      const txsAfterDeletion = await helpers.getTransactions({ raw: true });

      expect(res.statusCode).toEqual(200);
      expect(txsAfterDeletion.length).toBe(0);
    });
  });
  describe('transactions from external accounts', () => {
    it('cannot delete transactions from external account', async () => {
      await helpers.monobank.pair();
      const { transactions } = await helpers.monobank.mockTransactions();
      const incomeTransaction = transactions.find((item) => item.transactionType === TRANSACTION_TYPES.income);

      const res = await helpers.deleteTransaction({
        id: incomeTransaction!.id,
      });

      expect(res.statusCode).toEqual(ERROR_CODES.ValidationError);
    });

    it('cannot delete a manual transaction once its account is linked to a bank', async () => {
      const { account } = await helpers.createAccountWithNewCurrency({ currency: 'USD' });
      const [tx] = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({ accountId: account.id }),
        raw: true,
      });
      await helpers.lunchflow.linkManualAccount({ accountId: account.id });

      const res = await helpers.deleteTransaction({ id: tx.id });

      expect(res.statusCode).toEqual(ERROR_CODES.ValidationError);
      expect((await helpers.getTransactionById({ id: tx.id, raw: true }))?.accountId).toBe(account.id);
    });

    it('cannot delete a transfer leg whose twin sits on a bank-linked account', async () => {
      const { account: linkedAccount } = await helpers.createAccountWithNewCurrency({ currency: 'USD' });
      const manualAccount = await helpers.createAccount({ raw: true });
      const [linkedLeg, manualLeg] = await helpers.createTransaction({
        payload: {
          ...helpers.buildTransactionPayload({ accountId: linkedAccount.id, amount: 10 }),
          transferNature: TRANSACTION_TRANSFER_NATURE.common_transfer,
          destinationAccountId: manualAccount.id,
          destinationAmount: 10,
        },
        raw: true,
      });
      await helpers.lunchflow.linkManualAccount({ accountId: linkedAccount.id });

      const res = await helpers.deleteTransaction({ id: manualLeg!.id });

      expect(res.statusCode).toEqual(ERROR_CODES.ValidationError);
      expect((await helpers.getTransactionById({ id: linkedLeg.id, raw: true }))?.accountId).toBe(linkedAccount.id);
      expect((await helpers.getTransactionById({ id: manualLeg!.id, raw: true }))?.accountId).toBe(manualAccount.id);
    });
  });
  describe('refunded transactions', () => {
    const createExpense = async (accountId: RecordId) => {
      const [tx] = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId,
          amount: 100,
          transactionType: TRANSACTION_TYPES.expense,
        }),
        raw: true,
      });
      return tx;
    };

    const createRefundIncome = async (accountId: RecordId) => {
      const [tx] = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId,
          amount: 40,
          transactionType: TRANSACTION_TYPES.income,
        }),
        raw: true,
      });
      return tx;
    };

    it('releases the refund transaction so it can be linked to another purchase', async () => {
      const account = await helpers.createAccount({ raw: true });
      const originalTx = await createExpense(account.id);
      const refundTx = await createRefundIncome(account.id);

      await helpers.createSingleRefund({ originalTxId: originalTx.id, refundTxId: refundTx.id });

      expect((await helpers.deleteTransaction({ id: originalTx.id })).statusCode).toEqual(200);

      const replacementTx = await createExpense(account.id);
      const relink = await helpers.createSingleRefund({
        originalTxId: replacementTx.id,
        refundTxId: refundTx.id,
      });

      expect(relink.statusCode).toEqual(200);
    });

    it('releases every refund of the deleted purchase, not just the first', async () => {
      const account = await helpers.createAccount({ raw: true });
      const originalTx = await createExpense(account.id);
      const firstRefundTx = await createRefundIncome(account.id);
      const secondRefundTx = await createRefundIncome(account.id);

      for (const refundTx of [firstRefundTx, secondRefundTx]) {
        await helpers.createSingleRefund({ originalTxId: originalTx.id, refundTxId: refundTx.id });
      }

      expect((await helpers.deleteTransaction({ id: originalTx.id })).statusCode).toEqual(200);

      const transactions = await helpers.getTransactions({ raw: true });
      expect(transactions.every((tx) => !tx.refundLinked)).toBe(true);

      const replacementTx = await createExpense(account.id);
      for (const refundTx of [firstRefundTx, secondRefundTx]) {
        const relink = await helpers.createSingleRefund({
          originalTxId: replacementTx.id,
          refundTxId: refundTx.id,
        });
        expect(relink.statusCode).toEqual(200);
      }
    });
  });
});
