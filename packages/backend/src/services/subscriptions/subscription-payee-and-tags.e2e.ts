import { SUBSCRIPTION_FREQUENCIES, SUBSCRIPTION_PERIOD_STATUSES, TRANSACTION_TYPES } from '@bt/shared/types';
import { generateRandomRecordId } from '@common/lib/record-id-helpers';
import { describe, expect, it } from '@jest/globals';
import * as helpers from '@tests/helpers';
import { addMonths, format } from 'date-fns';

const createTag = ({ name }: { name: string }) => helpers.createTag({ payload: { name, color: '#123456' }, raw: true });

const createPayee = ({ name }: { name: string }) =>
  helpers.createPayee({ payload: helpers.buildPayeePayload({ name }), raw: true });

const tagIdsOfTransaction = async ({ transactionId }: { transactionId: string }) => {
  const list = await helpers.getTransactions({ raw: true });
  return (list.find((tx) => tx.id === transactionId)?.tags ?? []).map((tag) => tag.id).toSorted();
};

const payeeIdOfTransaction = async ({ transactionId }: { transactionId: string }) => {
  const tx = await helpers.getTransactionById({ id: transactionId, raw: true });
  return tx?.payeeId ?? null;
};

function futureDate({ monthsAhead, day }: { monthsAhead: number; day: number }): string {
  const d = addMonths(new Date(), monthsAhead);
  d.setDate(day);
  return format(d, 'yyyy-MM-dd');
}

describe('Subscription payee & tags', () => {
  describe('Create / update', () => {
    it('creates a subscription with payeeId and tagIds and returns them', async () => {
      const [payee, tagA, tagB] = await Promise.all([
        createPayee({ name: 'Netflix Inc' }),
        createTag({ name: 'Streaming' }),
        createTag({ name: 'Fun' }),
      ]);

      const sub = await helpers.createSubscription({
        name: 'Netflix',
        expectedAmount: 15.99,
        expectedCurrencyCode: global.BASE_CURRENCY.code,
        frequency: SUBSCRIPTION_FREQUENCIES.monthly,
        startDate: '2025-01-01',
        payeeId: payee.id,
        tagIds: [tagA.id, tagB.id],
        raw: true,
      });

      expect(sub.payeeId).toBe(payee.id);
      expect(sub.tagIds.toSorted()).toEqual([tagA.id, tagB.id].toSorted());

      const detail = await helpers.getSubscriptionById({ id: sub.id, raw: true });
      expect(detail.payeeId).toBe(payee.id);
      expect(detail.tagIds.toSorted()).toEqual([tagA.id, tagB.id].toSorted());

      const list = await helpers.getSubscriptions({ raw: true });
      const listed = list.find((item) => item.id === sub.id);
      expect(listed?.payeeId).toBe(payee.id);
      expect((listed?.tagIds ?? []).toSorted()).toEqual([tagA.id, tagB.id].toSorted());
    });

    it('replaces then clears the tag set on update without restamping linked transactions', async () => {
      const [account, payee, tagA, tagB] = await Promise.all([
        helpers.createAccount({ raw: true }),
        createPayee({ name: 'Spotify AB' }),
        createTag({ name: 'Old' }),
        createTag({ name: 'New' }),
      ]);

      const sub = await helpers.createSubscription({
        name: 'Spotify',
        expectedAmount: 9.99,
        expectedCurrencyCode: global.BASE_CURRENCY.code,
        frequency: SUBSCRIPTION_FREQUENCIES.monthly,
        startDate: '2025-01-01',
        payeeId: payee.id,
        tagIds: [tagA.id],
        raw: true,
      });

      const [tx] = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account.id,
          amount: 999,
          transactionType: TRANSACTION_TYPES.expense,
        }),
        raw: true,
      });
      await helpers.linkTransactionsToSubscription({ id: sub.id, transactionIds: [tx.id], raw: true });

      const updated = await helpers.updateSubscription({ id: sub.id, tagIds: [tagB.id], raw: true });
      expect(updated.tagIds).toEqual([tagB.id]);

      const afterReplace = await helpers.getSubscriptionById({ id: sub.id, raw: true });
      expect(afterReplace.tagIds).toEqual([tagB.id]);
      expect(await tagIdsOfTransaction({ transactionId: tx.id })).toEqual([tagA.id]);

      await helpers.updateSubscription({ id: sub.id, tagIds: [], raw: true });

      const afterClear = await helpers.getSubscriptionById({ id: sub.id, raw: true });
      expect(afterClear.tagIds).toEqual([]);
      expect(await tagIdsOfTransaction({ transactionId: tx.id })).toEqual([tagA.id]);
    }, 60_000);

    it('rejects a payeeId and tagIds that do not belong to the user', async () => {
      const bogusPayee = await helpers.createSubscription({
        name: 'Bogus payee',
        expectedAmount: 5,
        expectedCurrencyCode: global.BASE_CURRENCY.code,
        frequency: SUBSCRIPTION_FREQUENCIES.monthly,
        startDate: '2025-01-01',
        payeeId: generateRandomRecordId(),
      });
      expect(bogusPayee.statusCode).toBe(404);

      const tag = await createTag({ name: 'Mine' });
      const bogusTags = await helpers.createSubscription({
        name: 'Bogus tags',
        expectedAmount: 5,
        expectedCurrencyCode: global.BASE_CURRENCY.code,
        frequency: SUBSCRIPTION_FREQUENCIES.monthly,
        startDate: '2025-01-01',
        tagIds: [tag.id, generateRandomRecordId()],
      });
      expect(bogusTags.statusCode).toBe(422);
    });
  });

  describe('Stamping on auto-match', () => {
    it('stamps the payee and tags onto a rule-matched transaction', async () => {
      const [account, payee, tag] = await Promise.all([
        helpers.createAccount({ raw: true }),
        createPayee({ name: 'Netflix Inc' }),
        createTag({ name: 'Streaming' }),
      ]);

      await helpers.createSubscription({
        name: 'Netflix',
        expectedAmount: 15.99,
        expectedCurrencyCode: global.BASE_CURRENCY.code,
        frequency: SUBSCRIPTION_FREQUENCIES.monthly,
        startDate: '2025-01-01',
        payeeId: payee.id,
        tagIds: [tag.id],
        matchingRules: {
          rules: [{ field: 'note', operator: 'contains_any', value: ['netflix'] }],
        },
        raw: true,
      });

      const [tx] = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account.id,
          amount: 1599,
          note: 'Netflix monthly payment',
          transactionType: TRANSACTION_TYPES.expense,
        }),
        raw: true,
      });

      expect(await payeeIdOfTransaction({ transactionId: tx.id })).toBe(payee.id);
      expect(await tagIdsOfTransaction({ transactionId: tx.id })).toEqual([tag.id]);
    });

    it('keeps a payee the transaction already carries and still merges the tags', async () => {
      const [account, subPayee, txPayee, tag] = await Promise.all([
        helpers.createAccount({ raw: true }),
        createPayee({ name: 'Netflix Inc' }),
        createPayee({ name: 'Some Other Shop' }),
        createTag({ name: 'Streaming' }),
      ]);

      await helpers.createSubscription({
        name: 'Netflix',
        expectedAmount: 15.99,
        expectedCurrencyCode: global.BASE_CURRENCY.code,
        frequency: SUBSCRIPTION_FREQUENCIES.monthly,
        startDate: '2025-01-01',
        payeeId: subPayee.id,
        tagIds: [tag.id],
        matchingRules: {
          rules: [{ field: 'note', operator: 'contains_any', value: ['netflix'] }],
        },
        raw: true,
      });

      const [tx] = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account.id,
          amount: 1599,
          note: 'Netflix monthly payment',
          transactionType: TRANSACTION_TYPES.expense,
          payeeId: txPayee.id,
        }),
        raw: true,
      });

      expect(await payeeIdOfTransaction({ transactionId: tx.id })).toBe(txPayee.id);
      expect(await tagIdsOfTransaction({ transactionId: tx.id })).toEqual([tag.id]);
    });

    it('leaves a cleared-payee transaction unstamped and still merges the tags', async () => {
      const [account, subPayee, txPayee, tag] = await Promise.all([
        helpers.createAccount({ raw: true }),
        createPayee({ name: 'Netflix Inc' }),
        createPayee({ name: 'Some Other Shop' }),
        createTag({ name: 'Streaming' }),
      ]);

      await helpers.createSubscription({
        name: 'Netflix',
        expectedAmount: 15.99,
        expectedCurrencyCode: global.BASE_CURRENCY.code,
        frequency: SUBSCRIPTION_FREQUENCIES.monthly,
        startDate: '2025-01-01',
        payeeId: subPayee.id,
        tagIds: [tag.id],
        matchingRules: {
          rules: [{ field: 'note', operator: 'contains_any', value: ['netflix'] }],
        },
        raw: true,
      });

      // A transaction created without a note can't match, so the payee can be
      // set and cleared (leaving payeeLocked=true) before the match runs.
      const [tx] = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account.id,
          amount: 1599,
          transactionType: TRANSACTION_TYPES.expense,
        }),
        raw: true,
      });

      await helpers.bulkUpdateTransactions({
        payload: { transactionIds: [tx.id], payeeId: txPayee.id },
        raw: true,
      });
      await helpers.bulkUpdateTransactions({
        payload: { transactionIds: [tx.id], payeeId: null },
        raw: true,
      });

      const beforeLink = await helpers.getTransactionById({ id: tx.id, raw: true });
      expect(beforeLink?.payeeId).toBeNull();
      expect(beforeLink?.payeeLocked).toBe(true);

      const sub = (await helpers.getSubscriptions({ raw: true })).find((item) => item.name === 'Netflix')!;
      await helpers.linkTransactionsToSubscription({ id: sub.id, transactionIds: [tx.id], raw: true });

      // payeeLocked means the user cleared the payee on purpose, so the subscription defers.
      expect(await payeeIdOfTransaction({ transactionId: tx.id })).toBeNull();
      expect(await tagIdsOfTransaction({ transactionId: tx.id })).toEqual([tag.id]);
    });

    it('leaves an unmatched transaction untouched', async () => {
      const [account, payee, tag] = await Promise.all([
        helpers.createAccount({ raw: true }),
        createPayee({ name: 'Netflix Inc' }),
        createTag({ name: 'Streaming' }),
      ]);

      await helpers.createSubscription({
        name: 'Netflix',
        expectedAmount: 15.99,
        expectedCurrencyCode: global.BASE_CURRENCY.code,
        frequency: SUBSCRIPTION_FREQUENCIES.monthly,
        startDate: '2025-01-01',
        payeeId: payee.id,
        tagIds: [tag.id],
        matchingRules: {
          rules: [{ field: 'note', operator: 'contains_any', value: ['netflix'] }],
        },
        raw: true,
      });

      const [tx] = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account.id,
          amount: 1599,
          note: 'Spotify premium',
          transactionType: TRANSACTION_TYPES.expense,
        }),
        raw: true,
      });

      expect(await payeeIdOfTransaction({ transactionId: tx.id })).toBeNull();
      expect(await tagIdsOfTransaction({ transactionId: tx.id })).toEqual([]);
    });
  });

  describe('Stamping on manual link', () => {
    it('stamps the payee and tags onto a manually linked transaction', async () => {
      const [account, payee, tag] = await Promise.all([
        helpers.createAccount({ raw: true }),
        createPayee({ name: 'Gym Ltd' }),
        createTag({ name: 'Health' }),
      ]);

      const sub = await helpers.createSubscription({
        name: 'Gym',
        expectedAmount: 30,
        expectedCurrencyCode: global.BASE_CURRENCY.code,
        frequency: SUBSCRIPTION_FREQUENCIES.monthly,
        startDate: '2025-01-01',
        payeeId: payee.id,
        tagIds: [tag.id],
        raw: true,
      });

      const [tx] = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account.id,
          amount: 3000,
          transactionType: TRANSACTION_TYPES.expense,
        }),
        raw: true,
      });

      await helpers.linkTransactionsToSubscription({ id: sub.id, transactionIds: [tx.id], raw: true });

      expect(await payeeIdOfTransaction({ transactionId: tx.id })).toBe(payee.id);
      expect(await tagIdsOfTransaction({ transactionId: tx.id })).toEqual([tag.id]);
    });

    it('keeps the transaction payee and merges tags additively on manual link', async () => {
      const [account, subPayee, txPayee, subTag, txTag] = await Promise.all([
        helpers.createAccount({ raw: true }),
        createPayee({ name: 'Gym Ltd' }),
        createPayee({ name: 'Corner Shop' }),
        createTag({ name: 'Health' }),
        createTag({ name: 'Manual' }),
      ]);

      const sub = await helpers.createSubscription({
        name: 'Gym',
        expectedAmount: 30,
        expectedCurrencyCode: global.BASE_CURRENCY.code,
        frequency: SUBSCRIPTION_FREQUENCIES.monthly,
        startDate: '2025-01-01',
        payeeId: subPayee.id,
        tagIds: [subTag.id],
        raw: true,
      });

      const [tx] = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account.id,
          amount: 3000,
          transactionType: TRANSACTION_TYPES.expense,
          payeeId: txPayee.id,
          tagIds: [txTag.id],
        }),
        raw: true,
      });

      await helpers.linkTransactionsToSubscription({ id: sub.id, transactionIds: [tx.id], raw: true });

      expect(await payeeIdOfTransaction({ transactionId: tx.id })).toBe(txPayee.id);
      expect(await tagIdsOfTransaction({ transactionId: tx.id })).toEqual([subTag.id, txTag.id].toSorted());
    });

    it('is idempotent across unlink and re-link', async () => {
      const [account, payee, tag] = await Promise.all([
        helpers.createAccount({ raw: true }),
        createPayee({ name: 'Gym Ltd' }),
        createTag({ name: 'Health' }),
      ]);

      const sub = await helpers.createSubscription({
        name: 'Gym',
        expectedAmount: 30,
        expectedCurrencyCode: global.BASE_CURRENCY.code,
        frequency: SUBSCRIPTION_FREQUENCIES.monthly,
        startDate: '2025-01-01',
        payeeId: payee.id,
        tagIds: [tag.id],
        raw: true,
      });

      const [tx] = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account.id,
          amount: 3000,
          transactionType: TRANSACTION_TYPES.expense,
        }),
        raw: true,
      });

      await helpers.linkTransactionsToSubscription({ id: sub.id, transactionIds: [tx.id], raw: true });
      await helpers.unlinkTransactionsFromSubscription({ id: sub.id, transactionIds: [tx.id], raw: true });
      const reLink = await helpers.linkTransactionsToSubscription({
        id: sub.id,
        transactionIds: [tx.id],
        raw: true,
      });

      expect(reLink.linked).toBe(1);
      expect(await payeeIdOfTransaction({ transactionId: tx.id })).toBe(payee.id);
      expect(await tagIdsOfTransaction({ transactionId: tx.id })).toEqual([tag.id]);
    });
  });

  describe('Payee merge', () => {
    it('repoints the subscription rule at the merge target', async () => {
      const [source, target] = await Promise.all([
        createPayee({ name: 'Netflix Old' }),
        createPayee({ name: 'Netflix' }),
      ]);

      const sub = await helpers.createSubscription({
        name: 'Netflix',
        expectedAmount: 15.99,
        expectedCurrencyCode: global.BASE_CURRENCY.code,
        frequency: SUBSCRIPTION_FREQUENCIES.monthly,
        startDate: '2025-01-01',
        payeeId: source.id,
        raw: true,
      });

      await helpers.mergePayees({ sourceId: source.id, targetId: target.id, raw: true });

      const detail = await helpers.getSubscriptionById({ id: sub.id, raw: true });
      expect(detail.payeeId).toBe(target.id);
    });
  });

  describe('Stamping on mark-period-paid', () => {
    it('carries the payee and tags onto the transaction it creates', async () => {
      const [account, payee, tag] = await Promise.all([
        helpers.createAccount({ raw: true }),
        createPayee({ name: 'Electric Co' }),
        createTag({ name: 'Utilities' }),
      ]);

      const sub = await helpers.createSubscription({
        name: 'Electricity',
        frequency: SUBSCRIPTION_FREQUENCIES.monthly,
        startDate: futureDate({ monthsAhead: 1, day: 1 }),
        dueDate: futureDate({ monthsAhead: 1, day: 1 }),
        accountId: account.id,
        categoryId: global.DEFAULT_CATEGORY_ID,
        expectedAmount: 20,
        expectedCurrencyCode: global.BASE_CURRENCY.code,
        payeeId: payee.id,
        tagIds: [tag.id],
        raw: true,
      });

      const detail = await helpers.getSubscriptionById({ id: sub.id, raw: true });
      const upcoming = detail.periods.find((p) => p.status === SUBSCRIPTION_PERIOD_STATUSES.upcoming);
      expect(upcoming).toBeDefined();

      const period = await helpers.markSubscriptionPeriodPaid({
        id: sub.id,
        periodId: upcoming!.id,
        createTransaction: true,
        raw: true,
      });

      expect(period.transactionId).toBeTruthy();
      expect(await payeeIdOfTransaction({ transactionId: period.transactionId! })).toBe(payee.id);
      expect(await tagIdsOfTransaction({ transactionId: period.transactionId! })).toEqual([tag.id]);
    });
  });
});
