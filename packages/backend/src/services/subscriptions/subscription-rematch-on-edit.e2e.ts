import { SUBSCRIPTION_FREQUENCIES, SUBSCRIPTION_PERIOD_STATUSES } from '@bt/shared/types';
import { describe, expect, it } from '@jest/globals';
import * as helpers from '@tests/helpers';
import { addDays, format, startOfDay, subDays } from 'date-fns';

const dayFromToday = (days: number): Date =>
  startOfDay(days >= 0 ? addDays(new Date(), days) : subDays(new Date(), -days));
const formatDay = (date: Date): string => format(date, 'yyyy-MM-dd');

const createRuleSubscription = async ({ accountId, dueDate }: { accountId: string; dueDate: string }) =>
  helpers.createSubscription({
    name: 'Apple Music',
    frequency: SUBSCRIPTION_FREQUENCIES.monthly,
    startDate: dueDate,
    dueDate,
    accountId,
    expectedAmount: 10,
    expectedCurrencyCode: global.BASE_CURRENCY.code,
    matchingRules: { rules: [{ field: 'note', operator: 'contains_any', value: ['apple music'] }] },
    raw: true,
  });

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
});
