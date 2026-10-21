import { type Entitlements, FEATURES, TRANSACTION_TRANSFER_NATURE, USER_ROLES } from '@bt/shared/types';
import { describe, expect, it, jest } from '@jest/globals';
import { getEntitlementsByUserId } from '@services/entitlements/resolve-entitlements.service';

import { assertOriginalCurrencyArgs, requireFeature, requireScope } from './helpers';

jest.mock('@services/entitlements/resolve-entitlements.service', () => ({ getEntitlementsByUserId: jest.fn() }));

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
