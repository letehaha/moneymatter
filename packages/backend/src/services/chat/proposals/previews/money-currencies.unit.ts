import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import Accounts from '@models/accounts.model';
import Subscriptions from '@models/subscriptions.model';
import UsersCurrencies from '@models/users-currencies.model';

jest.mock('@models/transactions-query', () => ({
  ...(jest.requireActual('@models/transactions-query') as object),
  findOneTransaction: jest.fn(),
}));
jest.mock('@services/sharing/auth/can-user-access-resource.service', () => ({ canUserAccessResource: jest.fn() }));

import * as transactionsQuery from '@models/transactions-query';
import { canUserAccessResource } from '@services/sharing/auth/can-user-access-resource.service';

import { resolveArgsOnlyMoneyCurrencies } from './money-currencies';

const USER = 7;
const ID = '3f1b9c2e-8d4a-4b6e-9c1d-2a7e5f0b8c11';
const OTHER = '9a7c5e31-2b84-4d0f-8e66-1c3a5b7d9f20';
const REF = '$proposal:9a7c5e31-2b84-4d0f-8e66-1c3a5b7d9f20';

const resolve = ({ toolName, args }: { toolName: string; args: Record<string, unknown> }) =>
  resolveArgsOnlyMoneyCurrencies({ userId: USER, toolName, args });

describe('the currency of an amount on a card without a preview', () => {
  beforeEach(() => {
    jest.mocked(transactionsQuery.findOneTransaction).mockReset().mockResolvedValue(null);
    jest.mocked(canUserAccessResource).mockReset();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('pay_subscription_period', () => {
    it('books the amount in the currency of the account of a subscription of the user', async () => {
      const subscription = jest.spyOn(Subscriptions, 'findOne').mockResolvedValue({ accountId: OTHER } as never);
      const account = jest.spyOn(Accounts, 'findOne').mockResolvedValue({ currencyCode: 'EUR' } as never);

      const currencies = await resolve({
        toolName: 'pay_subscription_period',
        args: { subscriptionId: ID, periodId: OTHER, amount: 9 },
      });

      expect(subscription.mock.calls[0]![0]).toMatchObject({ where: { id: ID, userId: USER } });
      expect(account.mock.calls[0]![0]).toMatchObject({ where: { id: OTHER, userId: USER } });
      expect(currencies).toEqual({ amount: 'EUR' });
    });

    it('states nothing for a subscription that is not the user or has no account', async () => {
      jest
        .spyOn(Subscriptions, 'findOne')
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ accountId: null } as never);
      const account = jest.spyOn(Accounts, 'findOne');
      const args = { subscriptionId: ID, periodId: OTHER, amount: 9 };

      expect(await resolve({ toolName: 'pay_subscription_period', args })).toBeNull();
      expect(await resolve({ toolName: 'pay_subscription_period', args })).toBeNull();
      expect(account).not.toHaveBeenCalled();
    });

    it('reads nothing for a call with no amount, or one that names the account', async () => {
      const subscription = jest.spyOn(Subscriptions, 'findOne');

      expect(
        await resolve({ toolName: 'pay_subscription_period', args: { subscriptionId: ID, periodId: OTHER } }),
      ).toBeNull();
      expect(
        await resolve({
          toolName: 'pay_subscription_period',
          args: { subscriptionId: ID, periodId: OTHER, amount: 9, accountId: OTHER },
        }),
      ).toBeNull();
      expect(subscription).not.toHaveBeenCalled();
    });
  });

  describe('link_refund', () => {
    it('reads a share in the currency of the refund transaction', async () => {
      jest.mocked(transactionsQuery.findOneTransaction).mockResolvedValue({ currencyCode: 'PLN' } as never);

      const currencies = await resolve({
        toolName: 'link_refund',
        args: { originalTxId: OTHER, refundTxId: ID, amount: 4 },
      });

      expect(jest.mocked(transactionsQuery.findOneTransaction).mock.calls[0]![0]).toMatchObject({
        access: { accessibleTo: USER },
        where: { id: ID },
      });
      expect(currencies).toEqual({ amount: 'PLN' });
    });

    it('states nothing for a whole refund or a refund it cannot read', async () => {
      expect(await resolve({ toolName: 'link_refund', args: { originalTxId: OTHER, refundTxId: ID } })).toBeNull();
      expect(
        await resolve({ toolName: 'link_refund', args: { originalTxId: OTHER, refundTxId: ID, amount: 4 } }),
      ).toBeNull();
      expect(
        await resolve({ toolName: 'link_refund', args: { originalTxId: OTHER, refundTxId: REF, amount: 4 } }),
      ).toBeNull();
      expect(jest.mocked(transactionsQuery.findOneTransaction)).toHaveBeenCalledTimes(1);
    });
  });

  describe('create_tracker_line', () => {
    it('reads the limit in the base currency of the owner of a tracker the user can access', async () => {
      jest.mocked(canUserAccessResource).mockResolvedValue({
        granted: true,
        isOwner: false,
        ownerUserId: USER + 1,
      } as never);
      const base = jest.spyOn(UsersCurrencies, 'findOne').mockResolvedValue({ currencyCode: 'UAH' } as never);

      const currencies = await resolve({
        toolName: 'create_tracker_line',
        args: { trackerId: ID, name: 'Food', limitAmount: 9 },
      });

      expect(jest.mocked(canUserAccessResource).mock.calls[0]![0]).toMatchObject({
        userId: USER,
        resourceType: 'tracker',
        resourceId: ID,
        requiredPermission: 'read',
      });
      expect(base.mock.calls[0]![0]).toMatchObject({ where: { userId: USER + 1, isDefaultCurrency: true } });
      expect(currencies).toEqual({ limitAmount: 'UAH' });
    });

    it('states nothing for a tracker the user has no access to', async () => {
      jest.mocked(canUserAccessResource).mockResolvedValue({ granted: false, ownerUserId: USER + 1 } as never);
      const base = jest.spyOn(UsersCurrencies, 'findOne');

      const currencies = await resolve({
        toolName: 'create_tracker_line',
        args: { trackerId: ID, name: 'Food', limitAmount: 9 },
      });

      expect(currencies).toBeNull();
      expect(base).not.toHaveBeenCalled();
    });

    it.each([
      ['no limit', { trackerId: ID, name: 'Food' }],
      ['a limit it removes', { trackerId: ID, name: 'Food', limitAmount: null }],
      ['a tracker that does not exist yet', { trackerId: REF, name: 'Food', limitAmount: 9 }],
    ])('reads nothing with %s', async (_name, args) => {
      expect(await resolve({ toolName: 'create_tracker_line', args })).toBeNull();
      expect(canUserAccessResource).not.toHaveBeenCalled();
    });
  });

  it('states nothing for any other tool', async () => {
    expect(await resolve({ toolName: 'create_tag', args: { name: 'x' } })).toBeNull();
  });
});
