import { SUBSCRIPTION_LINK_STATUS, TRANSACTION_TYPES } from '@bt/shared/types';
import { Money } from '@common/types/money';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import SubscriptionTransactions from '@models/subscription-transactions.model';
import Subscriptions from '@models/subscriptions.model';

jest.mock('@models/transactions-query', () => ({
  ...(jest.requireActual('@models/transactions-query') as object),
  findTransactions: jest.fn(),
}));
jest.mock('@services/sharing/auth/get-accessible-account-ids.service', () => ({
  getAccessibleAccountIdsForUser: jest.fn(),
}));

import * as transactionsQuery from '@models/transactions-query';
import { getAccessibleAccountIdsForUser } from '@services/sharing/auth/get-accessible-account-ids.service';

import { resolveToolPolicy } from '../../policies';
import { PreviewError } from './preview-helpers';
import { resolveLinkTransactionsToSubscription, resolveUnlinkTransactionsFromSubscription } from './subscription-links';

const USER = 7;
const SUBSCRIPTION = '3f1b9c2e-8d4a-4b6e-9c1d-2a7e5f0b8c11';
const OTHER_SUBSCRIPTION = '9a7c5e31-2b84-4d0f-8e66-1c3a5b7d9f20';
const ACCOUNT = '5d2e8f40-7a13-4c9b-b0e5-6f4a2c1d8e37';
const uuid = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;

const tx = (n: number, overrides: Record<string, unknown> = {}) => ({
  id: uuid(n),
  time: new Date(Date.UTC(2026, 9, n)),
  accountId: ACCOUNT,
  transactionType: TRANSACTION_TYPES.expense,
  amount: Money.fromDecimal(9.99),
  currencyCode: 'USD',
  categoryId: null,
  payeeId: null,
  note: `Netflix ${n}`,
  updatedAt: new Date(Date.UTC(2026, 9, 10)),
  ...overrides,
});

const subscription = {
  id: SUBSCRIPTION,
  name: 'Netflix',
  transactionType: TRANSACTION_TYPES.expense,
  updatedAt: new Date(),
};
const link = (n: number, subscriptionId: string, status = SUBSCRIPTION_LINK_STATUS.active) => ({
  transactionId: uuid(n),
  subscriptionId,
  status,
});

const run = ({ toolName, args }: { toolName: string; args: Record<string, unknown> }) =>
  (toolName === 'link_transactions_to_subscription'
    ? resolveLinkTransactionsToSubscription
    : resolveUnlinkTransactionsFromSubscription)({
    userId: USER,
    toolName,
    args,
    policy: resolveToolPolicy({ name: toolName, args })!,
  });

describe('subscription link previews', () => {
  beforeEach(() => {
    jest.mocked(transactionsQuery.findTransactions).mockReset();
    jest.mocked(getAccessibleAccountIdsForUser).mockReset().mockResolvedValue([ACCOUNT]);
    jest.spyOn(Subscriptions, 'findOne').mockResolvedValue(subscription as never);
    jest.spyOn(SubscriptionTransactions, 'findAll').mockResolvedValue([]);
    jest.spyOn(Subscriptions, 'findAll').mockResolvedValue([]);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('link_transactions_to_subscription', () => {
    const args = { subscriptionId: SUBSCRIPTION, transactionIds: [uuid(1), uuid(2)], matchSource: 'manual' };

    it('lists the transactions with date, amount, currency, note and account, and counts them', async () => {
      jest.mocked(transactionsQuery.findTransactions).mockResolvedValue([tx(2), tx(1)] as never);

      const { preview, affectedCount, warnings } = await run({ toolName: 'link_transactions_to_subscription', args });

      expect(affectedCount).toBe(2);
      expect(preview.affected).toMatchObject({ count: 2, truncated: false });
      expect(preview.affected!.columns.map((column) => column.key)).toEqual(
        expect.arrayContaining(['time', 'account', 'amount', 'currency', 'payee', 'note', 'linkedTo']),
      );
      expect(preview.affected!.rows[0]).toMatchObject({
        time: '2026-10-02T00:00:00.000Z',
        amount: 9.99,
        currency: 'USD',
        note: 'Netflix 2',
        account: { kind: 'account', id: ACCOUNT },
        linkedTo: null,
      });
      expect(warnings).toBeUndefined();
    });

    it('says which subscription a transaction is linked to and warns that the call is refused', async () => {
      jest.mocked(transactionsQuery.findTransactions).mockResolvedValue([tx(2), tx(1)] as never);
      jest
        .spyOn(SubscriptionTransactions, 'findAll')
        .mockResolvedValue([
          link(1, OTHER_SUBSCRIPTION),
          link(2, SUBSCRIPTION, SUBSCRIPTION_LINK_STATUS.unlinked),
        ] as never);
      jest.spyOn(Subscriptions, 'findAll').mockResolvedValue([{ id: OTHER_SUBSCRIPTION, name: 'Spotify' }] as never);

      const { preview, warnings } = await run({ toolName: 'link_transactions_to_subscription', args });

      const byId = Object.fromEntries(preview.affected!.rows.map((row) => [row.note, row.linkedTo]));
      expect(byId).toEqual({ 'Netflix 1': 'Spotify', 'Netflix 2': null });
      expect(warnings).toEqual([{ key: 'chat.warnings.subscriptionAlreadyLinked', params: { count: 1 } }]);
    });

    it('warns about a transaction of another type than the subscription', async () => {
      jest
        .mocked(transactionsQuery.findTransactions)
        .mockResolvedValue([tx(1, { transactionType: TRANSACTION_TYPES.income }), tx(2)] as never);

      const { warnings } = await run({ toolName: 'link_transactions_to_subscription', args });

      expect(warnings).toEqual([{ key: 'chat.warnings.subscriptionTypeMismatch', params: { count: 1 } }]);
    });

    it('is not found when the subscription or a transaction is not the user’s', async () => {
      jest.spyOn(Subscriptions, 'findOne').mockResolvedValue(null);
      await expect(run({ toolName: 'link_transactions_to_subscription', args })).rejects.toBeInstanceOf(PreviewError);

      jest.spyOn(Subscriptions, 'findOne').mockResolvedValue(subscription as never);
      jest.mocked(transactionsQuery.findTransactions).mockResolvedValue([tx(1)] as never);
      await expect(run({ toolName: 'link_transactions_to_subscription', args })).rejects.toBeInstanceOf(PreviewError);
    });

    it('snapshots the links, so a link made after the preview makes the card stale', async () => {
      jest.mocked(transactionsQuery.findTransactions).mockResolvedValue([tx(2), tx(1)] as never);
      const before = await run({ toolName: 'link_transactions_to_subscription', args });

      jest.spyOn(SubscriptionTransactions, 'findAll').mockResolvedValue([link(1, OTHER_SUBSCRIPTION)] as never);
      const after = await run({ toolName: 'link_transactions_to_subscription', args });

      expect(after.snapshot.targetHash).not.toBe(before.snapshot.targetHash);
    });
  });

  describe('unlink_transactions_from_subscription', () => {
    const args = { subscriptionId: SUBSCRIPTION, transactionIds: [uuid(1), uuid(2)] };

    it('lists the transactions linked to the subscription and warns about the others', async () => {
      jest.spyOn(SubscriptionTransactions, 'findAll').mockResolvedValue([link(1, SUBSCRIPTION)] as never);
      jest.mocked(transactionsQuery.findTransactions).mockResolvedValue([tx(1)] as never);

      const { preview, affectedCount, warnings } = await run({
        toolName: 'unlink_transactions_from_subscription',
        args,
      });

      expect(affectedCount).toBe(1);
      expect(preview.affected).toMatchObject({ count: 1 });
      expect(preview.affected!.rows[0]).toMatchObject({ note: 'Netflix 1', amount: 9.99, currency: 'USD' });
      expect(warnings).toEqual([{ key: 'chat.warnings.subscriptionNotLinked', params: { count: 1 } }]);
    });

    it('refuses a card when none of the transactions is linked', async () => {
      await expect(run({ toolName: 'unlink_transactions_from_subscription', args })).rejects.toMatchObject({
        messageKey: 'chat.cards.nothingToUnlink',
      });
    });
  });
});
