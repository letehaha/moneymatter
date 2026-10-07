import { type RecordId, TRANSACTION_TRANSFER_NATURE, TRANSACTION_TYPES } from '@bt/shared/types';
import { faker } from '@faker-js/faker';
import { describe, expect, it } from '@jest/globals';
import { ERROR_CODES } from '@js/errors';
import Transactions from '@models/transactions.model';
import { EXTERNAL_ACCOUNT_RESTRICTED_UPDATION_FIELDS } from '@services/transactions/update-transaction';
import * as helpers from '@tests/helpers';

describe('Update transaction controller', () => {
  it('should reject negative amount', async () => {
    const [baseTx] = await helpers.createTransaction({ raw: true });

    const res = await helpers.updateTransaction({
      id: baseTx.id,
      payload: { amount: -100 },
      raw: false,
    });

    expect(res.statusCode).toEqual(ERROR_CODES.ValidationError);
  });

  it('rejects time before year 2000', async () => {
    const [baseTx] = await helpers.createTransaction({ raw: true });

    const res = await helpers.updateTransaction({
      id: baseTx.id,
      payload: { time: '0026-08-22T00:00:00.000Z' },
      raw: false,
    });

    expect(res.statusCode).toEqual(ERROR_CODES.ValidationError);
  });

  // Zero is a legitimate amount to edit a transaction down to — an imported
  // Microsoft Money voided cheque lands at zero and must stay editable.
  it('accepts a zero amount', async () => {
    const [baseTx] = await helpers.createTransaction({ raw: true });

    const [updated] = await helpers.updateTransaction({
      id: baseTx.id,
      payload: { amount: 0 },
      raw: true,
    });

    expect(Number(updated.amount)).toBe(0);
    expect(Number(updated.refAmount)).toBe(0);
  });

  it('should make basic updation', async () => {
    const [baseTx] = await helpers.createTransaction({ raw: true });
    const txAmount = Number(baseTx.amount);
    const expectedNewAmount = txAmount + 1000;

    const res = await helpers.updateTransaction({
      id: baseTx.id,
      payload: {
        amount: expectedNewAmount,
        transactionType: TRANSACTION_TYPES.income,
      },
      raw: true,
    });

    const txsAfterUpdation = (await helpers.getTransactions({ raw: true }))!;

    expect(res[0]).toStrictEqual(txsAfterUpdation[0]);
    expect(res[0].amount).toStrictEqual(expectedNewAmount);
    expect(res[0].transactionType).toStrictEqual(TRANSACTION_TYPES.income);
  });
  it('should change account (so and currency) and update refAmount correctly', async () => {
    const [createdTransaction] = await helpers.createTransaction({ raw: true });

    const { account: accountUAH, currencyRate } = await helpers.createAccountWithNewCurrency({
      currency: 'UAH',
    });

    const [baseTx] = await helpers.updateTransaction({
      id: createdTransaction.id,
      payload: {
        transactionType: TRANSACTION_TYPES.income,
        accountId: accountUAH.id,
      },
      raw: true,
    });

    expect(baseTx.accountId).toStrictEqual(accountUAH.id);
    expect(baseTx.amount).toStrictEqual(createdTransaction.amount);
    expect(baseTx.refAmount).toEqualRefValue(Number(createdTransaction.amount) * currencyRate!.rate);
  });
  it('should create transfer tx for ref + non-ref tx, and change destination non-ref account to another non-ref account', async () => {
    const baseAccount = await helpers.createAccount({ raw: true });
    const { account: accountUAH } = await helpers.createAccountWithNewCurrency({
      currency: 'UAH',
    });

    const [baseTx, oppositeTx] = await helpers.createTransaction({
      payload: {
        ...helpers.buildTransactionPayload({
          accountId: baseAccount.id,
          amount: 10,
          transferNature: TRANSACTION_TRANSFER_NATURE.common_transfer,
          destinationAmount: 20,
          destinationAccountId: accountUAH.id,
        }),
      },
      raw: true,
    });

    // Even if the currencyRate between USD and UAH has a huge difference, non-ref
    // tx should always have refAmount same as ref tx in case of transfer
    expect(oppositeTx!.refAmount).toEqual(baseTx.refAmount);

    const { account: accountEUR, currency: currencyEUR } = await helpers.createAccountWithNewCurrency({
      currency: 'EUR',
    });
    const [, newOppositeTx] = await helpers.updateTransaction({
      id: baseTx.id,
      payload: {
        destinationAccountId: accountEUR.id,
      },
      raw: true,
    });

    expect(newOppositeTx).toMatchObject({
      // We only changed account, so amounts should stay same
      amount: oppositeTx!.amount,
      refAmount: oppositeTx!.refAmount,
      // accountId and currencyCode are changed
      accountId: accountEUR.id,
      currencyCode: currencyEUR.code,
    });
  });
  it.each([[TRANSACTION_TYPES.income], [TRANSACTION_TYPES.expense]])(
    'should change %s to transfer and vice versa',
    async (txType) => {
      const accountA = await helpers.createAccount({ raw: true });
      const accountB = await helpers.createAccount({ raw: true });

      const [tx] = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: accountA.id,
          transactionType: txType,
        }),
        raw: true,
      });

      const [, oppositeTx] = await helpers.updateTransaction({
        id: tx.id,
        payload: {
          transferNature: TRANSACTION_TRANSFER_NATURE.common_transfer,
          destinationAmount: 30,
          destinationAccountId: accountB.id,
        },
        raw: true,
      });

      await helpers.updateTransaction({
        id: tx.id,
        payload: {
          transferNature: TRANSACTION_TRANSFER_NATURE.not_transfer,
        },
        raw: true,
      });

      const transactions = (await helpers.getTransactions({ raw: true }))!;

      // Both transactions should exist but be unlinked (not deleted)
      expect(transactions.length).toBe(2);

      const baseTxAfter = transactions.find((t) => t.id === tx.id);
      const oppositeTxAfter = transactions.find((t) => t.id === oppositeTx!.id);

      // Base tx should be back to original state (unlinked)
      expect(baseTxAfter).toMatchObject({
        ...tx,
        transferId: null,
        transferNature: TRANSACTION_TRANSFER_NATURE.not_transfer,
        updatedAt: expect.toBeAnythingOrNull(),
      });

      // Opposite tx should also be unlinked (not deleted)
      expect(oppositeTxAfter).toMatchObject({
        transferId: null,
        transferNature: TRANSACTION_TRANSFER_NATURE.not_transfer,
      });
    },
  );

  describe('test refAmount is correct when changing transfer transaction accounts to ref account', () => {
    it('EUR->UAH to EUR->USD, refAmount should be same as amount of USD. Because USD is a ref-currency', async () => {
      const { account: accountEUR } = await helpers.createAccountWithNewCurrency({
        currency: 'EUR',
      });
      const { account: accountUAH } = await helpers.createAccountWithNewCurrency({
        currency: 'UAH',
      });
      const accountUSD = await helpers.createAccount({ raw: true });

      const [baseTx] = await helpers.createTransaction({
        payload: {
          ...helpers.buildTransactionPayload({
            accountId: accountEUR.id,
            amount: 1000,
            transferNature: TRANSACTION_TRANSFER_NATURE.common_transfer,
            destinationAmount: 2000,
            destinationAccountId: accountUAH.id,
          }),
        },
        raw: true,
      });

      const [updatedBaseTx, updatedOppositeTx] = await helpers.updateTransaction({
        id: baseTx.id,
        payload: {
          destinationAccountId: accountUSD.id,
          destinationAmount: 1000,
        },
        raw: true,
      });

      expect(updatedOppositeTx!.amount).toEqual(updatedOppositeTx!.refAmount);
      expect(updatedBaseTx.refAmount).toEqual(updatedOppositeTx!.refAmount);
    });
    it('UAH->EUR to USD->EUR, refAmount should be same as amount of USD. Because USD is a ref-currency', async () => {
      const { account: accountEUR } = await helpers.createAccountWithNewCurrency({
        currency: 'EUR',
      });
      const { account: accountUAH } = await helpers.createAccountWithNewCurrency({
        currency: 'UAH',
      });
      const accountUSD = await helpers.createAccount({ raw: true });

      const [baseTx, oppositeTx] = await helpers.createTransaction({
        payload: {
          ...helpers.buildTransactionPayload({
            accountId: accountUAH.id,
            amount: 40000,
            transferNature: TRANSACTION_TRANSFER_NATURE.common_transfer,
            destinationAmount: 1000,
            destinationAccountId: accountEUR.id,
          }),
        },
        raw: true,
      });

      // Change base tx account to USD, amount makes same as refAmount
      // opposite tx amount stays as previous, but refAmount makes same as base tx.
      // destinationAmount is restated because the pair is cross-currency — an
      // amount edit without it is rejected.
      const [updatedBaseTx, updatedOppositeTx] = await helpers.updateTransaction({
        id: baseTx.id,
        payload: {
          accountId: accountUSD.id,
          amount: 2500,
          destinationAmount: Number(oppositeTx!.amount),
        },
        raw: true,
      });

      expect(updatedBaseTx.amount).toEqual(updatedBaseTx.refAmount);
      expect(updatedOppositeTx!.amount).toEqual(oppositeTx!.amount);
      expect(updatedOppositeTx!.refAmount).toEqual(updatedBaseTx.refAmount);
    });
  });

  describe('amount-only edits on transfer pairs', () => {
    it('re-derives the opposite leg amount on a same-currency transfer and keeps refAmounts consistent', async () => {
      const [accountA, accountB] = await Promise.all([
        helpers.createAccount({ raw: true }),
        helpers.createAccount({ raw: true }),
      ]);

      const [baseTx] = await helpers.createTransaction({
        payload: {
          ...helpers.buildTransactionPayload({
            accountId: accountA.id,
            amount: 100,
          }),
          transferNature: TRANSACTION_TRANSFER_NATURE.common_transfer,
          destinationAmount: 100,
          destinationAccountId: accountB.id,
        },
        raw: true,
      });

      const [updatedBaseTx, updatedOppositeTx] = await helpers.updateTransaction({
        id: baseTx.id,
        payload: { amount: 250 },
        raw: true,
      });

      expect(updatedBaseTx.amount).toBe(250);
      expect(updatedOppositeTx!.amount).toBe(250);
      expect(updatedOppositeTx!.refAmount).toEqual(updatedBaseTx.refAmount);

      // Both persisted legs carry the new amount, not just the response payload.
      const transactions = (await helpers.getTransactions({ raw: true }))!;
      expect(transactions.find((tx) => tx.id === updatedBaseTx.id)!.amount).toBe(250);
      expect(transactions.find((tx) => tx.id === updatedOppositeTx!.id)!.amount).toBe(250);
    });

    it('rejects an amount-only edit on a cross-currency transfer and leaves both legs unchanged', async () => {
      const accountUSD = await helpers.createAccount({ raw: true });
      const { account: accountUAH } = await helpers.createAccountWithNewCurrency({
        currency: 'UAH',
      });

      const [baseTx, oppositeTx] = await helpers.createTransaction({
        payload: {
          ...helpers.buildTransactionPayload({
            accountId: accountUSD.id,
            amount: 10,
          }),
          transferNature: TRANSACTION_TRANSFER_NATURE.common_transfer,
          destinationAmount: 400,
          destinationAccountId: accountUAH.id,
        },
        raw: true,
      });

      const response = await helpers.updateTransaction({
        id: baseTx.id,
        payload: { amount: 15 },
      });

      expect(response.statusCode).toBe(ERROR_CODES.ValidationError);

      const transactions = (await helpers.getTransactions({ raw: true }))!;
      const baseAfter = transactions.find((tx) => tx.id === baseTx.id)!;
      const oppositeAfter = transactions.find((tx) => tx.id === oppositeTx!.id)!;
      expect(baseAfter.amount).toBe(10);
      expect(baseAfter.refAmount).toEqual(baseTx.refAmount);
      expect(oppositeAfter.amount).toBe(400);
      expect(oppositeAfter.refAmount).toEqual(oppositeTx!.refAmount);
    });

    it('accepts a cross-currency amount edit when destinationAmount is restated', async () => {
      const accountUSD = await helpers.createAccount({ raw: true });
      const { account: accountUAH } = await helpers.createAccountWithNewCurrency({
        currency: 'UAH',
      });

      const [baseTx] = await helpers.createTransaction({
        payload: {
          ...helpers.buildTransactionPayload({
            accountId: accountUSD.id,
            amount: 10,
          }),
          transferNature: TRANSACTION_TRANSFER_NATURE.common_transfer,
          destinationAmount: 400,
          destinationAccountId: accountUAH.id,
        },
        raw: true,
      });

      const [updatedBaseTx, updatedOppositeTx] = await helpers.updateTransaction({
        id: baseTx.id,
        payload: { amount: 15, destinationAmount: 600 },
        raw: true,
      });

      expect(updatedBaseTx.amount).toBe(15);
      expect(updatedOppositeTx!.amount).toBe(600);
      expect(updatedOppositeTx!.refAmount).toEqual(updatedBaseTx.refAmount);
    });
  });

  describe('updates external transactions to transfer and vice versa', () => {
    it('updates external expense and income transactions to transfer and back', async () => {
      await helpers.monobank.pair();
      const { transactions } = await helpers.monobank.mockTransactions();

      for (const transactionType of [TRANSACTION_TYPES.expense, TRANSACTION_TYPES.income]) {
        const externalTransaction = transactions.find((item) => item.transactionType === transactionType);
        expect(externalTransaction).not.toBe(undefined);

        // Each type needs its own destination account: the unlinked opposite leg stays
        // behind, and the balance check below is keyed by (date, opposite accountId).
        const accountB = await helpers.createAccount({
          raw: true,
        });

        const [baseTx, oppositeTx] = await helpers.updateTransaction({
          id: externalTransaction!.id,
          payload: {
            transferNature: TRANSACTION_TRANSFER_NATURE.common_transfer,
            destinationAccountId: accountB.id,
            destinationAmount: Number(externalTransaction!.refAmount),
          },
          raw: true,
        });
        const transferId = baseTx.transferId;

        const checkBalanceIsCorrect = async (expected) => {
          const balanceHistory = await helpers.makeRequest({
            method: 'get',
            url: '/stats/balance-history',
            raw: true,
          });
          // Find balance record for the external transaction's account and date
          const externalTxDate = new Date(baseTx.time).toISOString().split('T')[0];

          // Find balance record for the opposite transaction (accountB)
          const newTxBalanceRecord = balanceHistory.find(
            (item) => item.date === externalTxDate && item.accountId === oppositeTx!.accountId,
          );

          expect(newTxBalanceRecord?.amount || 0).toBe(
            expected === 0 ? 0 : oppositeTx!.transactionType === TRANSACTION_TYPES.expense ? -expected : expected,
          );
        };

        expect(baseTx).toMatchObject({
          amount: externalTransaction!.amount,
          refAmount: externalTransaction!.refAmount,
          accountId: externalTransaction!.accountId,
          transferId,
          transactionType: transactionType,
        });
        expect(oppositeTx).toMatchObject({
          amount: externalTransaction!.refAmount,
          refAmount: externalTransaction!.refAmount,
          transferId,
          accountId: accountB.id,
          transactionType:
            transactionType === TRANSACTION_TYPES.expense ? TRANSACTION_TYPES.income : TRANSACTION_TYPES.expense,
        });

        // The synced account balance and bank entry reference must not be copied onto
        // the opposite leg. `externalData` isn't exposed via the API — read it from the DB.
        const oppositeRow = await Transactions.findByPk(oppositeTx!.id);
        expect(oppositeRow!.externalData?.balance).toBeUndefined();
        expect(oppositeRow!.externalData?.entryReference).toBeUndefined();

        await checkBalanceIsCorrect(externalTransaction!.refAmount);

        // Now update it back to be non-transfer one
        await helpers.updateTransaction({
          id: externalTransaction!.id,
          payload: {
            transferNature: TRANSACTION_TRANSFER_NATURE.not_transfer,
          },
          raw: true,
        });

        // Balance should remain the same since opposite tx is now unlinked (not deleted)
        await checkBalanceIsCorrect(externalTransaction!.refAmount);

        const transactionsAfterUpdate = (await helpers.getTransactions({
          raw: true,
        }))!;

        // Check that opposite tx is unlinked (not deleted)
        const oppositeTxAfter = transactionsAfterUpdate.find((i) => i.id === oppositeTx!.id);
        expect(oppositeTxAfter).not.toBe(undefined);
        expect(oppositeTxAfter!.transferId).toBe(null);
        expect(oppositeTxAfter!.transferNature).toBe(TRANSACTION_TRANSFER_NATURE.not_transfer);
        // Check that base tx doesn't have transferId anymore
        expect(transactionsAfterUpdate.find((i) => i.id === baseTx.id)!.transferId).toBe(null);
      }
    }, 30000);

    it('updates external expense and income to transfer_out_wallet without transactionType', async () => {
      await helpers.monobank.pair();
      const { transactions } = await helpers.monobank.mockTransactions();

      for (const transactionType of [TRANSACTION_TYPES.expense, TRANSACTION_TYPES.income]) {
        const externalTransaction = transactions.find((item) => item.transactionType === transactionType);
        expect(externalTransaction).not.toBe(undefined);

        // Update external transaction to transfer_out_wallet
        const [baseTx] = await helpers.updateTransaction({
          id: externalTransaction!.id,
          payload: {
            transferNature: TRANSACTION_TRANSFER_NATURE.transfer_out_wallet,
          },
          raw: true,
        });

        // Verify that the transaction was updated to transfer_out_wallet
        expect(baseTx).toMatchObject({
          amount: externalTransaction!.amount,
          refAmount: externalTransaction!.refAmount,
          accountId: externalTransaction!.accountId,
          transferId: null,
          transferNature: TRANSACTION_TRANSFER_NATURE.transfer_out_wallet,
          // transactionType should remain the same as the original
          transactionType: transactionType,
        });
      }

      // Verify no opposite transaction is created for out_of_wallet
      const allTransactions = (await helpers.getTransactions({ raw: true }))!;
      expect(allTransactions.length).toBe(transactions.length);
    });

    it('throws error when trying to make invalid actions', async () => {
      await helpers.monobank.pair();
      const { transactions } = await helpers.monobank.mockTransactions();

      const incomeTransaction = transactions.find((item) => item.transactionType === TRANSACTION_TYPES.income);
      const expenseTransaction = transactions.find((item) => item.transactionType === TRANSACTION_TYPES.expense);

      // when trying to update "transactionType" of the external account
      const result_a = await helpers.updateTransaction({
        id: incomeTransaction!.id,
        payload: { transactionType: TRANSACTION_TYPES.expense },
      });
      expect(result_a.statusCode).toEqual(ERROR_CODES.ValidationError);

      const result_b = await helpers.updateTransaction({
        id: expenseTransaction!.id,
        payload: { transactionType: TRANSACTION_TYPES.income },
      });
      expect(result_b.statusCode).toEqual(ERROR_CODES.ValidationError);

      const mockedData = {
        amount: faker.number.int({ max: 10000, min: 0 }),
        time: faker.date.anytime(),
        transactionType: TRANSACTION_TYPES.expense,
        accountId: faker.number.int({ max: 10000, min: 0 }),
      };

      // Trying to update some of restricted fields
      for (const field of EXTERNAL_ACCOUNT_RESTRICTED_UPDATION_FIELDS) {
        const res = await helpers.updateTransaction({
          id: expenseTransaction!.id,
          payload: { [field]: mockedData[field] },
        });
        expect(res.statusCode).toEqual(ERROR_CODES.ValidationError);
      }
    });
  });

  describe('transfer legs on bank-linked accounts', () => {
    const accountIdOf = async ({ id }: { id: RecordId }) =>
      (await helpers.getTransactionById({ id, raw: true }))?.accountId;

    it('rejects converting a transaction into a transfer whose destination is a bank-linked account', async () => {
      const { account: bankAccount } = await helpers.lunchflow.mockTransactions();
      const manualAccount = await helpers.createAccount({ raw: true });
      const [tx] = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({ accountId: manualAccount.id, amount: 10 }),
        raw: true,
      });
      const bankRowsBefore = (await helpers.getTransactions({ accountIds: [bankAccount.id], raw: true })).length;

      const response = await helpers.updateTransaction({
        id: tx.id,
        payload: {
          transferNature: TRANSACTION_TRANSFER_NATURE.common_transfer,
          destinationAccountId: bankAccount.id,
          destinationAmount: 10,
        },
      });

      expect(response.statusCode).toBe(ERROR_CODES.ValidationError);
      expect(await helpers.getTransactions({ accountIds: [bankAccount.id], raw: true })).toHaveLength(bankRowsBefore);
      expect((await helpers.getTransactionById({ id: tx.id, raw: true }))!.transferNature).toBe(
        TRANSACTION_TRANSFER_NATURE.not_transfer,
      );
    });

    it('rejects changing a transfer destination to a bank-linked account', async () => {
      const { account: bankAccount } = await helpers.lunchflow.mockTransactions();
      const [accountA, accountB] = await Promise.all([
        helpers.createAccount({ raw: true }),
        helpers.createAccount({ raw: true }),
      ]);
      const [baseTx, oppositeTx] = await helpers.createTransaction({
        payload: {
          ...helpers.buildTransactionPayload({ accountId: accountA.id, amount: 10 }),
          transferNature: TRANSACTION_TRANSFER_NATURE.common_transfer,
          destinationAccountId: accountB.id,
          destinationAmount: 10,
        },
        raw: true,
      });

      const response = await helpers.updateTransaction({
        id: baseTx.id,
        payload: { destinationAccountId: bankAccount.id },
      });

      expect(response.statusCode).toBe(ERROR_CODES.ValidationError);
      expect(await accountIdOf({ id: oppositeTx!.id })).toBe(accountB.id);
    });

    it('rejects moving a linked bank transaction off its account through the manual leg', async () => {
      const { account: bankAccount, transactions } = await helpers.lunchflow.mockTransactions();
      const bankTx = transactions.find((tx) => tx.accountId === bankAccount.id)!;
      expect(bankTx).toBeDefined();
      const [accountA, accountC] = await Promise.all([
        helpers.createAccount({ raw: true }),
        helpers.createAccount({ raw: true }),
      ]);
      const [manualLeg] = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: accountA.id,
          amount: 50,
          transactionType:
            bankTx.transactionType === TRANSACTION_TYPES.expense ? TRANSACTION_TYPES.income : TRANSACTION_TYPES.expense,
          transferNature: TRANSACTION_TRANSFER_NATURE.common_transfer,
          destinationTransactionId: bankTx.id,
        }),
        raw: true,
      });

      const response = await helpers.updateTransaction({
        id: manualLeg.id,
        payload: { destinationAccountId: accountC.id },
      });

      expect(response.statusCode).toBe(ERROR_CODES.ValidationError);
      expect(await accountIdOf({ id: bankTx.id })).toBe(bankAccount.id);
    });
  });

  describe('link transactions between each other', () => {
    it.each([[TRANSACTION_TYPES.expense], [TRANSACTION_TYPES.income]])(
      'links %s to a transfer and unlinks both transactions back to their initial state',
      async (txType) => {
        const accountA = await helpers.createAccount({ raw: true });
        const accountB = await helpers.createAccount({ raw: true });

        const oppositeTxType =
          txType === TRANSACTION_TYPES.income ? TRANSACTION_TYPES.expense : TRANSACTION_TYPES.income;

        const [tx1] = await helpers.createTransaction({
          payload: helpers.buildTransactionPayload({
            accountId: accountA.id,
            transactionType: txType,
          }),
          raw: true,
        });
        const [tx2] = await helpers.createTransaction({
          payload: helpers.buildTransactionPayload({
            accountId: accountB.id,
            transactionType: oppositeTxType,
          }),
          raw: true,
        });

        await helpers.updateTransaction({
          id: tx1.id,
          payload: {
            transferNature: TRANSACTION_TRANSFER_NATURE.common_transfer,
            destinationTransactionId: tx2.id,
          },
        });

        const txsAfterLinking = (await helpers.getTransactions({ raw: true }))!;

        const tx1AfterLinking = txsAfterLinking.find((item) => item.id === tx1.id);
        const tx2AfterLinking = txsAfterLinking.find((item) => item.id === tx2.id);

        [
          [tx1, tx1AfterLinking],
          [tx2, tx2AfterLinking],
        ].forEach(([tx, txAfter]) => {
          // Expect that only transferNature and transferId were changed
          expect({ ...tx }).toEqual({
            ...txAfter,
            transferNature: expect.toBeAnythingOrNull(),
            transferId: expect.toBeAnythingOrNull(),
            updatedAt: expect.toBeAnythingOrNull(),
          });

          expect(txAfter!.transferNature).toBe(TRANSACTION_TRANSFER_NATURE.common_transfer);
          expect(txAfter!.transferId).toEqual(expect.any(String));
        });

        expect(tx1AfterLinking!.transferId).toBe(tx2AfterLinking!.transferId);

        await helpers.updateTransaction({
          id: tx1.id,
          payload: {
            transferNature: TRANSACTION_TRANSFER_NATURE.not_transfer,
          },
        });

        const txsAfterUnlinking = (await helpers.getTransactions({ raw: true }))!;

        // Both transactions should exist but be unlinked
        expect(txsAfterUnlinking.length).toBe(2);

        expect(txsAfterUnlinking.find((t) => t.id === tx1.id)).toMatchObject({
          ...tx1,
          transferId: null,
          transferNature: TRANSACTION_TRANSFER_NATURE.not_transfer,
          updatedAt: expect.toBeAnythingOrNull(),
        });
        expect(txsAfterUnlinking.find((t) => t.id === tx2.id)).toMatchObject({
          ...tx2,
          transferId: null,
          transferNature: TRANSACTION_TRANSFER_NATURE.not_transfer,
          updatedAt: expect.toBeAnythingOrNull(),
        });
      },
    );

    it('rejects linking to the same account, to the same transactionType, or to an existing transfer', async () => {
      const accountA = await helpers.createAccount({ raw: true });
      const accountB = await helpers.createAccount({ raw: true });
      const accountC = await helpers.createAccount({ raw: true });

      const createTx = async ({
        accountId,
        transactionType,
      }: {
        accountId: RecordId;
        transactionType: TRANSACTION_TYPES;
      }) => {
        const [tx] = await helpers.createTransaction({
          payload: helpers.buildTransactionPayload({ accountId, transactionType }),
          raw: true,
        });
        return tx;
      };

      const expenseA = await createTx({ accountId: accountA.id, transactionType: TRANSACTION_TYPES.expense });
      const incomeA = await createTx({ accountId: accountA.id, transactionType: TRANSACTION_TYPES.income });
      const expenseB = await createTx({ accountId: accountB.id, transactionType: TRANSACTION_TYPES.expense });
      const incomeB = await createTx({ accountId: accountB.id, transactionType: TRANSACTION_TYPES.income });

      const transferPair = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: accountB.id,
          amount: 10,
          transferNature: TRANSACTION_TRANSFER_NATURE.common_transfer,
          destinationAmount: 20,
          destinationAccountId: accountC.id,
        }),
        raw: true,
      });
      const transferExpenseTx = transferPair.find((t) => t!.transactionType === TRANSACTION_TYPES.expense)!;
      const transferIncomeTx = transferPair.find((t) => t!.transactionType === TRANSACTION_TYPES.income)!;

      const rejectedLinks = [
        // same account
        { id: expenseA.id, destinationTransactionId: incomeA.id },
        { id: incomeA.id, destinationTransactionId: expenseA.id },
        // same transactionType
        { id: expenseA.id, destinationTransactionId: expenseB.id },
        { id: incomeA.id, destinationTransactionId: incomeB.id },
        // destination is already a transfer
        { id: expenseA.id, destinationTransactionId: transferIncomeTx.id },
        { id: incomeA.id, destinationTransactionId: transferExpenseTx.id },
      ];

      for (const { id, destinationTransactionId } of rejectedLinks) {
        const result = await helpers.updateTransaction({
          id,
          payload: {
            transferNature: TRANSACTION_TRANSFER_NATURE.common_transfer,
            destinationTransactionId,
          },
        });

        expect(result.statusCode).toBe(ERROR_CODES.ValidationError);
      }
    });
  });

  describe('refunds', () => {
    const createTestTx = async (txType: TRANSACTION_TYPES, amount: number) => {
      const account = await helpers.createAccount({ raw: true });
      const [tx] = await helpers.createTransaction({
        payload: {
          ...helpers.buildTransactionPayload({ accountId: account.id }),
          transactionType: txType,
          amount,
        },
        raw: true,
      });
      return tx;
    };
    const scenarios = [
      {
        originalType: TRANSACTION_TYPES.expense,
        refundType: TRANSACTION_TYPES.income,
      },
    ];

    it('fails when trying to update both refundsTxId, and refundedBy', async () => {
      const originalTx = await createTestTx(TRANSACTION_TYPES.expense, 1000);
      const refundTx = await createTestTx(TRANSACTION_TYPES.income, 500);
      const response = await helpers.updateTransaction({
        id: refundTx.id,
        payload: {
          refundsTxId: originalTx.id,
          refundedByTxIds: [originalTx.id],
        },
      });

      expect(response.statusCode).toBe(ERROR_CODES.ValidationError);
    });

    it('change from refundsTxId to refundedByTxIds', async () => {
      const [original, refund] = await Promise.all([
        // Use the same amount, so transactions can refund another in both directions
        createTestTx(TRANSACTION_TYPES.expense, 500),
        createTestTx(TRANSACTION_TYPES.income, 500),
      ]);

      // Set up initial refund relationship
      await helpers.updateTransaction({
        id: refund.id,
        payload: {
          refundsTxId: original.id,
        },
      });

      const initialRefund = await helpers.getSingleRefund({
        originalTxId: original.id,
        refundTxId: refund.id,
      });
      expect(initialRefund.statusCode).toBe(200);

      // Change to new refundedByTxIds format
      const [updatedOriginalTx] = await helpers.updateTransaction({
        id: refund.id,
        payload: {
          refundedByTxIds: [original.id],
        },
        raw: true,
      });
      expect(updatedOriginalTx.refundLinked).toBe(true);

      const oldRefund = await helpers.getSingleRefund({
        originalTxId: original.id,
        refundTxId: refund.id,
      });
      expect(oldRefund.statusCode).toBe(ERROR_CODES.NotFoundError);
      const newRefund = await helpers.getSingleRefund({
        originalTxId: refund.id,
        refundTxId: original.id,
      });
      expect(newRefund.statusCode).toBe(200);
    });

    describe('transaction refunds another transaction', () => {
      it.each(scenarios)(
        'refunds another transaction and unlinks it when refundsTxId is null ($originalType -> $refundType)',
        async ({ originalType, refundType }) => {
          const originalTx = await createTestTx(originalType, 1000);
          const refundTx = await createTestTx(refundType, 500);
          const [updatedOriginalTx] = await helpers.updateTransaction({
            id: refundTx.id,
            payload: {
              refundsTxId: originalTx.id,
            },
            raw: true,
          });

          let refund = await helpers.getSingleRefund({
            originalTxId: originalTx.id,
            refundTxId: refundTx.id,
          });

          let transactions = (await helpers.getTransactions({ raw: true }))!.filter((t) =>
            [originalTx.id, refundTx.id].includes(t.id),
          );

          expect(refund.statusCode).toBe(200);
          expect(updatedOriginalTx.refundLinked).toBe(true);
          expect(transactions.every((i) => !!i.refundLinked)).toBe(true);

          await helpers.updateTransaction({
            id: refundTx.id,
            payload: {
              refundsTxId: null,
            },
            raw: true,
          });

          refund = await helpers.getSingleRefund({
            originalTxId: originalTx.id,
            refundTxId: refundTx.id,
          });

          transactions = (await helpers.getTransactions({ raw: true }))!.filter((t) =>
            [originalTx.id, refundTx.id].includes(t.id),
          );

          expect(refund.statusCode).toBe(ERROR_CODES.NotFoundError);
          expect(transactions.every((i) => !!i.refundLinked)).toBe(false);
        },
      );

      it.each(scenarios)(
        'should change refund transaction when a new one is provided ($originalType -> $refundType)',
        async ({ originalType, refundType }) => {
          const originalTx1 = await createTestTx(originalType, 1000);
          const originalTx2 = await createTestTx(originalType, 500);
          const refundTx = await createTestTx(refundType, 500);

          await helpers.updateTransaction({
            id: refundTx.id,
            payload: {
              refundsTxId: originalTx1.id,
            },
            raw: true,
          });

          await helpers.updateTransaction({
            id: refundTx.id,
            payload: {
              refundsTxId: originalTx2.id,
            },
            raw: true,
          });

          const oldRefund = await helpers.getSingleRefund({
            originalTxId: originalTx1.id,
            refundTxId: refundTx.id,
          });
          expect(oldRefund.statusCode).toBe(ERROR_CODES.NotFoundError);

          const newRefund = await helpers.getSingleRefund({
            originalTxId: originalTx2.id,
            refundTxId: refundTx.id,
          });
          expect(newRefund.statusCode).toBe(200);

          const transactions = (await helpers.getTransactions({ raw: true }))!;

          // Test that previously refunded tx is now not marked as a refund
          expect(transactions.find((i) => i.id === originalTx1.id)!.refundLinked).toBe(false);
          expect(transactions.find((t) => [refundTx.id, originalTx2.id].includes(t.id))!.refundLinked).toBe(true);
        },
      );
    });

    describe('transaction refunded by many others', () => {
      it.each(scenarios)(
        'links multiple refund transactions and unlinks them when refundedByTxIds is null ($originalType -> $refundType)',
        async ({ originalType, refundType }) => {
          const [originalTx, refundTx1, refundTx2] = await Promise.all([
            createTestTx(originalType, 1000),
            createTestTx(refundType, 500),
            createTestTx(refundType, 500),
          ]);

          const [updatedOriginalTx] = await helpers.updateTransaction({
            id: originalTx.id,
            payload: {
              refundedByTxIds: [refundTx1.id, refundTx2.id],
            },
            raw: true,
          });

          let refunds = await Promise.all([
            helpers.getSingleRefund({
              originalTxId: originalTx.id,
              refundTxId: refundTx1.id,
            }),
            helpers.getSingleRefund({
              originalTxId: originalTx.id,
              refundTxId: refundTx2.id,
            }),
          ]);

          let transactions = (await helpers.getTransactions({ raw: true }))!;

          expect(refunds.every((r) => r.statusCode === 200)).toBe(true);
          expect(updatedOriginalTx.refundLinked).toBe(true);
          expect(
            transactions
              .filter((t) => [originalTx.id, refundTx1.id, refundTx2.id].includes(t.id))
              .every((t) => t.refundLinked),
          ).toBe(true);

          await helpers.updateTransaction({
            id: originalTx.id,
            payload: {
              refundedByTxIds: null,
            },
            raw: true,
          });

          refunds = await Promise.all([
            helpers.getSingleRefund({
              originalTxId: originalTx.id,
              refundTxId: refundTx1.id,
            }),
            helpers.getSingleRefund({
              originalTxId: originalTx.id,
              refundTxId: refundTx2.id,
            }),
          ]);

          transactions = (await helpers.getTransactions({ raw: true }))!;

          expect(refunds.every((r) => r.statusCode === ERROR_CODES.NotFoundError)).toBe(true);
          expect(
            transactions
              .filter((t) => [originalTx.id, refundTx1.id, refundTx2.id].includes(t.id))
              .every((t) => !t.refundLinked),
          ).toBe(true);
        },
      );

      it.each(scenarios)(
        'changes refund transactions when new array is provided ($originalType -> $refundType)',
        async ({ originalType, refundType }) => {
          const [originalTx, refundTx1, refundTx2, refundTx3] = await Promise.all([
            createTestTx(originalType, 1000),
            createTestTx(refundType, 300),
            createTestTx(refundType, 300),
            createTestTx(refundType, 400),
          ]);

          await helpers.updateTransaction({
            id: originalTx.id,
            payload: {
              refundedByTxIds: [refundTx1.id, refundTx2.id],
            },
          });

          await helpers.updateTransaction({
            id: originalTx.id,
            payload: {
              refundedByTxIds: [refundTx2.id, refundTx3.id],
            },
          });

          const refunds = await Promise.all([
            helpers.getSingleRefund({
              originalTxId: originalTx.id,
              refundTxId: refundTx1.id,
            }),
            helpers.getSingleRefund({
              originalTxId: originalTx.id,
              refundTxId: refundTx2.id,
            }),
            helpers.getSingleRefund({
              originalTxId: originalTx.id,
              refundTxId: refundTx3.id,
            }),
          ]);

          expect(refunds[0].statusCode).toBe(ERROR_CODES.NotFoundError);
          expect(refunds[1].statusCode).toBe(200);
          expect(refunds[2].statusCode).toBe(200);
        },
      );

      it.each(scenarios)(
        'does not allow refunds exceeding original transaction amount ($originalType -> $refundType)',
        async ({ originalType, refundType }) => {
          const [originalTx, refundTx1, refundTx2, refundTx3] = await Promise.all([
            createTestTx(originalType, 1000),
            createTestTx(refundType, 500),
            createTestTx(refundType, 500),
            createTestTx(refundType, 100),
          ]);

          const response = await helpers.updateTransaction({
            id: originalTx.id,
            payload: {
              refundedByTxIds: [refundTx1.id, refundTx2.id, refundTx3.id],
            },
          });

          expect(response.statusCode).toBe(ERROR_CODES.ValidationError);
        },
      );
    });
  });

  describe('portfolio-linked transaction protection', () => {
    it('should reject updating a transaction linked to a portfolio', async () => {
      const account = await helpers.createAccount({ raw: true });
      const portfolio = await helpers.createPortfolio({
        payload: helpers.buildPortfolioPayload({ name: 'Test Portfolio' }),
        raw: true,
      });

      const [tx] = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account.id,
          amount: 100,
          transactionType: TRANSACTION_TYPES.expense,
        }),
        raw: true,
      });

      await helpers.linkTransactionToPortfolio({
        transactionId: tx.id,
        payload: { portfolioId: portfolio.id },
        raw: true,
      });

      const result = await helpers.updateTransaction({
        id: tx.id,
        payload: { note: 'trying to edit' },
      });

      expect(result.statusCode).toBe(ERROR_CODES.ValidationError);
    });

    it('should allow updating after unlinking from portfolio', async () => {
      const account = await helpers.createAccount({ raw: true });
      const portfolio = await helpers.createPortfolio({
        payload: helpers.buildPortfolioPayload({ name: 'Test Portfolio' }),
        raw: true,
      });

      const [tx] = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account.id,
          amount: 100,
          transactionType: TRANSACTION_TYPES.expense,
        }),
        raw: true,
      });

      await helpers.linkTransactionToPortfolio({
        transactionId: tx.id,
        payload: { portfolioId: portfolio.id },
        raw: true,
      });

      await helpers.unlinkTransactionFromPortfolio({
        transactionId: tx.id,
        raw: true,
      });

      const [updatedTx] = await helpers.updateTransaction({
        id: tx.id,
        payload: { note: 'edited after unlink' },
        raw: true,
      });

      expect(updatedTx.note).toBe('edited after unlink');
    });
  });

  describe('orphaned transfer leg', () => {
    it('should update a common_transfer transaction whose pair is gone (transferId cleared)', async () => {
      const [tx] = await helpers.createTransaction({ raw: true });

      // Reproduces a corrupt row seen in production (Sentry MONEY-MATTER-BACKEND-6J): a
      // transaction flagged as a common transfer but with its `transferId` cleared. The
      // opposite-tx lookup did `findAll({ transferId: null })`, which matches every other
      // null-transferId row in the DB, picked a bogus "opposite", and failed its auth gate
      // — surfacing as a misleading "Cannot find opposite tx to make an updation".
      await Transactions.update(
        { transferNature: TRANSACTION_TRANSFER_NATURE.common_transfer, transferId: null },
        { where: { id: tx.id } },
      );

      const newAmount = Number(tx.amount) + 500;
      const res = await helpers.updateTransaction({
        id: tx.id,
        payload: { amount: newAmount },
        raw: false,
      });

      expect(res.statusCode).toEqual(200);

      const [updated] = await helpers.getTransactions({ raw: true });
      expect(updated!.amount).toEqual(newAmount);
    });

    it("should update an orphaned common_transfer leg (type change) without touching another user's transactions", async () => {
      // Primary user's orphaned leg: flagged common_transfer but with transferId cleared.
      const [leg] = await helpers.createTransaction({ raw: true });
      await Transactions.update(
        { transferNature: TRANSACTION_TRANSFER_NATURE.common_transfer, transferId: null },
        { where: { id: leg.id } },
      );

      // A second, unrelated user owning their own null-transferId transaction. The opposite
      // lookup in `unlinkOppositeTransaction` queries `findAll({ transferId: null })` with NO
      // userId filter, so before the guard it matched this foreign row, treated it as the
      // "opposite", and failed its write-access gate — surfacing as a spurious 404 (the prod
      // shape of MONEY-MATTER-BACKEND-6J on the unlink code path).
      const secondUser = await helpers.signUpSecondUser();
      let foreignTxId = '';
      await helpers.asUser({
        cookies: secondUser.cookies,
        fn: async () => {
          await helpers.setBaseCurrencyForActiveUser({ currencyCode: global.BASE_CURRENCY.code });
          const account = await helpers.createAccount({ raw: true });
          const category = await helpers.addCustomCategory({ name: 'second-user-cat', color: '#123456', raw: true });
          const [tx] = await helpers.createTransaction({
            payload: helpers.buildTransactionPayload({ accountId: account.id, categoryId: category.id }),
            raw: true,
          });
          foreignTxId = tx.id;
        },
      });

      // Changing transactionType routes the update through `unlinkOppositeTransaction`.
      const res = await helpers.updateTransaction({
        id: leg.id,
        payload: { transactionType: TRANSACTION_TYPES.income },
        raw: false,
      });

      expect(res.statusCode).toEqual(200);

      // The foreign transaction must be left completely untouched.
      const foreignTx = await Transactions.findByPk(foreignTxId);
      expect(foreignTx).not.toBeNull();
      expect(foreignTx!.transferId).toBeNull();
      expect(foreignTx!.transferNature).toEqual(TRANSACTION_TRANSFER_NATURE.not_transfer);
    });
  });

  describe('Payee linking', () => {
    it('rejects a foreign-user payeeId on PATCH with 404 (cross-user injection guard)', async () => {
      // Mirrors the same guard exercised by the create path — the row's
      // `payeeId` must reference a Payee owned by the row's `userId`.
      const secondUser = await helpers.signUpSecondUser();
      let foreignPayeeId: RecordId | null = null;
      await helpers.asUser({
        cookies: secondUser.cookies,
        fn: async () => {
          await helpers.setBaseCurrencyForActiveUser({ currencyCode: global.BASE_CURRENCY.code });
          const payee = await helpers.createPayee({
            payload: helpers.buildPayeePayload({ name: `Foreign Patch Co ${Date.now()}` }),
            raw: true,
          });
          foreignPayeeId = payee.id;
        },
      });

      const [tx] = await helpers.createTransaction({ raw: true });
      const result = await helpers.updateTransaction({
        id: tx.id,
        payload: { payeeId: foreignPayeeId! },
        raw: false,
      });

      expect(result.statusCode).toBe(ERROR_CODES.NotFoundError);
    });
  });

  describe('editing a two-leg transfer keeps one expense and one income leg', () => {
    const getLegs = async ({ expenseLegId, incomeLegId }: { expenseLegId: string; incomeLegId: string }) => {
      const transactions = (await helpers.getTransactions({ raw: true }))!;
      return {
        expenseLeg: transactions.find((tx) => tx.id === expenseLegId)!,
        incomeLeg: transactions.find((tx) => tx.id === incomeLegId)!,
      };
    };

    const createManualCrossCurrencyTransfer = async () => {
      const [{ account: cryptoProxy }, { account: monobankManual }] = await Promise.all([
        helpers.createAccountWithNewCurrency({ currency: 'USD' }),
        helpers.createAccountWithNewCurrency({ currency: 'UAH' }),
      ]);

      const [expenseLeg, incomeLeg] = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: cryptoProxy.id,
          amount: 410,
          transactionType: TRANSACTION_TYPES.expense,
          transferNature: TRANSACTION_TRANSFER_NATURE.common_transfer,
          destinationAccountId: monobankManual.id,
          destinationAmount: 18400,
        }),
        raw: true,
      });

      expect(expenseLeg.transactionType).toBe(TRANSACTION_TYPES.expense);
      expect(incomeLeg!.transactionType).toBe(TRANSACTION_TYPES.income);

      return { cryptoProxy, monobankManual, expenseLeg, incomeLeg: incomeLeg! };
    };

    it('manual accounts: editing via the income leg does not flip the expense leg to income', async () => {
      const { cryptoProxy, monobankManual, expenseLeg, incomeLeg } = await createManualCrossCurrencyTransfer();

      const res = await helpers.updateTransaction({
        id: incomeLeg.id,
        payload: { note: 'edited from income leg' },
        raw: false,
      });
      expect(res.statusCode).toEqual(200);

      const legs = await getLegs({ expenseLegId: expenseLeg.id, incomeLegId: incomeLeg.id });

      expect(legs.expenseLeg).toMatchObject({
        transactionType: TRANSACTION_TYPES.expense,
        accountId: cryptoProxy.id,
        amount: 410,
        refAmount: expenseLeg.refAmount,
        transferId: expenseLeg.transferId,
        transferNature: TRANSACTION_TRANSFER_NATURE.common_transfer,
      });
      expect(legs.incomeLeg).toMatchObject({
        transactionType: TRANSACTION_TYPES.income,
        accountId: monobankManual.id,
        amount: 18400,
        refAmount: incomeLeg.refAmount,
        transferId: expenseLeg.transferId,
        transferNature: TRANSACTION_TRANSFER_NATURE.common_transfer,
      });
    });

    it('bank-connected income leg: a no-op save from the edit dialog does not flip the expense leg to income', async () => {
      await helpers.monobank.pair();
      const { account: monobankAccount, transactions } = await helpers.monobank.mockTransactions({
        transactions: [{ amount: 1840000 }],
      });
      const externalIncome = transactions.find(
        (tx) => tx.accountId === monobankAccount.id && tx.transactionType === TRANSACTION_TYPES.income,
      )!;
      expect(externalIncome).toBeDefined();

      const { account: cryptoProxy } = await helpers.createAccountWithNewCurrency({ currency: 'USD' });

      const [incomeLeg, expenseLeg] = await helpers.updateTransaction({
        id: externalIncome.id,
        payload: {
          transferNature: TRANSACTION_TRANSFER_NATURE.common_transfer,
          destinationAccountId: cryptoProxy.id,
          destinationAmount: 410,
        },
        raw: true,
      });
      expect(incomeLeg.transactionType).toBe(TRANSACTION_TYPES.income);
      expect(expenseLeg!.transactionType).toBe(TRANSACTION_TYPES.expense);

      // What prepareTxUpdationParams sends for an untouched form opened on the external income leg:
      // amount/time/type/accountId are omitted, and getDestinationAccount/Amount resolve to the source side.
      const res = await helpers.updateTransaction({
        id: incomeLeg.id,
        payload: {
          note: incomeLeg.note ?? undefined,
          paymentType: incomeLeg.paymentType,
          transferNature: TRANSACTION_TRANSFER_NATURE.common_transfer,
          destinationAccountId: cryptoProxy.id,
          destinationAmount: 410,
        },
        raw: false,
      });
      expect(res.statusCode).toEqual(200);

      const legs = await getLegs({ expenseLegId: expenseLeg!.id, incomeLegId: incomeLeg.id });

      expect(legs.expenseLeg).toMatchObject({
        transactionType: TRANSACTION_TYPES.expense,
        accountId: cryptoProxy.id,
        amount: 410,
        transferId: incomeLeg.transferId,
        transferNature: TRANSACTION_TRANSFER_NATURE.common_transfer,
      });
      expect(legs.incomeLeg).toMatchObject({
        transactionType: TRANSACTION_TYPES.income,
        accountId: monobankAccount.id,
        amount: 18400,
        transferId: incomeLeg.transferId,
        transferNature: TRANSACTION_TRANSFER_NATURE.common_transfer,
      });
    }, 30000);

    it('manual accounts: editing via the expense leg keeps both leg types (control)', async () => {
      const { cryptoProxy, monobankManual, expenseLeg, incomeLeg } = await createManualCrossCurrencyTransfer();

      const res = await helpers.updateTransaction({
        id: expenseLeg.id,
        payload: {
          amount: 410,
          note: 'edited from expense leg',
          time: new Date(expenseLeg.time).toISOString(),
          transactionType: TRANSACTION_TYPES.expense,
          paymentType: expenseLeg.paymentType,
          accountId: cryptoProxy.id,
          transferNature: TRANSACTION_TRANSFER_NATURE.common_transfer,
          destinationAccountId: monobankManual.id,
          destinationAmount: 18400,
        },
        raw: false,
      });
      expect(res.statusCode).toEqual(200);

      const legs = await getLegs({ expenseLegId: expenseLeg.id, incomeLegId: incomeLeg.id });

      expect(legs.expenseLeg).toMatchObject({
        transactionType: TRANSACTION_TYPES.expense,
        accountId: cryptoProxy.id,
        amount: 410,
        transferId: expenseLeg.transferId,
      });
      expect(legs.incomeLeg).toMatchObject({
        transactionType: TRANSACTION_TYPES.income,
        accountId: monobankManual.id,
        amount: 18400,
        transferId: expenseLeg.transferId,
      });
    });
  });
});
