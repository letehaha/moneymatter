import {
  BANK_PROVIDER_TYPE,
  NOTIFICATION_STATUSES,
  NOTIFICATION_TYPES,
  RecordId,
  type StuckPendingNotificationPayload,
} from '@bt/shared/types';
import { t } from '@i18n/index';
import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import * as helpers from '@tests/helpers';
import { FixedTransaction, MOCK_IDENTIFICATION_HASH_1 } from '@tests/mocks/enablebanking/data';
import { format, subDays } from 'date-fns';

import { notifyStuckPending } from './notify-stuck-pending';

const daysAgo = ({ days }: { days: number }) => format(subDays(new Date(), days), 'yyyy-MM-dd');

const pending = ({ amount, days }: { amount: string; days: number }): FixedTransaction => ({
  amount,
  currency: 'EUR',
  isExpense: true,
  transactionDate: daysAgo({ days }),
  counterpartyIban: null,
  status: 'PDNG',
});

async function setupEnableBanking({ transactions }: { transactions: FixedTransaction[] }) {
  helpers.enablebanking.setFixedTransactions(transactions);

  const { connectionId } = await helpers.bankDataProviders.connectProvider({
    providerType: BANK_PROVIDER_TYPE.ENABLE_BANKING,
    credentials: helpers.enablebanking.mockCredentials(),
    raw: true,
  });
  const state = await helpers.enablebanking.getConnectionState(connectionId);
  await helpers.makeRequest({
    method: 'post',
    url: '/bank-data-providers/enablebanking/oauth-callback',
    payload: { connectionId, code: helpers.enablebanking.mockAuthCode, state },
  });
  const { syncedAccounts } = await helpers.bankDataProviders.connectSelectedAccounts({
    connectionId,
    accountExternalIds: [MOCK_IDENTIFICATION_HASH_1],
    raw: true,
  });

  return { connectionId, accountId: syncedAccounts[0]!.id as RecordId };
}

const stuckIds = async () =>
  (await helpers.getStuckPending({ raw: true })).map((item) => item.transaction.id).toSorted();

const stuckNotifications = () => helpers.getNotifications({ type: NOTIFICATION_TYPES.stuckPending, raw: true });

const payloadIds = ({ notification }: { notification: { payload: unknown } }) =>
  [...(notification.payload as StuckPendingNotificationPayload).transactionIds].toSorted();

describe('notifyStuckPending', () => {
  beforeEach(async () => {
    helpers.enablebanking.resetSessionCounter();
    await helpers.patchUserSettings({ patch: { importPendingBankTransactions: true }, raw: true });
  });

  afterEach(() => {
    helpers.enablebanking.resetTransactionConfig();
  });

  it('creates one notification listing every stuck row', async () => {
    await setupEnableBanking({
      transactions: [
        pending({ amount: '12.00', days: 20 }),
        pending({ amount: '30.00', days: 100 }),
        pending({ amount: '7.00', days: 2 }),
      ],
    });
    const ids = await stuckIds();
    expect(ids).toHaveLength(2);

    expect(await notifyStuckPending()).toEqual({ usersChecked: 1, notified: 1, failed: 0, errors: [] });

    const notifications = await stuckNotifications();
    expect(notifications).toHaveLength(1);
    expect(notifications[0]).toMatchObject({
      type: NOTIFICATION_TYPES.stuckPending,
      status: NOTIFICATION_STATUSES.unread,
      title: t({ key: 'transactions.reconciliation.stuckPendingNotification.title' }),
      message: t({ key: 'transactions.reconciliation.stuckPendingNotification.message', variables: { count: 2 } }),
    });
    expect(payloadIds({ notification: notifications[0]! })).toEqual(ids);
  });

  it('sends nothing when pending rows are younger than a week', async () => {
    await setupEnableBanking({ transactions: [pending({ amount: '7.00', days: 2 })] });

    expect(await notifyStuckPending()).toEqual({ usersChecked: 0, notified: 0, failed: 0, errors: [] });
    expect(await stuckNotifications()).toEqual([]);
  });

  it('does not repeat while the previous notification is unread', async () => {
    await setupEnableBanking({ transactions: [pending({ amount: '12.00', days: 20 })] });

    await notifyStuckPending();
    expect(await notifyStuckPending()).toEqual({ usersChecked: 1, notified: 0, failed: 0, errors: [] });

    expect(await stuckNotifications()).toHaveLength(1);
  });

  it('does not nag about the same rows after the notification was read', async () => {
    await setupEnableBanking({ transactions: [pending({ amount: '12.00', days: 20 })] });
    await notifyStuckPending();
    const [notification] = await stuckNotifications();
    await helpers.markAsRead({ id: notification!.id, raw: true });

    expect(await notifyStuckPending()).toEqual({ usersChecked: 1, notified: 0, failed: 0, errors: [] });

    expect(await stuckNotifications()).toHaveLength(1);
  });

  it('notifies again once a new row is stuck after the previous notification was read', async () => {
    const { connectionId, accountId } = await setupEnableBanking({
      transactions: [pending({ amount: '12.00', days: 20 })],
    });
    await notifyStuckPending();
    const [first] = await stuckNotifications();
    await helpers.markAsRead({ id: first!.id, raw: true });

    helpers.enablebanking.setFixedTransactions([
      pending({ amount: '12.00', days: 20 }),
      pending({ amount: '33.00', days: 10 }),
    ]);
    await helpers.bankDataProviders.syncTransactionsForAccount({ connectionId, accountId, raw: true });
    const ids = await stuckIds();
    expect(ids).toHaveLength(2);

    expect(await notifyStuckPending()).toEqual({ usersChecked: 1, notified: 1, failed: 0, errors: [] });

    const notifications = await stuckNotifications();
    expect(notifications).toHaveLength(2);
    const latest = notifications.find((item) => item.id !== first!.id)!;
    expect(latest.status).toBe(NOTIFICATION_STATUSES.unread);
    expect(payloadIds({ notification: latest })).toEqual(ids);
  });

  it('does not notify again when a notified row is resolved after the notification was read', async () => {
    await setupEnableBanking({
      transactions: [pending({ amount: '12.00', days: 20 }), pending({ amount: '30.00', days: 30 })],
    });
    const ids = await stuckIds();
    expect(ids).toHaveLength(2);
    await notifyStuckPending();
    const [notification] = await stuckNotifications();
    await helpers.markAsRead({ id: notification!.id, raw: true });

    await helpers.keepAsBooked({ transactionIds: [ids[0] as RecordId], raw: true });
    expect(await stuckIds()).toEqual([ids[1]]);

    expect(await notifyStuckPending()).toEqual({ usersChecked: 1, notified: 0, failed: 0, errors: [] });
    expect(await stuckNotifications()).toHaveLength(1);
  });

  it("does not notify a user about another user's stuck rows", async () => {
    await setupEnableBanking({ transactions: [pending({ amount: '12.00', days: 20 })] });
    const userB = await helpers.signUpSecondUser();

    expect(await notifyStuckPending()).toEqual({ usersChecked: 1, notified: 1, failed: 0, errors: [] });

    expect(await stuckNotifications()).toHaveLength(1);
    await helpers.asUser({
      cookies: userB.cookies,
      fn: async () => {
        expect(await stuckNotifications()).toEqual([]);
      },
    });
  });
});
