import { TRANSACTION_TRANSFER_NATURE, TRANSACTION_TYPES } from '@bt/shared/types';
import { generateRandomRecordId } from '@common/lib/record-id-helpers';
import { describe, expect, it } from '@jest/globals';
import { ERROR_CODES } from '@js/errors';
import * as helpers from '@tests/helpers';
import { addDays } from 'date-fns';

describe('POST /transactions/bulk-delete', () => {
  it('deletes rows of every nature in one batch and updates the list', async () => {
    const account = await helpers.createAccount({ raw: true });

    const [expense] = await helpers.createTransaction({
      payload: helpers.buildTransactionPayload({
        accountId: account.id,
        amount: 100,
        transactionType: TRANSACTION_TYPES.expense,
      }),
      raw: true,
    });
    const [income] = await helpers.createTransaction({
      payload: helpers.buildTransactionPayload({
        accountId: account.id,
        amount: 150,
        transactionType: TRANSACTION_TYPES.income,
      }),
      raw: true,
    });
    const [outOfWallet] = await helpers.createTransaction({
      payload: {
        ...helpers.buildTransactionPayload({ accountId: account.id, amount: 250 }),
        transferNature: TRANSACTION_TRANSFER_NATURE.transfer_out_wallet,
      },
      raw: true,
    });
    const [keeper] = await helpers.createTransaction({
      payload: helpers.buildTransactionPayload({ accountId: account.id, amount: 300 }),
      raw: true,
    });

    const deletedIds = [expense.id, income.id, outOfWallet.id];
    const result = await helpers.bulkDeleteTransactions({
      payload: { transactionIds: deletedIds },
      raw: true,
    });

    expect(result.deletedCount).toBe(3);
    expect(result.deletedIds.toSorted()).toEqual(deletedIds.toSorted());

    const remaining = await helpers.getTransactions({ raw: true });
    const remainingIds = remaining.map((tx) => tx.id);
    expect(remainingIds).toContain(keeper.id);
    expect(remainingIds).not.toContain(expense.id);
    expect(remainingIds).not.toContain(income.id);
    expect(remainingIds).not.toContain(outOfWallet.id);
  });

  it('deletes both legs of a transfer when one leg is selected, and tolerates both legs being selected', async () => {
    const accountA = await helpers.createAccount({ raw: true });
    const accountB = await helpers.createAccount({ raw: true });

    const [transferBase, transferOpposite] = await helpers.createTransaction({
      payload: {
        ...helpers.buildTransactionPayload({ accountId: accountA.id, amount: 500 }),
        transferNature: TRANSACTION_TRANSFER_NATURE.common_transfer,
        destinationAmount: 500,
        destinationAccountId: accountB.id,
      },
      raw: true,
    });

    const result = await helpers.bulkDeleteTransactions({
      payload: { transactionIds: [transferBase.id, transferOpposite!.id] },
      raw: true,
    });

    // The twin is removed by the transfer-pair cleanup, not counted twice
    expect(result.deletedCount).toBe(1);

    const remaining = await helpers.getTransactions({ raw: true });
    const remainingIds = remaining.map((tx) => tx.id);
    expect(remainingIds).not.toContain(transferBase.id);
    expect(remainingIds).not.toContain(transferOpposite!.id);
  });

  it('rejects unknown ids and an empty id list', async () => {
    const unknownIds = await helpers.bulkDeleteTransactions({
      payload: { transactionIds: [generateRandomRecordId()] },
    });
    expect(unknownIds.statusCode).toBe(ERROR_CODES.NotFoundError);

    const noIds = await helpers.bulkDeleteTransactions({
      payload: { transactionIds: [] },
    });
    expect(noIds.statusCode).toBe(ERROR_CODES.ValidationError);
  });

  it('refuses to delete bank-connected transactions and lists the disallowed ids', async () => {
    const { transactions: externalTransactions } = await helpers.monobank.mockTransactions({ amount: 2 });
    expect(externalTransactions.length).toBeGreaterThan(0);

    const account = await helpers.createAccount({ raw: true });
    const [systemTx] = await helpers.createTransaction({
      payload: helpers.buildTransactionPayload({ accountId: account.id, amount: 100 }),
      raw: true,
    });

    const externalTxId = externalTransactions[0]!.id;
    const response = await helpers.bulkDeleteTransactions({
      payload: { transactionIds: [systemTx.id, externalTxId] },
    });

    expect(response.statusCode).toBe(ERROR_CODES.ValidationError);

    // Nothing is deleted when the batch contains a disallowed row (all-or-nothing)
    const remaining = await helpers.getTransactions({ raw: true });
    const remainingIds = remaining.map((tx) => tx.id);
    expect(remainingIds).toContain(systemTx.id);
    expect(remainingIds).toContain(externalTxId);
  });

  it('refuses to delete a manual transaction once its account is linked to a bank', async () => {
    const { account } = await helpers.createAccountWithNewCurrency({ currency: 'USD' });
    const [tx] = await helpers.createTransaction({
      payload: helpers.buildTransactionPayload({ accountId: account.id }),
      raw: true,
    });
    await helpers.lunchflow.linkManualAccount({ accountId: account.id });

    const response = await helpers.bulkDeleteTransactions({ payload: { transactionIds: [tx.id] } });

    expect(response.statusCode).toBe(ERROR_CODES.ValidationError);
    expect((await helpers.getTransactionById({ id: tx.id, raw: true }))?.accountId).toBe(account.id);
  });

  it('deletes a planned transaction on a bank-connected account without moving the balance', async () => {
    const { account } = await helpers.monobank.mockTransactions({ amount: 2 });
    const balanceBefore = Number((await helpers.getAccount({ id: account.id, raw: true })).currentBalance);

    const [planned] = await helpers.createPlannedTransaction({
      payload: { accountId: account.id, amount: 250, time: addDays(new Date(), 5).toISOString() },
      raw: true,
    });

    const result = await helpers.bulkDeleteTransactions({
      payload: { transactionIds: [planned.id] },
      raw: true,
    });

    expect(result.deletedCount).toBe(1);
    expect(await helpers.getTransactionById({ id: planned.id, raw: true })).toBe(null);
    expect(Number((await helpers.getAccount({ id: account.id, raw: true })).currentBalance)).toBe(balanceBefore);
  });
});
