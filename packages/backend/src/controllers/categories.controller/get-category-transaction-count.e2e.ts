import {
  CategoryModel,
  RESOURCE_TYPES,
  SHARE_PERMISSIONS,
  TRANSACTIONS_WRITE_SCOPES,
  TRANSACTION_TYPES,
  type RecordId,
} from '@bt/shared/types';
import { NONEXISTENT_ID } from '@common/lib/record-id-helpers';
import { beforeEach, describe, expect, it } from '@jest/globals';
import { ERROR_CODES } from '@js/errors';
import * as helpers from '@tests/helpers';
import { addDays } from 'date-fns';

const FUTURE_TIME = () => addDays(new Date(), 5).toISOString();

const readSplits = async ({ id }: { id: RecordId }) =>
  (await helpers.getTransactions({ raw: true, includeSplits: true }))!.find((tx) => tx.id === id)!.splits!;

describe('GET /categories/:id/transaction-count', () => {
  let category: CategoryModel;
  let accountId: RecordId;

  beforeEach(async () => {
    category = await helpers.addCustomCategory({ name: 'Groceries', color: '#00FF00', raw: true });
    accountId = (await helpers.createAccount({ raw: true })).id;
  });

  const createReal = ({ amount }: { amount: number }) =>
    helpers.createTransaction({
      payload: helpers.buildTransactionPayload({ accountId, categoryId: category.id, amount }),
      raw: true,
    });

  const createPlanned = ({ amount }: { amount: number }) =>
    helpers.createPlannedTransaction({
      payload: { accountId, categoryId: category.id, amount, time: FUTURE_TIME() },
      raw: true,
    });

  it('returns zero for an empty category, and rejects a malformed id', async () => {
    expect(await helpers.getCategoryTransactionCount({ categoryId: category.id, raw: true })).toEqual({
      transactionCount: 0,
    });

    const malformed = await helpers.getCategoryTransactionCount({ categoryId: 'not-a-uuid' });

    expect(malformed.statusCode).toBe(ERROR_CODES.ValidationError);
  });

  it('answers 404 for an unknown category instead of a count', async () => {
    const response = await helpers.getCategoryTransactionCount({ categoryId: NONEXISTENT_ID });

    expect(response.statusCode).toBe(ERROR_CODES.NotFoundError);
  });

  describe("another user's category", () => {
    let other: Awaited<ReturnType<typeof helpers.provisionSecondUserWithBaseCurrency>>;
    let otherCategory: CategoryModel;

    beforeEach(async () => {
      other = await helpers.provisionSecondUserWithBaseCurrency();
      otherCategory = await helpers.asUser({
        cookies: other.cookies,
        fn: () => helpers.addCustomCategory({ name: 'Private', color: '#123456', raw: true }),
      });
    });

    it('answers 404 to a caller with no access, even when the category carries splits', async () => {
      await helpers.asUser({
        cookies: other.cookies,
        fn: async () => {
          const otherAccountId = (await helpers.createAccount({ raw: true })).id;
          const primary = await helpers.addCustomCategory({ name: 'Primary', color: '#FF0000', raw: true });
          await helpers.createTransaction({
            payload: helpers.buildTransactionPayload({
              accountId: otherAccountId,
              categoryId: primary.id,
              amount: 1000,
              splits: [{ categoryId: otherCategory.id, amount: 400 }],
            }),
            raw: true,
          });
        },
      });

      const response = await helpers.getCategoryTransactionCount({ categoryId: otherCategory.id });

      expect(response.statusCode).toBe(ERROR_CODES.NotFoundError);
    });

    it("still counts the owner's category for a recipient of one of the owner's shared accounts", async () => {
      const invitation = await helpers.createShareInvitation({
        inviteeEmail: other.email,
        resourceType: RESOURCE_TYPES.account,
        resourceId: accountId,
        permission: SHARE_PERMISSIONS.write,
        policy: { transactionsWriteScope: TRANSACTIONS_WRITE_SCOPES.all },
        raw: true,
      });
      await helpers.asUser({
        cookies: other.cookies,
        fn: () => helpers.acceptShareInvitation({ token: invitation.token, raw: true }),
      });

      const count = await helpers.asUser({
        cookies: other.cookies,
        fn: async () => {
          await helpers.createTransaction({
            payload: helpers.buildTransactionPayload({ accountId, categoryId: category.id, amount: 100 }),
            raw: true,
          });
          return helpers.getCategoryTransactionCount({ categoryId: category.id, raw: true });
        },
      });

      expect(count).toEqual({ transactionCount: 1 });
    });
  });

  it('counts real and planned transactions', async () => {
    await createReal({ amount: 100 });
    await createReal({ amount: 200 });
    await createPlanned({ amount: 300 });

    expect(await helpers.getCategoryTransactionCount({ categoryId: category.id, raw: true })).toEqual({
      transactionCount: 3,
    });
  });

  it('reports a plans-only category as reassignable, and the delete re-points the plan', async () => {
    const [planned] = await createPlanned({ amount: 100 });
    const replacement = await helpers.addCustomCategory({ name: 'Household', color: '#0000FF', raw: true });

    expect(await helpers.getCategoryTransactionCount({ categoryId: category.id, raw: true })).toEqual({
      transactionCount: 1,
    });

    const response = await helpers.deleteCustomCategory({
      categoryId: category.id,
      replaceWithCategoryId: replacement.id,
      raw: false,
    });

    expect(response.statusCode).toBe(200);
    expect((await helpers.getTransactionById({ id: planned.id, raw: true }))!.categoryId).toBe(replacement.id);
    expect((await helpers.getCategoriesList()).find((c) => c.id === category.id)).toBeUndefined();
  });

  describe('category used only by splits', () => {
    const createSplitTx = async ({
      splits,
      creatorCookies,
    }: {
      splits: { categoryId: RecordId; amount: number; note?: string }[];
      creatorCookies?: string;
    }) => {
      const primary = await helpers.addCustomCategory({ name: 'Primary', color: '#FF0000', raw: true });
      const create = () =>
        helpers.createTransaction({
          payload: helpers.buildTransactionPayload({ accountId, categoryId: primary.id, amount: 1000, splits }),
          raw: true,
        });
      const [tx] = await (creatorCookies ? helpers.asUser({ cookies: creatorCookies, fn: create }) : create());
      return tx;
    };

    it('counts the transaction and refuses to delete without a replacement', async () => {
      const tx = await createSplitTx({ splits: [{ categoryId: category.id, amount: 400 }] });

      expect(await helpers.getCategoryTransactionCount({ categoryId: category.id, raw: true })).toEqual({
        transactionCount: 1,
      });

      const response = await helpers.deleteCustomCategory({ categoryId: category.id, raw: false });

      expect(response.statusCode).toBe(ERROR_CODES.ConflictError);
      expect(await readSplits({ id: tx.id })).toHaveLength(1);
    });

    it('re-points the split to the replacement category', async () => {
      const tx = await createSplitTx({ splits: [{ categoryId: category.id, amount: 400 }] });
      const replacement = await helpers.addCustomCategory({ name: 'Household', color: '#0000FF', raw: true });

      const response = await helpers.deleteCustomCategory({
        categoryId: category.id,
        replaceWithCategoryId: replacement.id,
        raw: false,
      });

      expect(response.statusCode).toBe(200);
      const splits = await readSplits({ id: tx.id });
      expect(splits).toHaveLength(1);
      expect(splits[0]!.categoryId).toBe(replacement.id);
      expect(splits[0]!.amount).toBe(400);
    });

    it('folds the split, its note and its refund into an existing split of the replacement category', async () => {
      const replacement = await helpers.addCustomCategory({ name: 'Household', color: '#0000FF', raw: true });
      const tx = await createSplitTx({
        splits: [
          { categoryId: category.id, amount: 400, note: 'doomed note' },
          { categoryId: replacement.id, amount: 100 },
        ],
      });
      const doomedSplit = (await readSplits({ id: tx.id })).find((split) => split.categoryId === category.id)!;

      const [refundTx] = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId,
          categoryId: replacement.id,
          amount: 50,
          transactionType: TRANSACTION_TYPES.income,
        }),
        raw: true,
      });
      const refundResponse = await helpers.createSingleRefund({
        originalTxId: tx.id,
        refundTxId: refundTx.id,
        splitId: doomedSplit.id,
      });
      expect(refundResponse.statusCode).toBe(200);

      const response = await helpers.deleteCustomCategory({
        categoryId: category.id,
        replaceWithCategoryId: replacement.id,
        raw: false,
      });

      expect(response.statusCode).toBe(200);
      const splits = await readSplits({ id: tx.id });
      expect(splits).toHaveLength(1);
      expect(splits[0]!.categoryId).toBe(replacement.id);
      expect(splits[0]!.amount).toBe(500);
      expect(splits[0]!.refAmount).toBe(500);
      expect(splits[0]!.note).toBe('doomed note');

      const refundLink = await helpers.getSingleRefund({ originalTxId: tx.id, refundTxId: refundTx.id }, true);
      expect(refundLink.splitId).toBe(splits[0]!.id);
    });

    it('rejects the deleted category as its own replacement and keeps the split', async () => {
      const tx = await createSplitTx({ splits: [{ categoryId: category.id, amount: 400 }] });

      const response = await helpers.deleteCustomCategory({
        categoryId: category.id,
        replaceWithCategoryId: category.id,
        raw: false,
      });

      expect(response.statusCode).toBe(ERROR_CODES.ValidationError);
      const splits = await readSplits({ id: tx.id });
      expect(splits).toHaveLength(1);
      expect(splits[0]!.amount).toBe(400);
    });

    it("counts and re-points a split on a share recipient's transaction", async () => {
      const recipient = await helpers.provisionSecondUserWithBaseCurrency();
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

      const tx = await createSplitTx({
        splits: [{ categoryId: category.id, amount: 400 }],
        creatorCookies: recipient.cookies,
      });

      expect(await helpers.getCategoryTransactionCount({ categoryId: category.id, raw: true })).toEqual({
        transactionCount: 1,
      });

      const refused = await helpers.deleteCustomCategory({ categoryId: category.id, raw: false });
      expect(refused.statusCode).toBe(ERROR_CODES.ConflictError);

      const replacement = await helpers.addCustomCategory({ name: 'Household', color: '#0000FF', raw: true });
      const response = await helpers.deleteCustomCategory({
        categoryId: category.id,
        replaceWithCategoryId: replacement.id,
        raw: false,
      });

      expect(response.statusCode).toBe(200);
      const splits = await readSplits({ id: tx.id });
      expect(splits).toHaveLength(1);
      expect(splits[0]!.categoryId).toBe(replacement.id);
      expect(splits[0]!.amount).toBe(400);
    });
  });

  it('stops counting a planned transaction once it is deleted', async () => {
    const [real] = await createReal({ amount: 100 });
    const [planned] = await createPlanned({ amount: 200 });

    await helpers.deleteTransaction({ id: planned.id });

    expect(await helpers.getCategoryTransactionCount({ categoryId: category.id, raw: true })).toEqual({
      transactionCount: 1,
    });
    expect((await helpers.getTransactionById({ id: real.id, raw: true }))!.id).toBe(real.id);
  });
});
