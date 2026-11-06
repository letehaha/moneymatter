import { type Entitlements, FEATURES, USER_ROLES } from '@bt/shared/types';
import { describe, expect, it, jest } from '@jest/globals';
import { isBaseCurrencyChangeLocked } from '@services/currencies/base-currency-lock';
import { getEntitlementsByUserId } from '@services/entitlements/resolve-entitlements.service';

import { assertBaseCurrencyUnlocked, assertNotDemoUser, requireFeature, requireScope } from './helpers';

jest.mock('@services/entitlements/resolve-entitlements.service', () => ({ getEntitlementsByUserId: jest.fn() }));
jest.mock('@services/currencies/base-currency-lock', () => ({ isBaseCurrencyChangeLocked: jest.fn() }));

const mockFeatures = (features: string[]) =>
  jest.mocked(getEntitlementsByUserId).mockResolvedValueOnce({ features } as unknown as Entitlements);

describe('requireFeature', () => {
  it('passes when the plan or an active trial includes the feature', async () => {
    mockFeatures([FEATURES.goals]);

    await expect(requireFeature({ userId: 1, feature: FEATURES.goals })).resolves.toBeUndefined();
  });

  it.each([{ features: [FEATURES.budget_plan] }, { features: [] }])(
    'rejects when the feature is not included ($features)',
    async ({ features }) => {
      mockFeatures(features);

      await expect(requireFeature({ userId: 1, feature: FEATURES.goals })).rejects.toThrow(/not included/);
    },
  );
});

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

describe('assertNotDemoUser', () => {
  it('refuses a demo user whatever the scopes and plan', () => {
    const extra = authInfoFor({ role: USER_ROLES.demo, scopes: ['finance:read'], readOnly: true });

    expect(() => assertNotDemoUser({ extra })).toThrow(/demo mode/);
  });

  it('lets a common user through, read-only or not', () => {
    expect(() => assertNotDemoUser({ extra: authInfoFor({ role: USER_ROLES.common, scopes: [] }) })).not.toThrow();
    expect(() =>
      assertNotDemoUser({ extra: authInfoFor({ role: USER_ROLES.common, scopes: [], readOnly: true }) }),
    ).not.toThrow();
  });
});

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
