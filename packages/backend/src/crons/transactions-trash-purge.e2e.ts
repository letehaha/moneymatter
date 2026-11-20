import {
  type RecordId,
  TRANSACTION_TRASH_RETENTION_DAYS,
  TRANSACTION_TRANSFER_NATURE,
  TRANSACTION_TYPES,
} from '@bt/shared/types';
import { describe, expect, it } from '@jest/globals';
import { transactionsTrashPurgeCron } from '@root/crons/transactions-trash-purge';
import * as helpers from '@tests/helpers';

/** The purge has no HTTP surface, so this e2e invokes it directly. */

const createAccount = () =>
  helpers.createAccount({ payload: helpers.buildAccountPayload({ initialBalance: 1000 }), raw: true });

const createExpense = async ({ accountId, amount = 100 }: { accountId: RecordId; amount?: number }) => {
  const [tx] = await helpers.createTransaction({
    payload: helpers.buildTransactionPayload({ accountId, amount, transactionType: TRANSACTION_TYPES.expense }),
    raw: true,
  });
  return tx!;
};

const trash = async ({ id }: { id: RecordId }) => {
  expect((await helpers.deleteTransaction({ id })).statusCode).toBe(200);
};

describe('Transactions trash purge cron', () => {
  it('purges rows trashed longer than the retention window and keeps newer ones and live rows', async () => {
    const account = await createAccount();
    const expired = await createExpense({ accountId: account.id, amount: 10 });
    const insideWindow = await createExpense({ accountId: account.id, amount: 20 });
    const live = await createExpense({ accountId: account.id, amount: 30 });
    await trash({ id: expired.id });
    await trash({ id: insideWindow.id });
    await helpers.backdateTrashedTransaction({ id: expired.id, days: TRANSACTION_TRASH_RETENTION_DAYS + 1 });
    await helpers.backdateTrashedTransaction({ id: insideWindow.id, days: TRANSACTION_TRASH_RETENTION_DAYS - 1 });

    expect(await transactionsTrashPurgeCron.triggerManualSync()).toEqual({ purged: 1 });

    expect((await helpers.getTrash({ raw: true })).map((entry) => entry.id)).toEqual([insideWindow.id]);
    expect((await helpers.restoreTrash({ transactionIds: [expired.id] })).statusCode).toBe(404);
    expect(await helpers.getTransactionById({ id: live.id, raw: true })).not.toBeNull();
    expect(Number((await helpers.getAccount({ id: account.id, raw: true })).currentBalance)).toBe(970);
  });

  it('purges both legs of an expired transfer', async () => {
    const [checking, savings] = [await createAccount(), await createAccount()];
    const [from, to] = await helpers.createTransaction({
      payload: {
        ...helpers.buildTransactionPayload({ accountId: checking.id, amount: 100 }),
        transferNature: TRANSACTION_TRANSFER_NATURE.common_transfer,
        destinationAmount: 100,
        destinationAccountId: savings.id,
      },
      raw: true,
    });
    await trash({ id: from.id });
    for (const id of [from.id, to!.id]) {
      await helpers.backdateTrashedTransaction({ id, days: TRANSACTION_TRASH_RETENTION_DAYS + 1 });
    }

    expect(await transactionsTrashPurgeCron.triggerManualSync()).toEqual({ purged: 2 });

    expect(await helpers.getTrash({ raw: true })).toEqual([]);
    expect(Number((await helpers.getAccount({ id: checking.id, raw: true })).currentBalance)).toBe(1000);
    expect(Number((await helpers.getAccount({ id: savings.id, raw: true })).currentBalance)).toBe(1000);
  });

  it('dissolves a group left with fewer than two members', async () => {
    const account = await createAccount();
    const [purged, survivor] = [
      await createExpense({ accountId: account.id }),
      await createExpense({ accountId: account.id }),
    ];
    const group = await helpers.createTransactionGroup({
      payload: helpers.buildTransactionGroupPayload({ name: 'Pair', transactionIds: [purged.id, survivor.id] }),
      raw: true,
    });
    await trash({ id: purged.id });
    await helpers.backdateTrashedTransaction({ id: purged.id, days: TRANSACTION_TRASH_RETENTION_DAYS + 1 });

    await transactionsTrashPurgeCron.triggerManualSync();

    expect((await helpers.getTransactionGroupById({ id: group.id })).statusCode).toBe(404);
    expect(await helpers.getTransactionById({ id: survivor.id, raw: true })).not.toBeNull();
  });

  it('is a no-op when nothing has expired', async () => {
    const account = await createAccount();
    const tx = await createExpense({ accountId: account.id });
    await trash({ id: tx.id });

    expect(await transactionsTrashPurgeCron.triggerManualSync()).toEqual({ purged: 0 });
    expect((await helpers.getTrash({ raw: true })).map((entry) => entry.id)).toEqual([tx.id]);
  });
});
