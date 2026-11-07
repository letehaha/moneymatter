import type { ChatEntityRef } from '@bt/shared/types';
import { afterEach, describe, expect, it, jest } from '@jest/globals';
import Accounts from '@models/accounts.model';
import BankDataProviderConnections from '@models/bank-data-provider-connections.model';
import BudgetPlans from '@models/budget-plans.model';
import Categories from '@models/categories.model';
import ImportBatches from '@models/import-batches.model';
import Notifications from '@models/notifications.model';
import TransactionAutomations from '@models/transaction-automations.model';
import Transactions from '@models/transactions.model';
import VentureDeals from '@models/venture/venture-deals.model';

import { findForeignEntities, lookupEntities } from './entity-ownership';

const A1 = '3f1b9c2e-8d4a-4b6e-9c1d-2a7e5f0b8c11';
const A2 = '9a7c5e31-2b84-4d0f-8e66-1c3a5b7d9f20';
const C1 = '5d2e8f40-7a13-4c9b-b0e5-6f4a2c1d8e37';

describe('findForeignEntities', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('answers nothing for no refs, without a query', async () => {
    const spy = jest.spyOn(Accounts, 'findAll');

    await expect(findForeignEntities({ userId: 1, refs: [] })).resolves.toEqual([]);
    expect(spy).not.toHaveBeenCalled();
  });

  it('asks each model for the ids of its kind, scoped to the user, and returns the ones it did not find', async () => {
    const accounts = jest.spyOn(Accounts, 'findAll').mockResolvedValue([{ id: A1 }] as never);
    const categories = jest.spyOn(Categories, 'findAll').mockResolvedValue([{ id: C1 }] as never);
    const refs: ChatEntityRef[] = [
      { kind: 'account', id: A1 },
      { kind: 'account', id: A2 },
      { kind: 'account', id: A1 },
      { kind: 'category', id: C1 },
    ];

    const foreign = await findForeignEntities({ userId: 7, refs });

    expect(foreign).toEqual([{ kind: 'account', id: A2 }]);
    expect((accounts.mock.calls[0]![0] as any).where).toMatchObject({ userId: 7, id: [A1, A2] });
    expect((categories.mock.calls[0]![0] as any).where).toMatchObject({ userId: 7, id: [C1] });
  });

  it('refuses a kind it cannot check, instead of linking it unchecked', async () => {
    const transactions = jest.spyOn(Transactions, 'findAll').mockResolvedValue([]);

    const foreign = await findForeignEntities({ userId: 7, refs: [{ kind: 'split', id: A1 }] });

    expect(foreign).toEqual([{ kind: 'split', id: A1 }]);
    expect(transactions).not.toHaveBeenCalled();
  });

  it('checks the kinds a page can be about against the user rows, and names them', async () => {
    const loans = jest.spyOn(Accounts, 'findAll').mockResolvedValue([{ id: A1, name: 'Car loan' }] as never);
    const plans = jest.spyOn(BudgetPlans, 'findAll').mockResolvedValue([{ id: A2, name: 'Home' }] as never);
    const automations = jest.spyOn(TransactionAutomations, 'findAll').mockResolvedValue([]);
    const deals = jest.spyOn(VentureDeals, 'findAll').mockResolvedValue([{ id: C1, name: 'Seed round' }] as never);

    const { foreign, labels } = await lookupEntities({
      userId: 7,
      refs: [
        { kind: 'loan', id: A1 },
        { kind: 'budgetPlan', id: A2 },
        { kind: 'transactionAutomation', id: C1 },
        { kind: 'ventureDeal', id: C1 },
      ],
    });

    expect(foreign).toEqual([{ kind: 'transactionAutomation', id: C1 }]);
    expect(labels.get(`loan:${A1}`)).toBe('Car loan');
    expect(labels.get(`budgetPlan:${A2}`)).toBe('Home');
    expect(labels.get(`ventureDeal:${C1}`)).toBe('Seed round');
    expect((loans.mock.calls[0]![0] as any).where).toMatchObject({ userId: 7, id: [A1] });
    expect(plans).toHaveBeenCalledTimes(1);
    expect(automations).toHaveBeenCalledTimes(1);
    expect(deals).toHaveBeenCalledTimes(1);
  });

  it('looks an import batch up by its batch id', async () => {
    const batches = jest.spyOn(ImportBatches, 'findAll').mockResolvedValue([{ id: A1 }] as never);

    const foreign = await findForeignEntities({ userId: 7, refs: [{ kind: 'importBatch', id: A1 }] });

    expect(foreign).toEqual([]);
    const query = batches.mock.calls[0]![0] as any;
    expect(query.where).toEqual({ userId: 7, batchId: [A1] });
    expect(query.attributes[0]).toEqual(['batchId', 'id']);
  });

  it('names a bank connection by its provider and a notification by its title', async () => {
    jest
      .spyOn(BankDataProviderConnections, 'findAll')
      .mockResolvedValue([{ id: A1, providerName: 'monobank' }] as never);
    jest.spyOn(Notifications, 'findAll').mockResolvedValue([{ id: A2, title: 'Rent is due' }] as never);

    const { labels } = await lookupEntities({
      userId: 7,
      refs: [
        { kind: 'bankConnection', id: A1 },
        { kind: 'notification', id: A2 },
      ],
    });

    expect(labels.get(`bankConnection:${A1}`)).toBe('monobank');
    expect(labels.get(`notification:${A2}`)).toBe('Rent is due');
  });
});
