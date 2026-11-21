import type { UserSettingsSchema } from '@/api/user-settings';
import type { PayeeLookupItem, RecordId } from '@bt/shared/types';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/composable/data-queries/payees', () => ({ usePayeeLookup: vi.fn() }));
vi.mock('@/composable/data-queries/user-settings', () => ({ userSettingsQueryOptions: {} }));

import { isPayeeLogosEnabled, resolvePayeeLogo } from './use-payee-logos';

const payee = ({ id, logoDomain = null }: { id: string; logoDomain?: string | null }) =>
  ({
    id,
    name: `Payee ${id}`,
    logoDomain,
    logoInitials: null,
    logoColor: null,
    logoIcon: null,
    logoImageId: null,
  }) as PayeeLookupItem;

const payeesById = new Map([
  ['with-logo', payee({ id: 'with-logo', logoDomain: 'netflix.com' })],
  ['no-logo', payee({ id: 'no-logo' })],
]);

const resolve = ({ payeeId, enabled = true }: { payeeId: string | null; enabled?: boolean }) =>
  resolvePayeeLogo({ enabled, payeeId: payeeId as RecordId | null, payeesById });

describe('isPayeeLogosEnabled', () => {
  it('is on when the setting is unset and off only when explicitly false', () => {
    expect(isPayeeLogosEnabled({ settings: {} as UserSettingsSchema })).toBe(true);
    expect(isPayeeLogosEnabled({ settings: { showPayeeLogos: true } as UserSettingsSchema })).toBe(true);
    expect(isPayeeLogosEnabled({ settings: { showPayeeLogos: false } as UserSettingsSchema })).toBe(false);
  });

  it('is off until settings load', () => {
    expect(isPayeeLogosEnabled({ settings: undefined })).toBe(false);
  });
});

describe('resolvePayeeLogo', () => {
  it('returns display props for a payee with a logo', () => {
    expect(resolve({ payeeId: 'with-logo' })).toMatchObject({ name: 'Payee with-logo', domain: 'netflix.com' });
  });

  it('returns null when disabled, without a payee, for an unknown payee, or for a payee without a logo', () => {
    expect(resolve({ payeeId: 'with-logo', enabled: false })).toBeNull();
    expect(resolve({ payeeId: null })).toBeNull();
    expect(resolve({ payeeId: 'missing' })).toBeNull();
    expect(resolve({ payeeId: 'no-logo' })).toBeNull();
  });
});
