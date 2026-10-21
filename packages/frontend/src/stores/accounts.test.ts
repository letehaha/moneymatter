import { VUE_QUERY_GLOBAL_PREFIXES } from '@/common/const';
import { formatUIAmount, registerCurrencyDecimals, resetCurrencyDecimals } from '@/js/helpers';
import {
  ACCOUNT_CATEGORIES,
  ACCOUNT_STATUSES,
  ACCOUNT_TYPES,
  type AccountWithRelinkStatus,
  type RecordId,
  SHARE_PERMISSIONS,
  type UserInfoResponse,
} from '@bt/shared/types';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { ACCOUNTS } from '@tests/mocks/accounts';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent } from 'vue';

import { useAccountsStore } from './accounts';
import { useUserStore } from './user';

// Mock the `@/api` barrel so the query resolves from a stub. `loadUserData` is
// included because the user store imports it from the same barrel.
vi.mock('@/api', () => ({
  loadAccounts: vi.fn(),
  loadUserData: vi.fn(),
  deleteAccount: vi.fn(),
  editAccount: vi.fn(),
  unlinkAccountFromBankConnection: vi.fn(),
}));

import { loadAccounts as apiLoadAccounts } from '@/api';

const mockLoadAccounts = vi.mocked(apiLoadAccounts);

/** An account carrying the given id, reusing a valid mock as the base shape. */
const withId = (id: string): AccountWithRelinkStatus => ({ ...ACCOUNTS[0]!, id: id as RecordId });

const buildAccount = (id: string, overrides: Partial<AccountWithRelinkStatus> = {}): AccountWithRelinkStatus => ({
  ...withId(id),
  type: ACCOUNT_TYPES.system,
  accountCategory: ACCOUNT_CATEGORIES.general,
  status: ACCOUNT_STATUSES.active,
  ...overrides,
});

describe('useAccountsStore – accountsRecord mirrors the live accounts list', () => {
  let store: ReturnType<typeof useAccountsStore>;
  let queryClient: QueryClient;

  const mountStore = () => {
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const pinia = createPinia();
    setActivePinia(pinia);

    // The accounts query is gated on `isUserExists`; seed a signed-in user.
    useUserStore().user = {} as UserInfoResponse;

    const Wrapper = defineComponent({
      setup() {
        store = useAccountsStore();
        return () => null;
      },
    });
    mount(Wrapper, { global: { plugins: [pinia, [VueQueryPlugin, { queryClient }]] } });
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('prunes an id that disappears from the accounts list while keeping survivors', async () => {
    const keep = withId('acc-keep');
    const drop = withId('acc-drop');

    mockLoadAccounts.mockResolvedValue([keep, drop]);
    mountStore();
    await flushPromises();

    expect(store.accountsRecord['acc-keep']).toBeDefined();
    expect(store.accountsRecord['acc-drop']).toBeDefined();

    // A later fetch no longer returns `acc-drop` (the account was deleted).
    mockLoadAccounts.mockResolvedValue([keep]);
    await store.refetchAccounts();
    await flushPromises();

    // The vanished id is pruned; survivors remain.
    expect(store.accountsRecord['acc-drop']).toBeUndefined();
    expect(store.accountsRecord['acc-keep']).toBeDefined();
    expect(Object.keys(store.accountsRecord)).toEqual(['acc-keep']);
  });

  describe('shared accounts in a custom currency', () => {
    beforeEach(() => {
      resetCurrencyDecimals();
    });

    it('registers the owner definition so a code the viewer never defined renders as custom', async () => {
      mockLoadAccounts.mockResolvedValue([
        buildAccount('acc-shared', {
          currencyCode: 'SAT',
          currencyMeta: { decimals: 8, symbol: null, isCustom: true },
        }),
      ]);
      mountStore();
      await flushPromises();

      expect(formatUIAmount(0.12345678, { currency: 'SAT' })).toBe('0.12345678 SAT');
    });

    it('does not override a code the viewer defines themselves', async () => {
      registerCurrencyDecimals({ entries: [{ code: 'SAT', decimals: 0, isCustom: true }] });
      mockLoadAccounts.mockResolvedValue([
        buildAccount('acc-shared', {
          currencyCode: 'SAT',
          currencyMeta: { decimals: 8, symbol: null, isCustom: true },
        }),
      ]);
      mountStore();
      await flushPromises();

      expect(formatUIAmount(1.5, { currency: 'SAT' })).toBe('2 SAT');
    });
  });

  describe('txTargetableSourceAccountsActiveFirst', () => {
    const seed = async (accounts: AccountWithRelinkStatus[]) => {
      mockLoadAccounts.mockResolvedValue(accounts);
      mountStore();
      await flushPromises();
      return store.txTargetableSourceAccountsActiveFirst.map((account) => account.id);
    };

    it('drops read-only shares, which would disable the whole transaction form', async () => {
      const ids = await seed([
        buildAccount('acc-own'),
        buildAccount('acc-read', {
          share: { isOwner: false, permission: SHARE_PERMISSIONS.read } as AccountWithRelinkStatus['share'],
        }),
        buildAccount('acc-write', {
          share: { isOwner: false, permission: SHARE_PERMISSIONS.write } as AccountWithRelinkStatus['share'],
        }),
        buildAccount('acc-manage', {
          share: { isOwner: false, permission: SHARE_PERMISSIONS.manage } as AccountWithRelinkStatus['share'],
        }),
        buildAccount('acc-owned-share', {
          share: { isOwner: true, permission: SHARE_PERMISSIONS.read } as AccountWithRelinkStatus['share'],
        }),
      ]);

      expect(ids).toEqual(['acc-own', 'acc-write', 'acc-manage', 'acc-owned-share']);
    });

    it('drops loan and vehicle accounts, which never source a transaction', async () => {
      const ids = await seed([
        buildAccount('acc-cash'),
        buildAccount('acc-loan', { accountCategory: ACCOUNT_CATEGORIES.loan }),
        buildAccount('acc-car', { accountCategory: ACCOUNT_CATEGORIES.vehicle }),
      ]);

      expect(ids).toEqual(['acc-cash']);
    });
  });

  describe('plannedTargetableAccountsActiveFirst', () => {
    const seed = async (accounts: AccountWithRelinkStatus[]) => {
      mockLoadAccounts.mockResolvedValue(accounts);
      mountStore();
      await flushPromises();
      return store.plannedTargetableAccountsActiveFirst.map((account) => account.id);
    };

    it('offers bank-connected accounts, which the manual picker leaves out', async () => {
      const ids = await seed([buildAccount('acc-cash'), buildAccount('acc-mono', { type: ACCOUNT_TYPES.monobank })]);

      expect(ids).toEqual(['acc-cash', 'acc-mono']);
    });

    it('drops loan and vehicle accounts, whose balances are replayed from transactions', async () => {
      const ids = await seed([
        buildAccount('acc-cash'),
        buildAccount('acc-loan', { accountCategory: ACCOUNT_CATEGORIES.loan }),
        buildAccount('acc-car', { accountCategory: ACCOUNT_CATEGORIES.vehicle }),
      ]);

      expect(ids).toEqual(['acc-cash']);
    });

    it('drops accounts shared with the user, since a plan belongs to the account owner', async () => {
      const ids = await seed([
        buildAccount('acc-own'),
        buildAccount('acc-owned-share', {
          share: { isOwner: true } as AccountWithRelinkStatus['share'],
        }),
        buildAccount('acc-theirs', {
          share: { isOwner: false } as AccountWithRelinkStatus['share'],
        }),
      ]);

      expect(ids).toEqual(['acc-own', 'acc-owned-share']);
    });

    it('keeps archived accounts reachable but sorts them behind the active ones', async () => {
      const ids = await seed([
        buildAccount('acc-archived', { status: ACCOUNT_STATUSES.archived }),
        buildAccount('acc-active'),
      ]);

      expect(ids).toEqual(['acc-active', 'acc-archived']);
    });
  });

  describe('editAccount', () => {
    const statsKey = [VUE_QUERY_GLOBAL_PREFIXES.transactionChange, 'stats'];

    it.each([
      { field: 'currentBalance', data: { currentBalance: 10 } },
      { field: 'creditLimit', data: { creditLimit: 500 } },
      { field: 'excludeFromStats', data: { excludeFromStats: true } },
    ])('refreshes balance-derived stats after editing $field', async ({ data }) => {
      mockLoadAccounts.mockResolvedValue([buildAccount('acc-1')]);
      mountStore();
      await flushPromises();
      queryClient.setQueryData(statsKey, 1);

      await store.editAccount({ id: 'acc-1', ...data });

      expect(queryClient.getQueryState(statsKey)?.isInvalidated).toBe(true);
    });

    it('leaves stats alone after a rename', async () => {
      mockLoadAccounts.mockResolvedValue([buildAccount('acc-1')]);
      mountStore();
      await flushPromises();
      queryClient.setQueryData(statsKey, 1);

      await store.editAccount({ id: 'acc-1', name: 'Renamed' });

      expect(queryClient.getQueryState(statsKey)?.isInvalidated).toBe(false);
    });
  });

  describe('importLinkableAccounts', () => {
    it('offers only hand-managed accounts whose balance an import may shift', async () => {
      mockLoadAccounts.mockResolvedValue([
        buildAccount('acc-cash'),
        buildAccount('acc-mono', { type: ACCOUNT_TYPES.monobank }),
        buildAccount('acc-loan', { accountCategory: ACCOUNT_CATEGORIES.loan }),
        buildAccount('acc-car', { accountCategory: ACCOUNT_CATEGORIES.vehicle }),
      ]);
      mountStore();
      await flushPromises();

      expect(store.importLinkableAccounts.map((account) => account.id)).toEqual(['acc-cash']);
    });
  });
});
