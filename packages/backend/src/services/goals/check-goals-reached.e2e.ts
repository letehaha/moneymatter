import { ACCOUNT_CATEGORIES, NOTIFICATION_TYPES, type RecordId, TRANSACTION_TYPES } from '@bt/shared/types';
import { t } from '@i18n/index';
import { describe, expect, it } from '@jest/globals';
import Goals from '@models/goals.model';
import * as helpers from '@tests/helpers';
import { subDays } from 'date-fns';

import { checkGoalsReached } from './check-goals-reached';

const goalNotifications = () => helpers.getNotifications({ type: NOTIFICATION_TYPES.goalReached, raw: true });

const addTransaction = ({
  accountId,
  amount,
  transactionType,
}: {
  accountId: RecordId;
  amount: number;
  transactionType: TRANSACTION_TYPES;
}) =>
  helpers.createTransaction({
    payload: helpers.buildTransactionPayload({ accountId, amount, transactionType }),
    raw: true,
  });

/** A goal of 1000 backed 100% by a fresh account, funded with `balance` after creation so create doesn't latch it. */
const setupGoal = async ({ balance }: { balance: number }) => {
  const account = await helpers.createAccount({ raw: true });
  const goal = await helpers.createGoal({
    payload: { name: 'Vacation', targetAmount: 1000, accounts: [{ accountId: account.id, sharePercent: 100 }] },
    raw: true,
  });
  if (balance)
    await addTransaction({ accountId: account.id, amount: balance, transactionType: TRANSACTION_TYPES.income });
  return { accountId: account.id, goal };
};

const backdateLatch = ({ goalId, days }: { goalId: RecordId; days: number }) =>
  Goals.update({ achievedAt: subDays(new Date(), days) }, { where: { id: goalId } });

describe('Goals reached check', () => {
  it('latches a reached goal and sends exactly one notification', async () => {
    const { goal } = await setupGoal({ balance: 1200 });

    expect(await checkGoalsReached()).toEqual({ usersChecked: 1, notified: 1, failed: 0, errors: [] });

    const notifications = await goalNotifications();
    expect(notifications).toHaveLength(1);
    expect(notifications[0]).toMatchObject({
      title: t({ key: 'goals.reachedNotification.title', variables: { name: 'Vacation' } }),
      payload: {
        goalId: goal.id,
        goalName: 'Vacation',
        achievedAmount: 1200,
        currencyCode: global.BASE_CURRENCY.code,
      },
    });
    const stored = await helpers.getGoal({ goalId: goal.id, raw: true });
    expect(stored.achievedAt).not.toBeNull();
    expect(stored.achievedAmount).toBe(1200);

    expect(await checkGoalsReached()).toEqual({ usersChecked: 1, notified: 0, failed: 0, errors: [] });
    expect(await goalNotifications()).toHaveLength(1);
  });

  it('sends nothing for a goal below its target', async () => {
    const { goal } = await setupGoal({ balance: 400 });

    await checkGoalsReached();

    expect(await goalNotifications()).toEqual([]);
    expect((await helpers.getGoal({ goalId: goal.id, raw: true })).achievedAt).toBeNull();
  });

  it('never notifies for an archived goal', async () => {
    const { goal } = await setupGoal({ balance: 1200 });
    await helpers.updateGoal({ goalId: goal.id, payload: { status: 'archived' }, raw: true });

    expect(await checkGoalsReached()).toEqual({ usersChecked: 0, notified: 0, failed: 0, errors: [] });
    expect(await goalNotifications()).toEqual([]);
  });

  it('latches on an edit that reaches the goal, without waiting for the cron', async () => {
    const { goal } = await setupGoal({ balance: 600 });

    const updated = await helpers.updateGoal({ goalId: goal.id, payload: { targetAmount: 500 }, raw: true });

    expect(updated.achievedAmount).toBe(600);
    expect(await goalNotifications()).toHaveLength(1);
  });

  it('clears the latch when the target changes, without notifying', async () => {
    const { goal } = await setupGoal({ balance: 1200 });
    await checkGoalsReached();

    const updated = await helpers.updateGoal({ goalId: goal.id, payload: { targetAmount: 5000 }, raw: true });

    expect(updated).toMatchObject({ achievedAt: null, achievedAmount: null });
    expect(await goalNotifications()).toHaveLength(1);
  });

  it('keeps the latch for 30 days below target, then re-arms for the next completion', async () => {
    const { accountId, goal } = await setupGoal({ balance: 1200 });
    await checkGoalsReached();
    await addTransaction({ accountId, amount: 500, transactionType: TRANSACTION_TYPES.expense });

    await checkGoalsReached();
    expect((await helpers.getGoal({ goalId: goal.id, raw: true })).achievedAt).not.toBeNull();

    await backdateLatch({ goalId: goal.id, days: 29 });
    await checkGoalsReached();
    expect((await helpers.getGoal({ goalId: goal.id, raw: true })).achievedAt).not.toBeNull();

    await backdateLatch({ goalId: goal.id, days: 31 });
    await checkGoalsReached();
    expect(await helpers.getGoal({ goalId: goal.id, raw: true })).toMatchObject({
      achievedAt: null,
      achievedAmount: null,
    });

    await addTransaction({ accountId, amount: 500, transactionType: TRANSACTION_TYPES.income });
    expect(await checkGoalsReached()).toMatchObject({ notified: 1 });
    expect(await goalNotifications()).toHaveLength(2);
  });

  it('uses the goal’s own hold window, and 0 reads and re-arms live', async () => {
    const { accountId, goal } = await setupGoal({ balance: 1200 });
    await checkGoalsReached();
    await helpers.updateGoal({ goalId: goal.id, payload: { reachedHoldDays: 7 }, raw: true });
    await addTransaction({ accountId, amount: 500, transactionType: TRANSACTION_TYPES.expense });

    await backdateLatch({ goalId: goal.id, days: 6 });
    await checkGoalsReached();
    expect((await helpers.getGoal({ goalId: goal.id, raw: true })).achievedAt).not.toBeNull();

    await helpers.updateGoal({ goalId: goal.id, payload: { reachedHoldDays: 0 }, raw: true });
    await checkGoalsReached();
    expect((await helpers.getGoal({ goalId: goal.id, raw: true })).achievedAt).toBeNull();
  });

  it('keeps an old latch while the goal is still reached', async () => {
    const { goal } = await setupGoal({ balance: 1200 });
    await checkGoalsReached();
    await backdateLatch({ goalId: goal.id, days: 31 });

    expect(await checkGoalsReached()).toMatchObject({ notified: 0, failed: 0 });
    expect((await helpers.getGoal({ goalId: goal.id, raw: true })).achievedAt).not.toBeNull();
    expect(await goalNotifications()).toHaveLength(1);
  });

  it('keeps the latch on a rename that resends the same target and currency', async () => {
    const { goal } = await setupGoal({ balance: 1200 });
    await checkGoalsReached();
    const { achievedAt } = await helpers.getGoal({ goalId: goal.id, raw: true });

    const renamed = await helpers.updateGoal({
      goalId: goal.id,
      payload: { name: 'Summer trip', targetAmount: 1000, currencyCode: global.BASE_CURRENCY.code },
      raw: true,
    });

    expect(renamed).toMatchObject({ name: 'Summer trip', achievedAt, achievedAmount: 1200 });
    expect(await goalNotifications()).toHaveLength(1);
  });

  it('clears the latch when the currency changes', async () => {
    const { goal } = await setupGoal({ balance: 1200 });
    await checkGoalsReached();

    const updated = await helpers.updateGoal({ goalId: goal.id, payload: { currencyCode: 'EUR' }, raw: true });

    expect(updated).toMatchObject({ currencyCode: 'EUR', achievedAt: null, achievedAmount: null });
    expect(await goalNotifications()).toHaveLength(1);
  });

  it('latches a goal reached at creation and notifies once', async () => {
    const account = await helpers.createAccount({ raw: true });
    await addTransaction({ accountId: account.id, amount: 1200, transactionType: TRANSACTION_TYPES.income });

    const goal = await helpers.createGoal({
      payload: { targetAmount: 1000, accounts: [{ accountId: account.id, sharePercent: 100 }] },
      raw: true,
    });

    expect(goal.achievedAt).not.toBeNull();
    expect(goal.achievedAmount).toBe(1200);
    expect(await goalNotifications()).toHaveLength(1);
    expect(await checkGoalsReached()).toMatchObject({ notified: 0 });
  });

  it('stores and notifies the achieved amount in the goal currency', async () => {
    await helpers.addUserCurrencies({ currencyCodes: ['USD'] });
    const account = await helpers.createAccount({
      payload: helpers.buildAccountPayload({
        accountCategory: ACCOUNT_CATEGORIES.saving,
        initialBalance: 600,
        currencyCode: 'USD',
      }),
      raw: true,
    });

    const goal = await helpers.createGoal({
      payload: { currencyCode: 'USD', targetAmount: 500, accounts: [{ accountId: account.id, sharePercent: 100 }] },
      raw: true,
    });

    expect(goal.insights!.rateToBase).not.toBe(1);
    expect(goal.achievedAmount).toBeCloseTo(600, 0);
    const [notification] = await goalNotifications();
    expect(notification!.payload).toMatchObject({ achievedAmount: goal.achievedAmount, currencyCode: 'USD' });
  });

  it('sends exactly one notification when two checks run at once', async () => {
    await setupGoal({ balance: 1200 });

    const results = await Promise.all([checkGoalsReached(), checkGoalsReached()]);

    expect(results.reduce((sum, { notified }) => sum + notified, 0)).toBe(1);
    expect(await goalNotifications()).toHaveLength(1);
  });
});
