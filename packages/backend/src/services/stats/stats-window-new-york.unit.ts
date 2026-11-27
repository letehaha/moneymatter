/**
 * @jest-environment <rootDir>/src/services/budget-plans/periods/new-york-timezone-environment.ts
 */
import { describe, expect, it, jest } from '@jest/globals';
import { Op } from 'sequelize';

jest.mock('@models/accounts.model', () => ({ __esModule: true, default: { name: 'Accounts' } }));
jest.mock('@models/transactions.model', () => ({ __esModule: true, default: { name: 'Transactions' } }));
jest.mock('@models/transactions-query', () => ({ __esModule: true, findTransactions: jest.fn() }));
jest.mock('./category-allocation', () => ({ __esModule: true, resolveRefundPairs: jest.fn() }));

/* eslint-disable import/first */
import { findTransactions } from '@models/transactions-query';

import { statsTransactions } from './stats-transactions';
/* eslint-enable import/first */

describe('statsTransactions window under America/New_York', () => {
  it('closes the range at the end of the UTC closing day', async () => {
    jest.mocked(findTransactions).mockResolvedValue([] as never);
    await statsTransactions({
      access: { creator: 7 },
      planned: 'exclude',
      refunds: 'ignore',
      window: { from: '2026-03-01', to: '2026-03-08' },
    });

    const where = jest.mocked(findTransactions).mock.calls.at(-1)![0]!.where as unknown as {
      [Op.and]: { time: { [Op.lte]: Date } }[];
    };
    expect(where[Op.and][0]!.time[Op.lte]).toEqual(new Date('2026-03-08T23:59:59.999Z'));
  });
});
