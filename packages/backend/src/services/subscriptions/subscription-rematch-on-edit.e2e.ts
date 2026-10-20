import {
  type RecordId,
  RESOURCE_TYPES,
  SHARE_PERMISSIONS,
  SUBSCRIPTION_FREQUENCIES,
  SUBSCRIPTION_PERIOD_STATUSES,
  TRANSACTIONS_WRITE_SCOPES,
} from '@bt/shared/types';
import { describe, expect, it } from '@jest/globals';
import * as helpers from '@tests/helpers';
import { addDays, format, startOfDay, subDays } from 'date-fns';

const dayFromToday = (days: number): Date =>
  startOfDay(days >= 0 ? addDays(new Date(), days) : subDays(new Date(), -days));
const formatDay = (date: Date): string => format(date, 'yyyy-MM-dd');

const createRuleSubscription = ({
  accountId,
  categoryId,
  dueDate,
  rule = { field: 'note', operator: 'contains_any', value: ['apple music'] },
}: {
  accountId?: RecordId;
  categoryId?: RecordId;
  dueDate: string;
  rule?: Record<string, unknown>;
}) =>
  helpers.createSubscription({
    name: 'Apple Music',
    frequency: SUBSCRIPTION_FREQUENCIES.monthly,
    startDate: dueDate,
    dueDate,
    accountId,
    categoryId,
    expectedAmount: 10,
    expectedCurrencyCode: global.BASE_CURRENCY.code,
    matchingRules: { rules: [rule] },
    raw: true,
  });

/** Where an uncategorized row lands. `global.DEFAULT_CATEGORY_ID` is only the first seeded category. */
const userDefaultCategoryId = async () => (await helpers.getUserInfo({ raw: true })).defaultCategoryId;

const createUnmatchedRow = async ({ accountId, categoryId }: { accountId: RecordId; categoryId?: RecordId }) => {
  const [tx] = await helpers.createTransaction({
    payload: helpers.buildTransactionPayload({
      accountId,
      ...(categoryId ? { categoryId } : {}),
      amount: 10,
      note: 'APPLE.COM/BILL',
      time: dayFromToday(-3).toISOString(),
    }),
    raw: true,
  });
  return tx;
};

const linkedTxIds = async ({ subscriptionId }: { subscriptionId: RecordId }) =>
  (await helpers.getSubscriptionById({ id: subscriptionId, raw: true })).transactions.map((t: { id: string }) => t.id);

describe('Editing a transaction re-runs subscription rule matching', () => {
  it('links the row and settles the period once an edit makes its note match', async () => {
    const account = await helpers.createAccount({ raw: true });
    const dueDate = formatDay(dayFromToday(-3));
    const sub = await createRuleSubscription({ accountId: account.id, dueDate });

    const [tx] = await helpers.createTransaction({
      payload: helpers.buildTransactionPayload({
        accountId: account.id,
        amount: 10,
        note: 'APPLE.COM/BILL',
        time: dayFromToday(-3).toISOString(),
      }),
      raw: true,
    });

    const before = await helpers.getSubscriptionById({ id: sub.id, raw: true });
    expect(before.transactions.map((t: { id: string }) => t.id)).not.toContain(tx.id);

    // A note that still matches nothing leaves the row alone.
    await helpers.updateTransaction({ id: tx.id, payload: { note: 'APPLE.COM/BILL 2' }, raw: true });
    const stillUnlinked = await helpers.getSubscriptionById({ id: sub.id, raw: true });
    expect(stillUnlinked.transactions.map((t: { id: string }) => t.id)).not.toContain(tx.id);

    await helpers.updateTransaction({ id: tx.id, payload: { note: 'Apple Music subscription' }, raw: true });

    const detail = await helpers.getSubscriptionById({ id: sub.id, raw: true });
    expect(detail.transactions.map((t: { id: string }) => t.id)).toContain(tx.id);

    const settled = detail.periods.find((p: { dueDate: string }) => p.dueDate === dueDate);
    expect(settled!.status).toBe(SUBSCRIPTION_PERIOD_STATUSES.paid);
    expect(settled!.transactionId).toBe(tx.id);
    expect(settled!.transactionAutoCreated).toBe(false);
  });

  it('does not link a row again after the user unlinked it, however it is edited', async () => {
    const account = await helpers.createAccount({ raw: true });
    const dueDate = formatDay(dayFromToday(-3));
    const sub = await createRuleSubscription({ accountId: account.id, dueDate });

    const [tx] = await helpers.createTransaction({
      payload: helpers.buildTransactionPayload({
        accountId: account.id,
        amount: 10,
        note: 'Apple Music',
        time: dayFromToday(-3).toISOString(),
      }),
      raw: true,
    });
    const linked = await helpers.getSubscriptionById({ id: sub.id, raw: true });
    expect(linked.transactions.map((t: { id: string }) => t.id)).toContain(tx.id);

    await helpers.unlinkTransactionsFromSubscription({ id: sub.id, transactionIds: [tx.id], raw: true });

    await helpers.updateTransaction({ id: tx.id, payload: { note: 'Apple Music renewal', amount: 11 }, raw: true });

    const detail = await helpers.getSubscriptionById({ id: sub.id, raw: true });
    expect(detail.transactions.map((t: { id: string }) => t.id)).not.toContain(tx.id);
  });

  it('matches only once an edit changes a field the rules read', async () => {
    const account = await helpers.createAccount({ raw: true });
    const tx = await createUnmatchedRow({ accountId: account.id });
    await helpers.updateTransaction({ id: tx.id, payload: { note: 'Apple Music' }, raw: true });
    const sub = await createRuleSubscription({ accountId: account.id, dueDate: formatDay(dayFromToday(-3)) });
    const otherCategory = await helpers.addCustomCategory({ name: 'Other', color: '#112233', raw: true });

    await helpers.updateTransaction({ id: tx.id, payload: { categoryId: otherCategory.id }, raw: true });
    expect(await linkedTxIds({ subscriptionId: sub.id })).not.toContain(tx.id);

    await helpers.updateTransaction({ id: tx.id, payload: { note: 'Apple Music renewal' }, raw: true });
    expect(await linkedTxIds({ subscriptionId: sub.id })).toContain(tx.id);
  });

  it('links the row once an amount-only edit fits an amount rule', async () => {
    const account = await helpers.createAccount({ raw: true });
    const sub = await createRuleSubscription({
      accountId: account.id,
      dueDate: formatDay(dayFromToday(-3)),
      rule: { field: 'amount', operator: 'between', value: { min: 20, max: 30 } },
    });
    const tx = await createUnmatchedRow({ accountId: account.id });
    expect(await linkedTxIds({ subscriptionId: sub.id })).not.toContain(tx.id);

    await helpers.updateTransaction({ id: tx.id, payload: { amount: 25 }, raw: true });

    expect(await linkedTxIds({ subscriptionId: sub.id })).toContain(tx.id);
  });
});

describe('Editing a transaction re-runs subscription matching: category and author', () => {
  it("applies the subscription's category to an uncategorized row and answers with the row as stored", async () => {
    const account = await helpers.createAccount({ raw: true });
    const dueDate = formatDay(dayFromToday(-3));
    const musicCategory = await helpers.addCustomCategory({ name: 'Music', color: '#112233', raw: true });
    await createRuleSubscription({ accountId: account.id, categoryId: musicCategory.id, dueDate });
    const tx = await createUnmatchedRow({ accountId: account.id, categoryId: await userDefaultCategoryId() });

    const [edited] = await helpers.updateTransaction({
      id: tx.id,
      payload: { note: 'Apple Music subscription' },
      raw: true,
    });

    expect(edited.categoryId).toBe(musicCategory.id);
    const stored = await helpers.getTransactionById({ id: tx.id, raw: true });
    expect(stored!.categoryId).toBe(musicCategory.id);
  });

  it("applies the subscription's category when the edit re-sends the row's unchanged default category", async () => {
    const account = await helpers.createAccount({ raw: true });
    const dueDate = formatDay(dayFromToday(-3));
    const defaultCategoryId = await userDefaultCategoryId();
    const musicCategory = await helpers.addCustomCategory({ name: 'Music', color: '#112233', raw: true });
    await createRuleSubscription({ accountId: account.id, categoryId: musicCategory.id, dueDate });
    const tx = await createUnmatchedRow({ accountId: account.id, categoryId: defaultCategoryId });

    const [edited] = await helpers.updateTransaction({
      id: tx.id,
      payload: { note: 'Apple Music subscription', categoryId: defaultCategoryId },
      raw: true,
    });

    expect(edited.categoryId).toBe(musicCategory.id);
  });

  it('keeps the category the same edit sets, and still links the row and settles the period', async () => {
    const account = await helpers.createAccount({ raw: true });
    const dueDate = formatDay(dayFromToday(-3));
    const musicCategory = await helpers.addCustomCategory({ name: 'Music', color: '#112233', raw: true });
    const giftsCategory = await helpers.addCustomCategory({ name: 'Gifts', color: '#445566', raw: true });
    const sub = await createRuleSubscription({
      accountId: account.id,
      categoryId: musicCategory.id,
      dueDate,
    });
    const tx = await createUnmatchedRow({ accountId: account.id });

    const [edited] = await helpers.updateTransaction({
      id: tx.id,
      payload: { note: 'Apple Music gift card', categoryId: giftsCategory.id },
      raw: true,
    });

    expect(edited.categoryId).toBe(giftsCategory.id);
    const stored = await helpers.getTransactionById({ id: tx.id, raw: true });
    expect(stored!.categoryId).toBe(giftsCategory.id);

    const detail = await helpers.getSubscriptionById({ id: sub.id, raw: true });
    expect(detail.transactions.map((t: { id: string }) => t.id)).toContain(tx.id);
    const settled = detail.periods.find((p: { dueDate: string }) => p.dueDate === dueDate);
    expect(settled!.status).toBe(SUBSCRIPTION_PERIOD_STATUSES.paid);
    expect(settled!.transactionId).toBe(tx.id);
  });

  it("matches a share recipient's own row on the owner's account like create does, with category and period", async () => {
    const ownerAccount = await helpers.createAccount({ raw: true });
    const ownerCategory = await userDefaultCategoryId();
    const recipient = await helpers.provisionSecondUserWithBaseCurrency();
    const invitation = await helpers.createShareInvitation({
      inviteeEmail: recipient.email,
      resourceType: RESOURCE_TYPES.account,
      resourceId: ownerAccount.id,
      permission: SHARE_PERMISSIONS.write,
      policy: { transactionsWriteScope: TRANSACTIONS_WRITE_SCOPES.all },
      raw: true,
    });
    await helpers.asUser({
      cookies: recipient.cookies,
      fn: () => helpers.acceptShareInvitation({ token: invitation.token, raw: true }),
    });

    const dueDate = formatDay(dayFromToday(-3));
    const { sub, musicCategory, tx } = await helpers.asUser({
      cookies: recipient.cookies,
      fn: async () => {
        const category = await helpers.addCustomCategory({ name: 'Music', color: '#112233', raw: true });
        const subscription = await createRuleSubscription({ categoryId: category.id, dueDate });
        const [row] = await helpers.createTransaction({
          payload: helpers.buildTransactionPayload({
            accountId: ownerAccount.id,
            amount: 10,
            note: 'APPLE.COM/BILL',
            categoryId: ownerCategory,
            time: dayFromToday(-3).toISOString(),
          }),
          raw: true,
        });
        return { sub: subscription, musicCategory: category, tx: row };
      },
    });

    const [edited] = await helpers.asUser({
      cookies: recipient.cookies,
      fn: () => helpers.updateTransaction({ id: tx.id, payload: { note: 'Apple Music subscription' }, raw: true }),
    });

    expect(edited.categoryId).toBe(musicCategory.id);

    const detail = await helpers.asUser({
      cookies: recipient.cookies,
      fn: () => helpers.getSubscriptionById({ id: sub.id, raw: true }),
    });
    expect(detail.transactions.map((t: { id: string }) => t.id)).toContain(tx.id);
    const settled = detail.periods.find((p: { dueDate: string }) => p.dueDate === dueDate);
    expect(settled!.status).toBe(SUBSCRIPTION_PERIOD_STATUSES.paid);
    expect(settled!.transactionId).toBe(tx.id);
  });

  it('leaves a manually chosen category alone when an edit that omits categoryId makes the note match', async () => {
    const account = await helpers.createAccount({ raw: true });
    const dueDate = formatDay(dayFromToday(-3));
    const musicCategory = await helpers.addCustomCategory({ name: 'Music', color: '#112233', raw: true });
    const giftsCategory = await helpers.addCustomCategory({ name: 'Gifts', color: '#445566', raw: true });
    const sub = await createRuleSubscription({
      accountId: account.id,
      categoryId: musicCategory.id,
      dueDate,
    });
    const tx = await createUnmatchedRow({ accountId: account.id });
    await helpers.updateTransaction({ id: tx.id, payload: { categoryId: giftsCategory.id }, raw: true });

    const [edited] = await helpers.updateTransaction({
      id: tx.id,
      payload: { note: 'Apple Music gift card' },
      raw: true,
    });

    expect(edited.categoryId).toBe(giftsCategory.id);
    const stored = await helpers.getTransactionById({ id: tx.id, raw: true });
    expect(stored!.categoryId).toBe(giftsCategory.id);

    const detail = await helpers.getSubscriptionById({ id: sub.id, raw: true });
    expect(detail.transactions.map((t: { id: string }) => t.id)).toContain(tx.id);
    const settled = detail.periods.find((p: { dueDate: string }) => p.dueDate === dueDate);
    expect(settled!.status).toBe(SUBSCRIPTION_PERIOD_STATUSES.paid);
  });

  it("does not match a row to its author's subscription once the author lost access to the account", async () => {
    const ownerAccount = await helpers.createAccount({ raw: true });
    const ownerCategory = await helpers.addCustomCategory({ name: 'Shared cat', color: '#778899', raw: true });
    const recipient = await helpers.provisionSecondUserWithBaseCurrency();
    const invitation = await helpers.createShareInvitation({
      inviteeEmail: recipient.email,
      resourceType: RESOURCE_TYPES.account,
      resourceId: ownerAccount.id,
      permission: SHARE_PERMISSIONS.write,
      policy: { transactionsWriteScope: TRANSACTIONS_WRITE_SCOPES.all },
      raw: true,
    });
    await helpers.asUser({
      cookies: recipient.cookies,
      fn: () => helpers.acceptShareInvitation({ token: invitation.token, raw: true }),
    });

    const dueDate = formatDay(dayFromToday(-3));
    const { sub, tx } = await helpers.asUser({
      cookies: recipient.cookies,
      fn: async () => {
        const category = await helpers.addCustomCategory({ name: 'Music', color: '#112233', raw: true });
        const subscription = await createRuleSubscription({ categoryId: category.id, dueDate });
        const [row] = await helpers.createTransaction({
          payload: helpers.buildTransactionPayload({
            accountId: ownerAccount.id,
            amount: 10,
            note: 'APPLE.COM/BILL',
            categoryId: ownerCategory.id,
            time: dayFromToday(-3).toISOString(),
          }),
          raw: true,
        });
        return { sub: subscription, tx: row };
      },
    });

    const recipientApp = await helpers.findAppUserByEmail({ email: recipient.email });
    await helpers.revokeShareMember({
      resourceType: RESOURCE_TYPES.account,
      resourceId: ownerAccount.id,
      memberUserId: recipientApp.id,
      raw: true,
    });

    const [edited] = await helpers.updateTransaction({
      id: tx.id,
      payload: { note: 'Apple Music subscription' },
      raw: true,
    });

    expect(edited.categoryId).toBe(ownerCategory.id);
    const detail = await helpers.asUser({
      cookies: recipient.cookies,
      fn: () => helpers.getSubscriptionById({ id: sub.id, raw: true }),
    });
    expect(detail.transactions.map((t: { id: string }) => t.id)).not.toContain(tx.id);
    const period = detail.periods.find((p: { dueDate: string }) => p.dueDate === dueDate);
    expect(period!.status).not.toBe(SUBSCRIPTION_PERIOD_STATUSES.paid);
  });
});
