import { type Entitlements, FEATURES, TRANSACTION_TRANSFER_NATURE, USER_ROLES } from '@bt/shared/types';
import { describe, expect, it, jest } from '@jest/globals';
import { isBaseCurrencyChangeLocked } from '@services/currencies/base-currency-lock';
import { getEntitlementsByUserId } from '@services/entitlements/resolve-entitlements.service';

import {
  assertBaseCurrencyUnlocked,
  assertNotDemoUser,
  assertOriginalCurrencyArgs,
  requireFeature,
  requireFeatureAccess,
  requireScope,
} from './helpers';

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

describe('requireScope with allowReadOnly', () => {
  it('lets a read-only user through when the scope is granted', () => {
    const extra = authInfoFor({ role: USER_ROLES.common, scopes: ['finance:write'], readOnly: true });

    expect(() => requireScope({ extra, scope: 'finance:write', allowReadOnly: true })).not.toThrow();
  });

  it('lets a read-only user through when the entitlement info is missing', () => {
    const extra = { authInfo: { scopes: ['finance:write'], extra: { role: USER_ROLES.common } } };

    expect(() => requireScope({ extra, scope: 'finance:write', allowReadOnly: true })).not.toThrow();
  });

  it('lets a demo user through, as the READ_ONLY_ROUTES have no demo block', () => {
    const extra = authInfoFor({ role: USER_ROLES.demo, scopes: ['finance:write'] });

    expect(() => requireScope({ extra, scope: 'finance:write', allowReadOnly: true })).not.toThrow();
  });

  it('still rejects a missing scope', () => {
    const extra = authInfoFor({ role: USER_ROLES.common, scopes: ['finance:read'], readOnly: true });

    expect(() => requireScope({ extra, scope: 'finance:write', allowReadOnly: true })).toThrow(
      /Missing required scope/,
    );
  });

  it('keeps rejecting read-only and demo users when the option is false or absent', () => {
    const readOnly = authInfoFor({ role: USER_ROLES.common, scopes: ['finance:write'], readOnly: true });
    const demo = authInfoFor({ role: USER_ROLES.demo, scopes: ['finance:write'] });

    expect(() => requireScope({ extra: readOnly, scope: 'finance:write', allowReadOnly: false })).toThrow(
      /no longer includes editing/,
    );
    expect(() => requireScope({ extra: demo, scope: 'finance:write', allowReadOnly: false })).toThrow(/demo mode/);
  });
});

const withFeatures = ({ features }: { features?: string[] }) => ({ authInfo: { extra: { features } } });

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

describe('requireFeatureAccess', () => {
  it('passes when the plan includes the feature', () => {
    const extra = withFeatures({ features: [FEATURES.budget_plan, FEATURES.attachments] });

    expect(() => requireFeatureAccess({ extra: extra as never, feature: FEATURES.budget_plan })).not.toThrow();
  });

  it('throws the plan message when the feature is missing', () => {
    const extra = withFeatures({ features: [FEATURES.attachments] });

    expect(() => requireFeatureAccess({ extra: extra as never, feature: FEATURES.budget_plan })).toThrow(
      'This feature is not included in your current plan.',
    );
  });

  it('throws when features is absent from the auth payload', () => {
    expect(() => requireFeatureAccess({ extra: withFeatures({}) as never, feature: FEATURES.attachments })).toThrow(
      'This feature is not included in your current plan.',
    );
    expect(() => requireFeatureAccess({ extra: {} as never, feature: FEATURES.attachments })).toThrow(
      'This feature is not included in your current plan.',
    );
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
