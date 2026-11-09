import {
  type RecordId,
  SUBSCRIPTION_FREQUENCIES,
  SUBSCRIPTION_PERIOD_STATUSES,
  TRANSACTION_TYPES,
} from '@bt/shared/types';
import { describe, expect, it } from '@jest/globals';
import * as helpers from '@tests/helpers';
import { addMonths, format } from 'date-fns';

const createAccount = () =>
  helpers.createAccount({ payload: helpers.buildAccountPayload({ initialBalance: 1000 }), raw: true });

const createTx = async ({
  accountId,
  amount,
  transactionType = TRANSACTION_TYPES.expense,
  ...rest
}: {
  accountId: RecordId;
  amount: number;
  transactionType?: TRANSACTION_TYPES;
} & Partial<Parameters<typeof helpers.buildTransactionPayload>[0]>) => {
  const [tx] = await helpers.createTransaction({
    payload: helpers.buildTransactionPayload({ accountId, amount, transactionType, ...rest }),
    raw: true,
  });
  return tx!;
};

const trash = async ({ id }: { id: RecordId }) => {
  expect((await helpers.deleteTransaction({ id })).statusCode).toBe(200);
};

const restore = async ({ id }: { id: RecordId }) => {
  const response = await helpers.restoreTrash({ transactionIds: [id] });
  expect(response.statusCode).toBe(200);
  return helpers.extractResponse(response);
};

const refundLinkedOf = async ({ id }: { id: RecordId }) =>
  (await helpers.getTransactionById({ id, raw: true }))!.refundLinked;

const refundPairsOf = async ({ id }: { id: RecordId }) =>
  (await helpers.getRefundsForTransaction({ transactionId: id, raw: true }))
    .map((link) => `${link.originalTxId}->${link.refundTxId}`)
    .toSorted();

const linkRefund = async ({ originalTxId, refundTxId }: { originalTxId: RecordId; refundTxId: RecordId }) => {
  expect((await helpers.createSingleRefund({ originalTxId, refundTxId })).statusCode).toBe(200);
};

const listRefunds = () =>
  helpers.getRefundTransactions({ page: 1, limit: 10 }, true) as Promise<{ data: unknown[]; meta: { total: number } }>;

const createPurchaseWithRefund = async () => {
  const account = await createAccount();
  const purchase = await createTx({ accountId: account.id, amount: 100 });
  const refund = await createTx({ accountId: account.id, amount: 40, transactionType: TRANSACTION_TYPES.income });
  await linkRefund({ originalTxId: purchase.id, refundTxId: refund.id });
  return { account, purchase, refund };
};

describe('Transactions Trash: links stay attached', () => {
  it('hides every link while trashed and brings all of them back on restore', async () => {
    const account = await createAccount();
    const categories = await helpers.getCategoriesList();
    const tag = await helpers.createTag({ payload: { name: 'trip', color: '#000000' }, raw: true });
    const purchase = await createTx({
      accountId: account.id,
      amount: 100,
      categoryId: categories[0]!.id,
      tagIds: [tag.id],
      splits: [{ categoryId: categories[1]!.id, amount: 30 }],
    });
    const refund = await createTx({ accountId: account.id, amount: 40, transactionType: TRANSACTION_TYPES.income });
    const sibling = await createTx({ accountId: account.id, amount: 50 });
    await linkRefund({ originalTxId: purchase.id, refundTxId: refund.id });

    const tracker = await helpers.createTracker({ name: 'Rome', raw: true });
    await helpers.addTransactionsToTracker({ id: tracker.id, payload: { transactionIds: [purchase.id] }, raw: true });
    const group = await helpers.createTransactionGroup({
      payload: helpers.buildTransactionGroupPayload({ name: 'Dinner', transactionIds: [purchase.id, sibling.id] }),
      raw: true,
    });

    const dueDate = format(addMonths(new Date(), 1), 'yyyy-MM-15');
    const subscription = await helpers.createSubscription({
      name: 'Gym',
      frequency: SUBSCRIPTION_FREQUENCIES.monthly,
      startDate: dueDate,
      dueDate,
      accountId: account.id,
      categoryId: global.DEFAULT_CATEGORY_ID,
      expectedAmount: 100,
      expectedCurrencyCode: global.BASE_CURRENCY.code,
      raw: true,
    });
    const period = (await helpers.getSubscriptionById({ id: subscription.id, raw: true })).periods.find(
      (item) => item.status === SUBSCRIPTION_PERIOD_STATUSES.upcoming,
    )!;
    await helpers.markSubscriptionPeriodPaid({
      id: subscription.id,
      periodId: period.id,
      transactionId: purchase.id,
      raw: true,
    });
    await helpers.linkTransactionsToSubscription({ id: subscription.id, transactionIds: [purchase.id], raw: true });

    const linkState = async () => {
      const tx = await helpers.getTransactionById({ id: purchase.id, raw: true });
      const detail = await helpers.getSubscriptionById({ id: subscription.id, raw: true });
      const paidPeriod = detail.periods.find((item) => item.id === period.id)!;
      const exported = helpers.parseExportArchive({ buffer: (await helpers.exportData()).body }).json as Record<
        string,
        Record<string, unknown>[]
      >;
      return {
        tags: tx?.tags?.map((item) => item.id) ?? null,
        splits: tx?.splits?.map((split) => [split.categoryId, split.amount]) ?? null,
        refunds: await refundPairsOf({ id: refund.id }),
        flags: [await refundLinkedOf({ id: refund.id }), tx?.refundLinked ?? null],
        trackerTxIds: (await helpers.getTransactions({ trackerIds: [tracker.id], raw: true })).map((row) => row.id),
        trackerCount: (await helpers.getTrackerStats({ id: tracker.id, raw: true }))!.summary.transactionsCount,
        groupTxIds: (await helpers.getTransactionGroupById({ id: group.id, raw: true })).transactions!.map(
          (row) => row.id,
        ),
        groupCount: (await helpers.getTransactionGroups({ raw: true })).find((item) => item.id === group.id)!
          .transactionCount,
        subscriptionTxIds: detail.transactions.map((row) => row.id),
        period: [paidPeriod.status, paidPeriod.transactionId, paidPeriod.transactionInTrash],
        exportedTrackerSpent: exported.trackers!.find((row) => row.name === 'Rome')!.spentAmount,
        exportedSubscriptionLinks: exported.subscriptions!.find((row) => row.name === 'Gym')!.linkedTransactionsCount,
      };
    };

    const before = await linkState();
    expect(before).toEqual({
      tags: [tag.id],
      splits: [[categories[1]!.id, 30]],
      refunds: [`${purchase.id}->${refund.id}`],
      flags: [true, true],
      trackerTxIds: [purchase.id],
      trackerCount: 1,
      groupTxIds: expect.arrayContaining([purchase.id, sibling.id]),
      groupCount: 2,
      subscriptionTxIds: [purchase.id],
      period: [SUBSCRIPTION_PERIOD_STATUSES.paid, purchase.id, false],
      exportedTrackerSpent: 100,
      exportedSubscriptionLinks: 1,
    });

    await trash({ id: purchase.id });

    expect(await linkState()).toEqual({
      tags: null,
      splits: null,
      refunds: [],
      flags: [false, null],
      trackerTxIds: [],
      trackerCount: 0,
      groupTxIds: [sibling.id],
      groupCount: 1,
      subscriptionTxIds: [],
      period: [SUBSCRIPTION_PERIOD_STATUSES.paid, purchase.id, true],
      exportedTrackerSpent: 0,
      exportedSubscriptionLinks: 0,
    });
    expect((await listRefunds()).meta.total).toBe(0);
    expect((await helpers.getSingleRefund({ originalTxId: purchase.id, refundTxId: refund.id })).statusCode).toBe(404);
    expect((await helpers.getTransactions({ raw: true })).map((row) => row.id).toSorted()).toEqual(
      [refund.id, sibling.id].toSorted(),
    );

    await restore({ id: purchase.id });

    expect(await linkState()).toEqual(before);
    expect((await listRefunds()).meta.total).toBe(1);
  });

  describe('refunds', () => {
    it('unflags the refund while its original is trashed, keeps it editable, and relinks on restore', async () => {
      const { purchase, refund } = await createPurchaseWithRefund();

      await trash({ id: purchase.id });

      expect(await refundLinkedOf({ id: refund.id })).toBe(false);
      expect(await refundPairsOf({ id: refund.id })).toEqual([]);
      const edit = await helpers.updateTransaction({ id: refund.id, payload: { amount: 35 } });
      expect(edit.statusCode).toBe(200);

      await restore({ id: purchase.id });

      expect(await refundPairsOf({ id: refund.id })).toEqual([`${purchase.id}->${refund.id}`]);
      expect(await refundLinkedOf({ id: refund.id })).toBe(true);
      expect(await refundLinkedOf({ id: purchase.id })).toBe(true);
    });

    it('unflags the original while its refund is trashed, keeps it editable, and relinks on restore', async () => {
      const { purchase, refund } = await createPurchaseWithRefund();

      await trash({ id: refund.id });

      expect(await refundLinkedOf({ id: purchase.id })).toBe(false);
      expect(await refundPairsOf({ id: purchase.id })).toEqual([]);
      expect((await listRefunds()).meta.total).toBe(0);
      const edit = await helpers.updateTransaction({ id: purchase.id, payload: { amount: 90, note: 'Shoes' } });
      expect(edit.statusCode).toBe(200);

      await restore({ id: refund.id });

      expect(await refundPairsOf({ id: purchase.id })).toEqual([`${purchase.id}->${refund.id}`]);
      expect(await refundLinkedOf({ id: purchase.id })).toBe(true);
      expect(await refundLinkedOf({ id: refund.id })).toBe(true);
    });

    it('unflags a restored refund whose original was deleted permanently while both were trashed', async () => {
      const { purchase, refund } = await createPurchaseWithRefund();
      await trash({ id: refund.id });
      await trash({ id: purchase.id });
      expect((await helpers.deleteTrash({ transactionIds: [purchase.id] })).statusCode).toBe(200);

      await restore({ id: refund.id });

      expect(await refundPairsOf({ id: refund.id })).toEqual([]);
      expect(await refundLinkedOf({ id: refund.id })).toBe(false);
    });

    it('relinks a pair trashed together once both sides are restored one at a time', async () => {
      const { purchase, refund } = await createPurchaseWithRefund();
      await trash({ id: purchase.id });
      await trash({ id: refund.id });

      expect((await restore({ id: purchase.id })).droppedRefundLinks).toBe(0);

      expect(await refundLinkedOf({ id: purchase.id })).toBe(false);
      const [refundEntry] = await helpers.getTrash({ raw: true });
      expect(refundEntry!.id).toBe(refund.id);
      expect(refundEntry!.links).toEqual([expect.objectContaining({ kind: 'refund', counterpartInTrash: false })]);

      expect((await restore({ id: refund.id })).droppedRefundLinks).toBe(0);

      expect(await refundPairsOf({ id: refund.id })).toEqual([`${purchase.id}->${refund.id}`]);
      expect(await refundLinkedOf({ id: purchase.id })).toBe(true);
      expect(await refundLinkedOf({ id: refund.id })).toBe(true);
    });

    it('drops the link when the live original became a transfer while the refund was trashed', async () => {
      const { purchase, refund } = await createPurchaseWithRefund();
      await trash({ id: refund.id });

      const savings = await createAccount();
      const incoming = await createTx({
        accountId: savings.id,
        amount: 100,
        transactionType: TRANSACTION_TYPES.income,
      });
      expect((await helpers.linkTransactions({ payload: { ids: [[purchase.id, incoming.id]] } })).statusCode).toBe(200);

      expect((await restore({ id: refund.id })).droppedRefundLinks).toBe(1);

      expect(await refundPairsOf({ id: refund.id })).toEqual([]);
      expect(await refundLinkedOf({ id: refund.id })).toBe(false);
      expect(await refundLinkedOf({ id: purchase.id })).toBe(false);
    });

    it('labels the refund link with the counterpart payee when it has no note', async () => {
      const account = await createAccount();
      const payee = await helpers.createPayee({ payload: helpers.buildPayeePayload({ name: 'Amazon' }), raw: true });
      const purchase = await createTx({ accountId: account.id, amount: 100, payeeId: payee.id });
      const refund = await createTx({ accountId: account.id, amount: 40, transactionType: TRANSACTION_TYPES.income });
      await linkRefund({ originalTxId: purchase.id, refundTxId: refund.id });
      await trash({ id: refund.id });

      const [entry] = await helpers.getTrash({ raw: true });
      expect(entry!.links).toEqual([{ kind: 'refund', label: 'Amazon', counterpartInTrash: false }]);
    });

    it('lets the live refund be linked to another purchase, then drops the stale link on restore', async () => {
      const { account, purchase, refund } = await createPurchaseWithRefund();
      await trash({ id: purchase.id });

      const replacement = await createTx({ accountId: account.id, amount: 100 });
      await linkRefund({ originalTxId: replacement.id, refundTxId: refund.id });

      expect((await restore({ id: purchase.id })).droppedRefundLinks).toBe(1);

      expect(await helpers.getTransactionById({ id: purchase.id, raw: true })).not.toBeNull();
      expect(await refundPairsOf({ id: refund.id })).toEqual([`${replacement.id}->${refund.id}`]);
      expect(await refundLinkedOf({ id: purchase.id })).toBe(false);
      expect(await refundLinkedOf({ id: refund.id })).toBe(true);
      expect(await refundLinkedOf({ id: replacement.id })).toBe(true);
    });

    it('drops only the link that no longer fits when the restored purchase has several refunds', async () => {
      const account = await createAccount();
      const purchase = await createTx({ accountId: account.id, amount: 100 });
      const movedRefund = await createTx({
        accountId: account.id,
        amount: 30,
        transactionType: TRANSACTION_TYPES.income,
      });
      const keptRefund = await createTx({
        accountId: account.id,
        amount: 30,
        transactionType: TRANSACTION_TYPES.income,
      });
      await linkRefund({ originalTxId: purchase.id, refundTxId: movedRefund.id });
      await linkRefund({ originalTxId: purchase.id, refundTxId: keptRefund.id });
      await trash({ id: purchase.id });

      const replacement = await createTx({ accountId: account.id, amount: 100 });
      await linkRefund({ originalTxId: replacement.id, refundTxId: movedRefund.id });

      expect((await restore({ id: purchase.id })).droppedRefundLinks).toBe(1);

      expect(await refundPairsOf({ id: movedRefund.id })).toEqual([`${replacement.id}->${movedRefund.id}`]);
      expect(await refundPairsOf({ id: keptRefund.id })).toEqual([`${purchase.id}->${keptRefund.id}`]);
      expect(await refundLinkedOf({ id: purchase.id })).toBe(true);
    });
  });

  describe('groups', () => {
    it('counts only the live member while one of two is trashed and rejoins it on restore', async () => {
      const account = await createAccount();
      const [first, second] = [
        await createTx({ accountId: account.id, amount: 10 }),
        await createTx({ accountId: account.id, amount: 20 }),
      ];
      const group = await helpers.createTransactionGroup({
        payload: helpers.buildTransactionGroupPayload({ name: 'Pair', transactionIds: [first.id, second.id] }),
        raw: true,
      });
      const countOf = async () =>
        (await helpers.getTransactionGroups({ raw: true })).find((item) => item.id === group.id)?.transactionCount;

      await trash({ id: first.id });

      expect(await countOf()).toBe(1);
      expect(
        (await helpers.getTransactionGroupById({ id: group.id, raw: true })).transactions!.map((row) => row.id),
      ).toEqual([second.id]);

      await restore({ id: first.id });

      expect(await countOf()).toBe(2);
      expect(
        (await helpers.getTransactionGroupById({ id: group.id, raw: true }))
          .transactions!.map((row) => row.id)
          .toSorted(),
      ).toEqual([first.id, second.id].toSorted());
    });

    it('dissolves a group left with one member once the trashed one is deleted permanently', async () => {
      const account = await createAccount();
      const [first, second] = [
        await createTx({ accountId: account.id, amount: 10 }),
        await createTx({ accountId: account.id, amount: 20 }),
      ];
      const group = await helpers.createTransactionGroup({
        payload: helpers.buildTransactionGroupPayload({ name: 'Pair', transactionIds: [first.id, second.id] }),
        raw: true,
      });
      await trash({ id: first.id });

      await helpers.deleteTrash({ transactionIds: [first.id], raw: true });

      expect((await helpers.getTransactionGroupById({ id: group.id })).statusCode).toBe(404);
      expect(await helpers.getTransactionById({ id: second.id, raw: true })).not.toBeNull();
    });
  });
});
