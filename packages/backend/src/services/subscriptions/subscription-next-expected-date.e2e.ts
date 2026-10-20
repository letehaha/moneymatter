import { SUBSCRIPTION_FREQUENCIES, SUBSCRIPTION_PERIOD_STATUSES } from '@bt/shared/types';
import { describe, expect, it } from '@jest/globals';
import * as helpers from '@tests/helpers';
import { addDays, addMonths, format, subDays } from 'date-fns';

/** Returns a YYYY-MM-DD string N days from today (negative for the past). */
const daysFromToday = (days: number): string =>
  format(days >= 0 ? addDays(new Date(), days) : subDays(new Date(), -days), 'yyyy-MM-dd');

const findInList = async ({ id }: { id: string }) => {
  const list = await helpers.getSubscriptions({ raw: true });
  return list.find((s: { id: string }) => s.id === id)!;
};

describe('Subscription next expected date', () => {
  describe('follows the schedule', () => {
    it('uses the scheduled dueDate instead of last payment plus one frequency step', async () => {
      const account = await helpers.createAccount({ raw: true });
      const dueDate = daysFromToday(20);
      // One month and two days before the due date: payment-based math would say dueDate - 2 days.
      const paymentDate = subDays(addMonths(new Date(dueDate + 'T00:00:00Z'), -1), 2);

      const sub = await helpers.createSubscription({
        name: 'Scheduled monthly',
        frequency: SUBSCRIPTION_FREQUENCIES.monthly,
        startDate: daysFromToday(-120),
        dueDate,
        accountId: account.id,
        expectedAmount: 10,
        expectedCurrencyCode: global.BASE_CURRENCY.code,
        raw: true,
      });

      const [payment] = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({ accountId: account.id, time: paymentDate.toISOString() }),
        raw: true,
      });
      await helpers.linkTransactionsToSubscription({ id: sub.id, transactionIds: [payment.id], raw: true });

      const detail = await helpers.getSubscriptionById({ id: sub.id, raw: true });
      expect(detail.nextExpectedDate).toBe(dueDate);

      const listed = await findInList({ id: sub.id });
      expect(listed.nextDueDate).toBe(dueDate);
    });

    it('moves to the following scheduled period once the open one is skipped', async () => {
      const dueDate = daysFromToday(15);
      const sub = await helpers.createSubscription({
        name: 'Skipped monthly',
        frequency: SUBSCRIPTION_FREQUENCIES.monthly,
        startDate: daysFromToday(-60),
        dueDate,
        expectedAmount: 10,
        expectedCurrencyCode: global.BASE_CURRENCY.code,
        raw: true,
      });

      const before = await helpers.getSubscriptionById({ id: sub.id, raw: true });
      const open = before.periods.find((p: { status: string }) => p.status === SUBSCRIPTION_PERIOD_STATUSES.upcoming);
      await helpers.skipSubscriptionPeriod({ id: sub.id, periodId: open!.id, raw: true });

      const after = await helpers.getSubscriptionById({ id: sub.id, raw: true });
      const nextOpen = after.periods.find(
        (p: { status: string }) => p.status === SUBSCRIPTION_PERIOD_STATUSES.upcoming,
      );
      expect(nextOpen).toBeDefined();
      expect(nextOpen!.dueDate).not.toBe(dueDate);
      expect(after.nextExpectedDate).toBe(nextOpen!.dueDate);
    });

    it('falls back to the payment-based estimate when the subscription has no schedule', async () => {
      const account = await helpers.createAccount({ raw: true });
      const paymentDate = subDays(new Date(), 5);

      const sub = await helpers.createSubscription({
        name: 'Detection only',
        frequency: SUBSCRIPTION_FREQUENCIES.monthly,
        startDate: daysFromToday(-90),
        accountId: account.id,
        expectedAmount: 10,
        expectedCurrencyCode: global.BASE_CURRENCY.code,
        raw: true,
      });
      const [payment] = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({ accountId: account.id, time: paymentDate.toISOString() }),
        raw: true,
      });
      await helpers.linkTransactionsToSubscription({ id: sub.id, transactionIds: [payment.id], raw: true });

      const detail = await helpers.getSubscriptionById({ id: sub.id, raw: true });
      expect(detail.nextExpectedDate).toBe(format(addMonths(paymentDate, 1), 'yyyy-MM-dd'));
    });
  });

  describe('inactive or ended subscriptions', () => {
    it('has no next date for an inactive subscription', async () => {
      const sub = await helpers.createSubscription({
        name: 'Paused',
        frequency: SUBSCRIPTION_FREQUENCIES.monthly,
        startDate: daysFromToday(-60),
        dueDate: daysFromToday(10),
        expectedAmount: 10,
        expectedCurrencyCode: global.BASE_CURRENCY.code,
        raw: true,
      });
      await helpers.toggleSubscriptionActive({ id: sub.id, isActive: false, raw: true });

      const detail = await helpers.getSubscriptionById({ id: sub.id, raw: true });
      expect(detail.nextExpectedDate).toBeNull();

      const listed = await findInList({ id: sub.id });
      expect(listed.nextDueDate).toBeNull();
    });

    it('has no next date when the end date falls before the scheduled due date', async () => {
      const sub = await helpers.createSubscription({
        name: 'Ends before due',
        frequency: SUBSCRIPTION_FREQUENCIES.monthly,
        startDate: daysFromToday(-60),
        dueDate: daysFromToday(20),
        endDate: daysFromToday(5),
        expectedAmount: 10,
        expectedCurrencyCode: global.BASE_CURRENCY.code,
        raw: true,
      });

      const detail = await helpers.getSubscriptionById({ id: sub.id, raw: true });
      expect(detail.nextExpectedDate).toBeNull();

      const listed = await findInList({ id: sub.id });
      expect(listed.nextDueDate).toBeNull();
    });
  });
});
