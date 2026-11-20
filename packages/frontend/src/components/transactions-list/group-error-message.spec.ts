import { ApiErrorResponseError } from '@/js/errors';
import { API_ERROR_CODES } from '@bt/shared/types';
import { describe, expect, it } from 'vitest';

import { getGroupErrorMessage } from './group-error-message';

const t = (key: string, named?: Record<string, unknown>) => (named ? `${key} ${JSON.stringify(named)}` : key);
const FALLBACK_KEY = 'transactions.transactionGroups.errors.createFailed';

const apiError = ({ code, details }: { code: API_ERROR_CODES; details?: Record<string, unknown> }) =>
  new ApiErrorResponseError('boom', { code, message: 'boom', details });

describe('getGroupErrorMessage', () => {
  it('explains the size limit when a validation error carries maxSize', () => {
    const e = apiError({ code: API_ERROR_CODES.validationError, details: { maxSize: 50, count: 52 } });
    expect(getGroupErrorMessage({ e, t, fallbackKey: FALLBACK_KEY })).toBe(
      'transactions.transactionGroups.errors.tooManyTransactions {"max":50,"count":52}',
    );
  });

  it('names the groups the transactions already belong to', () => {
    const e = apiError({
      code: API_ERROR_CODES.conflict,
      details: {
        transactionIds: ['a', 'b'],
        groups: [
          { id: '1', name: 'Trip' },
          { id: '2', name: 'Rent' },
        ],
      },
    });
    expect(getGroupErrorMessage({ e, t, fallbackKey: FALLBACK_KEY })).toBe(
      'transactions.transactionGroups.errors.alreadyInNamedGroup {"name":"Trip, Rent"}',
    );
  });

  it('falls back to the generic conflict message when no groups are sent', () => {
    const e = apiError({ code: API_ERROR_CODES.conflict, details: { transactionIds: ['a'] } });
    expect(getGroupErrorMessage({ e, t, fallbackKey: FALLBACK_KEY })).toBe(
      'transactions.transactionGroups.errors.alreadyInGroup',
    );
  });

  it('falls back to the provided key for a validation error without size details', () => {
    const e = apiError({ code: API_ERROR_CODES.validationError });
    expect(getGroupErrorMessage({ e, t, fallbackKey: FALLBACK_KEY })).toBe(FALLBACK_KEY);
  });

  it.each([
    ['maxSize is not a number', { maxSize: '50', count: 52 }],
    ['count is missing', { maxSize: 50 }],
  ])('falls back to the provided key when %s', (_, details) => {
    const e = apiError({ code: API_ERROR_CODES.validationError, details });
    expect(getGroupErrorMessage({ e, t, fallbackKey: FALLBACK_KEY })).toBe(FALLBACK_KEY);
  });

  it('names a single group without a separator', () => {
    const e = apiError({ code: API_ERROR_CODES.conflict, details: { groups: [{ id: '1', name: 'Trip' }] } });
    expect(getGroupErrorMessage({ e, t, fallbackKey: FALLBACK_KEY })).toBe(
      'transactions.transactionGroups.errors.alreadyInNamedGroup {"name":"Trip"}',
    );
  });

  it.each([
    ['groups is empty', { transactionIds: ['a'], groups: [] }],
    ['every group entry is malformed', { groups: [{ id: '1' }, null, { id: '2', name: 42 }] }],
    ['details are absent', undefined],
  ])('uses the generic conflict message when %s', (_, details) => {
    const e = apiError({ code: API_ERROR_CODES.conflict, details });
    expect(getGroupErrorMessage({ e, t, fallbackKey: FALLBACK_KEY })).toBe(
      'transactions.transactionGroups.errors.alreadyInGroup',
    );
  });

  it('falls back to the provided key for unknown errors', () => {
    expect(getGroupErrorMessage({ e: new Error('network'), t, fallbackKey: FALLBACK_KEY })).toBe(FALLBACK_KEY);
  });
});
