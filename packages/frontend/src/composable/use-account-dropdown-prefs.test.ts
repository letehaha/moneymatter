import { ACCOUNT_STATUSES } from '@bt/shared/types';

vi.mock('@/composable/data-queries/user-settings', () => ({
  useUserSettings: vi.fn(),
}));

import { filterDropdownAccounts, resolveDefaultAccount } from './use-account-dropdown-prefs';

const account = ({ id, status = ACCOUNT_STATUSES.active }: { id: string; status?: ACCOUNT_STATUSES }) => ({
  id,
  status,
});

describe('resolveDefaultAccount', () => {
  const accounts = [account({ id: 'a' }), account({ id: 'b' })];

  it('returns the account matching the default id', () => {
    expect(resolveDefaultAccount({ accounts, defaultAccountId: 'b' })).toBe(accounts[1]);
  });

  it('falls back to the first account when the default is absent', () => {
    expect(resolveDefaultAccount({ accounts, defaultAccountId: 'missing' })).toBe(accounts[0]);
    expect(resolveDefaultAccount({ accounts, defaultAccountId: null })).toBe(accounts[0]);
  });

  it('returns null when the default is absent and the fallback is disabled', () => {
    expect(resolveDefaultAccount({ accounts, defaultAccountId: null, fallbackToFirst: false })).toBe(null);
    expect(resolveDefaultAccount({ accounts, defaultAccountId: 'missing', fallbackToFirst: false })).toBe(null);
  });

  it('uses the last-used account when no default is set, and the default wins over it', () => {
    expect(resolveDefaultAccount({ accounts, defaultAccountId: null, lastUsedAccountId: 'b' })).toBe(accounts[1]);
    expect(resolveDefaultAccount({ accounts, defaultAccountId: 'a', lastUsedAccountId: 'b' })).toBe(accounts[0]);
    expect(
      resolveDefaultAccount({ accounts, defaultAccountId: null, lastUsedAccountId: 'gone', fallbackToFirst: false }),
    ).toBe(null);
  });

  it('returns null for an empty list', () => {
    expect(resolveDefaultAccount({ accounts: [], defaultAccountId: 'a' })).toBe(null);
    expect(resolveDefaultAccount({ accounts: [], defaultAccountId: null, fallbackToFirst: false })).toBe(null);
  });
});

describe('filterDropdownAccounts', () => {
  const active = account({ id: 'active' });
  const archived = account({ id: 'archived', status: ACCOUNT_STATUSES.archived });
  const outOfWallet = { id: 'out-of-wallet' };
  const accounts = [active, archived, outOfWallet];

  it('drops archived accounts when archived are hidden', () => {
    expect(filterDropdownAccounts({ accounts, showArchived: false })).toEqual([active, outOfWallet]);
  });

  it('keeps an archived account while it is the selected one', () => {
    expect(filterDropdownAccounts({ accounts, showArchived: false, selectedId: 'archived' })).toEqual([
      active,
      archived,
      outOfWallet,
    ]);
  });

  it('keeps options without a status regardless of the filter', () => {
    expect(filterDropdownAccounts({ accounts: [outOfWallet], showArchived: false })).toEqual([outOfWallet]);
  });

  it('keeps everything when archived are shown', () => {
    expect(filterDropdownAccounts({ accounts, showArchived: true })).toEqual(accounts);
  });
});
