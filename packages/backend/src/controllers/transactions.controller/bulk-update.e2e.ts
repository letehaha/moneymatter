import { RESOURCE_TYPES, SHARE_PERMISSIONS, TRANSACTION_TRANSFER_NATURE } from '@bt/shared/types';
import { generateRandomRecordId } from '@common/lib/record-id-helpers';
import { describe, expect, it } from '@jest/globals';
import { ERROR_CODES } from '@js/errors';
import * as helpers from '@tests/helpers';
import { startOfMonth, subMonths } from 'date-fns';

const middayUtcIso = ({ month, day }: { month: Date; day: number }) =>
  new Date(Date.UTC(month.getFullYear(), month.getMonth(), day, 12)).toISOString();

describe('Bulk update transactions controller', () => {
  describe('category updates', () => {
    it('should bulk update category for multiple transactions', async () => {
      const account = await helpers.createAccount({ raw: true });
      const newCategory = await helpers.addCustomCategory({ name: 'Test Category', color: '#FF0000', raw: true });

      // Create transactions with default categoryId (1)
      const [tx1] = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({ accountId: account.id }),
        raw: true,
      });
      const [tx2] = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({ accountId: account.id }),
        raw: true,
      });

      const result = await helpers.bulkUpdateTransactions({
        payload: {
          transactionIds: [tx1.id, tx2.id],
          categoryId: newCategory.id,
        },
        raw: true,
      });

      expect(result.updatedCount).toBe(2);
      expect(result.updatedIds).toContain(tx1.id);
      expect(result.updatedIds).toContain(tx2.id);

      const transactions = (await helpers.getTransactions({ raw: true }))!;
      const updatedTx1 = transactions.find((t) => t.id === tx1.id);
      const updatedTx2 = transactions.find((t) => t.id === tx2.id);

      expect(updatedTx1?.categoryId).toBe(newCategory.id);
      expect(updatedTx2?.categoryId).toBe(newCategory.id);
    });

    it('should skip transfer transactions when updating category', async () => {
      const accountA = await helpers.createAccount({ raw: true });
      const accountB = await helpers.createAccount({ raw: true });
      const newCategory = await helpers.addCustomCategory({ name: 'Test Category', color: '#00FF00', raw: true });

      // Create a regular transaction with default categoryId
      const [regularTx] = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({ accountId: accountA.id }),
        raw: true,
      });

      // Create a transfer transaction
      const [transferTx] = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: accountA.id,
          transferNature: TRANSACTION_TRANSFER_NATURE.common_transfer,
          destinationAccountId: accountB.id,
          destinationAmount: 1000,
        }),
        raw: true,
      });

      const result = await helpers.bulkUpdateTransactions({
        payload: {
          transactionIds: [regularTx.id, transferTx.id],
          categoryId: newCategory.id,
        },
        raw: true,
      });

      // Only the regular transaction should be updated
      expect(result.updatedCount).toBe(1);
      expect(result.updatedIds).toContain(regularTx.id);
      expect(result.updatedIds).not.toContain(transferTx.id);
    });
  });

  describe('tag updates', () => {
    it('should add tags to transactions and update updatedAt', async () => {
      const account = await helpers.createAccount({ raw: true });
      const tag = await helpers.createTag({ payload: helpers.buildTagPayload(), raw: true });

      const [tx1] = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({ accountId: account.id }),
        raw: true,
      });
      const [tx2] = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({ accountId: account.id }),
        raw: true,
      });

      const originalUpdatedAt1 = tx1.updatedAt;
      const originalUpdatedAt2 = tx2.updatedAt;

      // Wait a bit to ensure timestamp difference
      await new Promise((resolve) => setTimeout(resolve, 10));

      const result = await helpers.bulkUpdateTransactions({
        payload: {
          transactionIds: [tx1.id, tx2.id],
          tagIds: [tag.id],
          tagMode: 'add',
        },
        raw: true,
      });

      expect(result.updatedCount).toBe(2);

      const transactions = (await helpers.getTransactions({ raw: true }))!;
      const updatedTx1 = transactions.find((t) => t.id === tx1.id);
      const updatedTx2 = transactions.find((t) => t.id === tx2.id);

      // Verify tags were added
      expect(updatedTx1?.tags).toHaveLength(1);
      expect(updatedTx1?.tags?.[0]?.id).toBe(tag.id);
      expect(updatedTx2?.tags).toHaveLength(1);
      expect(updatedTx2?.tags?.[0]?.id).toBe(tag.id);

      // Verify updatedAt was changed
      expect(new Date(updatedTx1!.updatedAt).getTime()).toBeGreaterThan(new Date(originalUpdatedAt1).getTime());
      expect(new Date(updatedTx2!.updatedAt).getTime()).toBeGreaterThan(new Date(originalUpdatedAt2).getTime());
    });

    it('adds tags when the affected month has no first-of-month balance row yet', async () => {
      const account = await helpers.createAccount({ raw: true });
      const tag = await helpers.createTag({ payload: helpers.buildTagPayload(), raw: true });

      const currentMonth = startOfMonth(new Date());
      const targetMonth = subMonths(currentMonth, 2);
      const olderMonth = subMonths(currentMonth, 3);

      // Creating the target month's transactions first leaves that month without a
      // 1st-of-month balance row: there is nothing older to seed it from. The older
      // transaction added afterwards supplies that missing predecessor, so the next
      // write to the target month has to create the 1st-of-month row.
      const targetMonthTxIds: string[] = [];
      for (const day of [15, 16, 17, 18, 19, 20]) {
        const [tx] = await helpers.createTransaction({
          payload: helpers.buildTransactionPayload({
            accountId: account.id,
            time: middayUtcIso({ month: targetMonth, day }),
          }),
          raw: true,
        });
        targetMonthTxIds.push(tx.id);
      }

      await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account.id,
          time: middayUtcIso({ month: olderMonth, day: 10 }),
        }),
        raw: true,
      });

      const balancesBefore = await helpers.getBalanceHistory({ accountId: account.id, raw: true });

      const response = await helpers.bulkUpdateTransactions({
        payload: {
          transactionIds: targetMonthTxIds,
          tagIds: [tag.id],
          tagMode: 'add',
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.body.response.updatedCount).toBe(targetMonthTxIds.length);

      // A tag edit carries no money, so every day already present in the history
      // must keep its amount.
      const balancesAfter = await helpers.getBalanceHistory({ accountId: account.id, raw: true });
      const amountByDateAfter = new Map(balancesAfter.map((entry) => [String(entry.date), entry.amount]));

      for (const entry of balancesBefore) {
        expect(amountByDateAfter.get(String(entry.date))).toBe(entry.amount);
      }
    });

    it('should replace tags on transactions and update updatedAt', async () => {
      const account = await helpers.createAccount({ raw: true });
      const tag1 = await helpers.createTag({ payload: helpers.buildTagPayload({ name: 'Tag 1' }), raw: true });
      const tag2 = await helpers.createTag({ payload: helpers.buildTagPayload({ name: 'Tag 2' }), raw: true });

      // Create transaction without tags first
      const [tx] = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({ accountId: account.id }),
        raw: true,
      });

      // Add initial tag via bulk update
      await helpers.bulkUpdateTransactions({
        payload: {
          transactionIds: [tx.id],
          tagIds: [tag1.id],
          tagMode: 'add',
        },
        raw: true,
      });

      // Get updated transaction to capture new updatedAt
      let transactions = (await helpers.getTransactions({ raw: true }))!;
      const txWithTag = transactions.find((t) => t.id === tx.id);
      const originalUpdatedAt = txWithTag!.updatedAt;

      await new Promise((resolve) => setTimeout(resolve, 10));

      // Now replace with tag2
      await helpers.bulkUpdateTransactions({
        payload: {
          transactionIds: [tx.id],
          tagIds: [tag2.id],
          tagMode: 'replace',
        },
        raw: true,
      });

      transactions = (await helpers.getTransactions({ raw: true }))!;
      const updatedTx = transactions.find((t) => t.id === tx.id);

      // Verify tags were replaced
      expect(updatedTx?.tags).toHaveLength(1);
      expect(updatedTx?.tags?.[0]?.id).toBe(tag2.id);

      // Verify updatedAt was changed
      expect(new Date(updatedTx!.updatedAt).getTime()).toBeGreaterThan(new Date(originalUpdatedAt).getTime());
    });

    it('should remove tags from transactions and update updatedAt', async () => {
      const account = await helpers.createAccount({ raw: true });
      const tag1 = await helpers.createTag({ payload: helpers.buildTagPayload({ name: 'Tag 1' }), raw: true });
      const tag2 = await helpers.createTag({ payload: helpers.buildTagPayload({ name: 'Tag 2' }), raw: true });

      // Create transaction without tags first
      const [tx] = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({ accountId: account.id }),
        raw: true,
      });

      // Add both tags via bulk update
      await helpers.bulkUpdateTransactions({
        payload: {
          transactionIds: [tx.id],
          tagIds: [tag1.id, tag2.id],
          tagMode: 'add',
        },
        raw: true,
      });

      // Get updated transaction to capture new updatedAt
      let transactions = (await helpers.getTransactions({ raw: true }))!;
      const txWithTags = transactions.find((t) => t.id === tx.id);
      const originalUpdatedAt = txWithTags!.updatedAt;

      await new Promise((resolve) => setTimeout(resolve, 10));

      // Now remove tag1
      await helpers.bulkUpdateTransactions({
        payload: {
          transactionIds: [tx.id],
          tagIds: [tag1.id],
          tagMode: 'remove',
        },
        raw: true,
      });

      transactions = (await helpers.getTransactions({ raw: true }))!;
      const updatedTx = transactions.find((t) => t.id === tx.id);

      // Verify only tag2 remains
      expect(updatedTx?.tags).toHaveLength(1);
      expect(updatedTx?.tags?.[0]?.id).toBe(tag2.id);

      // Verify updatedAt was changed
      expect(new Date(updatedTx!.updatedAt).getTime()).toBeGreaterThan(new Date(originalUpdatedAt).getTime());
    });
  });

  describe('note updates', () => {
    it('should bulk update note for transactions', async () => {
      const account = await helpers.createAccount({ raw: true });

      const [tx1] = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({ accountId: account.id }),
        raw: true,
      });
      const [tx2] = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({ accountId: account.id }),
        raw: true,
      });

      const newNote = 'Bulk updated note';
      const result = await helpers.bulkUpdateTransactions({
        payload: {
          transactionIds: [tx1.id, tx2.id],
          note: newNote,
        },
        raw: true,
      });

      expect(result.updatedCount).toBe(2);

      const transactions = (await helpers.getTransactions({ raw: true }))!;
      const updatedTx1 = transactions.find((t) => t.id === tx1.id);
      const updatedTx2 = transactions.find((t) => t.id === tx2.id);

      expect(updatedTx1?.note).toBe(newNote);
      expect(updatedTx2?.note).toBe(newNote);
    });
  });

  describe('validation', () => {
    it('rejects invalid payloads (no update fields, empty ids, missing category, missing transactions)', async () => {
      const account = await helpers.createAccount({ raw: true });
      const category = await helpers.addCustomCategory({ name: 'Test Category', color: '#0000FF', raw: true });
      const [tx] = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({ accountId: account.id }),
        raw: true,
      });

      const noUpdateFields = await helpers.bulkUpdateTransactions({
        payload: {
          transactionIds: [tx.id],
        },
      });
      expect(noUpdateFields.statusCode).toBe(ERROR_CODES.ValidationError);

      const emptyTransactionIds = await helpers.bulkUpdateTransactions({
        payload: {
          transactionIds: [],
          categoryId: category.id,
        },
      });
      expect(emptyTransactionIds.statusCode).toBe(ERROR_CODES.ValidationError);

      const missingCategory = await helpers.bulkUpdateTransactions({
        payload: {
          transactionIds: [tx.id],
          categoryId: generateRandomRecordId(),
        },
      });
      expect(missingCategory.statusCode).toBe(ERROR_CODES.NotFoundError);

      const missingTransactions = await helpers.bulkUpdateTransactions({
        payload: {
          transactionIds: [generateRandomRecordId()],
          categoryId: category.id,
        },
      });
      expect(missingTransactions.statusCode).toBe(ERROR_CODES.NotFoundError);
    });
  });

  describe('payee updates', () => {
    it('assigns payeeId and flips payeeLocked=true on owned-account transactions', async () => {
      const account = await helpers.createAccount({ raw: true });
      const payee = await helpers.createPayee({ payload: { name: 'Amazon' }, raw: true });

      const [tx1] = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({ accountId: account.id }),
        raw: true,
      });
      const [tx2] = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({ accountId: account.id }),
        raw: true,
      });

      const result = await helpers.bulkUpdateTransactions({
        payload: {
          transactionIds: [tx1.id, tx2.id],
          payeeId: payee.id,
        },
        raw: true,
      });

      expect(result.updatedCount).toBe(2);

      const transactions = (await helpers.getTransactions({ raw: true }))!;
      const updatedTx1 = transactions.find((t) => t.id === tx1.id);
      const updatedTx2 = transactions.find((t) => t.id === tx2.id);

      expect(updatedTx1?.payeeId).toBe(payee.id);
      expect(updatedTx1?.payeeLocked).toBe(true);
      expect(updatedTx2?.payeeId).toBe(payee.id);
      expect(updatedTx2?.payeeLocked).toBe(true);
    });

    it('clears payeeId when null is passed and keeps payeeLocked=true', async () => {
      const account = await helpers.createAccount({ raw: true });
      const payee = await helpers.createPayee({ payload: { name: 'Glovo' }, raw: true });

      const [tx] = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({ accountId: account.id }),
        raw: true,
      });

      await helpers.bulkUpdateTransactions({
        payload: { transactionIds: [tx.id], payeeId: payee.id },
        raw: true,
      });

      const result = await helpers.bulkUpdateTransactions({
        payload: { transactionIds: [tx.id], payeeId: null },
        raw: true,
      });

      expect(result.updatedCount).toBe(1);

      const transactions = (await helpers.getTransactions({ raw: true }))!;
      const updatedTx = transactions.find((t) => t.id === tx.id);
      expect(updatedTx?.payeeId).toBeNull();
      expect(updatedTx?.payeeLocked).toBe(true);
    });

    it('returns NotFound when payeeId does not belong to the caller', async () => {
      const account = await helpers.createAccount({ raw: true });
      const [tx] = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({ accountId: account.id }),
        raw: true,
      });

      const result = await helpers.bulkUpdateTransactions({
        payload: {
          transactionIds: [tx.id],
          payeeId: generateRandomRecordId(),
        },
      });

      expect(result.statusCode).toBe(ERROR_CODES.NotFoundError);
    });

    it('skips recipient-authored rows on a shared account when payeeId is set', async () => {
      // Owner sets up an account + a category and shares the account with the recipient.
      // Recipients writing on a shared account must reuse the owner's category (per-owner
      // validation), so we need an owner-side category id for the shared-account tx.
      const ownerAccount = await helpers.createAccount({ raw: true });
      const ownerCategory = await helpers.addCustomCategory({
        name: 'owner-cat',
        color: '#123456',
        raw: true,
      });

      const recipient = await helpers.signUpSecondUser();
      await helpers.asUser({
        cookies: recipient.cookies,
        fn: async () => {
          const res = await helpers.setBaseCurrencyForActiveUser({ currencyCode: global.BASE_CURRENCY.code });
          if (res.statusCode !== 200) {
            throw new Error(`Failed to set base currency: ${res.statusCode} ${JSON.stringify(res.body)}`);
          }
        },
      });

      const invitation = await helpers.createShareInvitation({
        inviteeEmail: recipient.email,
        resourceType: RESOURCE_TYPES.account,
        resourceId: ownerAccount.id,
        permission: SHARE_PERMISSIONS.write,
        raw: true,
      });
      await helpers.asUser({
        cookies: recipient.cookies,
        fn: () => helpers.acceptShareInvitation({ token: invitation.token, raw: true }),
      });

      // Recipient creates one tx on the shared (owner-owned) account and one on their own account.
      const { recipientOwnAccountTxId, recipientSharedAccountTxId, recipientPayeeId } = await helpers.asUser({
        cookies: recipient.cookies,
        fn: async () => {
          const recipientOwnAccount = await helpers.createAccount({ raw: true });
          const recipientCategory = await helpers.addCustomCategory({
            name: 'recipient-cat',
            color: '#ABCDEF',
            raw: true,
          });
          const [ownTx] = await helpers.createTransaction({
            payload: helpers.buildTransactionPayload({
              accountId: recipientOwnAccount.id,
              categoryId: recipientCategory.id,
            }),
            raw: true,
          });
          const [sharedTx] = await helpers.createTransaction({
            payload: helpers.buildTransactionPayload({
              accountId: ownerAccount.id,
              // Owner-scoped — see comment on `ownerCategory` above.
              categoryId: ownerCategory.id,
            }),
            raw: true,
          });
          const payee = await helpers.createPayee({ payload: { name: 'Spotify' }, raw: true });
          return {
            recipientOwnAccountTxId: ownTx.id,
            recipientSharedAccountTxId: sharedTx.id,
            recipientPayeeId: payee.id,
          };
        },
      });

      // Bulk update — only the recipient's own-account tx should be touched.
      const result = await helpers.asUser({
        cookies: recipient.cookies,
        fn: () =>
          helpers.bulkUpdateTransactions({
            payload: {
              transactionIds: [recipientOwnAccountTxId, recipientSharedAccountTxId],
              payeeId: recipientPayeeId,
            },
            raw: true,
          }),
      });

      expect(result.updatedCount).toBe(1);
      expect(result.updatedIds).toContain(recipientOwnAccountTxId);
      expect(result.updatedIds).not.toContain(recipientSharedAccountTxId);

      const txList = await helpers.asUser({
        cookies: recipient.cookies,
        fn: () => helpers.getTransactions({ raw: true }),
      });
      const updatedOwn = txList!.find((t) => t.id === recipientOwnAccountTxId);
      const skippedShared = txList!.find((t) => t.id === recipientSharedAccountTxId);

      expect(updatedOwn?.payeeId).toBe(recipientPayeeId);
      expect(updatedOwn?.payeeLocked).toBe(true);
      expect(skippedShared?.payeeId).toBeNull();
      expect(skippedShared?.payeeLocked).toBe(false);
    });
  });
});
