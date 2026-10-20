import { SUBSCRIPTION_FREQUENCIES, SUBSCRIPTION_PERIOD_STATUSES, SUBSCRIPTION_TYPES } from '@bt/shared/types';
import { describe, expect, it } from '@jest/globals';
import * as helpers from '@tests/helpers';
import { addDays, format, startOfDay, subDays } from 'date-fns';

const dayFromToday = (days: number): Date =>
  startOfDay(days >= 0 ? addDays(new Date(), days) : subDays(new Date(), -days));
const formatDay = (date: Date): string => format(date, 'yyyy-MM-dd');

const createRuleSubscription = async ({
  accountId,
  dueDate,
  installments,
}: {
  accountId: string;
  dueDate: string;
  installments?: number;
}) =>
  helpers.createSubscription({
    name: 'Netflix',
    frequency: SUBSCRIPTION_FREQUENCIES.monthly,
    startDate: dueDate,
    dueDate,
    accountId,
    expectedAmount: 10,
    expectedCurrencyCode: global.BASE_CURRENCY.code,
    matchingRules: { rules: [{ field: 'note', operator: 'contains_any', value: ['netflix'] }] },
    ...(installments ? { type: SUBSCRIPTION_TYPES.installment, maxOccurrences: installments } : {}),
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

  it('leaves one auto-created paid period when paying books a transaction the rule also matches', async () => {
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

  it("does not settle another subscription's period with the transaction booked by paying a period", async () => {
    const account = await helpers.createAccount({ raw: true });
    const dueDate = formatDay(dayFromToday(-3));
    const subA = await helpers.createSubscription({
      name: 'Spotify Family',
      frequency: SUBSCRIPTION_FREQUENCIES.monthly,
      startDate: dueDate,
      dueDate,
      accountId: account.id,
      expectedAmount: 10,
      expectedCurrencyCode: global.BASE_CURRENCY.code,
      raw: true,
    });
    // B is the only rule-bearing candidate for the booked tx (note = A's name), so the matcher picks it.
    const subB = await helpers.createSubscription({
      name: 'Music bundle',
      frequency: SUBSCRIPTION_FREQUENCIES.monthly,
      startDate: dueDate,
      dueDate,
      accountId: account.id,
      expectedAmount: 10,
      expectedCurrencyCode: global.BASE_CURRENCY.code,
      matchingRules: { rules: [{ field: 'note', operator: 'contains_any', value: ['spotify'] }] },
      raw: true,
    });

    const beforeA = await helpers.getSubscriptionById({ id: subA.id, raw: true });
    const paidPeriod = await helpers.markSubscriptionPeriodPaid({
      id: subA.id,
      periodId: beforeA.periods[0]!.id,
      createTransaction: true,
      amount: 10,
      time: dayFromToday(-3).toISOString(),
      raw: true,
    });
    const txId = paidPeriod.transactionId;
    expect(txId).not.toBeNull();

    const detailA = await helpers.getSubscriptionById({ id: subA.id, raw: true });
    const periodA = detailA.periods.find((p: { id: string }) => p.id === beforeA.periods[0]!.id);
    expect(periodA!.status).toBe(SUBSCRIPTION_PERIOD_STATUSES.paid);
    expect(periodA!.transactionId).toBe(txId);

    const detailB = await helpers.getSubscriptionById({ id: subB.id, raw: true });
    const periodB = detailB.periods.find((p: { dueDate: string }) => p.dueDate === dueDate);
    expect(periodB!.status).not.toBe(SUBSCRIPTION_PERIOD_STATUSES.paid);
    expect(detailB.periods.some((p: { transactionId: string | null }) => p.transactionId === txId)).toBe(false);
  });

  it('finishes an installment when a rule match settles its last occurrence', async () => {
    const account = await helpers.createAccount({ raw: true });
    const dueDate = formatDay(dayFromToday(-2));
    const sub = await createRuleSubscription({ accountId: account.id, dueDate, installments: 1 });

    const [tx] = await helpers.createTransaction({
      payload: helpers.buildTransactionPayload({
        accountId: account.id,
        amount: 10,
        note: 'NETFLIX.COM',
        time: dayFromToday(-2).toISOString(),
      }),
      raw: true,
    });

    const detail = await helpers.getSubscriptionById({ id: sub.id, raw: true });
    expect(detail.isActive).toBe(false);
    expect(detail.completedAt).not.toBeNull();
    expect(detail.periods).toHaveLength(1);
    expect(detail.periods[0]!.status).toBe(SUBSCRIPTION_PERIOD_STATUSES.paid);
    expect(detail.periods[0]!.transactionId).toBe(tx.id);
  });
});
