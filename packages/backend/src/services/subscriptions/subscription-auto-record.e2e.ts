import {
  ACCOUNT_TYPES,
  SUBSCRIPTION_FREQUENCIES,
  SUBSCRIPTION_PERIOD_STATUSES,
  SUBSCRIPTION_TYPES,
  TRANSACTION_TYPES,
} from '@bt/shared/types';
import { describe, expect, it } from '@jest/globals';
import { ERROR_CODES } from '@js/errors';
import SubscriptionPeriods from '@models/subscription-periods.model';
import Subscriptions from '@models/subscriptions.model';
import { redisClient } from '@root/redis-client';
import { buildLockKey } from '@services/currencies/base-currency-lock';
import * as helpers from '@tests/helpers';
import { addDays, format, subDays } from 'date-fns';

import { processAutoRecordPeriods } from './process-auto-record';

const todayStr = format(new Date(), 'yyyy-MM-dd');

/**
 * Build an auto-record-ready subscription via the API. Uses `dueDate=today` so
 * the first period is generated immediately, then optionally backdates that
 * period via the ORM (the API has no setter for the period's date) so a single
 * test can stage `due today`, `due yesterday`, or `due tomorrow` without
 * juggling system time.
 */
async function createAutoRecordSubscription({
  name,
  accountId,
  amount = 12.5,
  currencyCode,
  periodDueDate = todayStr,
  periodStatus,
  transactionType,
}: {
  name: string;
  accountId: string;
  amount?: number;
  currencyCode?: string;
  periodDueDate?: string;
  periodStatus?: SUBSCRIPTION_PERIOD_STATUSES;
  transactionType?: TRANSACTION_TYPES;
}) {
  const sub = await helpers.createSubscription({
    name,
    type: SUBSCRIPTION_TYPES.subscription,
    transactionType,
    frequency: SUBSCRIPTION_FREQUENCIES.monthly,
    startDate: todayStr,
    dueDate: todayStr,
    accountId,
    expectedAmount: amount,
    expectedCurrencyCode: currencyCode ?? global.BASE_CURRENCY.code,
    autoRecord: true,
    raw: true,
  });

  if (periodDueDate !== todayStr || periodStatus) {
    const update: Record<string, unknown> = { dueDate: periodDueDate };
    if (periodStatus) update.status = periodStatus;
    await SubscriptionPeriods.update(update, { where: { subscriptionId: sub.id } });
  }

  return sub;
}

async function countTransactionsForAccount({ accountId }: { accountId: string }): Promise<number> {
  const txs = await helpers.getTransactions({ accountIds: [accountId], raw: true });
  return txs.length;
}

describe('Subscription auto-record cron', () => {
  describe('happy path', () => {
    it('books a due period, opens the next one, and does not double-book on a second tick', async () => {
      const account = await helpers.createAccount({ raw: true });

      const sub = await createAutoRecordSubscription({
        name: 'Auto netflix',
        accountId: account.id,
      });

      const result = await processAutoRecordPeriods();

      expect(result.booked).toBe(1);
      expect(result.failed).toBe(0);

      const { periods } = await helpers.getSubscriptionPeriods({ id: sub.id, raw: true });
      expect(periods.length).toBeGreaterThanOrEqual(1);

      const paid = periods.find((p) => p.status === SUBSCRIPTION_PERIOD_STATUSES.paid);
      expect(paid).toBeDefined();
      expect(paid!.transactionId).not.toBeNull();
      expect(paid!.transactionAutoCreated).toBe(true);

      expect(await countTransactionsForAccount({ accountId: account.id })).toBe(1);

      const upcoming = periods.filter((p) => p.status === SUBSCRIPTION_PERIOD_STATUSES.upcoming);
      expect(upcoming.length).toBe(1);
      expect(upcoming[0]!.dueDate > todayStr).toBe(true);

      const second = await processAutoRecordPeriods();
      expect(second.booked).toBe(0);
      expect(await countTransactionsForAccount({ accountId: account.id })).toBe(1);
    }, 60_000);

    it('books an income transaction and marks the period paid for a due upcoming income period', async () => {
      const account = await helpers.createAccount({ raw: true });

      const sub = await createAutoRecordSubscription({
        name: 'Auto Paycheck',
        accountId: account.id,
        transactionType: TRANSACTION_TYPES.income,
      });

      const result = await processAutoRecordPeriods();

      expect(result.booked).toBe(1);
      expect(result.failed).toBe(0);

      const { periods } = await helpers.getSubscriptionPeriods({ id: sub.id, raw: true });
      const paid = periods.find((p) => p.status === SUBSCRIPTION_PERIOD_STATUSES.paid);
      expect(paid).toBeDefined();

      const tx = await helpers.getTransactionById({ id: paid!.transactionId!, raw: true });
      expect(tx).not.toBeNull();
      expect(tx!.transactionType).toBe(TRANSACTION_TYPES.income);
      expect(tx!.amount).toBe(12.5);
    });

    it('dates the booked transaction at the period dueDate, not the current time', async () => {
      const account = await helpers.createAccount({ raw: true });
      const dueDate = format(subDays(new Date(), 1), 'yyyy-MM-dd');

      await createAutoRecordSubscription({
        name: 'Backdated',
        accountId: account.id,
        periodDueDate: dueDate,
      });

      await processAutoRecordPeriods();

      const txs = await helpers.getTransactions({ accountIds: [account.id], raw: true });
      expect(txs.length).toBe(1);
      expect(txs[0]!.time.toString().slice(0, 10)).toBe(dueDate);
    });
  });

  describe('skip reasons', () => {
    it('skips every ineligible period in a single tick', async () => {
      const overdueAccount = await helpers.createAccount({ raw: true });
      const futureAccount = await helpers.createAccount({ raw: true });
      const manualAccount = await helpers.createAccount({ raw: true });
      const pausedAccount = await helpers.createAccount({ raw: true });
      const finishedAccount = await helpers.createAccount({ raw: true });

      await createAutoRecordSubscription({
        name: 'Slipped',
        accountId: overdueAccount.id,
        periodDueDate: format(subDays(new Date(), 5), 'yyyy-MM-dd'),
        periodStatus: SUBSCRIPTION_PERIOD_STATUSES.overdue,
      });

      await createAutoRecordSubscription({
        name: 'Future',
        accountId: futureAccount.id,
        periodDueDate: format(addDays(new Date(), 7), 'yyyy-MM-dd'),
      });

      await helpers.createSubscription({
        name: 'Manual',
        frequency: SUBSCRIPTION_FREQUENCIES.monthly,
        startDate: todayStr,
        dueDate: todayStr,
        accountId: manualAccount.id,
        expectedAmount: 9,
        expectedCurrencyCode: global.BASE_CURRENCY.code,
        autoRecord: false,
        raw: true,
      });

      const paused = await createAutoRecordSubscription({ name: 'Paused', accountId: pausedAccount.id });
      await Subscriptions.update({ isActive: false }, { where: { id: paused.id } });

      const finished = await createAutoRecordSubscription({ name: 'Finished', accountId: finishedAccount.id });
      await Subscriptions.update({ completedAt: new Date() }, { where: { id: finished.id } });

      const result = await processAutoRecordPeriods();
      expect(result.booked).toBe(0);

      expect(await countTransactionsForAccount({ accountId: overdueAccount.id })).toBe(0);
      expect(await countTransactionsForAccount({ accountId: futureAccount.id })).toBe(0);
      expect(await countTransactionsForAccount({ accountId: manualAccount.id })).toBe(0);
      expect(await countTransactionsForAccount({ accountId: pausedAccount.id })).toBe(0);
      expect(await countTransactionsForAccount({ accountId: finishedAccount.id })).toBe(0);
    }, 60_000);
  });

  describe('idempotency + isolation', () => {
    it('books every eligible period in a single tick across multiple subscriptions', async () => {
      const accountA = await helpers.createAccount({ raw: true });
      const accountB = await helpers.createAccount({ raw: true });

      await createAutoRecordSubscription({ name: 'A', accountId: accountA.id });
      await createAutoRecordSubscription({ name: 'B', accountId: accountB.id });

      const result = await processAutoRecordPeriods();
      expect(result.booked).toBe(2);
      expect(result.failed).toBe(0);
    });
  });

  describe('base-currency lock', () => {
    it('skips a locked user this tick, then books once the lock clears', async () => {
      const { id: userId } = await helpers.getUserInfo({ raw: true });
      const account = await helpers.createAccount({ raw: true });
      await createAutoRecordSubscription({ name: 'Locked user', accountId: account.id });

      await redisClient.set(buildLockKey(userId), 'test-lock');
      try {
        const locked = await processAutoRecordPeriods();
        expect(locked.booked).toBe(0);
        expect(await countTransactionsForAccount({ accountId: account.id })).toBe(0);
      } finally {
        await redisClient.del(buildLockKey(userId));
      }

      const unlocked = await processAutoRecordPeriods();
      expect(unlocked.booked).toBe(1);
      expect(await countTransactionsForAccount({ accountId: account.id })).toBe(1);
    });
  });

  describe('validation', () => {
    it('rejects invalid autoRecord combinations', async () => {
      const account = await helpers.createAccount({ raw: true });

      const withoutAccount = await helpers.createSubscription({
        name: 'No account',
        frequency: SUBSCRIPTION_FREQUENCIES.monthly,
        startDate: todayStr,
        dueDate: todayStr,
        expectedAmount: 5,
        expectedCurrencyCode: global.BASE_CURRENCY.code,
        autoRecord: true,
      });
      expect(withoutAccount.statusCode).toBe(422);

      const withoutAmount = await helpers.createSubscription({
        name: 'No amount',
        type: SUBSCRIPTION_TYPES.bill,
        frequency: SUBSCRIPTION_FREQUENCIES.monthly,
        startDate: todayStr,
        dueDate: todayStr,
        accountId: account.id,
        autoRecord: true,
      });
      expect(withoutAmount.statusCode).toBe(422);

      const withMatchingRules = await helpers.createSubscription({
        name: 'Both',
        frequency: SUBSCRIPTION_FREQUENCIES.monthly,
        startDate: todayStr,
        dueDate: todayStr,
        accountId: account.id,
        expectedAmount: 7,
        expectedCurrencyCode: global.BASE_CURRENCY.code,
        autoRecord: true,
        matchingRules: {
          rules: [{ field: 'note', operator: 'contains_any', value: ['x'] }],
        },
      });
      expect(withMatchingRules.statusCode).toBe(422);

      const accountLess = await helpers.createSubscription({
        name: 'Account-less',
        frequency: SUBSCRIPTION_FREQUENCIES.monthly,
        startDate: todayStr,
        dueDate: todayStr,
        expectedAmount: 4,
        expectedCurrencyCode: global.BASE_CURRENCY.code,
        raw: true,
      });
      const flipOn = await helpers.updateSubscription({ id: accountLess.id, autoRecord: true });
      expect(flipOn.statusCode).toBe(422);

      const autoSub = await createAutoRecordSubscription({
        name: 'Already auto',
        accountId: account.id,
      });
      const addRules = await helpers.updateSubscription({
        id: autoSub.id,
        matchingRules: {
          rules: [{ field: 'note', operator: 'contains_any', value: ['x'] }],
        },
      });
      expect(addRules.statusCode).toBe(422);
    }, 60_000);

    it('rejects autoRecord on a bank-connected account', async () => {
      const bankAccount = await helpers.createAccount({
        payload: { ...helpers.buildAccountPayload(), type: ACCOUNT_TYPES.monobank },
        raw: true,
      });
      const basePayload = {
        frequency: SUBSCRIPTION_FREQUENCIES.monthly,
        startDate: todayStr,
        dueDate: todayStr,
        accountId: bankAccount.id,
        expectedAmount: 5,
        expectedCurrencyCode: global.BASE_CURRENCY.code,
      };

      const created = await helpers.createSubscription({ ...basePayload, name: 'Bank auto', autoRecord: true });
      expect(created.statusCode).toBe(ERROR_CODES.ValidationError);

      const manual = await helpers.createSubscription({
        ...basePayload,
        name: 'Bank manual',
        autoRecord: false,
        raw: true,
      });
      const flipOn = await helpers.updateSubscription({ id: manual.id, autoRecord: true });
      expect(flipOn.statusCode).toBe(ERROR_CODES.ValidationError);
    });
  });
});
