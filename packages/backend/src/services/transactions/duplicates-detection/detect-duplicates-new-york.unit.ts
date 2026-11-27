/**
 * @jest-environment <rootDir>/src/services/budget-plans/periods/new-york-timezone-environment.ts
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

jest.mock('@models/accounts.model', () => ({ __esModule: true, getAccountById: jest.fn() }));
jest.mock('@models/transactions.model', () => ({ __esModule: true, findWithFilters: jest.fn() }));
jest.mock('@common/lib/currency-precision', () => ({ __esModule: true, getCurrencyDecimals: jest.fn() }));

/* eslint-disable import/first */
import { getCurrencyDecimals } from '@common/lib/currency-precision';
import { getAccountById } from '@models/accounts.model';
import { findWithFilters } from '@models/transactions.model';

import { detectDuplicates } from './detect-duplicates.service';
/* eslint-enable import/first */

const findWithFiltersMock = jest.mocked(findWithFilters);

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(getAccountById).mockResolvedValue({ userId: 1, currencyCode: 'USD' } as never);
  jest.mocked(getCurrencyDecimals).mockResolvedValue(2 as never);
  findWithFiltersMock.mockResolvedValue([] as never);
});

describe('detectDuplicates date window under America/New_York', () => {
  it('ends the window the day after the latest transaction across spring-forward', async () => {
    await detectDuplicates({
      userId: 1,
      accountId: 'acc',
      transactions: [
        { date: '2026-03-06', amount: 10, type: 'expense' },
        { date: '2026-03-08 14:00:00', amount: 20, type: 'expense' },
      ],
    });

    expect(findWithFiltersMock).toHaveBeenCalledWith(
      expect.objectContaining({ startDate: '2026-03-06', endDate: '2026-03-09' }),
    );
  });
});
