import { RECONCILIATION_MERGE_MAX } from '@bt/shared/const/reconciliation';
import {
  ACCOUNT_TYPES,
  BANK_PROVIDER_TYPE,
  RecordId,
  SUBSCRIPTION_FREQUENCIES,
  SUBSCRIPTION_PERIOD_STATUSES,
  TRANSACTION_TYPES,
  TransactionModel,
} from '@bt/shared/types';
import { NONEXISTENT_ID } from '@common/lib/record-id-helpers';
import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import * as helpers from '@tests/helpers';
import {
  FixedTransaction,
  MOCK_IDENTIFICATION_HASH_1,
  MOCK_IDENTIFICATION_HASH_2,
} from '@tests/mocks/enablebanking/data';
import { format, subDays } from 'date-fns';

const daysAgo = ({ days }: { days: number }) => format(subDays(new Date(), days), 'yyyy-MM-dd');

const booked = ({ ref, amount, days = 3 }: { ref: string; amount: string; days?: number }): FixedTransaction => ({
  entryReference: ref,
  amount,
  currency: 'EUR',
  isExpense: true,
  bookingDate: daysAgo({ days }),
  counterpartyIban: null,
});

const pending = ({ amount, days }: { amount: string; days: number }): FixedTransaction => ({
  amount,
  currency: 'EUR',
  isExpense: true,
  transactionDate: daysAgo({ days }),
  counterpartyIban: null,
  status: 'PDNG',
});

const STUCK_FIXTURES = [
  pending({ amount: '12.00', days: 20 }),
  booked({ ref: 'booked-copy', amount: '12.50', days: 18 }),
  pending({ amount: '30.00', days: 100 }),
  pending({ amount: '7.00', days: 2 }),
];

const dateFrom = () => helpers.enablebanking.lastTransactionsQuery()!.dateFrom!.slice(0, 10);

const listIds = async ({ accountId }: { accountId: RecordId }) =>
  (await helpers.getTransactions({ accountIds: [accountId], raw: true })).map((tx) => tx.id).toSorted();

const liveIdsWithAmount = async ({ accountId, amount }: { accountId: RecordId; amount: number }) =>
  ((await helpers.getTransactions({ accountIds: [accountId], raw: true })) as unknown as TransactionModel[])
    .filter((tx) => tx.amount === amount)
    .map((tx) => tx.id);

const resync = ({ connectionId, accountId }: { connectionId: string; accountId: RecordId }) =>
  helpers.bankDataProviders.syncTransactionsForAccount({ connectionId, accountId, raw: true });

async function setupEnableBanking({
  transactions,
  accountExternalIds = [MOCK_IDENTIFICATION_HASH_1],
}: {
  transactions: FixedTransaction[];
  accountExternalIds?: string[];
}) {
  helpers.enablebanking.setFixedTransactions(transactions);

  const { connectionId } = await helpers.bankDataProviders.connectProvider({
    providerType: BANK_PROVIDER_TYPE.ENABLE_BANKING,
    credentials: helpers.enablebanking.mockCredentials(),
    raw: true,
  });
  const state = await helpers.enablebanking.getConnectionState(connectionId);
  await helpers.makeRequest({
    method: 'post',
    url: '/bank-data-providers/enablebanking/oauth-callback',
    payload: { connectionId, code: helpers.enablebanking.mockAuthCode, state },
  });
  const { syncedAccounts } = await helpers.bankDataProviders.connectSelectedAccounts({
    connectionId,
    accountExternalIds,
    raw: true,
  });
  const accountId = syncedAccounts[0]!.id as RecordId;
  const txs = (await helpers.getTransactions({ accountIds: [accountId], raw: true })) as unknown as TransactionModel[];
  const byAmount = ({ amount }: { amount: number }) => txs.find((tx) => tx.amount === amount)!;

  return { connectionId, accountId, accountIds: syncedAccounts.map((a) => a.id as RecordId), byAmount };
}

const budgetTxIds = async ({ budgetId }: { budgetId: RecordId }) =>
  (await helpers.getTransactions({ budgetIds: [budgetId], raw: true })).map((tx) => tx.id);

const groupTxIds = async ({ groupId }: { groupId: RecordId }) =>
  ((await helpers.getTransactionGroupById({ id: groupId, raw: true })).transactions ?? [])
    .map((tx) => tx.id)
    .toSorted();

const subscriptionTxIds = async ({ subscriptionId }: { subscriptionId: RecordId }) =>
  (await helpers.getSubscriptionById({ id: subscriptionId, raw: true })).transactions.map((tx) => tx.id);

const createBudget = async ({ name, transactionIds }: { name: string; transactionIds: RecordId[] }) => {
  const budget = await helpers.createCustomBudget({ name, autoInclude: false, raw: true });
  await helpers.addTransactionToCustomBudget({ id: budget.id, payload: { transactionIds } });
  return budget.id as RecordId;
};

const createGroup = async ({ transactionIds }: { transactionIds: RecordId[] }) =>
  (await helpers.createTransactionGroup({ payload: { name: 'Group', transactionIds }, raw: true })).id as RecordId;

const createSubscription = async ({
  name,
  transactionIds,
  dueDate,
}: {
  name: string;
  transactionIds: RecordId[];
  dueDate?: string;
}) => {
  const subscription = await helpers.createSubscription({
    name,
    frequency: SUBSCRIPTION_FREQUENCIES.monthly,
    startDate: daysAgo({ days: 60 }),
    dueDate,
    expectedAmount: 10,
    expectedCurrencyCode: 'EUR',
    raw: true,
  });
  if (transactionIds.length) {
    const linked = await helpers.linkTransactionsToSubscription({ id: subscription.id, transactionIds });
    expect(linked.statusCode).toBe(200);
  }
  return subscription.id as RecordId;
};

const payNextPeriod = async ({
  subscriptionId,
  transactionId,
}: {
  subscriptionId: RecordId;
  transactionId: RecordId;
}) => {
  const { periods } = await helpers.getSubscriptionPeriods({ id: subscriptionId, raw: true });
  const period = periods.find(
    (p) => p.status !== SUBSCRIPTION_PERIOD_STATUSES.paid && p.status !== SUBSCRIPTION_PERIOD_STATUSES.skipped,
  )!;
  await helpers.markSubscriptionPeriodPaid({ id: subscriptionId, periodId: period.id, transactionId, raw: true });
  return period.id;
};

const periodTxId = async ({ subscriptionId, periodId }: { subscriptionId: RecordId; periodId: string }) =>
  (await helpers.getSubscriptionPeriods({ id: subscriptionId, raw: true })).periods.find((p) => p.id === periodId)!
    .transactionId;

const historyEvents = async () =>
  (await helpers.getReconciliationHistory({ raw: true })).map((event) => ({
    type: event.type,
    survivorId: event.survivor?.id ?? null,
    ids: event.transactions.map((tx) => tx.id).toSorted(),
  }));

describe('Transactions reconciliation', () => {
  beforeEach(async () => {
    helpers.enablebanking.resetSessionCounter();
    await helpers.patchUserSettings({ patch: { importPendingBankTransactions: true }, raw: true });
  });

  afterEach(() => {
    helpers.enablebanking.resetTransactionConfig();
  });

  describe('POST /transactions/reconciliation/remove', () => {
    it('hides removed rows from the list and Enable Banking re-sync does not re-import them', async () => {
      const fixed = [booked({ ref: 'r1', amount: '10.00' }), booked({ ref: 'r2', amount: '20.00' })];
      const { connectionId, accountId, byAmount } = await setupEnableBanking({ transactions: fixed });
      const removed = byAmount({ amount: 10 });

      const result = await helpers.reconciliationRemove({ transactionIds: [removed.id], raw: true });

      expect(result.removedIds).toEqual([removed.id]);
      expect(await listIds({ accountId })).toEqual([byAmount({ amount: 20 }).id]);

      await resync({ connectionId, accountId });

      expect(await listIds({ accountId })).toEqual([byAmount({ amount: 20 }).id]);
    });

    it('does not re-import a removed Monobank row on the next sync', async () => {
      const payloads = [
        { id: 'mono-reconcile-1', amount: -1000, time: subDays(new Date(), 2) },
        { id: 'mono-reconcile-2', amount: -2000, time: subDays(new Date(), 1) },
      ];
      const { transactions } = await helpers.monobank.mockTransactions({ transactions: payloads });
      const removedIds = transactions.filter((tx) => tx.originalId === 'mono-reconcile-1').map((tx) => tx.id);
      const keptCount = transactions.filter((tx) => tx.originalId === 'mono-reconcile-2').length;

      await helpers.reconciliationRemove({ transactionIds: removedIds, raw: true });
      await helpers.monobank.mockTransactions({ transactions: payloads });

      const after = await helpers.monobank.getTransactions();
      expect(after.filter((tx) => tx.originalId === 'mono-reconcile-1')).toEqual([]);
      expect(after.filter((tx) => tx.originalId === 'mono-reconcile-2')).toHaveLength(keptCount);
    });

    it('detaches budget, group and subscription links, and restore does not bring them back', async () => {
      const fixed = [booked({ ref: 'r1', amount: '10.00' }), booked({ ref: 'r2', amount: '20.00' })];
      const { byAmount } = await setupEnableBanking({ transactions: fixed });
      const target = byAmount({ amount: 10 });

      const budgetId = await createBudget({ name: 'Trip', transactionIds: [target.id] });
      const groupId = await createGroup({ transactionIds: [target.id, byAmount({ amount: 20 }).id] });
      const subscriptionId = await createSubscription({ name: 'Gym', transactionIds: [target.id] });

      await helpers.reconciliationRemove({ transactionIds: [target.id], raw: true });

      expect((await helpers.getTransactionGroupById({ id: groupId })).statusCode).toBe(404);
      expect(await subscriptionTxIds({ subscriptionId })).toEqual([]);

      await helpers.reconciliationRestore({ transactionIds: [target.id], raw: true });

      expect(await budgetTxIds({ budgetId })).toEqual([]);
      expect(await subscriptionTxIds({ subscriptionId })).toEqual([]);
    });

    it('rejects system, planned, transfer and refund-linked rows', async () => {
      const fixed = [
        booked({ ref: 'r1', amount: '30.00' }),
        booked({ ref: 'r2', amount: '40.00' }),
        { ...booked({ ref: 'r3', amount: '5.00' }), isExpense: false },
      ];
      const { accountId, byAmount } = await setupEnableBanking({ transactions: fixed });

      const systemAccount = await helpers.createAccount({ raw: true });
      const [systemTx] = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({ accountId: systemAccount.id }),
        raw: true,
      });
      const [systemIncome] = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: systemAccount.id,
          amount: 30,
          transactionType: TRANSACTION_TYPES.income,
        }),
        raw: true,
      });
      const [planned] = await helpers.createPlannedTransaction({
        payload: { accountId, amount: 50, time: new Date().toISOString() },
        raw: true,
      });
      await helpers.linkTransactions({ payload: { ids: [[byAmount({ amount: 30 }).id, systemIncome.id]] }, raw: true });
      await helpers.createSingleRefund({
        originalTxId: byAmount({ amount: 40 }).id,
        refundTxId: byAmount({ amount: 5 }).id,
      });

      for (const id of [
        systemTx.id,
        planned.id,
        byAmount({ amount: 30 }).id,
        byAmount({ amount: 40 }).id,
        byAmount({ amount: 5 }).id,
      ]) {
        const res = await helpers.reconciliationRemove({ transactionIds: [id as RecordId] });
        expect(res.statusCode).toBe(422);
      }
    });

    it('validates the payload and unknown ids', async () => {
      expect((await helpers.reconciliationRemove({ transactionIds: [] })).statusCode).toBe(422);
      expect((await helpers.reconciliationRemove({ transactionIds: [NONEXISTENT_ID] })).statusCode).toBe(404);
    });

    it('rejects a row linked to a portfolio', async () => {
      const { byAmount } = await setupEnableBanking({ transactions: [booked({ ref: 'r1', amount: '10.00' })] });
      const portfolio = await helpers.createPortfolio({
        payload: helpers.buildPortfolioPayload({ name: 'Broker' }),
        raw: true,
      });
      const linked = await helpers.linkTransactionToPortfolio({
        transactionId: byAmount({ amount: 10 }).id,
        payload: { portfolioId: portfolio.id },
      });
      expect(linked.statusCode).toBe(200);

      expect((await helpers.reconciliationRemove({ transactionIds: [byAmount({ amount: 10 }).id] })).statusCode).toBe(
        422,
      );
    });

    it('clears the subscription period the removed row paid', async () => {
      const { byAmount } = await setupEnableBanking({ transactions: [booked({ ref: 'r1', amount: '10.00' })] });
      const removed = byAmount({ amount: 10 });
      const subscriptionId = await createSubscription({
        name: 'Gym',
        transactionIds: [],
        dueDate: daysAgo({ days: 60 }),
      });
      const periodId = await payNextPeriod({ subscriptionId, transactionId: removed.id });
      expect(await periodTxId({ subscriptionId, periodId })).toBe(removed.id);

      await helpers.reconciliationRemove({ transactionIds: [removed.id], raw: true });

      expect(await periodTxId({ subscriptionId, periodId })).toBeNull();
    });

    it('returns 404 for an already removed row and leaves history unchanged', async () => {
      const fixed = [booked({ ref: 'r1', amount: '10.00' }), booked({ ref: 'r2', amount: '11.00' })];
      const { accountId, byAmount } = await setupEnableBanking({ transactions: fixed });
      const [removed, live] = [byAmount({ amount: 10 }), byAmount({ amount: 11 })];
      await helpers.reconciliationRemove({ transactionIds: [removed.id], raw: true });
      const historyBefore = await historyEvents();

      expect((await helpers.reconciliationRemove({ transactionIds: [removed.id] })).statusCode).toBe(404);
      expect(
        (await helpers.reconciliationMerge({ transactionIds: [live.id, removed.id], survivorId: live.id })).statusCode,
      ).toBe(404);
      expect(
        (await helpers.reconciliationMerge({ transactionIds: [live.id, removed.id], survivorId: removed.id }))
          .statusCode,
      ).toBe(404);

      expect(await historyEvents()).toEqual(historyBefore);
      expect(await listIds({ accountId })).toEqual([live.id]);
    });
  });

  describe('POST /transactions/reconciliation/merge', () => {
    it('keeps the survivor, removes the rest and records a merge in history', async () => {
      const fixed = [
        booked({ ref: 'r1', amount: '10.00' }),
        booked({ ref: 'r2', amount: '11.00' }),
        booked({ ref: 'r3', amount: '12.00' }),
      ];
      const { accountId, byAmount } = await setupEnableBanking({ transactions: fixed });
      const [survivor, a, b] = [byAmount({ amount: 10 }), byAmount({ amount: 11 }), byAmount({ amount: 12 })];

      const result = await helpers.reconciliationMerge({
        transactionIds: [survivor.id, a.id, b.id],
        survivorId: survivor.id,
        raw: true,
      });

      expect(result.removedIds.toSorted()).toEqual([a.id, b.id].toSorted());
      expect(await listIds({ accountId })).toEqual([survivor.id]);

      const history = await helpers.getReconciliationHistory({ raw: true });
      expect(history).toHaveLength(1);
      expect(history[0]!.type).toBe('merge');
      expect(history[0]!.survivor?.id).toBe(survivor.id);
      expect(history[0]!.transactions.map((tx) => tx.id).toSorted()).toEqual([a.id, b.id].toSorted());
    });

    it('moves links of removed rows onto a survivor that has none', async () => {
      const fixed = [
        booked({ ref: 'r1', amount: '10.00' }),
        booked({ ref: 'r2', amount: '11.00' }),
        booked({ ref: 'r3', amount: '12.00' }),
      ];
      const { byAmount } = await setupEnableBanking({ transactions: fixed });
      const [survivor, removed, other] = [byAmount({ amount: 10 }), byAmount({ amount: 11 }), byAmount({ amount: 12 })];

      const budgetId = await createBudget({ name: 'Trip', transactionIds: [removed.id] });
      const groupId = await createGroup({ transactionIds: [removed.id, other.id] });
      const subscriptionId = await createSubscription({ name: 'Gym', transactionIds: [removed.id] });

      await helpers.reconciliationMerge({
        transactionIds: [survivor.id, removed.id],
        survivorId: survivor.id,
        raw: true,
      });

      expect(await budgetTxIds({ budgetId })).toEqual([survivor.id]);
      expect(await groupTxIds({ groupId })).toEqual([survivor.id, other.id].toSorted());
      expect(await subscriptionTxIds({ subscriptionId })).toEqual([survivor.id]);
    });

    it('drops links the survivor already shares with the removed rows', async () => {
      const fixed = [
        booked({ ref: 'r1', amount: '10.00' }),
        booked({ ref: 'r2', amount: '11.00' }),
        booked({ ref: 'r3', amount: '12.00' }),
      ];
      const { byAmount } = await setupEnableBanking({ transactions: fixed });
      const [survivor, removed, other] = [byAmount({ amount: 10 }), byAmount({ amount: 11 }), byAmount({ amount: 12 })];

      const budgetId = await createBudget({ name: 'Trip', transactionIds: [survivor.id, removed.id] });
      const groupId = await createGroup({ transactionIds: [survivor.id, removed.id, other.id] });
      const subscriptionId = await createSubscription({ name: 'Gym', transactionIds: [survivor.id, removed.id] });

      await helpers.reconciliationMerge({
        transactionIds: [survivor.id, removed.id],
        survivorId: survivor.id,
        raw: true,
      });

      expect(await budgetTxIds({ budgetId })).toEqual([survivor.id]);
      expect(await groupTxIds({ groupId })).toEqual([survivor.id, other.id].toSorted());
      expect(await subscriptionTxIds({ subscriptionId })).toEqual([survivor.id]);
    });

    it('rejects merges whose links conflict', async () => {
      const fixed = Array.from({ length: 8 }, (_, i) => booked({ ref: `r${i + 1}`, amount: `${i + 1}0.00` }));
      const { accountId, byAmount } = await setupEnableBanking({ transactions: fixed });
      const t = ({ n }: { n: number }) => byAmount({ amount: n * 10 }).id;

      await createBudget({ name: 'B1', transactionIds: [t({ n: 1 })] });
      await createBudget({ name: 'B2', transactionIds: [t({ n: 2 })] });
      await createGroup({ transactionIds: [t({ n: 3 }), t({ n: 5 })] });
      await createGroup({ transactionIds: [t({ n: 4 }), t({ n: 6 })] });
      await createSubscription({ name: 'S1', transactionIds: [t({ n: 7 })] });
      await createSubscription({ name: 'S2', transactionIds: [t({ n: 8 })] });

      const cases: [RecordId[], RecordId][] = [
        [[t({ n: 1 }), t({ n: 2 })], t({ n: 1 })],
        [[t({ n: 3 }), t({ n: 4 })], t({ n: 3 })],
        [[t({ n: 1 }), t({ n: 5 }), t({ n: 6 })], t({ n: 1 })],
        [[t({ n: 7 }), t({ n: 8 })], t({ n: 7 })],
      ];
      for (const [transactionIds, survivorId] of cases) {
        expect((await helpers.reconciliationMerge({ transactionIds, survivorId })).statusCode).toBe(422);
      }

      expect(await listIds({ accountId })).toHaveLength(8);
    });

    it('adds the survivor to every budget of the removed rows', async () => {
      const fixed = [
        booked({ ref: 'r1', amount: '10.00' }),
        booked({ ref: 'r2', amount: '11.00' }),
        booked({ ref: 'r3', amount: '12.00' }),
      ];
      const { byAmount } = await setupEnableBanking({ transactions: fixed });
      const [survivor, a, b] = [byAmount({ amount: 10 }), byAmount({ amount: 11 }), byAmount({ amount: 12 })];
      const budgetA = await createBudget({ name: 'A', transactionIds: [a.id] });
      const budgetB = await createBudget({ name: 'B', transactionIds: [b.id] });

      await helpers.reconciliationMerge({
        transactionIds: [survivor.id, a.id, b.id],
        survivorId: survivor.id,
        raw: true,
      });

      expect(await budgetTxIds({ budgetId: budgetA })).toEqual([survivor.id]);
      expect(await budgetTxIds({ budgetId: budgetB })).toEqual([survivor.id]);
    });

    it('moves an active subscription link onto a survivor that was unlinked from that subscription', async () => {
      const fixed = [booked({ ref: 'r1', amount: '10.00' }), booked({ ref: 'r2', amount: '11.00' })];
      const { byAmount } = await setupEnableBanking({ transactions: fixed });
      const [survivor, removed] = [byAmount({ amount: 10 }), byAmount({ amount: 11 })];
      const subscriptionId = await createSubscription({ name: 'Gym', transactionIds: [survivor.id, removed.id] });
      await helpers.unlinkTransactionsFromSubscription({
        id: subscriptionId,
        transactionIds: [survivor.id],
        raw: true,
      });

      const res = await helpers.reconciliationMerge({
        transactionIds: [survivor.id, removed.id],
        survivorId: survivor.id,
      });

      expect(res.statusCode).toBe(200);
      expect(await subscriptionTxIds({ subscriptionId })).toEqual([survivor.id]);
    });

    it('moves the subscription period a removed row paid onto the survivor', async () => {
      const fixed = [booked({ ref: 'r1', amount: '10.00' }), booked({ ref: 'r2', amount: '11.00' })];
      const { byAmount } = await setupEnableBanking({ transactions: fixed });
      const [survivor, removed] = [byAmount({ amount: 10 }), byAmount({ amount: 11 })];
      const subscriptionId = await createSubscription({
        name: 'Gym',
        transactionIds: [],
        dueDate: daysAgo({ days: 60 }),
      });
      const periodId = await payNextPeriod({ subscriptionId, transactionId: removed.id });

      await helpers.reconciliationMerge({
        transactionIds: [survivor.id, removed.id],
        survivorId: survivor.id,
        raw: true,
      });

      expect(await periodTxId({ subscriptionId, periodId })).toBe(survivor.id);
    });

    it('rejects a merge when the survivor and a removed row pay different periods', async () => {
      const fixed = [booked({ ref: 'r1', amount: '10.00' }), booked({ ref: 'r2', amount: '11.00' })];
      const { byAmount } = await setupEnableBanking({ transactions: fixed });
      const [survivor, removed] = [byAmount({ amount: 10 }), byAmount({ amount: 11 })];
      const subscriptionId = await createSubscription({
        name: 'Gym',
        transactionIds: [],
        dueDate: daysAgo({ days: 60 }),
      });
      const survivorPeriodId = await payNextPeriod({ subscriptionId, transactionId: survivor.id });
      const removedPeriodId = await payNextPeriod({ subscriptionId, transactionId: removed.id });

      const res = await helpers.reconciliationMerge({
        transactionIds: [survivor.id, removed.id],
        survivorId: survivor.id,
      });

      expect(res.statusCode).toBe(422);
      expect(await periodTxId({ subscriptionId, periodId: survivorPeriodId })).toBe(survivor.id);
      expect(await periodTxId({ subscriptionId, periodId: removedPeriodId })).toBe(removed.id);
    });

    it('rejects a pending survivor when a removed row is settled', async () => {
      const { byAmount } = await setupEnableBanking({ transactions: STUCK_FIXTURES });
      const [pendingTx, bookedTx] = [byAmount({ amount: 12 }), byAmount({ amount: 12.5 })];
      const transactionIds = [pendingTx.id, bookedTx.id];

      expect((await helpers.reconciliationMerge({ transactionIds, survivorId: pendingTx.id })).statusCode).toBe(422);
      expect((await helpers.reconciliationMerge({ transactionIds, survivorId: bookedTx.id })).statusCode).toBe(200);
    });

    it('rejects an invalid selection', async () => {
      const overCap = RECONCILIATION_MERGE_MAX + 1;
      const fixed = Array.from({ length: overCap }, (_, i) => booked({ ref: `r${i + 1}`, amount: `${10 + i}.00` }));
      const { byAmount, accountIds } = await setupEnableBanking({
        transactions: fixed,
        accountExternalIds: [MOCK_IDENTIFICATION_HASH_1, MOCK_IDENTIFICATION_HASH_2],
      });
      const [a, b] = [byAmount({ amount: 10 }), byAmount({ amount: 11 })];
      const [otherAccountTx] = await helpers.getTransactions({ accountIds: [accountIds[1]!], raw: true });
      const [systemTx] = await helpers.createTransaction({ raw: true });

      const invalid: [RecordId[], RecordId, number][] = [
        [[a.id], a.id, 422],
        [[a.id, b.id], systemTx.id as RecordId, 422],
        [[a.id, systemTx.id as RecordId], a.id, 422],
        [[a.id, otherAccountTx!.id as RecordId], a.id, 422],
        [[a.id, NONEXISTENT_ID], a.id, 404],
        [Array.from({ length: overCap }, (_, i) => byAmount({ amount: 10 + i }).id), a.id, 422],
      ];
      for (const [transactionIds, survivorId, status] of invalid) {
        expect((await helpers.reconciliationMerge({ transactionIds, survivorId })).statusCode).toBe(status);
      }
    });
  });

  describe('POST /transactions/reconciliation/restore', () => {
    it('brings removed and merged rows back and clears them from history', async () => {
      const fixed = [
        booked({ ref: 'r1', amount: '10.00' }),
        booked({ ref: 'r2', amount: '11.00' }),
        booked({ ref: 'r3', amount: '12.00' }),
      ];
      const { accountId, byAmount } = await setupEnableBanking({ transactions: fixed });
      const [a, b, c] = [byAmount({ amount: 10 }), byAmount({ amount: 11 }), byAmount({ amount: 12 })];
      const balance = async () => (await helpers.getAccount({ id: accountId, raw: true })).currentBalance;
      const balanceBefore = await balance();

      await helpers.reconciliationRemove({ transactionIds: [a.id], raw: true });
      await helpers.reconciliationMerge({ transactionIds: [b.id, c.id], survivorId: b.id, raw: true });
      expect(await helpers.getReconciliationHistory({ raw: true })).toHaveLength(2);
      expect(await balance()).toEqual(balanceBefore);

      const result = await helpers.reconciliationRestore({ transactionIds: [a.id, c.id], raw: true });

      expect(result.restoredIds.toSorted()).toEqual([a.id, c.id].toSorted());
      expect(await listIds({ accountId })).toEqual([a.id, b.id, c.id].toSorted());
      expect(await helpers.getReconciliationHistory({ raw: true })).toEqual([]);
      expect(await balance()).toEqual(balanceBefore);
    });

    it('restores a removed row after its account is unlinked from the bank', async () => {
      const { accountId, byAmount } = await setupEnableBanking({
        transactions: [booked({ ref: 'r1', amount: '10.00' }), booked({ ref: 'r2', amount: '20.00' })],
      });
      const removed = byAmount({ amount: 10 });
      await helpers.reconciliationRemove({ transactionIds: [removed.id], raw: true });
      await helpers.unlinkAccountFromBankConnection({ id: accountId, raw: true });
      const balance = async () => (await helpers.getAccount({ id: accountId, raw: true })).currentBalance;
      const balanceBefore = await balance();

      expect((await helpers.reconciliationRestore({ transactionIds: [removed.id] })).statusCode).toBe(200);

      const restored = (
        (await helpers.getTransactions({ accountIds: [accountId], raw: true })) as unknown as TransactionModel[]
      ).find((tx) => tx.id === removed.id);
      expect(restored?.accountType).toBe(ACCOUNT_TYPES.system);
      expect(await helpers.getReconciliationHistory({ raw: true })).toEqual([]);
      expect(await balance()).toEqual(balanceBefore);
    });

    it('does not re-import a removed row when the unlinked account is linked to the bank again', async () => {
      const { entryReference: _entryReference, ...noRef } = booked({ ref: 'unused', amount: '10.00' });
      const { connectionId, accountId, byAmount } = await setupEnableBanking({
        transactions: [noRef, booked({ ref: 'r2', amount: '20.00' })],
      });
      const [removed, kept] = [byAmount({ amount: 10 }), byAmount({ amount: 20 })];
      await helpers.reconciliationRemove({ transactionIds: [removed.id], raw: true });
      await helpers.unlinkAccountFromBankConnection({ id: accountId, raw: true });

      const linked = await helpers.linkAccountToBankConnection({
        id: accountId,
        connectionId,
        externalAccountId: MOCK_IDENTIFICATION_HASH_1,
      });
      expect(linked.statusCode).toBe(200);
      await resync({ connectionId, accountId });

      expect(await listIds({ accountId })).toEqual([kept.id]);
      expect(await historyEvents()).toEqual([{ type: 'remove', survivorId: null, ids: [removed.id] }]);
    });

    it('restores a removed row with its payee merged and its category replaced while it was removed', async () => {
      const { byAmount } = await setupEnableBanking({ transactions: [booked({ ref: 'r1', amount: '10.00' })] });
      const removed = byAmount({ amount: 10 });
      const sourcePayee = await helpers.createPayee({ payload: { name: 'Old Payee' }, raw: true });
      const targetPayee = await helpers.createPayee({ payload: { name: 'New Payee' }, raw: true });
      const category = await helpers.addCustomCategory({ name: 'Old Category', color: '#FF0000', raw: true });
      const replacement = await helpers.addCustomCategory({ name: 'New Category', color: '#0000FF', raw: true });
      const updated = await helpers.updateTransaction({
        id: removed.id,
        payload: { payeeId: sourcePayee.id, categoryId: category.id },
      });
      expect(updated.statusCode).toBe(200);

      await helpers.reconciliationRemove({ transactionIds: [removed.id], raw: true });
      expect((await helpers.mergePayees({ sourceId: sourcePayee.id, targetId: targetPayee.id })).statusCode).toBe(200);
      const deleted = await helpers.deleteCustomCategory({
        categoryId: category.id,
        replaceWithCategoryId: replacement.id,
        raw: false,
      });
      expect(deleted.statusCode).toBe(200);
      await helpers.reconciliationRestore({ transactionIds: [removed.id], raw: true });

      const restored = await helpers.getTransactionById({ id: removed.id, raw: true });
      expect(restored!.payeeId).toBe(targetPayee.id);
      expect(restored!.categoryId).toBe(replacement.id);
    });

    it('restores a row removed before a base-currency change with ref values in the new base currency', async () => {
      const { byAmount } = await setupEnableBanking({ transactions: [booked({ ref: 'r1', amount: '10.00' })] });
      const removed = byAmount({ amount: 10 });
      expect(removed.refCurrencyCode).not.toBe('EUR');
      await helpers.reconciliationRemove({ transactionIds: [removed.id], raw: true });

      const status = await helpers.changeBaseCurrencyAndWait({ newCurrencyCode: 'EUR' });
      helpers.expectBaseCurrencyChangeCompleted(status);
      await helpers.reconciliationRestore({ transactionIds: [removed.id], raw: true });

      const restored = (await helpers.getTransactionById({ id: removed.id, raw: true }))!;
      expect(restored.refCurrencyCode).toBe('EUR');
      expect(restored.refAmount).toEqual(restored.amount);
    });

    it('rejects rows that are not removed and an empty payload', async () => {
      const { byAmount } = await setupEnableBanking({ transactions: [booked({ ref: 'r1', amount: '10.00' })] });

      expect((await helpers.reconciliationRestore({ transactionIds: [byAmount({ amount: 10 }).id] })).statusCode).toBe(
        404,
      );
      expect((await helpers.reconciliationRestore({ transactionIds: [] })).statusCode).toBe(422);
    });
  });

  describe('GET /transactions/reconciliation/history', () => {
    it('returns an empty list when nothing was removed', async () => {
      expect(await helpers.getReconciliationHistory({ raw: true })).toEqual([]);
    });

    it('records a plain removal', async () => {
      const { byAmount } = await setupEnableBanking({ transactions: [booked({ ref: 'r1', amount: '10.00' })] });
      await helpers.reconciliationRemove({ transactionIds: [byAmount({ amount: 10 }).id], raw: true });

      const [event] = await helpers.getReconciliationHistory({ raw: true });
      expect(event!.type).toBe('remove');
      expect(event!.survivor).toBeNull();
      expect(event!.transactions.map((tx) => tx.id)).toEqual([byAmount({ amount: 10 }).id]);
    });

    it('turns a merge into a restorable removal when the bank cancels the pending survivor', async () => {
      const survivorFixture = pending({ amount: '25.00', days: 4 });
      const mergedAwayFixture = pending({ amount: '9.00', days: 5 });
      const { connectionId, accountId, byAmount } = await setupEnableBanking({
        transactions: [survivorFixture, mergedAwayFixture],
      });
      const [survivor, removed] = [byAmount({ amount: 25 }), byAmount({ amount: 9 })];
      await helpers.reconciliationMerge({
        transactionIds: [survivor.id, removed.id],
        survivorId: survivor.id,
        raw: true,
      });

      helpers.enablebanking.setFixedTransactions([{ ...survivorFixture, status: 'CNCL' }, mergedAwayFixture]);
      await resync({ connectionId, accountId });

      expect(await listIds({ accountId })).toEqual([]);
      expect(await historyEvents()).toEqual([{ type: 'remove', survivorId: null, ids: [removed.id] }]);
      expect((await helpers.reconciliationRestore({ transactionIds: [removed.id] })).statusCode).toBe(200);
      expect(await listIds({ accountId })).toEqual([removed.id]);
    });

    it('keeps a removed pending row in history when the bank cancels it', async () => {
      const removedFixture = pending({ amount: '9.00', days: 5 });
      const { connectionId, accountId, byAmount } = await setupEnableBanking({ transactions: [removedFixture] });
      const removed = byAmount({ amount: 9 });
      await helpers.reconciliationRemove({ transactionIds: [removed.id], raw: true });

      helpers.enablebanking.setFixedTransactions([{ ...removedFixture, status: 'CNCL' }]);
      await resync({ connectionId, accountId });

      expect(await historyEvents()).toEqual([{ type: 'remove', survivorId: null, ids: [removed.id] }]);
      expect((await helpers.reconciliationRestore({ transactionIds: [removed.id] })).statusCode).toBe(200);
      expect(await listIds({ accountId })).toEqual([removed.id]);
    });

    it('does not record a normal delete, which stays permanent', async () => {
      const [tx] = await helpers.createTransaction({ raw: true });

      expect((await helpers.deleteTransaction({ id: tx.id })).statusCode).toBe(200);

      expect(await helpers.getReconciliationHistory({ raw: true })).toEqual([]);
      expect((await helpers.reconciliationRestore({ transactionIds: [tx.id as RecordId] })).statusCode).toBe(404);
    });
  });

  describe('cross-user isolation', () => {
    it("hides another user's rows from every reconciliation endpoint", async () => {
      const fixed = [
        booked({ ref: 'r1', amount: '10.00' }),
        booked({ ref: 'r2', amount: '11.00' }),
        booked({ ref: 'r3', amount: '12.00' }),
        pending({ amount: '30.00', days: 20 }),
      ];
      const { accountId, byAmount } = await setupEnableBanking({ transactions: fixed });
      const [removed, a, b, stuck] = [
        byAmount({ amount: 10 }),
        byAmount({ amount: 11 }),
        byAmount({ amount: 12 }),
        byAmount({ amount: 30 }),
      ];
      await helpers.reconciliationRemove({ transactionIds: [removed.id], raw: true });

      const userB = await helpers.signUpSecondUser();
      await helpers.asUser({
        cookies: userB.cookies,
        fn: async () => {
          expect((await helpers.reconciliationRemove({ transactionIds: [a.id] })).statusCode).toBe(404);
          expect(
            (await helpers.reconciliationMerge({ transactionIds: [a.id, b.id], survivorId: a.id })).statusCode,
          ).toBe(404);
          expect((await helpers.reconciliationRestore({ transactionIds: [removed.id] })).statusCode).toBe(404);
          expect(await helpers.getReconciliationHistory({ raw: true })).toEqual([]);
          expect((await helpers.keepAsBooked({ transactionIds: [stuck.id] })).statusCode).toBe(404);
          expect((await helpers.checkStuckPending({ accountId })).statusCode).toBe(404);
          expect(await helpers.getStuckPending({ raw: true })).toEqual([]);
        },
      });

      const [event] = await helpers.getReconciliationHistory({ raw: true });
      expect(event!.transactions.map((tx) => tx.id)).toEqual([removed.id]);
      const stuckItems = await helpers.getStuckPending({ raw: true });
      expect(stuckItems.map((item) => item.transaction.id)).toEqual([stuck.id]);
    });
  });

  describe('stuck pending', () => {
    it('lists pending rows older than 7 days with their best booked candidate', async () => {
      const { byAmount } = await setupEnableBanking({ transactions: STUCK_FIXTURES });

      const items = await helpers.getStuckPending({ raw: true });

      expect(items).toHaveLength(2);
      const recent = items.find((item) => item.transaction.id === byAmount({ amount: 12 }).id)!;
      const old = items.find((item) => item.transaction.id === byAmount({ amount: 30 }).id)!;
      expect(recent.candidate?.id).toBe(byAmount({ amount: 12.5 }).id);
      expect(recent.canCheckWithBank).toBe(true);
      expect(recent.pendingDays).toBeGreaterThanOrEqual(19);
      expect(recent.pendingDays).toBeLessThanOrEqual(21);
      expect(old.candidate).toBeNull();
      expect(old.canCheckWithBank).toBe(false);
    });

    it('offers no candidate when the booked copy is linked as a transfer', async () => {
      const { byAmount } = await setupEnableBanking({ transactions: STUCK_FIXTURES });
      const systemAccount = await helpers.createAccount({ raw: true });
      const [systemIncome] = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: systemAccount.id,
          amount: 12.5,
          transactionType: TRANSACTION_TYPES.income,
        }),
        raw: true,
      });
      await helpers.linkTransactions({
        payload: { ids: [[byAmount({ amount: 12.5 }).id, systemIncome.id]] },
        raw: true,
      });

      const items = await helpers.getStuckPending({ raw: true });

      expect(items.find((item) => item.transaction.id === byAmount({ amount: 12 }).id)!.candidate).toBeNull();
    });

    it('offers no candidate when the booked copy is refund-linked', async () => {
      const { byAmount } = await setupEnableBanking({
        transactions: [...STUCK_FIXTURES, { ...booked({ ref: 'refund', amount: '1.00', days: 17 }), isExpense: false }],
      });
      const refund = await helpers.createSingleRefund({
        originalTxId: byAmount({ amount: 12.5 }).id,
        refundTxId: byAmount({ amount: 1 }).id,
      });
      expect(refund.statusCode).toBe(200);

      const items = await helpers.getStuckPending({ raw: true });

      expect(items.find((item) => item.transaction.id === byAmount({ amount: 12 }).id)!.candidate).toBeNull();
    });

    it('returns an empty list without pending rows', async () => {
      expect(await helpers.getStuckPending({ raw: true })).toEqual([]);
    });

    it('keeps a pending row as booked', async () => {
      const { byAmount } = await setupEnableBanking({ transactions: STUCK_FIXTURES });

      const result = await helpers.keepAsBooked({ transactionIds: [byAmount({ amount: 12 }).id], raw: true });

      expect(result.updatedIds).toEqual([byAmount({ amount: 12 }).id]);
      const items = await helpers.getStuckPending({ raw: true });
      expect(items.map((item) => item.transaction.id)).toEqual([byAmount({ amount: 30 }).id]);

      expect((await helpers.keepAsBooked({ transactionIds: [byAmount({ amount: 12.5 }).id] })).statusCode).toBe(422);
      const [systemTx] = await helpers.createTransaction({ raw: true });
      expect((await helpers.keepAsBooked({ transactionIds: [systemTx.id as RecordId] })).statusCode).toBe(422);
      expect((await helpers.keepAsBooked({ transactionIds: [NONEXISTENT_ID] })).statusCode).toBe(404);
      expect((await helpers.keepAsBooked({ transactionIds: [] })).statusCode).toBe(422);
    });

    it('keeps a kept-as-booked row out of stuck pending after a re-sync, without a duplicate', async () => {
      const { connectionId, accountId, byAmount } = await setupEnableBanking({ transactions: STUCK_FIXTURES });
      const kept = byAmount({ amount: 12 });

      await helpers.keepAsBooked({ transactionIds: [kept.id], raw: true });
      await resync({ connectionId, accountId });

      const items = await helpers.getStuckPending({ raw: true });
      expect(items.map((item) => item.transaction.id)).not.toContain(kept.id);
      expect(await liveIdsWithAmount({ accountId, amount: 12 })).toEqual([kept.id]);
    });

    it('does not re-import a removed stuck pending row', async () => {
      const { connectionId, accountId, byAmount } = await setupEnableBanking({ transactions: STUCK_FIXTURES });

      await helpers.reconciliationRemove({ transactionIds: [byAmount({ amount: 12 }).id], raw: true });
      await resync({ connectionId, accountId });

      expect(await liveIdsWithAmount({ accountId, amount: 12 })).toEqual([]);
    });

    it('brings a removed pending row back when the bank books it', async () => {
      const { connectionId, accountId, byAmount } = await setupEnableBanking({
        transactions: [{ ...pending({ amount: '12.00', days: 20 }), entryReference: 'removed-ref' }],
      });
      const removed = byAmount({ amount: 12 });
      await helpers.reconciliationRemove({ transactionIds: [removed.id], raw: true });

      helpers.enablebanking.setFixedTransactions([booked({ ref: 'removed-ref', amount: '12.00', days: 19 })]);
      await resync({ connectionId, accountId });

      expect(await liveIdsWithAmount({ accountId, amount: 12 })).toEqual([removed.id]);
      const restored = (await helpers.getTransactionById({ id: removed.id, raw: true }))!;
      expect(restored.isPending).toBe(false);
      expect(restored.amount).toBe(12);
      expect(await historyEvents()).toEqual([]);
    });

    it('keeps a removed pending row removed when the bank re-sends it as pending', async () => {
      const removedFixture = { ...pending({ amount: '12.00', days: 20 }), entryReference: 'removed-ref' };
      const { connectionId, accountId, byAmount } = await setupEnableBanking({ transactions: [removedFixture] });
      const removed = byAmount({ amount: 12 });
      await helpers.reconciliationRemove({ transactionIds: [removed.id], raw: true });

      await resync({ connectionId, accountId });

      expect(await liveIdsWithAmount({ accountId, amount: 12 })).toEqual([]);
      expect(await historyEvents()).toEqual([{ type: 'remove', survivorId: null, ids: [removed.id] }]);
    });

    it('keeps only the booked survivor live after merging its pending copy and re-syncing', async () => {
      const { connectionId, accountId, byAmount } = await setupEnableBanking({ transactions: STUCK_FIXTURES });
      const [pendingTx, bookedTx] = [byAmount({ amount: 12 }), byAmount({ amount: 12.5 })];

      await helpers.reconciliationMerge({
        transactionIds: [pendingTx.id, bookedTx.id],
        survivorId: bookedTx.id,
        raw: true,
      });
      await resync({ connectionId, accountId });

      expect(await liveIdsWithAmount({ accountId, amount: 12 })).toEqual([]);
      expect(await liveIdsWithAmount({ accountId, amount: 12.5 })).toEqual([bookedTx.id]);
    });

    it('re-syncs the account from the oldest stuck pending date', async () => {
      const { connectionId, accountId } = await setupEnableBanking({
        transactions: [pending({ amount: '12.00', days: 20 })],
      });
      // The bank stops reporting the pending row; the first sync clears the stored pending anchor,
      // the second one then fetches only from the newest row.
      helpers.enablebanking.setFixedTransactions([booked({ ref: 'later', amount: '3.00', days: 1 })]);
      await resync({ connectionId, accountId });
      await resync({ connectionId, accountId });
      expect(dateFrom() > daysAgo({ days: 20 })).toBe(true);

      const result = await helpers.checkStuckPending({ accountId, raw: true });

      expect(result).toEqual({ bookedCount: 0, pendingCount: 1 });
      expect(dateFrom() <= daysAgo({ days: 20 })).toBe(true);
    });

    it('reports how many checkable stuck rows the bank booked and how many are still pending', async () => {
      const stillPending = { ...pending({ amount: '15.00', days: 25 }), entryReference: 'still-ref' };
      const { accountId, byAmount } = await setupEnableBanking({
        transactions: [
          { ...pending({ amount: '12.00', days: 20 }), entryReference: 'booked-ref' },
          stillPending,
          pending({ amount: '30.00', days: 100 }),
          pending({ amount: '7.00', days: 2 }),
        ],
      });
      helpers.enablebanking.setFixedTransactions([
        booked({ ref: 'booked-ref', amount: '12.00', days: 19 }),
        stillPending,
        pending({ amount: '30.00', days: 100 }),
        pending({ amount: '7.00', days: 2 }),
      ]);

      const result = await helpers.checkStuckPending({ accountId, raw: true });

      expect(result).toEqual({ bookedCount: 1, pendingCount: 1 });
      const items = await helpers.getStuckPending({ raw: true });
      expect(items.map((item) => item.transaction.id).toSorted()).toEqual(
        [byAmount({ amount: 15 }).id, byAmount({ amount: 30 }).id].toSorted(),
      );
    });

    it('reports zero counts when the account has no checkable stuck rows', async () => {
      const { accountId } = await setupEnableBanking({
        transactions: [pending({ amount: '30.00', days: 100 }), pending({ amount: '7.00', days: 2 })],
      });

      expect(await helpers.checkStuckPending({ accountId, raw: true })).toEqual({ bookedCount: 0, pendingCount: 0 });
    });

    it('rejects checking a non-bank or unknown account', async () => {
      const systemAccount = await helpers.createAccount({ raw: true });

      expect((await helpers.checkStuckPending({ accountId: systemAccount.id as RecordId })).statusCode).toBe(422);
      expect((await helpers.checkStuckPending({ accountId: NONEXISTENT_ID })).statusCode).toBe(404);
    });
  });

  describe('bank re-sync of merged rows', () => {
    it('upgrades a pending survivor when the bank books a row merged into it', async () => {
      const { connectionId, accountId, byAmount } = await setupEnableBanking({
        transactions: [
          pending({ amount: '12.00', days: 10 }),
          { ...pending({ amount: '13.00', days: 9 }), entryReference: 'merged-ref' },
        ],
      });
      const [survivor, removed] = [byAmount({ amount: 12 }), byAmount({ amount: 13 })];
      await helpers.reconciliationMerge({
        transactionIds: [survivor.id, removed.id],
        survivorId: survivor.id,
        raw: true,
      });
      const stuckBefore = await helpers.getStuckPending({ raw: true });
      expect(stuckBefore.map((item) => item.transaction.id)).toEqual([survivor.id]);

      helpers.enablebanking.setFixedTransactions([booked({ ref: 'merged-ref', amount: '13.00', days: 8 })]);
      await resync({ connectionId, accountId });

      expect(await listIds({ accountId })).toEqual([survivor.id]);
      expect((await helpers.getTransactionById({ id: survivor.id, raw: true }))!.isPending).toBe(false);
      expect(await helpers.getStuckPending({ raw: true })).toEqual([]);
      expect(await historyEvents()).toEqual([{ type: 'merge', survivorId: survivor.id, ids: [removed.id] }]);
    });

    it('follows a chain of merges to the live survivor when the bank books the first merged-away row', async () => {
      const { connectionId, accountId, byAmount } = await setupEnableBanking({
        transactions: [
          pending({ amount: '12.00', days: 10 }),
          pending({ amount: '14.00', days: 8 }),
          { ...pending({ amount: '13.00', days: 9 }), entryReference: 'merged-ref' },
        ],
      });
      const [finalSurvivor, middle, first] = [
        byAmount({ amount: 12 }),
        byAmount({ amount: 14 }),
        byAmount({ amount: 13 }),
      ];
      await helpers.reconciliationMerge({ transactionIds: [middle.id, first.id], survivorId: middle.id, raw: true });
      await helpers.reconciliationMerge({
        transactionIds: [finalSurvivor.id, middle.id],
        survivorId: finalSurvivor.id,
        raw: true,
      });

      helpers.enablebanking.setFixedTransactions([booked({ ref: 'merged-ref', amount: '13.00', days: 8 })]);
      await resync({ connectionId, accountId });

      expect(await listIds({ accountId })).toEqual([finalSurvivor.id]);
      expect((await helpers.getTransactionById({ id: finalSurvivor.id, raw: true }))!.isPending).toBe(false);
      expect(await helpers.getStuckPending({ raw: true })).toEqual([]);
    });

    it('leaves a pending survivor untouched when the bank re-sends a merged-away row as pending', async () => {
      const { connectionId, accountId, byAmount } = await setupEnableBanking({
        transactions: [pending({ amount: '12.00', days: 10 }), pending({ amount: '13.00', days: 9 })],
      });
      const [survivor, removed] = [byAmount({ amount: 12 }), byAmount({ amount: 13 })];
      await helpers.reconciliationMerge({
        transactionIds: [survivor.id, removed.id],
        survivorId: survivor.id,
        raw: true,
      });
      const survivorBefore = (await helpers.getTransactionById({ id: survivor.id, raw: true }))!;

      await resync({ connectionId, accountId });

      expect(await listIds({ accountId })).toEqual([survivor.id]);
      const survivorAfter = (await helpers.getTransactionById({ id: survivor.id, raw: true }))!;
      expect(survivorAfter.originalId).toBe(survivorBefore.originalId);
      expect(survivorAfter.time).toEqual(survivorBefore.time);
      expect(survivorAfter.amount).toEqual(survivorBefore.amount);
      expect(survivorAfter.isPending).toBe(true);
      expect(await historyEvents()).toEqual([{ type: 'merge', survivorId: survivor.id, ids: [removed.id] }]);
    });

    it('skips a booking of a merged-away row when the survivor is already booked', async () => {
      const survivorFixture = booked({ ref: 'survivor-ref', amount: '10.00', days: 5 });
      const { connectionId, accountId, byAmount } = await setupEnableBanking({
        transactions: [survivorFixture, { ...pending({ amount: '11.00', days: 6 }), entryReference: 'merged-ref' }],
      });
      const [survivor, removed] = [byAmount({ amount: 10 }), byAmount({ amount: 11 })];
      await helpers.reconciliationMerge({
        transactionIds: [survivor.id, removed.id],
        survivorId: survivor.id,
        raw: true,
      });
      const survivorBefore = (await helpers.getTransactionById({ id: survivor.id, raw: true }))!;

      helpers.enablebanking.setFixedTransactions([
        survivorFixture,
        booked({ ref: 'merged-ref', amount: '11.00', days: 4 }),
      ]);
      await resync({ connectionId, accountId });

      expect(await listIds({ accountId })).toEqual([survivor.id]);
      const survivorAfter = (await helpers.getTransactionById({ id: survivor.id, raw: true }))!;
      expect(survivorAfter.time).toEqual(survivorBefore.time);
      expect(survivorAfter.originalId).toBe(survivorBefore.originalId);
      expect(survivorAfter.amount).toEqual(survivorBefore.amount);
      expect(await historyEvents()).toEqual([{ type: 'merge', survivorId: survivor.id, ids: [removed.id] }]);
    });

    it('keeps a merge in history when duplicate reconciliation folds the pending survivor into its booked copy', async () => {
      const bookedFixture = booked({ ref: 'booked-ref', amount: '25.00', days: 3 });
      const mergedAwayFixture = pending({ amount: '9.00', days: 5 });
      const { connectionId, accountId, byAmount } = await setupEnableBanking({
        transactions: [bookedFixture, mergedAwayFixture],
      });
      const [bookedCopy, mergedAway] = [byAmount({ amount: 25 }), byAmount({ amount: 9 })];

      // Arrives after its booked copy is stored, so sync keeps both rows instead of upgrading.
      helpers.enablebanking.setFixedTransactions([
        bookedFixture,
        mergedAwayFixture,
        pending({ amount: '25.00', days: 4 }),
      ]);
      await resync({ connectionId, accountId });
      const pendingCopyId = (await liveIdsWithAmount({ accountId, amount: 25 })).find((id) => id !== bookedCopy.id)!;
      expect(pendingCopyId).toBeDefined();

      await helpers.reconciliationMerge({
        transactionIds: [pendingCopyId, mergedAway.id],
        survivorId: pendingCopyId,
        raw: true,
      });

      const result = await helpers.bankDataProviders.reconcileDuplicates({ connectionId, accountId, raw: true });

      expect(result.mergedCount).toBe(1);
      expect(await liveIdsWithAmount({ accountId, amount: 25 })).toEqual([bookedCopy.id]);
      expect(await historyEvents()).toEqual([{ type: 'merge', survivorId: bookedCopy.id, ids: [mergedAway.id] }]);
    });
  });
});
