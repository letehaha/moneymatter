import { TRANSACTION_TYPES } from '@bt/shared/types';
import { Money } from '@common/types/money';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import Accounts from '@models/accounts.model';
import Payees from '@models/payees.model';
import Subscriptions from '@models/subscriptions.model';

jest.mock('@models/transactions-query', () => ({
  ...(jest.requireActual('@models/transactions-query') as object),
  findTransactions: jest.fn(),
}));

import * as transactionsQuery from '@models/transactions-query';

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
});
