import {
  type RecordId,
  SUBSCRIPTION_FREQUENCIES,
  SUBSCRIPTION_INTERVAL_UNITS,
  SUBSCRIPTION_PERIOD_STATUSES,
} from '@bt/shared/types';
import { toUtcDateString } from '@common/utils/date';
import { describe, expect, it } from '@jest/globals';
import { ERROR_CODES } from '@js/errors';
import * as helpers from '@tests/helpers';

const DAY_MS = 86_400_000;
const today = () => toUtcDateString(new Date());
const plusDays = ({ date, days }: { date: string; days: number }) =>
  toUtcDateString(new Date(Date.parse(`${date}T00:00:00.000Z`) + days * DAY_MS));

const OPEN_STATUSES: string[] = [SUBSCRIPTION_PERIOD_STATUSES.upcoming, SUBSCRIPTION_PERIOD_STATUSES.overdue];

const every30Days = {
  frequency: SUBSCRIPTION_FREQUENCIES.custom,
  intervalUnit: SUBSCRIPTION_INTERVAL_UNITS.day,
  intervalCount: 30,
};

const createBill = (overrides: Partial<Parameters<typeof helpers.createSubscription>[0]> = {}) =>
  helpers.createSubscription({
    name: 'Mobile plan',
    expectedAmount: 30,
    expectedCurrencyCode: global.BASE_CURRENCY_CODE,
    startDate: today(),
    frequency: SUBSCRIPTION_FREQUENCIES.monthly,
    ...overrides,
    raw: true,
  });

const openPeriod = async ({ id }: { id: string }) => {
  const detail = await helpers.getSubscriptionById({ id, raw: true });
  const open = detail.periods.filter((p) => OPEN_STATUSES.includes(p.status));
  expect(open).toHaveLength(1);
  return open[0]!;
};

const payOpenPeriod = async ({ id }: { id: string }) => {
  const period = await openPeriod({ id });
  await helpers.markSubscriptionPeriodPaid({ id, periodId: period.id, raw: true });
};

describe('Subscriptions with a custom recurrence interval', () => {
  describe('create and read', () => {
    it('stores every 30 days and steps each next period by 30 days', async () => {
      const dueDate = plusDays({ date: today(), days: 3 });
      const created = await createBill({ ...every30Days, startDate: dueDate, dueDate });

      expect(created).toMatchObject(every30Days);

      const detail = await helpers.getSubscriptionById({ id: created.id, raw: true });
      expect(detail).toMatchObject(every30Days);
      expect(detail.nextExpectedDate).toBe(dueDate);

      const [listItem] = await helpers.getSubscriptions({ raw: true });
      expect(listItem).toMatchObject({ ...every30Days, nextDueDate: dueDate });

      await payOpenPeriod({ id: created.id });
      expect((await openPeriod({ id: created.id })).dueDate).toBe(plusDays({ date: dueDate, days: 30 }));

      await payOpenPeriod({ id: created.id });
      expect((await openPeriod({ id: created.id })).dueDate).toBe(plusDays({ date: dueDate, days: 60 }));
    });

    it('estimates the next date of an unscheduled custom subscription by its step', async () => {
      const startDate = plusDays({ date: today(), days: -50 });
      const created = await createBill({ ...every30Days, startDate });

      const detail = await helpers.getSubscriptionById({ id: created.id, raw: true });
      expect(detail.nextExpectedDate).toBe(plusDays({ date: startDate, days: 60 }));
    });

    it('stores a custom step equal to a preset as that preset', async () => {
      const monthly = await createBill({
        frequency: SUBSCRIPTION_FREQUENCIES.custom,
        intervalUnit: SUBSCRIPTION_INTERVAL_UNITS.month,
        intervalCount: 1,
      });
      expect(monthly).toMatchObject({
        frequency: SUBSCRIPTION_FREQUENCIES.monthly,
        intervalUnit: null,
        intervalCount: null,
      });

      const weekly = await createBill({
        frequency: SUBSCRIPTION_FREQUENCIES.custom,
        intervalUnit: SUBSCRIPTION_INTERVAL_UNITS.day,
        intervalCount: 7,
      });
      expect(weekly).toMatchObject({ frequency: SUBSCRIPTION_FREQUENCIES.weekly, intervalUnit: null });
    });

    it('returns a null step for a preset', async () => {
      const created = await createBill();
      expect(created).toMatchObject({
        frequency: SUBSCRIPTION_FREQUENCIES.monthly,
        intervalUnit: null,
        intervalCount: null,
      });
    });
  });

  describe('validation', () => {
    it.each([
      ['custom without a step', { frequency: SUBSCRIPTION_FREQUENCIES.custom }],
      [
        'custom with only a unit',
        { frequency: SUBSCRIPTION_FREQUENCIES.custom, intervalUnit: SUBSCRIPTION_INTERVAL_UNITS.day },
      ],
      [
        'a step with a preset',
        {
          frequency: SUBSCRIPTION_FREQUENCIES.monthly,
          intervalUnit: SUBSCRIPTION_INTERVAL_UNITS.day,
          intervalCount: 30,
        },
      ],
      ['count 0', { ...every30Days, intervalCount: 0 }],
      ['a fractional count', { ...every30Days, intervalCount: 1.5 }],
      ['a day count above 366', { ...every30Days, intervalCount: 367 }],
      [
        'a year count above 10',
        {
          frequency: SUBSCRIPTION_FREQUENCIES.custom,
          intervalUnit: SUBSCRIPTION_INTERVAL_UNITS.year,
          intervalCount: 11,
        },
      ],
      [
        'a week count above 104',
        {
          frequency: SUBSCRIPTION_FREQUENCIES.custom,
          intervalUnit: SUBSCRIPTION_INTERVAL_UNITS.week,
          intervalCount: 105,
        },
      ],
      [
        'a month count above 120',
        {
          frequency: SUBSCRIPTION_FREQUENCIES.custom,
          intervalUnit: SUBSCRIPTION_INTERVAL_UNITS.month,
          intervalCount: 121,
        },
      ],
      ['an unknown unit', { ...every30Days, intervalUnit: 'hour' as SUBSCRIPTION_INTERVAL_UNITS }],
    ])('refuses to create %s', async (_label, recurrence) => {
      const res = await helpers.createSubscription({
        name: 'Broken',
        expectedAmount: 10,
        expectedCurrencyCode: global.BASE_CURRENCY_CODE,
        startDate: today(),
        ...recurrence,
      });
      expect(res.statusCode).toBe(ERROR_CODES.ValidationError);
    });

    it('names the missing count in the refusal', async () => {
      const res = await helpers.createSubscription({
        name: 'Broken',
        expectedAmount: 10,
        expectedCurrencyCode: global.BASE_CURRENCY_CODE,
        startDate: today(),
        frequency: SUBSCRIPTION_FREQUENCIES.custom,
        intervalUnit: SUBSCRIPTION_INTERVAL_UNITS.day,
      });
      expect(res.statusCode).toBe(ERROR_CODES.ValidationError);
      expect((res.body.response as unknown as helpers.ErrorResponse).message).toContain('intervalCount');
    });

    it('accepts the largest count of each unit', async () => {
      for (const [intervalUnit, intervalCount] of [
        [SUBSCRIPTION_INTERVAL_UNITS.day, 366],
        [SUBSCRIPTION_INTERVAL_UNITS.week, 104],
        [SUBSCRIPTION_INTERVAL_UNITS.month, 120],
        [SUBSCRIPTION_INTERVAL_UNITS.year, 10],
      ] as const) {
        const created = await createBill({ frequency: SUBSCRIPTION_FREQUENCIES.custom, intervalUnit, intervalCount });
        expect(created).toMatchObject({ frequency: SUBSCRIPTION_FREQUENCIES.custom, intervalUnit, intervalCount });
      }
    });

    it('refuses an update to custom without a step', async () => {
      const created = await createBill();
      const res = await helpers.updateSubscription({ id: created.id, frequency: SUBSCRIPTION_FREQUENCIES.custom });
      expect(res.statusCode).toBe(ERROR_CODES.ValidationError);
    });

    it('refuses a step on a stored preset without switching to custom', async () => {
      const created = await createBill();
      const res = await helpers.updateSubscription({
        id: created.id,
        intervalUnit: SUBSCRIPTION_INTERVAL_UNITS.day,
        intervalCount: 30,
      });
      expect(res.statusCode).toBe(ERROR_CODES.ValidationError);
    });

    it('refuses an update whose merged count exceeds the stored unit limit', async () => {
      const created = await createBill({
        frequency: SUBSCRIPTION_FREQUENCIES.custom,
        intervalUnit: SUBSCRIPTION_INTERVAL_UNITS.year,
        intervalCount: 2,
      });
      const res = await helpers.updateSubscription({ id: created.id, intervalCount: 30 });
      expect(res.statusCode).toBe(ERROR_CODES.ValidationError);
    });

    it('refuses clearing the unit of a custom subscription', async () => {
      const created = await createBill(every30Days);
      const res = await helpers.updateSubscription({ id: created.id, intervalUnit: null });
      expect(res.statusCode).toBe(ERROR_CODES.ValidationError);
    });
  });

  describe('update', () => {
    it('switches monthly to every 30 days, keeping the open period and stepping 30 days after it', async () => {
      const dueDate = plusDays({ date: today(), days: 5 });
      const created = await createBill({ startDate: dueDate, dueDate });

      const updated = await helpers.updateSubscription({ id: created.id, ...every30Days, raw: true });
      expect(updated).toMatchObject(every30Days);

      const open = await openPeriod({ id: created.id });
      expect(open.dueDate).toBe(dueDate);

      await payOpenPeriod({ id: created.id });
      expect((await openPeriod({ id: created.id })).dueDate).toBe(plusDays({ date: dueDate, days: 30 }));
    });

    it('switches custom back to monthly and clears the step', async () => {
      const created = await createBill(every30Days);

      const updated = await helpers.updateSubscription({
        id: created.id,
        frequency: SUBSCRIPTION_FREQUENCIES.monthly,
        raw: true,
      });
      expect(updated).toMatchObject({
        frequency: SUBSCRIPTION_FREQUENCIES.monthly,
        intervalUnit: null,
        intervalCount: null,
      });
    });

    it('updates only the count of a custom step', async () => {
      const created = await createBill(every30Days);

      const updated = await helpers.updateSubscription({ id: created.id, intervalCount: 28, raw: true });
      expect(updated).toMatchObject({ ...every30Days, intervalCount: 28 });

      const detail = await helpers.getSubscriptionById({ id: created.id, raw: true });
      expect(detail).toMatchObject({ ...every30Days, intervalCount: 28 });
    });

    it("updates only the unit of a custom step and checks the inherited count against the new unit's limit", async () => {
      const created = await createBill(every30Days);
      const updated = await helpers.updateSubscription({
        id: created.id,
        intervalUnit: SUBSCRIPTION_INTERVAL_UNITS.week,
        raw: true,
      });
      expect(updated).toMatchObject({ ...every30Days, intervalUnit: SUBSCRIPTION_INTERVAL_UNITS.week });

      const every200Days = await createBill({ ...every30Days, intervalCount: 200 });
      const res = await helpers.updateSubscription({
        id: every200Days.id,
        intervalUnit: SUBSCRIPTION_INTERVAL_UNITS.year,
      });
      expect(res.statusCode).toBe(ERROR_CODES.ValidationError);
    });

    it('folds an updated step that equals a preset into the preset', async () => {
      const created = await createBill(every30Days);

      const updated = await helpers.updateSubscription({ id: created.id, intervalCount: 14, raw: true });
      expect(updated).toMatchObject({
        frequency: SUBSCRIPTION_FREQUENCIES.biweekly,
        intervalUnit: null,
        intervalCount: null,
      });
    });

    it('leaves the step alone on an edit that does not touch the schedule', async () => {
      const created = await createBill(every30Days);

      const updated = await helpers.updateSubscription({ id: created.id, name: 'Magti', raw: true });
      expect(updated).toMatchObject({ ...every30Days, name: 'Magti' });
    });
  });

  describe('settling a period from a matched transaction', () => {
    const createRuleBill = async ({ accountId, dueDate }: { accountId: string; dueDate: string }) =>
      createBill({
        ...every30Days,
        startDate: dueDate,
        dueDate,
        accountId,
        expectedAmount: 10,
        matchingRules: { rules: [{ field: 'note', operator: 'contains_any', value: ['magti'] }] },
      });

    const bookPayment = async ({ accountId, date }: { accountId: RecordId; date: string }) => {
      const [tx] = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId,
          amount: 10,
          note: 'MAGTI MOBILE',
          time: `${date}T12:00:00.000Z`,
        }),
        raw: true,
      });
      return tx;
    };

    it('settles the open period with a payment 15 days from a 30-day due date', async () => {
      const account = await helpers.createAccount({ raw: true });
      const dueDate = plusDays({ date: today(), days: -20 });
      const sub = await createRuleBill({ accountId: account.id, dueDate });

      const tx = await bookPayment({ accountId: account.id, date: plusDays({ date: dueDate, days: -15 }) });

      const detail = await helpers.getSubscriptionById({ id: sub.id, raw: true });
      const period = detail.periods.find((p) => p.dueDate === dueDate);
      expect(period!.status).toBe(SUBSCRIPTION_PERIOD_STATUSES.paid);
      expect(period!.transactionId).toBe(tx!.id);
    });

    it('only links a payment 16 days from a 30-day due date', async () => {
      const account = await helpers.createAccount({ raw: true });
      const dueDate = plusDays({ date: today(), days: -20 });
      const sub = await createRuleBill({ accountId: account.id, dueDate });

      const tx = await bookPayment({ accountId: account.id, date: plusDays({ date: dueDate, days: -16 }) });

      const detail = await helpers.getSubscriptionById({ id: sub.id, raw: true });
      expect(detail.transactions.map((t) => t.id)).toContain(tx!.id);
      const period = detail.periods.find((p) => p.dueDate === dueDate);
      expect(period!.status).not.toBe(SUBSCRIPTION_PERIOD_STATUSES.paid);
      expect(period!.transactionId).toBeNull();
    });
  });

  describe('reports', () => {
    it('lists a custom subscription in upcoming payments with its step and next date', async () => {
      const startDate = plusDays({ date: today(), days: -50 });
      await createBill({ ...every30Days, startDate });

      const [upcoming] = await helpers.getUpcomingPayments({ raw: true });
      expect(upcoming).toMatchObject({
        ...every30Days,
        nextPaymentDate: plusDays({ date: startDate, days: 60 }),
      });
    });

    it('counts a custom subscription at its monthly equivalent in the summary', async () => {
      await createBill({ ...every30Days, expectedAmount: 30 });
      await createBill({
        frequency: SUBSCRIPTION_FREQUENCIES.custom,
        intervalUnit: SUBSCRIPTION_INTERVAL_UNITS.month,
        intervalCount: 2,
        expectedAmount: 50,
      });

      const summary = await helpers.getSubscriptionsSummary({ raw: true });
      // 30 every 30 days → 30 × 30.44 / 30 = 30.44 a month; 50 every 2 months → 25.
      expect(summary.estimatedMonthlyCost).toBe(55.44);
    });

    it('counts custom week and year steps at their monthly equivalent', async () => {
      await createBill({
        frequency: SUBSCRIPTION_FREQUENCIES.custom,
        intervalUnit: SUBSCRIPTION_INTERVAL_UNITS.week,
        intervalCount: 3,
        expectedAmount: 30,
      });
      await createBill({
        frequency: SUBSCRIPTION_FREQUENCIES.custom,
        intervalUnit: SUBSCRIPTION_INTERVAL_UNITS.year,
        intervalCount: 2,
        expectedAmount: 240,
      });

      const summary = await helpers.getSubscriptionsSummary({ raw: true });
      // 30 every 3 weeks → 30 × 4.33 / 3 = 43.3 a month; 240 every 2 years → 240 / 12 / 2 = 10.
      expect(summary.estimatedMonthlyCost).toBe(53.3);
    });

    it('offers linked payments inside the custom period window only', async () => {
      const account = await helpers.createAccount({ raw: true });
      const dueDate = plusDays({ date: today(), days: -40 });
      const created = await createBill({
        frequency: SUBSCRIPTION_FREQUENCIES.custom,
        intervalUnit: SUBSCRIPTION_INTERVAL_UNITS.day,
        intervalCount: 20,
        startDate: dueDate,
        dueDate,
        accountId: account.id,
      });

      // Every 20 days: the window runs from 20 days before to 20 days after the due date,
      // and only payments within 10 days settle the period on their own.
      const book = async ({ days }: { days: number }) => {
        const [tx] = await helpers.createTransaction({
          payload: helpers.buildTransactionPayload({
            accountId: account.id,
            amount: 30,
            time: `${plusDays({ date: dueDate, days })}T12:00:00.000Z`,
          }),
          raw: true,
        });
        return tx!;
      };
      const inside = await book({ days: 15 });
      const outside = await book({ days: 25 });
      await helpers.linkTransactionsToSubscription({
        id: created.id,
        transactionIds: [inside.id, outside.id],
        raw: true,
      });

      const period = await openPeriod({ id: created.id });
      expect(period.dueDate).toBe(dueDate);
      const preview = await helpers.getSubscriptionPayPreview({ id: created.id, periodId: period.id, raw: true });
      expect(preview.linkedPayments.map((p) => p.id)).toEqual([inside.id]);
    });
  });
});
