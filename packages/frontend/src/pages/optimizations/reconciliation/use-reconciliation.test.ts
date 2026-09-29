import { checkStuckPending } from '@/api/transactions';
import { ApiErrorResponseError } from '@/js/errors';
import { API_ERROR_CODES, type RecordId } from '@bt/shared/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ComposerTranslation } from 'vue-i18n';

import { bankCheckText, checkAccountsWithBank } from './use-reconciliation';

vi.mock('@/api/transactions', () => ({ checkStuckPending: vi.fn() }));

const mockedCheck = vi.mocked(checkStuckPending);
const ACCOUNT_IDS = ['acc-a', 'acc-b', 'acc-c'] as RecordId[];
const KEY = 'optimizations.reconciliation.notifications.bankCheck';

const t = ((key: string, _named?: unknown, plural?: number) =>
  plural === undefined ? key : `${key}#${plural}`) as unknown as ComposerTranslation;

const apiError = ({ message }: { message: string }) =>
  new ApiErrorResponseError('request failed', { code: API_ERROR_CODES.unexpected, message });

describe('checkAccountsWithBank', () => {
  beforeEach(() => mockedCheck.mockReset());

  it('sums totals across all accounts', async () => {
    mockedCheck
      .mockResolvedValueOnce({ bookedCount: 1, pendingCount: 2 })
      .mockResolvedValueOnce({ bookedCount: 3, pendingCount: 0 })
      .mockResolvedValueOnce({ bookedCount: 0, pendingCount: 4 });

    await expect(checkAccountsWithBank({ accountIds: ACCOUNT_IDS })).resolves.toEqual({
      bookedCount: 4,
      pendingCount: 6,
      failedCount: 0,
    });
    expect(mockedCheck).toHaveBeenCalledTimes(3);
  });

  it('counts failures and keeps the first failure message on partial failure', async () => {
    mockedCheck
      .mockResolvedValueOnce({ bookedCount: 2, pendingCount: 1 })
      .mockRejectedValueOnce(apiError({ message: 'first' }))
      .mockRejectedValueOnce(apiError({ message: 'second' }));

    await expect(checkAccountsWithBank({ accountIds: ACCOUNT_IDS })).resolves.toEqual({
      bookedCount: 2,
      pendingCount: 1,
      failedCount: 2,
      failedMessage: 'first',
    });
  });

  it('throws the first error when every account fails', async () => {
    const first = apiError({ message: 'first' });
    mockedCheck.mockRejectedValueOnce(first).mockRejectedValueOnce(apiError({ message: 'second' }));

    await expect(checkAccountsWithBank({ accountIds: ACCOUNT_IDS.slice(0, 2) })).rejects.toBe(first);
  });
});

describe('bankCheckText', () => {
  it('nothing pending, nothing booked', () => {
    expect(bankCheckText({ t, bookedCount: 0, pendingCount: 0, failedCount: 0 })).toEqual({
      text: 'optimizations.reconciliation.notifications.checkedWithBank',
      description: undefined,
    });
  });

  it('nothing pending, some booked', () => {
    expect(bankCheckText({ t, bookedCount: 3, pendingCount: 0, failedCount: 0 })).toEqual({
      text: `${KEY}.allBooked#3`,
      description: undefined,
    });
  });

  it('some pending, some booked', () => {
    expect(bankCheckText({ t, bookedCount: 2, pendingCount: 1, failedCount: 0 })).toEqual({
      text: `${KEY}.someBooked#2`,
      description: `${KEY}.stillPending#1`,
    });
  });

  it('some pending, none booked', () => {
    expect(bankCheckText({ t, bookedCount: 0, pendingCount: 4, failedCount: 0 })).toEqual({
      text: `${KEY}.noneBooked`,
      description: `${KEY}.stillPending#4`,
    });
  });

  it('appends the failure count and message', () => {
    expect(bankCheckText({ t, bookedCount: 1, pendingCount: 0, failedCount: 1, failedMessage: 'Bank down' })).toEqual({
      text: `${KEY}.allBooked#1`,
      description: `${KEY}.someFailed#1 Bank down`,
    });
    expect(bankCheckText({ t, bookedCount: 0, pendingCount: 2, failedCount: 2 })).toEqual({
      text: `${KEY}.noneBooked`,
      description: `${KEY}.stillPending#2 ${KEY}.someFailed#2`,
    });
  });
});
