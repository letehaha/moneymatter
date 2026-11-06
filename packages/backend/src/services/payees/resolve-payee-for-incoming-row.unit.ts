import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { DatabaseError, UniqueConstraintError } from 'sequelize';

const mockResolve = jest.fn<() => Promise<{ payeeId: string }>>();
const mockLoggerError = jest.fn();

jest.mock('./extraction.service', () => ({ __esModule: true, resolvePayeeForRawMerchant: () => mockResolve() }));
jest.mock('../common/run-in-savepoint', () => ({
  __esModule: true,
  runInSavepoint: (fn: () => Promise<unknown>) => fn(),
}));
jest.mock('@js/utils/logger', () => ({
  __esModule: true,
  logger: { error: (...args: unknown[]) => mockLoggerError(...args) },
}));
jest.mock('@services/user-settings/get-user-settings', () => ({ __esModule: true, getUserSettings: jest.fn() }));

// eslint-disable-next-line import/first
import { resolvePayeeForIncomingRow } from './resolve-payee-for-incoming-row';

const params = { ownerUserId: 1, rawMerchantName: 'Bay Foodmarket', failureLogMessage: 'failed' };

beforeEach(() => {
  mockResolve.mockReset();
  mockLoggerError.mockReset();
});

describe('resolvePayeeForIncomingRow', () => {
  it('rethrows a deadlock so the caller can retry the whole transaction', async () => {
    const deadlock = new DatabaseError(Object.assign(new Error('deadlock detected'), { code: '40P01', sql: '' }));
    mockResolve.mockRejectedValue(deadlock);

    await expect(resolvePayeeForIncomingRow(params)).rejects.toBe(deadlock);
    expect(mockLoggerError).not.toHaveBeenCalled();
  });

  it('leaves the row unlinked on any other failure', async () => {
    mockResolve.mockRejectedValue(new UniqueConstraintError({}));

    await expect(resolvePayeeForIncomingRow(params)).resolves.toBeNull();
    expect(mockLoggerError).toHaveBeenCalledTimes(1);
  });
});
