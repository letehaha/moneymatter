import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { DatabaseError } from 'sequelize';

const mockNamespaceGet = jest.fn<(key: string) => unknown>();

jest.mock('@common/helpers', () => ({ __esModule: true, sleep: () => Promise.resolve() }));
jest.mock('@models/connection', () => ({
  __esModule: true,
  namespace: { get: (key: string) => mockNamespaceGet(key) },
}));

// eslint-disable-next-line import/first
import { retryOnDeadlock } from './retry-on-deadlock';

const makeDbError = ({ code }: { code: string }) =>
  new DatabaseError(Object.assign(new Error('db error'), { code, sql: '' }));

beforeEach(() => {
  mockNamespaceGet.mockReset();
});

describe('retryOnDeadlock', () => {
  it('runs fn a second time after a deadlock and returns its result', async () => {
    const fn = jest
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(makeDbError({ code: '40P01' }))
      .mockResolvedValueOnce('ok');

    await expect(retryOnDeadlock({ fn })).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('rethrows when the retry deadlocks too', async () => {
    const deadlock = makeDbError({ code: '40P01' });
    const fn = jest.fn<() => Promise<string>>().mockRejectedValue(deadlock);

    await expect(retryOnDeadlock({ fn })).rejects.toBe(deadlock);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('does not retry other database errors', async () => {
    const other = makeDbError({ code: '23505' });
    const fn = jest.fn<() => Promise<string>>().mockRejectedValue(other);

    await expect(retryOnDeadlock({ fn })).rejects.toBe(other);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('does not retry inside an outer transaction, which the deadlock aborted', async () => {
    mockNamespaceGet.mockReturnValue({ finished: undefined });
    const deadlock = makeDbError({ code: '40P01' });
    const fn = jest.fn<() => Promise<string>>().mockRejectedValue(deadlock);

    await expect(retryOnDeadlock({ fn })).rejects.toBe(deadlock);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
