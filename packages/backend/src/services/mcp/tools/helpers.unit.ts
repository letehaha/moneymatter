import { TRANSACTION_TRANSFER_NATURE, USER_ROLES } from '@bt/shared/types';
import { describe, expect, it, jest } from '@jest/globals';
import { RateLimitService } from '@services/common/rate-limit.service';
import { RATE_SOURCE_SAVE_LIMIT } from '@services/common/user-rate-limits';
import { isBaseCurrencyChangeLocked } from '@services/currencies/base-currency-lock';

import { assertBaseCurrencyUnlocked, assertOriginalCurrencyArgs, enforceUserRateLimit, requireScope } from './helpers';

const authInfoFor = ({ role, scopes, readOnly = false }: { role: string; scopes: string[]; readOnly?: boolean }) => ({
  authInfo: { scopes, extra: { role, readOnly } },
});

describe('requireScope', () => {
  it('blocks demo users from write tools even when the scope is granted', () => {
    const extra = authInfoFor({ role: USER_ROLES.demo, scopes: ['finance:read', 'finance:write', 'finance:delete'] });

    expect(() => requireScope({ extra, scope: 'finance:write' })).toThrow(/demo mode/);
    expect(() => requireScope({ extra, scope: 'finance:delete' })).toThrow(/demo mode/);
  });

  it('allows regular users with the granted scope', () => {
    const extra = authInfoFor({ role: USER_ROLES.common, scopes: ['finance:write'] });

    expect(() => requireScope({ extra, scope: 'finance:write' })).not.toThrow();
  });

  it('blocks read-only users from write tools even when the scope is granted', () => {
    const extra = authInfoFor({ role: USER_ROLES.common, scopes: ['finance:write'], readOnly: true });

    expect(() => requireScope({ extra, scope: 'finance:write' })).toThrow(/no longer includes editing/);
  });

  it('treats a missing readOnly flag as read-only', () => {
    const extra = { authInfo: { scopes: ['finance:write'], extra: { role: USER_ROLES.common } } };

    expect(() => requireScope({ extra, scope: 'finance:write' })).toThrow(/no longer includes editing/);
  });

  it('rejects regular users missing the scope', () => {
    const extra = authInfoFor({ role: USER_ROLES.common, scopes: ['finance:read'] });

    expect(() => requireScope({ extra, scope: 'finance:write' })).toThrow(/Missing required scope/);
  });
});

describe('assertOriginalCurrencyArgs', () => {
  it('accepts the pair set together, cleared together, or absent', () => {
    expect(() => assertOriginalCurrencyArgs({ args: {} })).not.toThrow();
    expect(() =>
      assertOriginalCurrencyArgs({ args: { originalAmount: 66.42, originalCurrencyCode: 'PLN' } }),
    ).not.toThrow();
    expect(() =>
      assertOriginalCurrencyArgs({ args: { originalAmount: null, originalCurrencyCode: null } }),
    ).not.toThrow();
  });

  it('rejects half a pair', () => {
    expect(() => assertOriginalCurrencyArgs({ args: { originalAmount: 66.42 } })).toThrow(/together/);
    expect(() => assertOriginalCurrencyArgs({ args: { originalCurrencyCode: 'PLN' } })).toThrow(/together/);
    expect(() => assertOriginalCurrencyArgs({ args: { originalAmount: null, originalCurrencyCode: 'PLN' } })).toThrow(
      /together/,
    );
    expect(() => assertOriginalCurrencyArgs({ args: { originalAmount: 66.42, originalCurrencyCode: null } })).toThrow(
      /together/,
    );
  });

  it('treats a zero amount as a set value, not a cleared one', () => {
    expect(() =>
      assertOriginalCurrencyArgs({ args: { originalAmount: 0, originalCurrencyCode: 'PLN' } }),
    ).not.toThrow();
    expect(() => assertOriginalCurrencyArgs({ args: { originalAmount: 0 } })).toThrow(/together/);
  });

  it('rejects the pair on explicit and implicit transfers', () => {
    const pair = { originalAmount: 66.42, originalCurrencyCode: 'PLN' };

    expect(() =>
      assertOriginalCurrencyArgs({ args: { ...pair, transferNature: TRANSACTION_TRANSFER_NATURE.common_transfer } }),
    ).toThrow(/transfer transactions/);
    for (const transferField of [
      { destinationAccountId: 1 },
      { destinationAmount: 30 },
      { destinationTransactionId: 'a9aad5e3-0000-4000-8000-000000000000' },
    ]) {
      expect(() => assertOriginalCurrencyArgs({ args: { ...pair, ...transferField } })).toThrow(
        /transfer transactions/,
      );
    }
    expect(() =>
      assertOriginalCurrencyArgs({ args: { ...pair, transferNature: TRANSACTION_TRANSFER_NATURE.not_transfer } }),
    ).not.toThrow();
  });
});

jest.mock('@services/currencies/base-currency-lock', () => ({ isBaseCurrencyChangeLocked: jest.fn() }));

describe('assertBaseCurrencyUnlocked', () => {
  const lockCheck = jest.mocked(isBaseCurrencyChangeLocked);

  it('throws while a base-currency change holds the lock', async () => {
    lockCheck.mockResolvedValueOnce(true);

    await expect(assertBaseCurrencyUnlocked({ userId: 7 })).rejects.toThrow(/currencies.baseCurrencyChangeInProgress/);
    expect(lockCheck).toHaveBeenCalledWith({ userId: 7 });
  });

  it('fails closed with the unavailable message when the lock check errors', async () => {
    lockCheck.mockRejectedValueOnce(new Error('redis down'));

    await expect(assertBaseCurrencyUnlocked({ userId: 7 })).rejects.toThrow(/common.serviceTemporarilyUnavailable/);
  });

  it('passes while the user is unlocked', async () => {
    lockCheck.mockResolvedValueOnce(false);

    await expect(assertBaseCurrencyUnlocked({ userId: 7 })).resolves.toBeUndefined();
  });
});

jest.mock('@services/common/rate-limit.service', () => ({ RateLimitService: { checkRateLimit: jest.fn() } }));

describe('enforceUserRateLimit', () => {
  const checkRateLimit = jest.mocked(RateLimitService.checkRateLimit);

  it('counts the call on the limit key of the user, with the budget of the limit', async () => {
    checkRateLimit.mockResolvedValueOnce({ allowed: true });

    await enforceUserRateLimit({ userId: 7, limit: RATE_SOURCE_SAVE_LIMIT });

    expect(checkRateLimit).toHaveBeenCalledWith('rate-source-save:user:7', 60, 20);
  });

  it('throws the too-many-requests message when the limiter refuses', async () => {
    checkRateLimit.mockResolvedValueOnce({ allowed: false, remainingSeconds: 30 });

    await expect(enforceUserRateLimit({ userId: 7, limit: RATE_SOURCE_SAVE_LIMIT })).rejects.toThrow(
      /middleware.tooManyRequests/,
    );
  });

  it('lets the call through when Redis is down, as the REST middleware does', async () => {
    checkRateLimit.mockResolvedValueOnce({ allowed: true, serviceUnavailable: true });

    await expect(enforceUserRateLimit({ userId: 7, limit: RATE_SOURCE_SAVE_LIMIT })).resolves.toBeUndefined();
  });
});
