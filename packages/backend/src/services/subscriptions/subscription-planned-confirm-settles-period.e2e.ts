import {
  type RecordId,
  SUBSCRIPTION_FREQUENCIES,
  SUBSCRIPTION_PERIOD_STATUSES,
  TRANSACTION_TYPES,
} from '@bt/shared/types';
import { describe, expect, it } from '@jest/globals';
import * as helpers from '@tests/helpers';
import { addDays, format, startOfDay, subDays } from 'date-fns';

const dayFromToday = (days: number): Date =>
  startOfDay(days >= 0 ? addDays(new Date(), days) : subDays(new Date(), -days));
const formatDay = (date: Date): string => format(date, 'yyyy-MM-dd');

const createSalarySubscription = ({ accountId, dueDate }: { accountId: string; dueDate: string }) =>
  helpers.createSubscription({
    name: 'Salary',
    transactionType: TRANSACTION_TYPES.income,
    frequency: SUBSCRIPTION_FREQUENCIES.monthly,
    startDate: dueDate,
    dueDate,
    accountId,
    expectedAmount: 1000,
    expectedCurrencyCode: global.BASE_CURRENCY.code,
    matchingRules: { rules: [{ field: 'note', operator: 'contains_any', value: ['salary'] }] },
    raw: true,
  });

const createPlannedSalary = async ({ accountId, time }: { accountId: RecordId; time: Date }) => {
  const [planned] = await helpers.createPlannedTransaction({
    payload: {
      accountId,
      amount: 1000,
      transactionType: TRANSACTION_TYPES.income,
      note: 'Salary',
      time: time.toISOString(),
    },
    raw: true,
  });
  return planned;
};

const findPeriod = async ({ subscriptionId, dueDate }: { subscriptionId: string; dueDate: string }) => {
  const detail = await helpers.getSubscriptionById({ id: subscriptionId, raw: true });
  return detail.periods.find((p: { dueDate: string }) => p.dueDate === dueDate)!;
};

describe('Confirming a planned transaction settles the subscription period', () => {
  it('marks the period paid when a rule-linked plan is confirmed', async () => {
    const account = await helpers.createAccount({ raw: true });
    const dueDate = formatDay(dayFromToday(-3));
    const sub = await createSalarySubscription({ accountId: account.id, dueDate });

    const planned = await createPlannedSalary({ accountId: account.id, time: dayFromToday(-3) });

    // Linked by the rule, but a plan is not money that moved, so the period stays open.
    const linked = await helpers.getSubscriptionById({ id: sub.id, raw: true });
    expect(linked.transactions.map((t: { id: string }) => t.id)).toContain(planned!.id);
    expect((await findPeriod({ subscriptionId: sub.id, dueDate })).status).not.toBe(SUBSCRIPTION_PERIOD_STATUSES.paid);

    await helpers.updateTransaction({ id: planned!.id, payload: { isPlanned: false }, raw: true });

    const period = await findPeriod({ subscriptionId: sub.id, dueDate });
    expect(period.status).toBe(SUBSCRIPTION_PERIOD_STATUSES.paid);
    expect(period.transactionId).toBe(planned!.id);
    expect(period.transactionAutoCreated).toBe(false);
  });

  it('marks the period paid when a plan linked by hand is confirmed', async () => {
    const account = await helpers.createAccount({ raw: true });
    const dueDate = formatDay(dayFromToday(-3));
    const sub = await createSalarySubscription({ accountId: account.id, dueDate });

    const [planned] = await helpers.createPlannedTransaction({
      payload: {
        accountId: account.id,
        amount: 1000,
        transactionType: TRANSACTION_TYPES.income,
        note: 'Monthly pay',
        time: dayFromToday(-3).toISOString(),
      },
      raw: true,
    });
    await helpers.linkTransactionsToSubscription({ id: sub.id, transactionIds: [planned!.id], raw: true });
    expect((await findPeriod({ subscriptionId: sub.id, dueDate })).status).not.toBe(SUBSCRIPTION_PERIOD_STATUSES.paid);

    await helpers.updateTransaction({ id: planned!.id, payload: { isPlanned: false }, raw: true });

    const period = await findPeriod({ subscriptionId: sub.id, dueDate });
    expect(period.status).toBe(SUBSCRIPTION_PERIOD_STATUSES.paid);
    expect(period.transactionId).toBe(planned!.id);
  });

  it('leaves the period open when the confirmed row lands outside the tolerance window', async () => {
    const account = await helpers.createAccount({ raw: true });
    const dueDate = formatDay(dayFromToday(-50));
    const sub = await createSalarySubscription({ accountId: account.id, dueDate });

    const planned = await createPlannedSalary({ accountId: account.id, time: dayFromToday(-50) });

    // Confirmed with the date the money actually arrived, 40 days after the due date.
    await helpers.updateTransaction({
      id: planned!.id,
      payload: { isPlanned: false, time: dayFromToday(-10).toISOString() },
      raw: true,
    });

    const detail = await helpers.getSubscriptionById({ id: sub.id, raw: true });
    expect(detail.transactions.map((t: { id: string }) => t.id)).toContain(planned!.id);

    const period = detail.periods.find((p: { dueDate: string }) => p.dueDate === dueDate)!;
    expect(period.status).not.toBe(SUBSCRIPTION_PERIOD_STATUSES.paid);
    expect(period.transactionId).toBeNull();
  });

  it('does not settle anything while an edit keeps the row planned', async () => {
    const account = await helpers.createAccount({ raw: true });
    const dueDate = formatDay(dayFromToday(-3));
    const sub = await createSalarySubscription({ accountId: account.id, dueDate });

    const planned = await createPlannedSalary({ accountId: account.id, time: dayFromToday(-3) });
    await helpers.updateTransaction({ id: planned!.id, payload: { note: 'Salary, moved' }, raw: true });

    const period = await findPeriod({ subscriptionId: sub.id, dueDate });
    expect(period.status).not.toBe(SUBSCRIPTION_PERIOD_STATUSES.paid);
    expect(period.transactionId).toBeNull();
  });
});
