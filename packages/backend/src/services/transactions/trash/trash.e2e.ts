import {
  type RecordId,
  RESOURCE_TYPES,
  SHARE_PERMISSIONS,
  TRANSACTION_TRASH_RETENTION_DAYS,
  TRANSACTION_TRANSFER_NATURE,
  TRANSACTION_TYPES,
  TRANSACTIONS_WRITE_SCOPES,
} from '@bt/shared/types';
import { NONEXISTENT_ID } from '@common/lib/record-id-helpers';
import { describe, expect, it } from '@jest/globals';
import { ERROR_CODES } from '@js/errors';
import * as helpers from '@tests/helpers';
import { addDays, subDays } from 'date-fns';

const DAY_MS = 24 * 60 * 60 * 1000;

const PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

const balanceOf = async ({ id }: { id: RecordId }) =>
  Number((await helpers.getAccount({ id, raw: true })).currentBalance);

const createAccount = ({ initialBalance = 1000 }: { initialBalance?: number } = {}) =>
  helpers.createAccount({ payload: helpers.buildAccountPayload({ initialBalance }), raw: true });

const createExpense = async ({
  accountId,
  amount = 100,
  ...rest
}: { accountId: RecordId; amount?: number } & Partial<Parameters<typeof helpers.buildTransactionPayload>[0]>) => {
  const [tx] = await helpers.createTransaction({
    payload: helpers.buildTransactionPayload({
      accountId,
      amount,
      transactionType: TRANSACTION_TYPES.expense,
      ...rest,
    }),
    raw: true,
  });
  return tx!;
};

const createTransfer = async ({
  fromId,
  toId,
  amount = 100,
}: {
  fromId: RecordId;
  toId: RecordId;
  amount?: number;
}) => {
  const [from, to] = await helpers.createTransaction({
    payload: {
      ...helpers.buildTransactionPayload({ accountId: fromId, amount }),
      transferNature: TRANSACTION_TRANSFER_NATURE.common_transfer,
      destinationAmount: amount,
      destinationAccountId: toId,
    },
    raw: true,
  });
  return { from: from!, to: to! };
};

const trash = async ({ id }: { id: RecordId }) => {
  const response = await helpers.deleteTransaction({ id });
  expect(response.statusCode).toBe(200);
};

const setupLoan = async () => {
  await helpers.addUserCurrencies({ currencyCodes: ['USD'] });
  const loan = await helpers.createLoan({
    payload: helpers.buildCreateLoanPayload({ initialBalance: 1_000, originalPrincipal: 1_000 }),
    raw: true,
  });
  const source = await helpers.createAccount({
    payload: helpers.buildAccountPayload({ currencyCode: 'USD' }),
    raw: true,
  });
  const pay = async ({ amount }: { amount: number }) => {
    const [payment] = await helpers.createTransaction({
      payload: {
        ...helpers.buildTransactionPayload({ accountId: source.id, amount }),
        transferNature: TRANSACTION_TRANSFER_NATURE.transfer_to_loan,
        destinationAmount: amount,
        destinationAccountId: loan.id as RecordId,
      },
      raw: true,
    });
    return payment!;
  };
  return { loan, source, pay };
};

const shareAccount = async ({ accountId, recipient }: { accountId: RecordId; recipient: helpers.SecondUserHandle }) => {
  const invitation = await helpers.createShareInvitation({
    inviteeEmail: recipient.email,
    resourceType: RESOURCE_TYPES.account,
    resourceId: accountId,
    permission: SHARE_PERMISSIONS.write,
    policy: { transactionsWriteScope: TRANSACTIONS_WRITE_SCOPES.all },
    raw: true,
  });
  await helpers.asUser({
    cookies: recipient.cookies,
    fn: () => helpers.acceptShareInvitation({ token: invitation.token, raw: true }),
  });
};

describe('Transactions Trash', () => {
  describe('GET /transactions/trash', () => {
    it('returns an empty list when nothing is trashed', async () => {
      const account = await createAccount();
      await createExpense({ accountId: account.id });

      expect(await helpers.getTrash({ raw: true })).toEqual([]);
    });

    it('lists a deleted transaction with its 30-day expiry and hides it from the transactions list', async () => {
      const account = await createAccount();
      const tx = await createExpense({ accountId: account.id, note: 'Coffee' });

      await trash({ id: tx.id });

      expect(await helpers.getTransactionById({ id: tx.id, raw: true })).toBeNull();
      expect(await helpers.getTransactions({ raw: true })).toHaveLength(0);

      const [entry, ...rest] = await helpers.getTrash({ raw: true });
      expect(rest).toHaveLength(0);
      expect(entry!.id).toBe(tx.id);
      expect(entry!.transactions.map((row) => row.id)).toEqual([tx.id]);
      expect(entry!.transactions[0]!.note).toBe('Coffee');
      expect(entry!.accountNames).toEqual({ [account.id]: account.name });
      expect(new Date(entry!.expiresAt).getTime() - new Date(entry!.deletedAt).getTime()).toBe(
        TRANSACTION_TRASH_RETENTION_DAYS * DAY_MS,
      );
      expect(entry!.kept).toEqual({ splits: 0, tags: 0, attachments: 0 });
      expect(entry!.links).toEqual([]);
    });

    it('orders entries by deletion, newest first', async () => {
      const account = await createAccount();
      const recent = await createExpense({ accountId: account.id });
      const older = await createExpense({ accountId: account.id });
      await trash({ id: recent.id });
      await trash({ id: older.id });
      await helpers.backdateTrashedTransaction({ id: older.id, days: 5 });

      const entries = await helpers.getTrash({ raw: true });

      expect(entries.map((entry) => entry.id)).toEqual([recent.id, older.id]);
    });

    it('shows a transfer pair as one entry with both legs', async () => {
      const [checking, savings] = [await createAccount(), await createAccount()];
      const { from, to } = await createTransfer({ fromId: checking.id, toId: savings.id });

      await trash({ id: to.id });

      const entries = await helpers.getTrash({ raw: true });
      expect(entries).toHaveLength(1);
      expect(entries[0]!.transactions.map((row) => row.id).toSorted()).toEqual([from.id, to.id].toSorted());
    });

    it('counts the splits, tags and attachments that stay attached, and lists the links still in place', async () => {
      const account = await createAccount();
      const categories = await helpers.getCategoriesList();
      const tag = await helpers.createTag({ payload: { name: 'trip', color: '#000000' }, raw: true });
      const tx = await createExpense({
        accountId: account.id,
        amount: 100,
        categoryId: categories[0]!.id,
        tagIds: [tag.id],
        splits: [{ categoryId: categories[1]!.id, amount: 30 }],
      });
      const sibling = await createExpense({ accountId: account.id });
      expect((await helpers.uploadAttachment({ transactionId: tx.id, file: PNG_BYTES })).statusCode).toBe(201);

      const tracker = await helpers.createTracker({ name: 'Rome', raw: true });
      await helpers.addTransactionsToTracker({ id: tracker.id, payload: { transactionIds: [tx.id] }, raw: true });
      await helpers.createTransactionGroup({
        payload: helpers.buildTransactionGroupPayload({ name: 'Dinner', transactionIds: [tx.id, sibling.id] }),
        raw: true,
      });

      await trash({ id: tx.id });

      const [entry] = await helpers.getTrash({ raw: true });
      expect(entry!.kept).toEqual({ splits: 1, tags: 1, attachments: 1 });
      expect(entry!.links).toEqual(
        expect.arrayContaining([
          { kind: 'tracker', label: 'Rome', counterpartInTrash: false },
          { kind: 'group', label: 'Dinner', counterpartInTrash: false },
        ]),
      );
      expect(entry!.links).toHaveLength(2);
    });

    it('marks a refund link whose counterpart is trashed too', async () => {
      const account = await createAccount();
      const purchase = await createExpense({ accountId: account.id, amount: 100, note: 'Shoes' });
      const [refund] = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account.id,
          amount: 40,
          transactionType: TRANSACTION_TYPES.income,
          note: 'Shoes refund',
        }),
        raw: true,
      });
      expect((await helpers.createSingleRefund({ originalTxId: purchase.id, refundTxId: refund!.id })).statusCode).toBe(
        200,
      );

      await trash({ id: purchase.id });
      const [onlyPurchase] = await helpers.getTrash({ raw: true });
      expect(onlyPurchase!.links).toEqual([{ kind: 'refund', label: 'Shoes refund', counterpartInTrash: false }]);

      await trash({ id: refund!.id });
      const entries = await helpers.getTrash({ raw: true });
      const purchaseEntry = entries.find((entry) => entry.id === purchase.id)!;
      const refundEntry = entries.find((entry) => entry.id === refund!.id)!;
      expect(purchaseEntry.links).toEqual([{ kind: 'refund', label: 'Shoes refund', counterpartInTrash: true }]);
      expect(refundEntry.links).toEqual([{ kind: 'refund', label: 'Shoes', counterpartInTrash: true }]);
    });

    it("never shows another user's trash", async () => {
      const account = await createAccount();
      const tx = await createExpense({ accountId: account.id });
      await trash({ id: tx.id });

      const stranger = await helpers.provisionSecondUserWithBaseCurrency();

      expect(await helpers.asUser({ cookies: stranger.cookies, fn: () => helpers.getTrash({ raw: true }) })).toEqual(
        [],
      );
      const restore = await helpers.asUser({
        cookies: stranger.cookies,
        fn: () => helpers.restoreTrash({ transactionIds: [tx.id] }),
      });
      expect(restore.statusCode).toBe(ERROR_CODES.NotFoundError);
      const purge = await helpers.asUser({
        cookies: stranger.cookies,
        fn: () => helpers.deleteTrash({ transactionIds: [tx.id] }),
      });
      expect(purge.statusCode).toBe(ERROR_CODES.NotFoundError);

      expect((await helpers.getTrash({ raw: true })).map((entry) => entry.id)).toEqual([tx.id]);
    });

    it('shows a shared-account row to its creator and to the account owner, but not to other members', async () => {
      const account = await createAccount();
      const recipient = await helpers.provisionSecondUserWithBaseCurrency();
      await shareAccount({ accountId: account.id, recipient });

      const recipientTx = await helpers.asUser({
        cookies: recipient.cookies,
        fn: async () => {
          const tx = await createExpense({ accountId: account.id, amount: 20 });
          await trash({ id: tx.id });
          return tx;
        },
      });
      const ownerTx = await createExpense({ accountId: account.id, amount: 30 });
      await trash({ id: ownerTx.id });

      const ownerTrash = await helpers.getTrash({ raw: true });
      expect(ownerTrash.map((entry) => entry.id).toSorted()).toEqual([recipientTx.id, ownerTx.id].toSorted());

      const recipientTrash = await helpers.asUser({
        cookies: recipient.cookies,
        fn: () => helpers.getTrash({ raw: true }),
      });
      expect(recipientTrash.map((entry) => entry.id)).toEqual([recipientTx.id]);

      const restored = await helpers.restoreTrash({ transactionIds: [recipientTx.id], raw: true });
      expect(restored.restoredIds).toEqual([recipientTx.id]);
      expect(await balanceOf({ id: account.id })).toBe(980);
    });

    it("hides the recipient's private links from the account owner", async () => {
      const account = await createAccount();
      const recipient = await helpers.provisionSecondUserWithBaseCurrency();
      await shareAccount({ accountId: account.id, recipient });

      const recipientTx = await helpers.asUser({
        cookies: recipient.cookies,
        fn: async () => {
          const tx = await createExpense({ accountId: account.id, amount: 20 });
          const tracker = await helpers.createTracker({ name: 'Lawyer fund', raw: true });
          await helpers.addTransactionsToTracker({ id: tracker.id, payload: { transactionIds: [tx.id] }, raw: true });
          await trash({ id: tx.id });
          return tx;
        },
      });

      const [ownerEntry] = await helpers.getTrash({ raw: true });
      expect(ownerEntry!.id).toBe(recipientTx.id);
      expect(ownerEntry!.links).toEqual([]);

      const [recipientEntry] = await helpers.asUser({
        cookies: recipient.cookies,
        fn: () => helpers.getTrash({ raw: true }),
      });
      expect(recipientEntry!.links).toEqual([{ kind: 'tracker', label: 'Lawyer fund', counterpartInTrash: false }]);
    });

    it("keeps a planned row in its creator's trash only", async () => {
      const account = await createAccount();
      const recipient = await helpers.provisionSecondUserWithBaseCurrency();
      await shareAccount({ accountId: account.id, recipient });

      const [planned] = await helpers.createPlannedTransaction({
        payload: {
          ...helpers.buildTransactionPayload({ accountId: account.id, amount: 50 }),
          time: addDays(new Date(), 5).toISOString(),
        },
        raw: true,
      });
      await trash({ id: planned!.id });

      const recipientView = await helpers.asUser({
        cookies: recipient.cookies,
        fn: async () => ({
          trash: await helpers.getTrash({ raw: true }),
          restore: await helpers.restoreTrash({ transactionIds: [planned!.id] }),
        }),
      });
      expect(recipientView.trash).toEqual([]);
      expect(recipientView.restore.statusCode).toBe(ERROR_CODES.NotFoundError);

      expect((await helpers.getTrash({ raw: true })).map((entry) => entry.id)).toEqual([planned!.id]);
    });
  });

  describe('POST /transactions/trash/restore', () => {
    it('brings a transaction back with its account balance and balance history', async () => {
      const account = await createAccount();
      const txDate = subDays(new Date(), 10);
      const dates = [subDays(txDate, 1), txDate, new Date()];
      const historyAt = async () => {
        const rows = await helpers.getBalanceHistory({ accountId: account.id, raw: true });
        return dates.map((date) => helpers.balanceCentsOn({ rows, date }));
      };

      const tx = await createExpense({ accountId: account.id, amount: 100, time: txDate.toISOString() });
      expect(await balanceOf({ id: account.id })).toBe(900);
      const withTx = await historyAt();
      expect(withTx).toEqual([100_000, 90_000, 90_000]);

      await trash({ id: tx.id });
      expect(await balanceOf({ id: account.id })).toBe(1000);
      expect(await historyAt()).toEqual([100_000, 100_000, 100_000]);

      const result = await helpers.restoreTrash({ transactionIds: [tx.id], raw: true });

      expect(result.restoredIds).toEqual([tx.id]);
      expect(await balanceOf({ id: account.id })).toBe(900);
      expect(await historyAt()).toEqual(withTx);
      expect((await helpers.getTransactionById({ id: tx.id, raw: true }))!.amount).toBe(100);
      expect(await helpers.getTrash({ raw: true })).toEqual([]);
    });

    it('restores a planned transaction without touching the balance', async () => {
      const account = await createAccount();
      const [planned] = await helpers.createPlannedTransaction({
        payload: {
          ...helpers.buildTransactionPayload({ accountId: account.id, amount: 50 }),
          time: addDays(new Date(), 5).toISOString(),
        },
        raw: true,
      });

      await trash({ id: planned!.id });
      expect(await balanceOf({ id: account.id })).toBe(1000);

      await helpers.restoreTrash({ transactionIds: [planned!.id], raw: true });

      const restored = await helpers.getTransactionById({ id: planned!.id, raw: true });
      expect(restored!.isPlanned).toBe(true);
      expect(await balanceOf({ id: account.id })).toBe(1000);
    });

    it('restores both legs of a transfer from either leg id', async () => {
      const [checking, savings] = [await createAccount(), await createAccount()];
      const { from, to } = await createTransfer({ fromId: checking.id, toId: savings.id });

      await trash({ id: from.id });
      expect(await balanceOf({ id: checking.id })).toBe(1000);
      expect(await balanceOf({ id: savings.id })).toBe(1000);

      const result = await helpers.restoreTrash({ transactionIds: [to.id], raw: true });

      expect(result.restoredIds.toSorted()).toEqual([from.id, to.id].toSorted());
      expect(await balanceOf({ id: checking.id })).toBe(900);
      expect(await balanceOf({ id: savings.id })).toBe(1100);
      const legs = await helpers.getTransactionsByTransferId({ transferId: from.transferId!, raw: true });
      expect(legs.map((leg) => leg.id).toSorted()).toEqual([from.id, to.id].toSorted());
    });

    it('takes back and re-applies a loan payment on the loan balance', async () => {
      await helpers.addUserCurrencies({ currencyCodes: ['USD'] });
      const loan = await helpers.createLoan({
        payload: helpers.buildCreateLoanPayload({ initialBalance: 2_500, originalPrincipal: 2_500 }),
        raw: true,
      });
      const source = await helpers.createAccount({
        payload: helpers.buildAccountPayload({ currencyCode: 'USD' }),
        raw: true,
      });
      const [payment] = await helpers.createTransaction({
        payload: {
          ...helpers.buildTransactionPayload({ accountId: source.id, amount: 500 }),
          transferNature: TRANSACTION_TRANSFER_NATURE.transfer_to_loan,
          destinationAmount: 500,
          destinationAccountId: loan.id as RecordId,
        },
        raw: true,
      });
      expect((await helpers.getLoanById({ id: loan.id, raw: true })).currentBalance).toBe(-2_000);

      await trash({ id: payment!.id });
      expect((await helpers.getLoanById({ id: loan.id, raw: true })).currentBalance).toBe(-2_500);

      const result = await helpers.restoreTrash({ transactionIds: [payment!.id], raw: true });
      expect(result.restoredIds).toHaveLength(2);
      expect((await helpers.getLoanById({ id: loan.id, raw: true })).currentBalance).toBe(-2_000);
    });

    describe('loan payments', () => {
      it('blocks deleting the cash account while a payment from it is trashed', async () => {
        const { source, pay } = await setupLoan();
        const payment = await pay({ amount: 500 });
        await trash({ id: payment.id });

        const response = await helpers.deleteAccount({ id: source.id, raw: false });

        expect(response.statusCode).toBe(ERROR_CODES.ValidationError);
      });

      it('rejects restoring a payment that would overpay the loan, and keeps it in the trash', async () => {
        const { loan, source, pay } = await setupLoan();
        const first = await pay({ amount: 1_000 });
        await trash({ id: first.id });
        await pay({ amount: 1_000 });
        expect((await helpers.getLoanById({ id: loan.id, raw: true })).currentBalance).toBe(0);
        const sourceBalance = await balanceOf({ id: source.id });

        const response = await helpers.restoreTrash({ transactionIds: [first.id] });

        expect(response.statusCode).toBe(ERROR_CODES.ValidationError);
        expect((await helpers.getLoanById({ id: loan.id, raw: true })).currentBalance).toBe(0);
        expect(await balanceOf({ id: source.id })).toBe(sourceBalance);
        const [entry] = await helpers.getTrash({ raw: true });
        expect(entry!.transactions).toHaveLength(2);
        expect(entry!.transactions.map((leg) => leg.id)).toContain(first.id);
      });
    });

    it('restores a transfer leg whose twin is gone as a standalone out-of-wallet row', async () => {
      const [checking, savings] = [await createAccount(), await createAccount()];
      const { from } = await createTransfer({ fromId: checking.id, toId: savings.id });

      await trash({ id: from.id });
      expect((await helpers.deleteAccount({ id: savings.id, raw: false })).statusCode).toBe(200);

      const [entry] = await helpers.getTrash({ raw: true });
      expect(entry!.transactions.map((row) => row.id)).toEqual([from.id]);

      const result = await helpers.restoreTrash({ transactionIds: [from.id], raw: true });

      expect(result.restoredIds).toEqual([from.id]);
      const restored = await helpers.getTransactionById({ id: from.id, raw: true });
      expect(restored!.transferNature).toBe(TRANSACTION_TRANSFER_NATURE.transfer_out_wallet);
      expect(restored!.transferId).toBeNull();
      expect(await balanceOf({ id: checking.id })).toBe(900);
    });

    it('rejects a row whose account was connected to a bank since, and keeps it in the trash', async () => {
      const { account } = await helpers.createAccountWithNewCurrency({ currency: 'USD' });
      const tx = await createExpense({ accountId: account.id });
      await trash({ id: tx.id });

      await helpers.lunchflow.linkManualAccount({ accountId: account.id });

      const response = await helpers.restoreTrash({ transactionIds: [tx.id] });

      expect(response.statusCode).toBe(ERROR_CODES.ValidationError);
      expect((await helpers.getTrash({ raw: true })).map((entry) => entry.id)).toEqual([tx.id]);
      expect(await helpers.getTransactionById({ id: tx.id, raw: true })).toBeNull();
    });

    it('rejects an unknown id and an empty body', async () => {
      const account = await createAccount();
      const live = await createExpense({ accountId: account.id });

      expect((await helpers.restoreTrash({ transactionIds: [NONEXISTENT_ID] })).statusCode).toBe(
        ERROR_CODES.NotFoundError,
      );
      expect((await helpers.restoreTrash({ transactionIds: [live.id] })).statusCode).toBe(ERROR_CODES.NotFoundError);
      expect((await helpers.restoreTrash({ transactionIds: [] })).statusCode).toBe(ERROR_CODES.ValidationError);
    });

    it('brings back a row whose category and payee were deleted while it was trashed', async () => {
      const account = await createAccount();
      const category = await helpers.addCustomCategory({ name: 'Hobby', color: '#00ff00', raw: true });
      const payee = await helpers.createPayee({ payload: { name: 'Model shop' }, raw: true });
      const tx = await createExpense({ accountId: account.id, categoryId: category.id, payeeId: payee.id });
      await trash({ id: tx.id });

      const categoryDelete = await helpers.deleteCustomCategory({
        categoryId: category.id,
        replaceWithCategoryId: global.DEFAULT_CATEGORY_ID,
        raw: false,
      });
      expect(categoryDelete.statusCode).toBe(200);
      expect((await helpers.deletePayee({ id: payee.id })).statusCode).toBe(204);

      await helpers.restoreTrash({ transactionIds: [tx.id], raw: true });

      const restored = await helpers.getTransactionById({ id: tx.id, raw: true });
      expect(restored!.categoryId).toBe(global.DEFAULT_CATEGORY_ID);
      expect(restored!.payeeId).toBeNull();
    });
  });

  describe('POST /transactions/trash/delete', () => {
    it('removes a trashed row for good without moving the balance again', async () => {
      const account = await createAccount();
      const tx = await createExpense({ accountId: account.id, amount: 100 });
      await trash({ id: tx.id });

      const result = await helpers.deleteTrash({ transactionIds: [tx.id], raw: true });

      expect(result.deletedIds).toEqual([tx.id]);
      expect(await balanceOf({ id: account.id })).toBe(1000);
      expect(await helpers.getTrash({ raw: true })).toEqual([]);
      expect((await helpers.restoreTrash({ transactionIds: [tx.id] })).statusCode).toBe(ERROR_CODES.NotFoundError);
    });

    it('removes both legs of a transfer', async () => {
      const [checking, savings] = [await createAccount(), await createAccount()];
      const { from, to } = await createTransfer({ fromId: checking.id, toId: savings.id });
      await trash({ id: from.id });

      const result = await helpers.deleteTrash({ transactionIds: [from.id], raw: true });

      expect(result.deletedIds.toSorted()).toEqual([from.id, to.id].toSorted());
      expect(await balanceOf({ id: checking.id })).toBe(1000);
      expect(await balanceOf({ id: savings.id })).toBe(1000);
      expect(await helpers.getTrash({ raw: true })).toEqual([]);
    });

    it('rejects a live row', async () => {
      const account = await createAccount();
      const live = await createExpense({ accountId: account.id });

      expect((await helpers.deleteTrash({ transactionIds: [live.id] })).statusCode).toBe(ERROR_CODES.NotFoundError);
      expect(await helpers.getTransactionById({ id: live.id, raw: true })).not.toBeNull();
    });
  });
});
