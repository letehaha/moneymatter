import { useUserSettings } from '@/composable/data-queries/user-settings';
import { ACCOUNT_STATUSES } from '@bt/shared/types';
import { useLocalStorage } from '@vueuse/core';
import { computed } from 'vue';

type DropdownAccount = { id: string; status?: ACCOUNT_STATUSES };

export const resolveDefaultAccount = <T extends DropdownAccount>({
  accounts,
  defaultAccountId,
  lastUsedAccountId = null,
  fallbackToFirst = true,
}: {
  accounts: T[];
  defaultAccountId: string | null;
  lastUsedAccountId?: string | null;
  fallbackToFirst?: boolean;
}): T | null =>
  accounts.find((account) => account.id === defaultAccountId) ??
  accounts.find((account) => account.id === lastUsedAccountId) ??
  (fallbackToFirst ? (accounts[0] ?? null) : null);

/** Options without a `status` (the out-of-wallet mock) are never archivable, so they always stay visible. */
export const filterDropdownAccounts = <T extends DropdownAccount>({
  accounts,
  showArchived,
  selectedId,
}: {
  accounts: T[];
  showArchived: boolean;
  selectedId?: string | null;
}): T[] =>
  showArchived
    ? accounts
    : accounts.filter(
        (account) =>
          account.status === undefined || account.status === ACCOUNT_STATUSES.active || account.id === selectedId,
      );

/**
 * Shared read/write access to the account-dropdown preferences: which account seeds a fresh
 * picker, and whether archived accounts are offered as options.
 */
export const useAccountDropdownPrefs = () => {
  const { data: userSettings, patchAsync, isPatching } = useUserSettings();

  const defaultAccountId = computed(() => userSettings.value?.accounts?.defaultAccountId ?? null);
  const showArchivedInDropdowns = computed(() => !!userSettings.value?.accounts?.showArchivedInDropdowns);
  const lastUsedAccountId = useLocalStorage<string | null>('accounts:last-used-id', null);

  return {
    defaultAccountId,
    showArchivedInDropdowns,
    // Archived accounts hidden by the preference are excluded from resolution too,
    // so a fresh picker never preselects an account its dropdown would hide.
    resolveDefaultAccount: <T extends DropdownAccount>({
      accounts,
      fallbackToFirst,
      useLastUsed = false,
    }: {
      accounts: T[];
      fallbackToFirst?: boolean;
      useLastUsed?: boolean;
    }): T | null =>
      resolveDefaultAccount({
        accounts: filterDropdownAccounts({ accounts, showArchived: showArchivedInDropdowns.value }),
        defaultAccountId: defaultAccountId.value,
        lastUsedAccountId: useLastUsed ? lastUsedAccountId.value : null,
        fallbackToFirst,
      }),
    rememberLastUsedAccount: ({ id }: { id: string }) => {
      lastUsedAccountId.value = id;
    },
    setDefaultAccountId: ({ id }: { id: string | null }) => patchAsync({ accounts: { defaultAccountId: id } }),
    setShowArchivedInDropdowns: ({ value }: { value: boolean }) =>
      patchAsync({ accounts: { showArchivedInDropdowns: value } }),
    isUpdating: isPatching,
  };
};
