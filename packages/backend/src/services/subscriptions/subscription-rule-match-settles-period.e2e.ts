import { SUBSCRIPTION_FREQUENCIES, SUBSCRIPTION_PERIOD_STATUSES } from '@bt/shared/types';
import { describe, expect, it } from '@jest/globals';
import * as helpers from '@tests/helpers';
import { addDays, format, startOfDay, subDays } from 'date-fns';

const dayFromToday = (days: number): Date =>
  startOfDay(days >= 0 ? addDays(new Date(), days) : subDays(new Date(), -days));
const formatDay = (date: Date): string => format(date, 'yyyy-MM-dd');

const createRuleSubscription = async ({ accountId, dueDate }: { accountId: string; dueDate: string }) =>
  helpers.createSubscription({
    name: 'Netflix',
    frequency: SUBSCRIPTION_FREQUENCIES.monthly,
    startDate: dueDate,
    dueDate,
    accountId,
    expectedAmount: 10,
    expectedCurrencyCode: global.BASE_CURRENCY.code,
    matchingRules: { rules: [{ field: 'note', operator: 'contains_any', value: ['netflix'] }] },
    raw: true,
  });

describe('Rule match settles the nearest open period', () => {
  it('marks the overdue period paid with a matching transaction dated 2 days early', async () => {
    const account = await helpers.createAccount({ raw: true });
    const dueDate = formatDay(dayFromToday(-10));
    const sub = await createRuleSubscription({ accountId: account.id, dueDate });

    const [tx] = await helpers.createTransaction({
      payload: helpers.buildTransactionPayload({
        accountId: account.id,
        amount: 10,
        note: 'NETFLIX.COM',
        time: dayFromToday(-12).toISOString(),
      }),
      raw: true,
    });

    const detail = await helpers.getSubscriptionById({ id: sub.id, raw: true });
    expect(detail.transactions.map((t: { id: string }) => t.id)).toContain(tx.id);

    const settled = detail.periods.find((p: { dueDate: string }) => p.dueDate === dueDate);
    expect(settled!.status).toBe(SUBSCRIPTION_PERIOD_STATUSES.paid);
    expect(settled!.transactionId).toBe(tx.id);
    expect(settled!.transactionAutoCreated).toBe(false);

    // The schedule continues with a fresh open period.
    const open = detail.periods.filter(
      (p: { status: string }) =>
        p.status === SUBSCRIPTION_PERIOD_STATUSES.upcoming || p.status === SUBSCRIPTION_PERIOD_STATUSES.overdue,
    );
    expect(open).toHaveLength(1);
    expect(open[0]!.dueDate > dueDate).toBe(true);
  });

  it('keeps only the link when the transaction is 40 days away from the due date', async () => {
    const account = await helpers.createAccount({ raw: true });
    const dueDate = formatDay(dayFromToday(-50));
    const sub = await createRuleSubscription({ accountId: account.id, dueDate });

    const [tx] = await helpers.createTransaction({
      payload: helpers.buildTransactionPayload({
        accountId: account.id,
        amount: 10,
        note: 'NETFLIX.COM',
        time: dayFromToday(-10).toISOString(),
      }),
      raw: true,
    });

    const detail = await helpers.getSubscriptionById({ id: sub.id, raw: true });
    expect(detail.transactions.map((t: { id: string }) => t.id)).toContain(tx.id);

    const period = detail.periods.find((p: { dueDate: string }) => p.dueDate === dueDate);
    expect(period!.status).not.toBe(SUBSCRIPTION_PERIOD_STATUSES.paid);
    expect(period!.transactionId).toBeNull();
  });

  it('does not double-settle when a period is paid by booking a transaction that the rule also matches', async () => {
    const account = await helpers.createAccount({ raw: true });
    const dueDate = formatDay(dayFromToday(-3));
    const sub = await createRuleSubscription({ accountId: account.id, dueDate });

    const before = await helpers.getSubscriptionById({ id: sub.id, raw: true });
    await helpers.markSubscriptionPeriodPaid({
      id: sub.id,
      periodId: before.periods[0]!.id,
      createTransaction: true,
      amount: 10,
      time: dayFromToday(-3).toISOString(),
      raw: true,
    });

    const detail = await helpers.getSubscriptionById({ id: sub.id, raw: true });
    const paid = detail.periods.filter((p: { status: string }) => p.status === SUBSCRIPTION_PERIOD_STATUSES.paid);
    expect(paid).toHaveLength(1);
    expect(paid[0]!.transactionAutoCreated).toBe(true);
  });
});
