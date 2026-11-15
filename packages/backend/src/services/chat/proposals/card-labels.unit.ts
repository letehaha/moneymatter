import { TRANSACTION_TYPES } from '@bt/shared/types';
import { Money } from '@common/types/money';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import Accounts from '@models/accounts.model';
import Categories from '@models/categories.model';
import Payees from '@models/payees.model';
import Subscriptions from '@models/subscriptions.model';
import Trackers from '@models/trackers.model';

jest.mock('@models/transactions-query', () => ({
  ...(jest.requireActual('@models/transactions-query') as object),
  findTransactions: jest.fn(),
}));

jest.mock('@services/sharing/auth/can-user-access-resource.service', () => ({ canUserAccessResource: jest.fn() }));

import * as transactionsQuery from '@models/transactions-query';
import { canUserAccessResource } from '@services/sharing/auth/can-user-access-resource.service';

import { resolveToolPolicy } from '../policies';
import { resolveCardLabels } from './card-labels';

const USER = 7;
const SUBSCRIPTION = '3f1b9c2e-8d4a-4b6e-9c1d-2a7e5f0b8c11';
const ACCOUNT = '5d2e8f40-7a13-4c9b-b0e5-6f4a2c1d8e37';
const PAYEE = '9a7c5e31-2b84-4d0f-8e66-1c3a5b7d9f20';
const TX = '00000000-0000-4000-8000-000000000001';

const policy = ({ name }: { name: string }) => resolveToolPolicy({ name, args: {} })!;

describe('resolveCardLabels', () => {
  beforeEach(() => {
    jest.mocked(transactionsQuery.findTransactions).mockReset();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('names a subscription and the transactions of a link call', async () => {
    const findSubscriptions = jest
      .spyOn(Subscriptions, 'findAll')
      .mockResolvedValue([{ id: SUBSCRIPTION, name: 'Netflix' }] as never);
    jest.mocked(transactionsQuery.findTransactions).mockResolvedValue([
      {
        id: TX,
        time: new Date(Date.UTC(2026, 9, 5)),
        accountId: ACCOUNT,
        transactionType: TRANSACTION_TYPES.expense,
        amount: Money.fromDecimal(9.99),
        currencyCode: 'USD',
        payeeId: PAYEE,
        note: 'ignored when there is a payee',
      },
    ] as never);
    jest.spyOn(Accounts, 'findAll').mockResolvedValue([{ id: ACCOUNT, name: 'Main card' }] as never);
    jest.spyOn(Payees, 'findAll').mockResolvedValue([{ id: PAYEE, name: 'Netflix Inc' }] as never);

    const labels = await resolveCardLabels({
      userId: USER,
      policy: policy({ name: 'link_transactions_to_subscription' }),
      args: { subscriptionId: SUBSCRIPTION, transactionIds: [TX], matchSource: 'manual' },
    });

    expect(labels).toEqual({
      [`subscription:${SUBSCRIPTION}`]: 'Netflix',
      [`transaction:${TX}`]: '2026-10-05 · -9.99 USD · Netflix Inc · Main card',
    });
    expect(findSubscriptions.mock.calls[0]![0]).toMatchObject({ where: { userId: USER } });
  });

  it('leaves out the kinds the app names itself, proposal refs and records that are not the user’s', async () => {
    const find = jest.spyOn(Subscriptions, 'findAll').mockResolvedValue([]);

    const labels = await resolveCardLabels({
      userId: USER,
      policy: policy({ name: 'create_transaction' }),
      args: { accountId: ACCOUNT, payeeId: PAYEE, categoryId: ACCOUNT },
    });
    expect(labels).toEqual({});

    const foreign = await resolveCardLabels({
      userId: USER,
      policy: policy({ name: 'link_transactions_to_subscription' }),
      args: {
        subscriptionId: '$proposal:3f1b9c2e-8d4a-4b6e-9c1d-2a7e5f0b8c12',
        transactionIds: ['$proposal:5d2e8f40-7a13-4c9b-b0e5-6f4a2c1d8e37', 'Netflix'],
      },
    });
    expect(foreign).toEqual({});
    expect(find).not.toHaveBeenCalled();
    expect(jest.mocked(transactionsQuery.findTransactions)).not.toHaveBeenCalled();
  });

  it('names at most ten transactions per argument', async () => {
    const ids = Array.from(
      { length: 25 },
      (_, n) => `00000000-0000-4000-8000-${(n + 1).toString(16).padStart(12, '0')}`,
    );
    jest.spyOn(Subscriptions, 'findAll').mockResolvedValue([]);
    jest.mocked(transactionsQuery.findTransactions).mockResolvedValue([]);

    await resolveCardLabels({
      userId: USER,
      policy: policy({ name: 'link_transactions_to_subscription' }),
      args: { subscriptionId: SUBSCRIPTION, transactionIds: ids },
    });

    expect(jest.mocked(transactionsQuery.findTransactions).mock.calls[0]![0]).toMatchObject({
      where: { id: ids.slice(0, 10) },
    });
  });

  it('names the payees, categories and accounts of the affected rows, one read per kind', async () => {
    const findPayees = jest.spyOn(Payees, 'findAll').mockResolvedValue([{ id: PAYEE, name: 'Netflix Inc' }] as never);
    const findCategories = jest
      .spyOn(Categories, 'findAll')
      .mockResolvedValue([{ id: TX, name: 'Streaming' }] as never);
    const findAccounts = jest.spyOn(Accounts, 'findAll').mockResolvedValue([{ id: ACCOUNT, name: 'Main' }] as never);

    const labels = await resolveCardLabels({
      userId: USER,
      policy: { name: 'unlink_transactions_from_subscription', entityFields: {} },
      args: {},
      affected: {
        count: 2,
        columns: [],
        truncated: false,
        rows: [
          { account: { kind: 'account', id: ACCOUNT }, payee: { kind: 'payee', id: PAYEE }, note: 'first' },
          {
            account: { kind: 'account', id: ACCOUNT },
            category: { kind: 'category', id: TX },
            payee: { kind: 'payee', id: PAYEE },
          },
        ],
      },
    });

    expect(labels).toEqual({
      [`payee:${PAYEE}`]: 'Netflix Inc',
      [`category:${TX}`]: 'Streaming',
      [`account:${ACCOUNT}`]: 'Main',
    });
    expect(findPayees).toHaveBeenCalledTimes(1);
    expect(findCategories).toHaveBeenCalledTimes(1);
    expect(findAccounts).toHaveBeenCalledTimes(1);
  });

  describe('the categories of a line of a shared tracker', () => {
    const OWNER = 99;
    const CATEGORY = '00000000-0000-4000-8000-000000000002';
    const args = { trackerId: SUBSCRIPTION, name: 'Food', categoryIds: [CATEGORY] };
    beforeEach(() => {
      jest.spyOn(Trackers, 'findAll').mockResolvedValue([]);
    });

    const labelsFor = ({ name = 'create_tracker_line' }: { name?: string } = {}) =>
      resolveCardLabels({ userId: USER, policy: policy({ name }), args });

    it('names them from the tree of the owner for a recipient who may manage the tracker', async () => {
      jest.mocked(canUserAccessResource).mockResolvedValue({ granted: true, ownerUserId: OWNER } as never);
      const find = jest.spyOn(Categories, 'findAll').mockResolvedValue([{ id: CATEGORY, name: 'Food' }] as never);

      expect(await labelsFor()).toMatchObject({ [`category:${CATEGORY}`]: 'Food' });
      expect(jest.mocked(canUserAccessResource).mock.calls.at(-1)![0]).toMatchObject({ requiredPermission: 'manage' });
      expect(find.mock.calls[0]![0]).toMatchObject({ where: { id: [CATEGORY], userId: OWNER } });
    });

    it('names none of them for a caller without that access', async () => {
      jest.mocked(canUserAccessResource).mockResolvedValue({ granted: false, ownerUserId: OWNER } as never);
      const find = jest.spyOn(Categories, 'findAll');

      expect(await labelsFor()).toEqual({});
      expect(find).not.toHaveBeenCalled();
    });

    it('leaves the categories of the owner of the tracker to the lists of the app', async () => {
      jest.mocked(canUserAccessResource).mockResolvedValue({ granted: true, ownerUserId: USER } as never);
      const find = jest.spyOn(Categories, 'findAll');

      expect(await labelsFor()).toEqual({});
      expect(find).not.toHaveBeenCalled();
    });
  });
});
