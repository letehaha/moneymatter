import { type RecordId, SHARE_PERMISSIONS, TRANSACTION_TRANSFER_NATURE, TRANSACTION_TYPES } from '@bt/shared/types';
import { NONEXISTENT_ID } from '@common/lib/record-id-helpers';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { ERROR_CODES } from '@js/errors';
import * as helpers from '@tests/helpers';
import { addDays } from 'date-fns';

const COOLDOWN_STEP_MINUTES = 6;
let clockShiftMinutes = 0;

beforeEach(() => {
  clockShiftMinutes = 0;
});

const syncAfterCooldown = async ({ id, cookies }: { id: RecordId; cookies?: string }) => {
  clockShiftMinutes += COOLDOWN_STEP_MINUTES;
  jest.useFakeTimers({
    now: Date.now() + clockShiftMinutes * 60_000,
    doNotFake: ['setTimeout', 'setInterval', 'setImmediate', 'queueMicrotask', 'nextTick', 'performance'],
  });
  try {
    const sync = () => helpers.syncTrackerRules({ id });
    return cookies ? await helpers.asUser({ cookies, fn: sync }) : await sync();
  } finally {
    jest.useRealTimers();
  }
};

const syncAfterCooldownOk = async ({ id }: { id: RecordId }) => {
  const res = await syncAfterCooldown({ id });
  expect(res.statusCode).toBe(200);
  return helpers.extractResponse(res) as { added: number; removed: number };
};

const linkedIds = async ({ trackerId }: { trackerId: RecordId }) => {
  const txs = await helpers.getTransactions({
    trackerIds: [trackerId],
    raw: true,
  });
  return txs.map((tx) => tx.id as RecordId).sort();
};

const sorted = (ids: RecordId[]) => [...ids].sort();

const createExpense = async ({
  accountId,
  categoryId,
  amount = 10,
  time,
  tagIds,
  splits,
}: {
  accountId: RecordId;
  categoryId: RecordId;
  amount?: number;
  time?: string;
  tagIds?: string[];
  splits?: { categoryId: RecordId; amount: number }[];
}) => {
  const [tx] = await helpers.createTransaction({
    payload: helpers.buildTransactionPayload({
      accountId,
      categoryId,
      amount,
      ...(time ? { time } : {}),
      ...(tagIds ? { tagIds } : {}),
      ...(splits ? { splits } : {}),
    }),
    raw: true,
  });
  return tx.id as RecordId;
};

const setup = async () => {
  const account = await helpers.createAccount({ raw: true });
  const [food, travel, other] = await Promise.all([
    helpers.addCustomCategory({ name: 'Food', color: '#FF0000', raw: true }),
    helpers.addCustomCategory({ name: 'Travel', color: '#00FF00', raw: true }),
    helpers.addCustomCategory({ name: 'Other', color: '#0000FF', raw: true }),
  ]);
  const [trip, work] = await Promise.all([
    helpers.createTag({
      payload: helpers.buildTagPayload({ name: 'Trip' }),
      raw: true,
    }),
    helpers.createTag({
      payload: helpers.buildTagPayload({ name: 'Work' }),
      raw: true,
    }),
  ]);
  return {
    accountId: account.id as RecordId,
    food: food.id as RecordId,
    travel: travel.id as RecordId,
    other: other.id as RecordId,
    trip: trip.id as RecordId,
    work: work.id as RecordId,
  };
};

const createRuleTracker = async ({
  categoryIds,
  tagIds,
  rulesCleanup,
  startDate,
  endDate,
}: {
  categoryIds?: string[];
  tagIds?: string[];
  rulesCleanup?: boolean;
  startDate?: string;
  endDate?: string;
}) => {
  const tracker = await helpers.createTracker({
    name: 'Rules tracker',
    rulesEnabled: true,
    categoryIds,
    tagIds,
    rulesCleanup,
    startDate,
    endDate,
    raw: true,
  });
  return tracker.id as RecordId;
};

const expectClientError = ({ statusCode }: { statusCode: number }) => {
  expect(statusCode).toBeGreaterThanOrEqual(400);
  expect(statusCode).toBeLessThan(500);
};

describe('Tracker rules (spec)', () => {
  describe('Matching', () => {
    it('links existing transactions matching any rule category OR any rule tag when created with rules on', async () => {
      const ctx = await setup();
      const byCategory = await createExpense({
        accountId: ctx.accountId,
        categoryId: ctx.food,
      });
      const byTag = await createExpense({
        accountId: ctx.accountId,
        categoryId: ctx.other,
        tagIds: [ctx.trip],
      });
      await createExpense({
        accountId: ctx.accountId,
        categoryId: ctx.other,
        tagIds: [ctx.work],
      });

      const trackerId = await createRuleTracker({
        categoryIds: [ctx.food],
        tagIds: [ctx.trip],
      });

      expect(await linkedIds({ trackerId })).toEqual(sorted([byCategory, byTag]));
    });

    it('returns the rule set with cleanup on by default', async () => {
      const ctx = await setup();
      const trackerId = await createRuleTracker({
        categoryIds: [ctx.food],
        tagIds: [ctx.trip],
      });

      const tracker = (await helpers.getTrackerById({
        id: trackerId,
        raw: true,
      }))!;

      expect(tracker.rulesEnabled).toBe(true);
      expect(tracker.rulesCleanup).toBe(true);
      expect(tracker.categories!.map((c) => c.id as RecordId)).toEqual([ctx.food]);
      expect(tracker.tags!.map((t) => t.id as RecordId)).toEqual([ctx.trip]);
    });

    it('expands a parent rule category to its children', async () => {
      const ctx = await setup();
      const child = await helpers.addCustomCategory({
        name: 'Groceries',
        parentId: ctx.food,
        raw: true,
      });
      const txId = await createExpense({
        accountId: ctx.accountId,
        categoryId: child.id as RecordId,
      });

      const trackerId = await createRuleTracker({ categoryIds: [ctx.food] });

      expect(await linkedIds({ trackerId })).toEqual([txId]);
    });

    it('only matches transactions inside the start/end window', async () => {
      const ctx = await setup();
      await createExpense({
        accountId: ctx.accountId,
        categoryId: ctx.food,
        time: '2026-02-28T12:00:00.000Z',
      });
      const inside = await createExpense({
        accountId: ctx.accountId,
        categoryId: ctx.food,
        time: '2026-03-15T12:00:00.000Z',
      });
      await createExpense({
        accountId: ctx.accountId,
        categoryId: ctx.food,
        time: '2026-04-01T12:00:00.000Z',
      });

      const trackerId = await createRuleTracker({
        categoryIds: [ctx.food],
        startDate: '2026-03-01T00:00:00.000Z',
        endDate: '2026-03-31T23:59:59.999Z',
      });

      expect(await linkedIds({ trackerId })).toEqual([inside]);
    });

    it('matches all history on an open-ended tracker', async () => {
      const ctx = await setup();
      const old = await createExpense({
        accountId: ctx.accountId,
        categoryId: ctx.food,
        time: '2019-06-01T12:00:00.000Z',
      });
      const recent = await createExpense({
        accountId: ctx.accountId,
        categoryId: ctx.food,
      });

      const trackerId = await createRuleTracker({ categoryIds: [ctx.food] });

      expect(await linkedIds({ trackerId })).toEqual(sorted([old, recent]));
    });

    it('never matches transfers, even with a rule category', async () => {
      const ctx = await setup();
      const destination = await helpers.createAccount({ raw: true });
      await helpers.createTransaction({
        payload: {
          ...helpers.buildTransactionPayload({
            accountId: ctx.accountId,
            categoryId: ctx.food,
            amount: 50,
          }),
          transferNature: TRANSACTION_TRANSFER_NATURE.common_transfer,
          destinationAmount: 50,
          destinationAccountId: destination.id,
        },
        raw: true,
      });
      const expense = await createExpense({
        accountId: ctx.accountId,
        categoryId: ctx.food,
      });

      const trackerId = await createRuleTracker({ categoryIds: [ctx.food] });

      expect(await linkedIds({ trackerId })).toEqual([expense]);
    });

    it('ignores planned transactions until they become real, then the next sync links them', async () => {
      const ctx = await setup();
      const [planned] = await helpers.createPlannedTransaction({
        payload: {
          accountId: ctx.accountId,
          categoryId: ctx.food,
          amount: 25,
          transactionType: TRANSACTION_TYPES.expense,
          time: addDays(new Date(), 5).toISOString(),
        },
        raw: true,
      });
      const plannedId = planned.id as RecordId;

      const trackerId = await createRuleTracker({ categoryIds: [ctx.food] });
      expect(await linkedIds({ trackerId })).not.toContain(plannedId);

      const res = await helpers.updateTransaction({
        id: plannedId,
        payload: { isPlanned: false, time: new Date().toISOString() },
      });
      expect(res.statusCode).toBe(200);

      await syncAfterCooldownOk({ id: trackerId });
      expect(await linkedIds({ trackerId })).toContain(plannedId);
    });

    it('links a split transaction whole when only a split category matches, counting the full amount', async () => {
      const ctx = await setup();
      const txId = await createExpense({
        accountId: ctx.accountId,
        categoryId: ctx.other,
        amount: 100,
        splits: [{ categoryId: ctx.food, amount: 30 }],
      });

      const trackerId = await createRuleTracker({ categoryIds: [ctx.food] });

      expect(await linkedIds({ trackerId })).toEqual([txId]);
      const stats = await helpers.getTrackerStats({ id: trackerId, raw: true });
      expect(stats!.summary.actualExpense).toBe(100);
      expect(stats!.summary.transactionsCount).toBe(1);
    });

    it('does not duplicate a transaction that was hand-linked before the rules matched it', async () => {
      const ctx = await setup();
      const txId = await createExpense({
        accountId: ctx.accountId,
        categoryId: ctx.food,
        amount: 40,
      });
      const tracker = await helpers.createTracker({
        name: 'Manual first',
        raw: true,
      });
      const trackerId = tracker.id as RecordId;
      await helpers.addTransactionsToTracker({
        id: trackerId,
        payload: { transactionIds: [txId] },
        raw: true,
      });

      await helpers.editTracker({
        id: trackerId,
        params: { rulesEnabled: true, categoryIds: [ctx.food] },
        raw: true,
      });

      expect(await linkedIds({ trackerId })).toEqual([txId]);
      const stats = await helpers.getTrackerStats({ id: trackerId, raw: true });
      expect(stats!.summary.transactionsCount).toBe(1);
      expect(stats!.summary.actualExpense).toBe(40);
    });
  });

  describe('Stats', () => {
    it('stats totals equal the sum of linked transactions (rule-added and hand-added)', async () => {
      const ctx = await setup();
      await createExpense({
        accountId: ctx.accountId,
        categoryId: ctx.food,
        amount: 10,
      });
      await createExpense({
        accountId: ctx.accountId,
        categoryId: ctx.other,
        amount: 20,
        tagIds: [ctx.trip],
      });
      const manual = await createExpense({
        accountId: ctx.accountId,
        categoryId: ctx.other,
        amount: 5,
      });
      await createExpense({
        accountId: ctx.accountId,
        categoryId: ctx.other,
        amount: 1000,
      });

      const trackerId = await createRuleTracker({
        categoryIds: [ctx.food],
        tagIds: [ctx.trip],
      });
      await helpers.addTransactionsToTracker({
        id: trackerId,
        payload: { transactionIds: [manual] },
        raw: true,
      });

      const stats = await helpers.getTrackerStats({ id: trackerId, raw: true });
      expect(stats!.summary.transactionsCount).toBe(3);
      expect(stats!.summary.actualExpense).toBe(35);
    });

    it('a deleted linked transaction disappears from the list and the stats', async () => {
      const ctx = await setup();
      const keep = await createExpense({
        accountId: ctx.accountId,
        categoryId: ctx.food,
        amount: 10,
      });
      const drop = await createExpense({
        accountId: ctx.accountId,
        categoryId: ctx.food,
        amount: 15,
      });
      const trackerId = await createRuleTracker({ categoryIds: [ctx.food] });

      await helpers.deleteTransaction({ id: drop });

      expect(await linkedIds({ trackerId })).toEqual([keep]);
      const stats = await helpers.getTrackerStats({ id: trackerId, raw: true });
      expect(stats!.summary.actualExpense).toBe(10);
      expect(stats!.summary.transactionsCount).toBe(1);
    });
  });

  describe('Visit sync (POST /trackers/:id/sync)', () => {
    it('links a transaction created after the rules were set up and reports it as added', async () => {
      const ctx = await setup();
      const trackerId = await createRuleTracker({ categoryIds: [ctx.food] });
      const txId = await createExpense({
        accountId: ctx.accountId,
        categoryId: ctx.food,
      });

      const result = await syncAfterCooldownOk({ id: trackerId });

      expect(result).toEqual({ added: 1, removed: 0 });
      expect(await linkedIds({ trackerId })).toEqual([txId]);
    });

    it('skips within the 5-minute cooldown and catches up after it', async () => {
      const ctx = await setup();
      const trackerId = await createRuleTracker({ categoryIds: [ctx.food] });
      const txId = await createExpense({
        accountId: ctx.accountId,
        categoryId: ctx.food,
      });

      const immediate = await helpers.syncTrackerRules({
        id: trackerId,
        raw: true,
      });
      expect(immediate).toEqual({ added: 0, removed: 0 });
      expect(await linkedIds({ trackerId })).toEqual([]);

      await syncAfterCooldownOk({ id: trackerId });
      expect(await linkedIds({ trackerId })).toEqual([txId]);
    });

    it('picks up a tag added to an existing transaction later', async () => {
      const ctx = await setup();
      const txId = await createExpense({
        accountId: ctx.accountId,
        categoryId: ctx.other,
      });
      const trackerId = await createRuleTracker({ tagIds: [ctx.trip] });
      expect(await linkedIds({ trackerId })).toEqual([]);

      await helpers.addTransactionsToTag({
        tagId: ctx.trip,
        transactionIds: [txId],
        raw: true,
      });
      await syncAfterCooldownOk({ id: trackerId });

      expect(await linkedIds({ trackerId })).toEqual([txId]);
    });

    it('links nothing when rules are off', async () => {
      const ctx = await setup();
      await createExpense({ accountId: ctx.accountId, categoryId: ctx.food });
      const tracker = await helpers.createTracker({
        name: 'Off',
        rulesEnabled: false,
        categoryIds: [ctx.food],
        raw: true,
      });

      const result = await syncAfterCooldownOk({ id: tracker.id as RecordId });

      expect(result).toEqual({ added: 0, removed: 0 });
      expect(await linkedIds({ trackerId: tracker.id as RecordId })).toEqual([]);
    });

    it('returns 404 for a tracker the user cannot see', async () => {
      const other = await helpers.provisionSecondUserWithBaseCurrency();
      const foreign = await helpers.asUser({
        cookies: other.cookies,
        fn: () => helpers.createTracker({ name: 'Not yours', raw: true }),
      });

      const res = await helpers.syncTrackerRules({
        id: foreign.id as RecordId,
      });

      expect(res.statusCode).toBe(ERROR_CODES.NotFoundError);
    });

    it('returns 404 for a nonexistent tracker', async () => {
      const res = await helpers.syncTrackerRules({ id: NONEXISTENT_ID });
      expect(res.statusCode).toBe(ERROR_CODES.NotFoundError);
    });
  });

  describe('Cleanup', () => {
    it('with cleanup on, a rule-added transaction that stops matching is removed on the next sync', async () => {
      const ctx = await setup();
      const txId = await createExpense({
        accountId: ctx.accountId,
        categoryId: ctx.food,
      });
      const trackerId = await createRuleTracker({ categoryIds: [ctx.food] });
      expect(await linkedIds({ trackerId })).toEqual([txId]);

      await helpers.updateTransaction({
        id: txId,
        payload: { categoryId: ctx.other },
        raw: true,
      });
      const result = await syncAfterCooldownOk({ id: trackerId });

      expect(result).toEqual({ added: 0, removed: 1 });
      expect(await linkedIds({ trackerId })).toEqual([]);
    });

    it('with cleanup off, a rule-added transaction that stops matching stays linked', async () => {
      const ctx = await setup();
      const txId = await createExpense({
        accountId: ctx.accountId,
        categoryId: ctx.food,
      });
      const trackerId = await createRuleTracker({
        categoryIds: [ctx.food],
        rulesCleanup: false,
      });

      await helpers.updateTransaction({
        id: txId,
        payload: { categoryId: ctx.other },
        raw: true,
      });
      await syncAfterCooldownOk({ id: trackerId });

      expect(await linkedIds({ trackerId })).toEqual([txId]);
    });

    it('with cleanup on, narrowing the date window drops rule-added links outside it', async () => {
      const ctx = await setup();
      const march = await createExpense({
        accountId: ctx.accountId,
        categoryId: ctx.food,
        time: '2026-03-15T12:00:00.000Z',
      });
      const april = await createExpense({
        accountId: ctx.accountId,
        categoryId: ctx.food,
        time: '2026-04-15T12:00:00.000Z',
      });
      const trackerId = await createRuleTracker({ categoryIds: [ctx.food] });
      expect(await linkedIds({ trackerId })).toEqual(sorted([march, april]));

      await helpers.editTracker({
        id: trackerId,
        params: {
          startDate: '2026-03-01T00:00:00.000Z',
          endDate: '2026-03-31T23:59:59.999Z',
        },
        raw: true,
      });
      await syncAfterCooldownOk({ id: trackerId });

      expect(await linkedIds({ trackerId })).toEqual([march]);
    });

    it('never removes hand-added links, matching or not', async () => {
      const ctx = await setup();
      const nonMatching = await createExpense({
        accountId: ctx.accountId,
        categoryId: ctx.other,
      });
      const trackerId = await createRuleTracker({ categoryIds: [ctx.food] });
      await helpers.addTransactionsToTracker({
        id: trackerId,
        payload: { transactionIds: [nonMatching] },
        raw: true,
      });

      await syncAfterCooldownOk({ id: trackerId });
      await syncAfterCooldownOk({ id: trackerId });

      expect(await linkedIds({ trackerId })).toEqual([nonMatching]);
    });
  });

  describe('Turning rules off and on', () => {
    it.each([true, false])(
      'turning rules off keeps existing links and stops new matches (cleanup %s)',
      async (rulesCleanup) => {
        const ctx = await setup();
        const existing = await createExpense({
          accountId: ctx.accountId,
          categoryId: ctx.food,
        });
        const trackerId = await createRuleTracker({
          categoryIds: [ctx.food],
          rulesCleanup,
        });

        await helpers.editTracker({
          id: trackerId,
          params: { rulesEnabled: false },
          raw: true,
        });
        expect(await linkedIds({ trackerId })).toEqual([existing]);

        await createExpense({ accountId: ctx.accountId, categoryId: ctx.food });
        await syncAfterCooldownOk({ id: trackerId });

        expect(await linkedIds({ trackerId })).toEqual([existing]);
      },
    );

    it('turning rules off does not drop links whose transaction stopped matching', async () => {
      const ctx = await setup();
      const txId = await createExpense({
        accountId: ctx.accountId,
        categoryId: ctx.food,
      });
      const trackerId = await createRuleTracker({ categoryIds: [ctx.food] });

      await helpers.editTracker({
        id: trackerId,
        params: { rulesEnabled: false },
        raw: true,
      });
      await helpers.updateTransaction({
        id: txId,
        payload: { categoryId: ctx.other },
        raw: true,
      });
      await syncAfterCooldownOk({ id: trackerId });

      expect(await linkedIds({ trackerId })).toEqual([txId]);
    });

    it('turning rules back on re-scans immediately', async () => {
      const ctx = await setup();
      const trackerId = await createRuleTracker({ categoryIds: [ctx.food] });
      await helpers.editTracker({
        id: trackerId,
        params: { rulesEnabled: false },
        raw: true,
      });
      const txId = await createExpense({
        accountId: ctx.accountId,
        categoryId: ctx.food,
      });

      await helpers.editTracker({
        id: trackerId,
        params: { rulesEnabled: true },
        raw: true,
      });

      expect(await linkedIds({ trackerId })).toEqual([txId]);
    });
  });

  describe('Editing the rule set', () => {
    it('adding a category re-scans on save, ignoring the visit cooldown', async () => {
      const ctx = await setup();
      const trackerId = await createRuleTracker({ categoryIds: [ctx.food] });
      await helpers.syncTrackerRules({ id: trackerId, raw: true });
      const travelTx = await createExpense({
        accountId: ctx.accountId,
        categoryId: ctx.travel,
      });

      await helpers.editTracker({
        id: trackerId,
        params: { categoryIds: [ctx.food, ctx.travel] },
        raw: true,
      });

      expect(await linkedIds({ trackerId })).toEqual([travelTx]);
    });

    it('adding a tag re-scans on save', async () => {
      const ctx = await setup();
      const tagged = await createExpense({
        accountId: ctx.accountId,
        categoryId: ctx.other,
        tagIds: [ctx.work],
      });
      const trackerId = await createRuleTracker({ categoryIds: [ctx.food] });

      await helpers.editTracker({
        id: trackerId,
        params: { tagIds: [ctx.work] },
        raw: true,
      });

      expect(await linkedIds({ trackerId })).toEqual([tagged]);
    });

    it('removing a category with cleanup on drops its rule-added links on save but keeps hand-added ones', async () => {
      const ctx = await setup();
      const ruleAdded = await createExpense({
        accountId: ctx.accountId,
        categoryId: ctx.travel,
      });
      const handAdded = await createExpense({
        accountId: ctx.accountId,
        categoryId: ctx.travel,
      });
      const foodTx = await createExpense({
        accountId: ctx.accountId,
        categoryId: ctx.food,
      });

      const tracker = await helpers.createTracker({ name: 'Mixed', raw: true });
      const trackerId = tracker.id as RecordId;
      await helpers.addTransactionsToTracker({
        id: trackerId,
        payload: { transactionIds: [handAdded] },
        raw: true,
      });
      await helpers.editTracker({
        id: trackerId,
        params: { rulesEnabled: true, categoryIds: [ctx.food, ctx.travel] },
        raw: true,
      });
      expect(await linkedIds({ trackerId })).toEqual(sorted([ruleAdded, handAdded, foodTx]));

      await helpers.editTracker({
        id: trackerId,
        params: { categoryIds: [ctx.food] },
        raw: true,
      });

      expect(await linkedIds({ trackerId })).toEqual(sorted([handAdded, foodTx]));
    });

    it('removing a category with cleanup off keeps its rule-added links', async () => {
      const ctx = await setup();
      const travelTx = await createExpense({
        accountId: ctx.accountId,
        categoryId: ctx.travel,
      });
      const foodTx = await createExpense({
        accountId: ctx.accountId,
        categoryId: ctx.food,
      });
      const trackerId = await createRuleTracker({
        categoryIds: [ctx.food, ctx.travel],
        rulesCleanup: false,
      });

      await helpers.editTracker({
        id: trackerId,
        params: { categoryIds: [ctx.food] },
        raw: true,
      });
      await syncAfterCooldownOk({ id: trackerId });

      expect(await linkedIds({ trackerId })).toEqual(sorted([travelTx, foodTx]));
    });

    it('tracker lines may use categories outside the rule categories', async () => {
      const ctx = await setup();
      const trackerId = await createRuleTracker({ categoryIds: [ctx.food] });

      const res = await helpers.createTrackerLine({
        trackerId,
        payload: { name: 'Other line', categoryIds: [ctx.other] },
      });

      expect(res.statusCode).toBeLessThan(300);
    });
  });

  describe('Rejected rows', () => {
    it('unlinking a rule-added transaction lists it as rejected and rules never re-add it', async () => {
      const ctx = await setup();
      const txId = await createExpense({
        accountId: ctx.accountId,
        categoryId: ctx.food,
      });
      const trackerId = await createRuleTracker({ categoryIds: [ctx.food] });

      await helpers.removeTransactionsFromTracker({
        id: trackerId,
        payload: { transactionIds: [txId] },
        raw: true,
      });

      const { rejected } = await helpers.getTrackerSuggestions({
        id: trackerId,
        raw: true,
      });
      expect(rejected.map((r) => r.transaction.id as RecordId)).toEqual([txId]);

      await syncAfterCooldownOk({ id: trackerId });
      await helpers.editTracker({
        id: trackerId,
        params: { categoryIds: [ctx.food, ctx.travel] },
        raw: true,
      });
      await helpers.editTracker({
        id: trackerId,
        params: { rulesEnabled: false },
        raw: true,
      });
      await helpers.editTracker({
        id: trackerId,
        params: { rulesEnabled: true },
        raw: true,
      });

      expect(await linkedIds({ trackerId })).toEqual([]);
    });

    it('allowing matching again lets the next sync re-link the transaction', async () => {
      const ctx = await setup();
      const txId = await createExpense({
        accountId: ctx.accountId,
        categoryId: ctx.food,
      });
      const trackerId = await createRuleTracker({ categoryIds: [ctx.food] });
      await helpers.removeTransactionsFromTracker({
        id: trackerId,
        payload: { transactionIds: [txId] },
        raw: true,
      });
      const { rejected } = await helpers.getTrackerSuggestions({
        id: trackerId,
        raw: true,
      });

      await helpers.resolveTrackerSuggestions({
        id: trackerId,
        action: 'restore',
        suggestionIds: rejected.map((r) => r.id as RecordId),
        raw: true,
      });
      await syncAfterCooldownOk({ id: trackerId });

      expect(await linkedIds({ trackerId })).toEqual([txId]);
      const after = await helpers.getTrackerSuggestions({
        id: trackerId,
        raw: true,
      });
      expect(after.rejected).toEqual([]);
    });

    it('a rejected transaction can still be linked back by hand', async () => {
      const ctx = await setup();
      const txId = await createExpense({
        accountId: ctx.accountId,
        categoryId: ctx.food,
      });
      const trackerId = await createRuleTracker({ categoryIds: [ctx.food] });
      await helpers.removeTransactionsFromTracker({
        id: trackerId,
        payload: { transactionIds: [txId] },
        raw: true,
      });

      const res = await helpers.addTransactionsToTracker({
        id: trackerId,
        payload: { transactionIds: [txId] },
      });

      expect(res.statusCode).toBe(200);
      expect(await linkedIds({ trackerId })).toEqual([txId]);
    });
  });

  describe('Deleting rule entities', () => {
    it('deleting a rule tag removes it from the rules and its matches drop on the next sync', async () => {
      const ctx = await setup();
      const tagged = await createExpense({
        accountId: ctx.accountId,
        categoryId: ctx.other,
        tagIds: [ctx.trip],
      });
      const foodTx = await createExpense({
        accountId: ctx.accountId,
        categoryId: ctx.food,
      });
      const trackerId = await createRuleTracker({
        categoryIds: [ctx.food],
        tagIds: [ctx.trip],
      });
      expect(await linkedIds({ trackerId })).toEqual(sorted([tagged, foodTx]));

      await helpers.deleteTag({ id: ctx.trip, raw: true });

      const tracker = (await helpers.getTrackerById({
        id: trackerId,
        raw: true,
      }))!;
      expect(tracker.tags).toEqual([]);
      await syncAfterCooldownOk({ id: trackerId });
      expect(await linkedIds({ trackerId })).toEqual([foodTx]);
    });

    it('deleting a rule category removes it from the rules and the tracker keeps working', async () => {
      const ctx = await setup();
      const trackerId = await createRuleTracker({
        categoryIds: [ctx.food, ctx.travel],
      });

      await helpers.deleteCustomCategory({ categoryId: ctx.travel, raw: true });

      const tracker = (await helpers.getTrackerById({
        id: trackerId,
        raw: true,
      }))!;
      expect(tracker.categories!.map((c) => c.id as RecordId)).toEqual([ctx.food]);
      const syncRes = await helpers.syncTrackerRules({ id: trackerId });
      expect(syncRes.statusCode).toBe(200);
    });

    it('deleting the only rule category leaves a tracker that still loads and syncs', async () => {
      const ctx = await setup();
      const trackerId = await createRuleTracker({ categoryIds: [ctx.travel] });

      await helpers.deleteCustomCategory({ categoryId: ctx.travel, raw: true });

      const getRes = await helpers.getTrackerById({ id: trackerId });
      expect(getRes.statusCode).toBe(200);
      const statsRes = await helpers.getTrackerStats({ id: trackerId });
      expect(statsRes.statusCode).toBe(200);
      const syncRes = await syncAfterCooldownOk({ id: trackerId });
      expect(syncRes).toEqual({ added: 0, removed: 0 });
    });
  });

  describe('Sharing', () => {
    it('a write recipient hand-linking their own transaction survives owner syncs with cleanup on', async () => {
      const ctx = await setup();
      const trackerId = await createRuleTracker({ categoryIds: [ctx.food] });
      const recipient = await helpers.provisionSecondUserWithBaseCurrency();
      await helpers.shareTrackerWith({
        trackerId,
        recipient,
        permission: SHARE_PERMISSIONS.write,
      });

      const recipientTxId = await helpers.asUser({
        cookies: recipient.cookies,
        fn: async () => {
          const account = await helpers.createAccount({ raw: true });
          const [ownCategory] = await helpers.getCategoriesList();
          const [tx] = await helpers.createTransaction({
            payload: helpers.buildTransactionPayload({ accountId: account.id, categoryId: ownCategory!.id }),
            raw: true,
          });
          const res = await helpers.addTransactionsToTracker({
            id: trackerId,
            payload: { transactionIds: [tx.id as RecordId] },
          });
          expect(res.statusCode).toBe(200);
          return tx.id as RecordId;
        },
      });

      await syncAfterCooldownOk({ id: trackerId });
      await helpers.editTracker({
        id: trackerId,
        params: { categoryIds: [ctx.travel] },
        raw: true,
      });

      expect(await linkedIds({ trackerId })).toContain(recipientTxId);
    });

    it.each([SHARE_PERMISSIONS.read, SHARE_PERMISSIONS.write, SHARE_PERMISSIONS.manage])(
      'a %s recipient opening the details page can call sync, which links the owner matches',
      async (permission) => {
        const ctx = await setup();
        const trackerId = await createRuleTracker({ categoryIds: [ctx.food] });
        const ownerTx = await createExpense({
          accountId: ctx.accountId,
          categoryId: ctx.food,
        });
        const recipient = await helpers.provisionSecondUserWithBaseCurrency();
        await helpers.shareTrackerWith({ trackerId, recipient, permission });

        const res = await syncAfterCooldown({
          id: trackerId,
          cookies: recipient.cookies,
        });

        expect(res.statusCode).toBe(200);
        expect(await linkedIds({ trackerId })).toEqual([ownerTx]);
      },
    );
  });

  describe('Duplicating', () => {
    it('copies the rule set and the copy links matches', async () => {
      const ctx = await setup();
      const foodTx = await createExpense({
        accountId: ctx.accountId,
        categoryId: ctx.food,
      });
      const tagged = await createExpense({
        accountId: ctx.accountId,
        categoryId: ctx.other,
        tagIds: [ctx.trip],
      });
      const trackerId = await createRuleTracker({
        categoryIds: [ctx.food],
        tagIds: [ctx.trip],
        rulesCleanup: false,
      });

      const copy = await helpers.duplicateTracker({ id: trackerId, raw: true });
      const copyId = copy.id as RecordId;
      const fetched = (await helpers.getTrackerById({
        id: copyId,
        raw: true,
      }))!;

      expect(fetched.rulesEnabled).toBe(true);
      expect(fetched.rulesCleanup).toBe(false);
      expect(fetched.categories!.map((c) => c.id as RecordId)).toEqual([ctx.food]);
      expect(fetched.tags!.map((t) => t.id as RecordId)).toEqual([ctx.trip]);
      await syncAfterCooldownOk({ id: copyId });
      expect(await linkedIds({ trackerId: copyId })).toEqual(sorted([foodTx, tagged]));
    });

    it('a transaction rejected on the original is not rejected on the copy', async () => {
      const ctx = await setup();
      const txId = await createExpense({
        accountId: ctx.accountId,
        categoryId: ctx.food,
      });
      const trackerId = await createRuleTracker({ categoryIds: [ctx.food] });
      await helpers.removeTransactionsFromTracker({
        id: trackerId,
        payload: { transactionIds: [txId] },
        raw: true,
      });

      const copy = await helpers.duplicateTracker({ id: trackerId, raw: true });
      await syncAfterCooldownOk({ id: copy.id as RecordId });

      expect(await linkedIds({ trackerId: copy.id as RecordId })).toEqual([txId]);
      expect(await linkedIds({ trackerId })).toEqual([]);
    });
  });

  describe('Without rules', () => {
    it('creating a tracker with a date range links nothing on its own', async () => {
      const ctx = await setup();
      await createExpense({
        accountId: ctx.accountId,
        categoryId: ctx.food,
        time: '2026-03-15T12:00:00.000Z',
      });

      const tracker = await helpers.createTracker({
        name: 'Plain',
        startDate: '2026-03-01T00:00:00.000Z',
        endDate: '2026-03-31T23:59:59.999Z',
        raw: true,
      });

      expect(tracker.rulesEnabled).toBe(false);
      expect(await linkedIds({ trackerId: tracker.id as RecordId })).toEqual([]);
    });
  });

  describe('Validation', () => {
    it('rejects creating with rules on and no category or tag', async () => {
      const res = await helpers.createTracker({
        name: 'Empty rules',
        rulesEnabled: true,
      });
      expectClientError(res);
      expect(await helpers.getTrackers({ raw: true })).toEqual([]);
    });

    it('rejects turning rules on for a tracker without categories or tags', async () => {
      const tracker = await helpers.createTracker({ name: 'Plain', raw: true });

      const res = await helpers.editTracker({
        id: tracker.id as RecordId,
        params: { rulesEnabled: true },
        raw: false,
      });

      expectClientError(res);
      expect(
        (await helpers.getTrackerById({
          id: tracker.id as RecordId,
          raw: true,
        }))!.rulesEnabled,
      ).toBe(false);
    });

    it('rejects clearing every category and tag while rules stay on', async () => {
      const ctx = await setup();
      const trackerId = await createRuleTracker({
        categoryIds: [ctx.food],
        tagIds: [ctx.trip],
      });

      const res = await helpers.editTracker({
        id: trackerId,
        params: { categoryIds: [], tagIds: [] },
        raw: false,
      });

      expectClientError(res);
      const tracker = (await helpers.getTrackerById({
        id: trackerId,
        raw: true,
      }))!;
      expect(tracker.categories!.map((c) => c.id as RecordId)).toEqual([ctx.food]);
    });

    it("rejects another user's tag as a rule tag", async () => {
      const other = await helpers.provisionSecondUserWithBaseCurrency();
      const foreignTag = await helpers.asUser({
        cookies: other.cookies,
        fn: () =>
          helpers.createTag({
            payload: helpers.buildTagPayload({ name: 'Theirs' }),
            raw: true,
          }),
      });

      const res = await helpers.createTracker({
        name: 'Foreign',
        rulesEnabled: true,
        tagIds: [foreignTag.id as RecordId],
      });

      expectClientError(res);
    });

    it("rejects another user's tag on edit", async () => {
      const ctx = await setup();
      const trackerId = await createRuleTracker({ categoryIds: [ctx.food] });
      const other = await helpers.provisionSecondUserWithBaseCurrency();
      const foreignTag = await helpers.asUser({
        cookies: other.cookies,
        fn: () =>
          helpers.createTag({
            payload: helpers.buildTagPayload({ name: 'Theirs' }),
            raw: true,
          }),
      });

      const res = await helpers.editTracker({
        id: trackerId,
        params: { tagIds: [foreignTag.id as RecordId] },
        raw: false,
      });

      expectClientError(res);
    });

    it("rejects another user's category as a rule category", async () => {
      const other = await helpers.provisionSecondUserWithBaseCurrency();
      const foreignCategory = await helpers.asUser({
        cookies: other.cookies,
        fn: () =>
          helpers.addCustomCategory({
            name: 'Theirs',
            color: '#123456',
            raw: true,
          }),
      });

      const res = await helpers.createTracker({
        name: 'Foreign',
        rulesEnabled: true,
        categoryIds: [foreignCategory.id as RecordId],
      });

      expectClientError(res);
    });

    it('rejects an unknown category id', async () => {
      const res = await helpers.createTracker({
        name: 'Unknown',
        rulesEnabled: true,
        categoryIds: [NONEXISTENT_ID],
      });
      expectClientError(res);
    });
  });
});
