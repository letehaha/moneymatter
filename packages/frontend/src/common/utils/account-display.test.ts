import {
  ACCESS_SOURCES,
  ACCOUNT_CATEGORIES,
  ACCOUNT_STATUSES,
  ACCOUNT_TYPES,
  type AccountModel,
  SHARE_PERMISSIONS,
  type RecordId,
} from '@bt/shared/types';
import { describe, expect, it } from 'vitest';

import { getAccountDisplayLabel, isAccountArchived } from './account-display';

const makeAccount = (overrides: Partial<AccountModel> = {}): AccountModel => ({
  type: ACCOUNT_TYPES.system,
  id: '00000000-0000-0000-0000-000000000001' as RecordId,
  name: 'Cash',
  initialBalance: 0,
  refInitialBalance: 0,
  currentBalance: 0,
  refCurrentBalance: 0,
  creditLimit: 0,
  refCreditLimit: 0,
  accountCategory: ACCOUNT_CATEGORIES.general,
  currencyCode: 'USD',
  userId: 1,
  status: ACCOUNT_STATUSES.active,
  excludeFromStats: false,
  logoDomain: null,
  logoInitials: null,
  logoColor: null,
  logoIcon: null,
  logoImageId: null,
  ...overrides,
});

describe('getAccountDisplayLabel', () => {
  it('returns the bare name for an owned active account', () => {
    expect(getAccountDisplayLabel(makeAccount({ name: 'Wallet' }))).toBe('Wallet');
  });

  it('appends "(archived)" for archived accounts', () => {
    expect(getAccountDisplayLabel(makeAccount({ name: 'Old', status: ACCOUNT_STATUSES.archived }))).toBe(
      'Old (archived)',
    );
  });

  it('omits the share suffix when the caller is the owner', () => {
    const account = makeAccount({
      name: 'Wallet',
      share: {
        isOwner: true,
        owner: { id: 1, username: 'me', avatar: null },
        permission: SHARE_PERMISSIONS.manage,
        policy: null,
        accessSource: ACCESS_SOURCES.owner,
      },
    });
    expect(getAccountDisplayLabel(account)).toBe('Wallet');
  });

  it('appends "(shared by @owner)" when the caller is a recipient', () => {
    const account = makeAccount({
      name: 'Family Wallet',
      share: {
        isOwner: false,
        owner: { id: 2, username: 'alice', avatar: null },
        permission: SHARE_PERMISSIONS.write,
        policy: null,
        accessSource: ACCESS_SOURCES.share,
      },
    });
    expect(getAccountDisplayLabel(account)).toBe('Family Wallet (shared by @alice)');
  });

  it('truncates owner usernames longer than 12 chars with an ellipsis', () => {
    const account = makeAccount({
      name: 'Family Wallet',
      share: {
        isOwner: false,
        owner: { id: 2, username: 'verylongusername123', avatar: null },
        permission: SHARE_PERMISSIONS.write,
        policy: null,
        accessSource: ACCESS_SOURCES.share,
      },
    });
    expect(getAccountDisplayLabel(account)).toBe('Family Wallet (shared by @verylonguser…)');
  });

  it('keeps usernames at the 12-char threshold un-truncated', () => {
    const account = makeAccount({
      name: 'Family Wallet',
      share: {
        isOwner: false,
        owner: { id: 2, username: 'twelvechars1', avatar: null },
        permission: SHARE_PERMISSIONS.write,
        policy: null,
        accessSource: ACCESS_SOURCES.share,
      },
    });
    expect(getAccountDisplayLabel(account)).toBe('Family Wallet (shared by @twelvechars1)');
  });

  it('combines archived and shared suffixes when both apply', () => {
    const account = makeAccount({
      name: 'Vault',
      status: ACCOUNT_STATUSES.archived,
      share: {
        isOwner: false,
        owner: { id: 2, username: 'bob', avatar: null },
        permission: SHARE_PERMISSIONS.read,
        policy: null,
        accessSource: ACCESS_SOURCES.share,
      },
    });
    expect(getAccountDisplayLabel(account)).toBe('Vault (archived) (shared by @bob)');
  });
});

describe('isAccountArchived', () => {
  it('returns false for active accounts', () => {
    expect(isAccountArchived({ status: ACCOUNT_STATUSES.active })).toBe(false);
  });

  it('returns true for archived accounts', () => {
    expect(isAccountArchived({ status: ACCOUNT_STATUSES.archived })).toBe(true);
  });

  it('returns false for the out-of-wallet mock', () => {
    expect(isAccountArchived({ status: ACCOUNT_STATUSES.archived, _isOutOfWallet: true })).toBe(false);
  });
});
