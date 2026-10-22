import { type RecordId, SHARE_PERMISSIONS, TRANSACTION_TRANSFER_NATURE, TRANSACTION_TYPES } from '@bt/shared/types';
import { NONEXISTENT_ID } from '@common/lib/record-id-helpers';
import { runTrackerRulesSyncCron } from '@crons/tracker-rules-sync';
import { describe, expect, it } from '@jest/globals';
import { ERROR_CODES } from '@js/errors';
import { connection } from '@models/connection';
import Trackers from '@models/trackers.model';
import * as helpers from '@tests/helpers';
import { subDays, subMinutes } from 'date-fns';

const addCategory = ({ name, parentId }: { name: string; parentId?: string }) =>
  helpers.addCustomCategory({ name, color: '#AABBCC', parentId, raw: true });

const addTag = ({ name }: { name: string }) => helpers.createTag({ payload: { name, color: '#AABBCC' }, raw: true });

const createExpense = async ({
  accountId,
  categoryId = global.DEFAULT_CATEGORY_ID,
  amount = 100,
  time,
}: {
  accountId: RecordId;
  categoryId?: RecordId;
  amount?: number;
  time?: string;
}) => {
  const [tx] = await helpers.createTransaction({
    payload: helpers.buildTransactionPayload({
      accountId,
      amount,
      categoryId,
      transactionType: TRANSACTION_TYPES.expense,
      ...(time ? { time } : {}),
    }),
    raw: true,
  });
  return tx!;
};

const getLinked = async ({ trackerId }: { trackerId: string }) =>
  (await helpers.getTransactions({ trackerIds: [trackerId], limit: 100, raw: true })) as (Awaited<
    ReturnType<typeof helpers.getTransactions<true>>
  >[number] & { addedByRule?: boolean })[];

const getLinkedIds = async ({ trackerId }: { trackerId: string }) =>
  (await getLinked({ trackerId })).map((tx) => tx.id).toSorted();

const resync = async ({ trackerId }: { trackerId: string }) => {
  await Trackers.update({ rulesSyncedAt: subMinutes(new Date(), 10) }, { where: { id: trackerId } });
  return helpers.syncTrackerRules({ id: trackerId, raw: true });
};

describe('Tracker rules', () => {
  describe('matching', () => {
    it('links transactions in the rule categories on create and counts them in stats', async () => {
      const account = await helpers.createAccount({ raw: true });
      const food = await addCategory({ name: 'Food' });
      const [first, second] = await Promise.all([
        createExpense({ accountId: account.id, categoryId: food.id, amount: 100 }),
        createExpense({ accountId: account.id, categoryId: food.id, amount: 50 }),
        createExpense({ accountId: account.id, amount: 30 }),
      ]);

      const tracker = await helpers.createTracker({
        name: 'Food',
        rulesEnabled: true,
        categoryIds: [food.id],
        limitAmount: 500,
        raw: true,
      });

      expect(tracker).toMatchObject({ rulesEnabled: true, rulesCleanup: true });
      expect(tracker.rulesSyncedAt).not.toBeNull();
      expect(await getLinkedIds({ trackerId: tracker.id })).toEqual([first!.id, second!.id].toSorted());

      const stats = (await helpers.getTrackerStats({ id: tracker.id, raw: true }))!;
      expect(stats.summary.actualExpense).toBe(150);
      expect(stats.summary.transactionsCount).toBe(2);
    });

    it('expands a parent rule category to its children', async () => {
      const account = await helpers.createAccount({ raw: true });
      const parent = await addCategory({ name: 'Entertainment' });
      const child = await addCategory({ name: 'Movies', parentId: parent.id });
      const tx = await createExpense({ accountId: account.id, categoryId: child.id });

      const tracker = await helpers.createTracker({
        name: 'Fun',
        rulesEnabled: true,
        categoryIds: [parent.id],
        raw: true,
      });

      expect(tracker.categories!.map((c) => c.id).toSorted()).toEqual([parent.id, child.id].toSorted());
      expect(await getLinkedIds({ trackerId: tracker.id })).toEqual([tx.id]);
    });

    it('matches a transaction by a rule category or a rule tag', async () => {
      const account = await helpers.createAccount({ raw: true });
      const [food, tag] = await Promise.all([addCategory({ name: 'Food' }), addTag({ name: 'Trip' })]);
      const [byCategory, byTag] = await Promise.all([
        createExpense({ accountId: account.id, categoryId: food.id }),
        createExpense({ accountId: account.id }),
        createExpense({ accountId: account.id }),
      ]);
      await helpers.addTransactionsToTag({ tagId: tag.id, transactionIds: [byTag!.id], raw: true });

      const [either, tagOnly] = await Promise.all([
        helpers.createTracker({
          name: 'Either',
          rulesEnabled: true,
          categoryIds: [food.id],
          tagIds: [tag.id],
          raw: true,
        }),
        helpers.createTracker({ name: 'Tag only', rulesEnabled: true, tagIds: [tag.id], raw: true }),
      ]);

      expect(either.tags).toEqual([{ id: tag.id, name: 'Trip', color: tag.color, icon: tag.icon }]);
      expect(await getLinkedIds({ trackerId: either.id })).toEqual([byCategory!.id, byTag!.id].toSorted());
      expect(await getLinkedIds({ trackerId: tagOnly.id })).toEqual([byTag!.id]);
    });

    it('links a split transaction whole when one split matches and counts its full amount', async () => {
      const account = await helpers.createAccount({ raw: true });
      const [food, transport, fun] = await Promise.all([
        addCategory({ name: 'Food' }),
        addCategory({ name: 'Transport' }),
        addCategory({ name: 'Fun' }),
      ]);
      const [tx] = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account.id,
          amount: 150,
          transactionType: TRANSACTION_TYPES.expense,
          categoryId: food.id,
          splits: [
            { amount: 50, categoryId: food.id },
            { amount: 30, categoryId: transport.id },
            { amount: 70, categoryId: fun.id },
          ],
        }),
        raw: true,
      });

      const tracker = await helpers.createTracker({
        name: 'Transport',
        rulesEnabled: true,
        categoryIds: [transport.id],
        raw: true,
      });

      expect(await getLinkedIds({ trackerId: tracker.id })).toEqual([tx!.id]);
      const stats = (await helpers.getTrackerStats({ id: tracker.id, raw: true }))!;
      expect(stats.summary.actualExpense).toBe(150);
      expect(stats.summary.transactionsCount).toBe(1);
    });

    it("skips out-of-range, planned and other users' transactions", async () => {
      const account = await helpers.createAccount({ raw: true });
      const food = await addCategory({ name: 'Food' });
      const [atStart, atEnd] = await Promise.all([
        createExpense({ accountId: account.id, categoryId: food.id, time: '2025-03-01T00:00:00Z' }),
        createExpense({ accountId: account.id, categoryId: food.id, time: '2025-03-31T23:59:59Z' }),
        createExpense({ accountId: account.id, categoryId: food.id, time: '2025-02-28T23:59:59Z' }),
        createExpense({ accountId: account.id, categoryId: food.id, time: '2025-04-01T00:00:00Z' }),
        helpers.createPlannedTransaction({
          payload: {
            accountId: account.id,
            amount: 40,
            transactionType: TRANSACTION_TYPES.expense,
            categoryId: food.id,
            time: '2025-03-15T10:00:00Z',
          },
          raw: true,
        }),
      ]);
      const stranger = await helpers.provisionSecondUserWithBaseCurrency();
      await helpers.asUser({
        cookies: stranger.cookies,
        fn: async () => {
          const [strangerAccount, [strangerCategory]] = await Promise.all([
            helpers.createAccount({ raw: true }),
            helpers.getCategoriesList(),
          ]);
          await createExpense({
            accountId: strangerAccount.id,
            categoryId: strangerCategory!.id,
            time: '2025-03-10T10:00:00Z',
          });
        },
      });

      const tracker = await helpers.createTracker({
        name: 'March',
        rulesEnabled: true,
        categoryIds: [food.id],
        startDate: '2025-03-01T00:00:00Z',
        endDate: '2025-03-31T23:59:59Z',
        raw: true,
      });

      expect(await getLinkedIds({ trackerId: tracker.id })).toEqual([atStart.id, atEnd.id].toSorted());
    });
  });

  describe('sync on edit', () => {
    it('links transactions matching a tag added on edit, including ones created after the tracker', async () => {
      const account = await helpers.createAccount({ raw: true });
      const [food, tag] = await Promise.all([addCategory({ name: 'Food' }), addTag({ name: 'Trip' })]);
      const tracker = await helpers.createTracker({
        name: 'Food',
        rulesEnabled: true,
        categoryIds: [food.id],
        raw: true,
      });
      const [foodTx, taggedTx] = await Promise.all([
        createExpense({ accountId: account.id, categoryId: food.id }),
        createExpense({ accountId: account.id }),
      ]);
      await helpers.addTransactionsToTag({ tagId: tag.id, transactionIds: [taggedTx.id], raw: true });

      await helpers.editTracker({ id: tracker.id, params: { tagIds: [tag.id] } });

      expect(await getLinkedIds({ trackerId: tracker.id })).toEqual([foodTx.id, taggedTx.id].toSorted());
    });
  });

  describe('cleanup', () => {
    const seed = async ({ rulesCleanup }: { rulesCleanup: boolean }) => {
      const account = await helpers.createAccount({ raw: true });
      const food = await addCategory({ name: 'Food' });
      const [ruleTx, handTx] = await Promise.all([
        createExpense({ accountId: account.id, categoryId: food.id }),
        createExpense({ accountId: account.id }),
      ]);
      const tracker = await helpers.createTracker({
        name: 'Food',
        rulesEnabled: true,
        rulesCleanup,
        categoryIds: [food.id],
        raw: true,
      });
      await helpers.addTransactionsToTracker({ id: tracker.id, payload: { transactionIds: [handTx.id] }, raw: true });
      await helpers.updateTransaction({
        id: ruleTx.id,
        payload: { categoryId: global.DEFAULT_CATEGORY_ID },
        raw: true,
      });
      return { tracker, ruleTx, handTx };
    };

    it('flags rule links with addedByRule and removes them once they stop matching, keeping hand links', async () => {
      const { tracker, ruleTx, handTx } = await seed({ rulesCleanup: true });

      const before = await getLinked({ trackerId: tracker.id });
      expect(before.find((tx) => tx.id === ruleTx.id)?.addedByRule).toBe(true);
      expect(before.find((tx) => tx.id === handTx.id)).not.toHaveProperty('addedByRule');

      await resync({ trackerId: tracker.id });

      expect(await getLinkedIds({ trackerId: tracker.id })).toEqual([handTx.id]);
    });

    it('keeps rule links that stopped matching when cleanup is off', async () => {
      const { tracker, ruleTx, handTx } = await seed({ rulesCleanup: false });

      await resync({ trackerId: tracker.id });

      expect(await getLinkedIds({ trackerId: tracker.id })).toEqual([ruleTx.id, handTx.id].toSorted());
    });
  });

  describe('owner unlink', () => {
    it('keeps an unlinked transaction out, lists it as rejected, and re-links it on restore', async () => {
      const account = await helpers.createAccount({ raw: true });
      const food = await addCategory({ name: 'Food' });
      const tx = await createExpense({ accountId: account.id, categoryId: food.id });
      const tracker = await helpers.createTracker({
        name: 'Food',
        rulesEnabled: true,
        categoryIds: [food.id],
        raw: true,
      });

      await helpers.removeTransactionsFromTracker({ id: tracker.id, payload: { transactionIds: [tx.id] } });
      await resync({ trackerId: tracker.id });

      expect(await getLinkedIds({ trackerId: tracker.id })).toEqual([]);
      const { rejected } = await helpers.getTrackerSuggestions({ id: tracker.id, raw: true });
      expect(rejected).toHaveLength(1);
      expect(rejected[0]).toMatchObject({ score: 0, transaction: { id: tx.id } });

      await helpers.resolveTrackerSuggestions({
        id: tracker.id,
        action: 'restore',
        suggestionIds: [rejected[0]!.id],
        raw: true,
      });

      expect(await getLinkedIds({ trackerId: tracker.id })).toEqual([tx.id]);
      expect((await helpers.getTrackerSuggestions({ id: tracker.id, raw: true })).rejected).toEqual([]);
    });
  });

  describe('rulesEnabled', () => {
    it('links nothing while off and keeps existing links when turned off', async () => {
      const account = await helpers.createAccount({ raw: true });
      const food = await addCategory({ name: 'Food' });
      const first = await createExpense({ accountId: account.id, categoryId: food.id });
      const tracker = await helpers.createTracker({ name: 'Food', categoryIds: [food.id], raw: true });

      expect(tracker.rulesEnabled).toBe(false);
      expect(await getLinkedIds({ trackerId: tracker.id })).toEqual([]);

      await helpers.editTracker({ id: tracker.id, params: { rulesEnabled: true } });
      expect(await getLinkedIds({ trackerId: tracker.id })).toEqual([first.id]);

      await helpers.editTracker({ id: tracker.id, params: { rulesEnabled: false } });
      await createExpense({ accountId: account.id, categoryId: food.id });
      await resync({ trackerId: tracker.id });

      expect(await getLinkedIds({ trackerId: tracker.id })).toEqual([first.id]);
    });

    it('rejects rules without categories or tags, and unknown categories', async () => {
      const responses = await Promise.all([
        helpers.createTracker({ name: 'Empty', rulesEnabled: true, raw: false }),
        helpers.createTracker({ name: 'Empty', rulesEnabled: true, categoryIds: [], tagIds: [], raw: false }),
        helpers.createTracker({ name: 'Unknown', rulesEnabled: true, categoryIds: [NONEXISTENT_ID], raw: false }),
      ]);
      for (const response of responses) expect(response.statusCode).toBe(ERROR_CODES.ValidationError);

      const food = await addCategory({ name: 'Food' });
      const tracker = await helpers.createTracker({
        name: 'Food',
        rulesEnabled: true,
        categoryIds: [food.id],
        raw: true,
      });
      const clearedRes = await helpers.editTracker({ id: tracker.id, params: { categoryIds: [] }, raw: false });
      expect(clearedRes.statusCode).toBe(ERROR_CODES.ValidationError);

      const plain = await helpers.createTracker({ name: 'Plain', raw: true });
      const enableRes = await helpers.editTracker({ id: plain.id, params: { rulesEnabled: true }, raw: false });
      expect(enableRes.statusCode).toBe(ERROR_CODES.ValidationError);
    });
  });

  it('does not sync an archived tracker', async () => {
    const account = await helpers.createAccount({ raw: true });
    const food = await addCategory({ name: 'Food' });
    const tracker = await helpers.createTracker({
      name: 'Food',
      rulesEnabled: true,
      categoryIds: [food.id],
      raw: true,
    });
    await helpers.archiveTracker({ id: tracker.id, isArchived: true, raw: true });
    await createExpense({ accountId: account.id, categoryId: food.id });

    await resync({ trackerId: tracker.id });

    expect(await getLinkedIds({ trackerId: tracker.id })).toEqual([]);
  });

  it('backfills an archived tracker that was never synced once, then skips it', async () => {
    const account = await helpers.createAccount({ raw: true });
    const food = await addCategory({ name: 'Food' });
    const tracker = await helpers.createTracker({
      name: 'Food',
      rulesEnabled: true,
      categoryIds: [food.id],
      raw: true,
    });
    const tx = await createExpense({ accountId: account.id, categoryId: food.id });
    await helpers.archiveTracker({ id: tracker.id, isArchived: true, raw: true });
    // A tracker restored from a legacy backup arrives with no sync yet.
    await Trackers.update({ rulesSyncedAt: null }, { where: { id: tracker.id } });

    expect(await helpers.syncTrackerRules({ id: tracker.id, raw: true })).toEqual({ added: 1, removed: 0 });
    expect(await getLinkedIds({ trackerId: tracker.id })).toEqual([tx.id]);

    await createExpense({ accountId: account.id, categoryId: food.id });
    expect(await resync({ trackerId: tracker.id })).toEqual({ added: 0, removed: 0 });
    expect(await getLinkedIds({ trackerId: tracker.id })).toEqual([tx.id]);
  });

  it('renames a rules tracker without syncing its links', async () => {
    const account = await helpers.createAccount({ raw: true });
    const food = await addCategory({ name: 'Food' });
    const linkedTx = await createExpense({ accountId: account.id, categoryId: food.id });
    const tracker = await helpers.createTracker({
      name: 'Food',
      rulesEnabled: true,
      categoryIds: [food.id],
      raw: true,
    });
    await createExpense({ accountId: account.id, categoryId: food.id });

    const renamed = await helpers.editTracker({ id: tracker.id, params: { name: 'Groceries' }, raw: true });

    expect(renamed).toMatchObject({ name: 'Groceries', rulesEnabled: true });
    expect(await getLinkedIds({ trackerId: tracker.id })).toEqual([linkedTx.id]);
  });

  describe('POST /trackers/:id/sync', () => {
    it('links new matches once the last sync is stale and skips while it is fresh', async () => {
      const account = await helpers.createAccount({ raw: true });
      const food = await addCategory({ name: 'Food' });
      const tracker = await helpers.createTracker({
        name: 'Food',
        rulesEnabled: true,
        categoryIds: [food.id],
        raw: true,
      });
      const tx = await createExpense({ accountId: account.id, categoryId: food.id });

      expect(await helpers.syncTrackerRules({ id: tracker.id, raw: true })).toEqual({ added: 0, removed: 0 });

      await Trackers.update({ rulesSyncedAt: subMinutes(new Date(), 10) }, { where: { id: tracker.id } });
      expect(await helpers.syncTrackerRules({ id: tracker.id, raw: true })).toEqual({ added: 1, removed: 0 });
      expect(await getLinkedIds({ trackerId: tracker.id })).toEqual([tx.id]);
    });

    it('returns 404 for a stranger and an unknown tracker', async () => {
      const food = await addCategory({ name: 'Food' });
      const tracker = await helpers.createTracker({
        name: 'Food',
        rulesEnabled: true,
        categoryIds: [food.id],
        raw: true,
      });
      const stranger = await helpers.provisionSecondUserWithBaseCurrency();

      const strangerRes = await helpers.asUser({
        cookies: stranger.cookies,
        fn: () => helpers.syncTrackerRules({ id: tracker.id, raw: false }),
      });
      expect(strangerRes.statusCode).toBe(ERROR_CODES.NotFoundError);

      const unknownRes = await helpers.syncTrackerRules({ id: NONEXISTENT_ID, raw: false });
      expect(unknownRes.statusCode).toBe(ERROR_CODES.NotFoundError);
    });
  });

  it('links the cash leg of a loan payment and counts it in stats and spending stats', async () => {
    const loan = await helpers.createLoan({
      payload: helpers.buildCreateLoanPayload({ initialBalance: 2_500, originalPrincipal: 2_500 }),
      raw: true,
    });
    const account = await helpers.createAccount({ raw: true });
    const loans = await addCategory({ name: 'Loans' });
    const [cashLeg] = await helpers.createTransaction({
      payload: {
        ...helpers.buildTransactionPayload({ accountId: account.id, amount: 300, categoryId: loans.id }),
        transferNature: TRANSACTION_TRANSFER_NATURE.transfer_to_loan,
        destinationAmount: 300,
        destinationAccountId: loan.id as RecordId,
      },
      raw: true,
    });

    const tracker = await helpers.createTracker({
      name: 'Loans',
      rulesEnabled: true,
      categoryIds: [loans.id],
      raw: true,
    });

    expect(await getLinkedIds({ trackerId: tracker.id })).toEqual([cashLeg!.id]);
    const stats = (await helpers.getTrackerStats({ id: tracker.id, raw: true }))!;
    expect(stats.summary).toMatchObject({ actualExpense: 300, actualIncome: 0, transactionsCount: 1 });
    const spending = await helpers.getTrackerSpendingStats({ id: tracker.id, raw: true });
    expect(spending.spendingsByCategory.map((item) => item.amount)).toEqual([300]);
  });

  describe('deleting a rule category or tag', () => {
    it('turns rules off when the only rule tag is deleted, keeping rule links and later edits working', async () => {
      const account = await helpers.createAccount({ raw: true });
      const tag = await addTag({ name: 'Trip' });
      const tx = await createExpense({ accountId: account.id });
      await helpers.addTransactionsToTag({ tagId: tag.id, transactionIds: [tx.id], raw: true });
      const tracker = await helpers.createTracker({ name: 'Trip', rulesEnabled: true, tagIds: [tag.id], raw: true });
      expect(await getLinkedIds({ trackerId: tracker.id })).toEqual([tx.id]);

      await helpers.deleteTag({ id: tag.id, raw: true });

      expect(await helpers.getTrackerById({ id: tracker.id, raw: true })).toMatchObject({
        rulesEnabled: false,
        tags: [],
      });
      expect(await getLinkedIds({ trackerId: tracker.id })).toEqual([tx.id]);
      const renameRes = await helpers.editTracker({ id: tracker.id, params: { name: 'Renamed' }, raw: false });
      expect(renameRes.statusCode).toBe(200);
    });

    it('turns rules off when the only rule category is deleted without a replacement', async () => {
      const food = await addCategory({ name: 'Food' });
      const tracker = await helpers.createTracker({
        name: 'Food',
        rulesEnabled: true,
        categoryIds: [food.id],
        raw: true,
      });

      await helpers.deleteCustomCategory({ categoryId: food.id, raw: false });

      expect(await helpers.getTrackerById({ id: tracker.id, raw: true })).toMatchObject({
        rulesEnabled: false,
        categories: [],
      });
      const renameRes = await helpers.editTracker({ id: tracker.id, params: { name: 'Renamed' }, raw: false });
      expect(renameRes.statusCode).toBe(200);
    });
  });

  it('keeps rules on when a rule category is deleted while a rule tag remains', async () => {
    const food = await addCategory({ name: 'Food' });
    const tag = await addTag({ name: 'Trip' });
    const tracker = await helpers.createTracker({
      name: 'Trip food',
      rulesEnabled: true,
      categoryIds: [food.id],
      tagIds: [tag.id],
      raw: true,
    });

    await helpers.deleteCustomCategory({ categoryId: food.id, raw: false });

    expect(await helpers.getTrackerById({ id: tracker.id, raw: true })).toMatchObject({
      rulesEnabled: true,
      categories: [],
      tags: [expect.objectContaining({ id: tag.id })],
    });
  });

  it("lets a manage recipient set the owner's rule categories and tags but not their own", async () => {
    const account = await helpers.createAccount({ raw: true });
    const food = await addCategory({ name: 'Food' });
    const tag = await addTag({ name: 'Trip' });
    const foodTx = await createExpense({ accountId: account.id, categoryId: food.id });
    const taggedTx = await createExpense({ accountId: account.id });
    await helpers.addTransactionsToTag({ tagId: tag.id, transactionIds: [taggedTx.id], raw: true });
    const tracker = await helpers.createTracker({ name: 'Shared', raw: true });
    const recipient = await helpers.provisionSecondUserWithBaseCurrency();
    await helpers.shareTrackerWith({ trackerId: tracker.id, recipient, permission: SHARE_PERMISSIONS.manage });

    const { ownRes, ownTagRes, ownerRes } = await helpers.asUser({
      cookies: recipient.cookies,
      fn: async () => {
        const recipientFood = await addCategory({ name: 'Food' });
        const recipientTag = await addTag({ name: 'Trip' });
        return {
          ownRes: await helpers.editTracker({
            id: tracker.id,
            params: { rulesEnabled: true, categoryIds: [recipientFood.id] },
            raw: false,
          }),
          ownTagRes: await helpers.editTracker({
            id: tracker.id,
            params: { rulesEnabled: true, tagIds: [recipientTag.id] },
            raw: false,
          }),
          ownerRes: await helpers.editTracker({
            id: tracker.id,
            params: { rulesEnabled: true, categoryIds: [food.id], tagIds: [tag.id] },
            raw: false,
          }),
        };
      },
    });

    expect(ownRes.statusCode).toBe(ERROR_CODES.ValidationError);
    expect(ownTagRes.statusCode).toBe(ERROR_CODES.ValidationError);
    expect(ownerRes.statusCode).toBe(200);
    expect(await helpers.getTrackerById({ id: tracker.id, raw: true })).toMatchObject({
      rulesEnabled: true,
      categories: [expect.objectContaining({ id: food.id })],
      tags: [expect.objectContaining({ id: tag.id })],
    });
    expect(await getLinkedIds({ trackerId: tracker.id })).toEqual([foodTx.id, taggedTx.id].toSorted());
  });

  it('does not re-add a transaction unlinked while rules were off once rules are turned on', async () => {
    const account = await helpers.createAccount({ raw: true });
    const food = await addCategory({ name: 'Food' });
    const tx = await createExpense({ accountId: account.id, categoryId: food.id });
    const tracker = await helpers.createTracker({ name: 'Food', categoryIds: [food.id], raw: true });
    await helpers.addTransactionsToTracker({ id: tracker.id, payload: { transactionIds: [tx.id] }, raw: true });

    await helpers.removeTransactionsFromTracker({ id: tracker.id, payload: { transactionIds: [tx.id] } });
    await helpers.editTracker({ id: tracker.id, params: { rulesEnabled: true } });

    expect(await getLinkedIds({ trackerId: tracker.id })).toEqual([]);
  });

  it("rejects another user's tag on create and edit without partial writes", async () => {
    const stranger = await helpers.provisionSecondUserWithBaseCurrency();
    const strangerTag = await helpers.asUser({ cookies: stranger.cookies, fn: () => addTag({ name: 'Theirs' }) });
    const food = await addCategory({ name: 'Food' });

    const createRes = await helpers.createTracker({
      name: 'Stolen',
      rulesEnabled: true,
      categoryIds: [food.id],
      tagIds: [strangerTag.id],
      raw: false,
    });
    expect(createRes.statusCode).toBe(ERROR_CODES.ValidationError);
    expect(await helpers.getTrackers({ raw: true })).toEqual([]);

    const tracker = await helpers.createTracker({
      name: 'Food',
      rulesEnabled: true,
      categoryIds: [food.id],
      raw: true,
    });
    const editRes = await helpers.editTracker({
      id: tracker.id,
      params: { name: 'Renamed', tagIds: [strangerTag.id] },
      raw: false,
    });
    expect(editRes.statusCode).toBe(ERROR_CODES.ValidationError);
    expect(await helpers.getTrackerById({ id: tracker.id, raw: true })).toMatchObject({ name: 'Food', tags: [] });
  });

  describe('edit with partial rule fields', () => {
    it('rejects only rulesEnabled: true on a tracker with no rules and leaves it unchanged', async () => {
      const tracker = await helpers.createTracker({ name: 'Plain', raw: true });

      const res = await helpers.editTracker({ id: tracker.id, params: { rulesEnabled: true }, raw: false });

      expect(res.statusCode).toBe(ERROR_CODES.ValidationError);
      expect(await helpers.getTrackerById({ id: tracker.id, raw: true })).toMatchObject({ rulesEnabled: false });
    });

    it('keeps the rule categories when only tagIds are sent', async () => {
      const [food, tag] = await Promise.all([addCategory({ name: 'Food' }), addTag({ name: 'Trip' })]);
      const tracker = await helpers.createTracker({
        name: 'Food',
        rulesEnabled: true,
        categoryIds: [food.id],
        raw: true,
      });

      const edited = await helpers.editTracker({ id: tracker.id, params: { tagIds: [tag.id] }, raw: true });

      expect(edited.categories!.map((c) => c.id)).toEqual([food.id]);
      expect(edited.tags!.map((t) => t.id)).toEqual([tag.id]);
    });

    it('keeps rules and links when only rulesEnabled: false is sent', async () => {
      const account = await helpers.createAccount({ raw: true });
      const food = await addCategory({ name: 'Food' });
      const tx = await createExpense({ accountId: account.id, categoryId: food.id });
      const tracker = await helpers.createTracker({
        name: 'Food',
        rulesEnabled: true,
        categoryIds: [food.id],
        raw: true,
      });

      const edited = await helpers.editTracker({ id: tracker.id, params: { rulesEnabled: false }, raw: true });

      expect(edited.rulesEnabled).toBe(false);
      expect(edited.categories!.map((c) => c.id)).toEqual([food.id]);
      expect(await getLinkedIds({ trackerId: tracker.id })).toEqual([tx.id]);
    });
  });

  it("lets a view-only recipient sync, linking the owner's matches and never the recipient's", async () => {
    const account = await helpers.createAccount({ raw: true });
    const food = await addCategory({ name: 'Food' });
    const tracker = await helpers.createTracker({
      name: 'Food',
      rulesEnabled: true,
      categoryIds: [food.id],
      raw: true,
    });
    const ownerTx = await createExpense({ accountId: account.id, categoryId: food.id });
    const recipient = await helpers.provisionSecondUserWithBaseCurrency();
    await helpers.shareTrackerWith({ trackerId: tracker.id, recipient, permission: SHARE_PERMISSIONS.read });
    await helpers.asUser({
      cookies: recipient.cookies,
      fn: async () => {
        const recipientAccount = await helpers.createAccount({ raw: true });
        const recipientFood = await addCategory({ name: 'Food' });
        await createExpense({ accountId: recipientAccount.id, categoryId: recipientFood.id });
      },
    });
    await Trackers.update({ rulesSyncedAt: subMinutes(new Date(), 10) }, { where: { id: tracker.id } });

    const result = await helpers.asUser({
      cookies: recipient.cookies,
      fn: () => helpers.syncTrackerRules({ id: tracker.id, raw: true }),
    });

    expect(result).toEqual({ added: 1, removed: 0 });
    expect(await getLinkedIds({ trackerId: tracker.id })).toEqual([ownerTx.id]);
  });

  it('duplicates a rules tracker together with its rule links', async () => {
    const account = await helpers.createAccount({ raw: true });
    const food = await addCategory({ name: 'Food' });
    const tx = await createExpense({ accountId: account.id, categoryId: food.id });
    const tracker = await helpers.createTracker({
      name: 'Food',
      rulesEnabled: true,
      categoryIds: [food.id],
      raw: true,
    });

    const copy = await helpers.duplicateTracker({ id: tracker.id, raw: true });

    expect(copy.rulesEnabled).toBe(true);
    const linked = await getLinked({ trackerId: copy.id });
    expect(linked.map((row) => [row.id, row.addedByRule])).toEqual([[tx.id, true]]);
  });

  describe('rules sync cron', () => {
    it('syncs trackers of recently active owners and skips archived, rules-off, long-ended and stale-owner ones', async () => {
      const account = await helpers.createAccount({ raw: true });
      const food = await addCategory({ name: 'Food' });
      const createRulesTracker = ({ name, ...rest }: { name: string; startDate?: string; endDate?: string }) =>
        helpers.createTracker({ name, rulesEnabled: true, categoryIds: [food.id], ...rest, raw: true });

      const [active, archived, ended] = await Promise.all([
        createRulesTracker({ name: 'Active' }),
        createRulesTracker({ name: 'Archived' }),
        createRulesTracker({ name: 'Ended', startDate: '2020-01-01T00:00:00Z', endDate: '2020-01-31T23:59:59Z' }),
      ]);
      const rulesOff = await helpers.createTracker({ name: 'Rules off', categoryIds: [food.id], raw: true });
      await helpers.archiveTracker({ id: archived.id, isArchived: true, raw: true });
      const [recentTx, oldTx] = await Promise.all([
        createExpense({ accountId: account.id, categoryId: food.id }),
        createExpense({ accountId: account.id, categoryId: food.id, time: '2020-01-15T10:00:00Z' }),
      ]);

      const stranger = await helpers.provisionSecondUserWithBaseCurrency();
      const strangerTracker = await helpers.asUser({
        cookies: stranger.cookies,
        fn: async () => {
          const strangerAccount = await helpers.createAccount({ raw: true });
          const strangerFood = await addCategory({ name: 'Food' });
          const created = await helpers.createTracker({
            name: 'Stale owner',
            rulesEnabled: true,
            categoryIds: [strangerFood.id],
            raw: true,
          });
          await createExpense({ accountId: strangerAccount.id, categoryId: strangerFood.id });
          return created;
        },
      });
      await connection.sequelize.query(
        `UPDATE ba_session SET "updatedAt" = :staleAt WHERE "userId" IN (SELECT id FROM ba_user WHERE email = :email)`,
        { replacements: { staleAt: subDays(new Date(), 60), email: stranger.email } },
      );

      expect(await runTrackerRulesSyncCron({ now: new Date() })).toEqual({ due: 1, failed: 0 });

      expect(await getLinkedIds({ trackerId: active.id })).toEqual([recentTx.id, oldTx.id].toSorted());
      expect(await getLinkedIds({ trackerId: archived.id })).toEqual([]);
      expect(await getLinkedIds({ trackerId: ended.id })).toEqual([]);
      expect(await getLinkedIds({ trackerId: rulesOff.id })).toEqual([]);
      const strangerLinked = await helpers.asUser({
        cookies: stranger.cookies,
        fn: () => getLinkedIds({ trackerId: strangerTracker.id }),
      });
      expect(strangerLinked).toEqual([]);
    });
  });
});
