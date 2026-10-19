import type { BankConnection } from '@/api/bank-data-providers';
import type { VehicleModel } from '@/api/vehicles';
import type { AccountGroups } from '@/common/types/models';
import { sumAccountsBaseBalance } from '@/components/sidebar/accounts-view/helpers/account-totals';
import { useUserSettings } from '@/composable/data-queries/user-settings';
import { useCurrenciesStore } from '@/stores';
import type { AccountModel } from '@bt/shared/types';
import { useLocalStorage } from '@vueuse/core';
import { storeToRefs } from 'pinia';

import { type AccountsListItem, type AccountsSortKey, accountBaseValue, sortItems, sortMixed } from './accounts-sort';

/** One Bank connections row: the connection plus every account linked to it. */
interface ConnectionRow {
  connection: BankConnection;
  accounts: AccountModel[];
}

// Module-scoped so every part of the Accounts page shares one persisted sort choice,
// mirroring `use-accounts-page-groups.ts`'s module-scoped open-state key. Default = `auto`.
const sortKey = useLocalStorage<AccountsSortKey>('accounts-page:sort-key', 'auto');

export function useAccountsSort() {
  const { baseCurrency } = storeToRefs(useCurrenciesStore());
  const { data: userSettings } = useUserSettings();

  const setSortKey = (key: AccountsSortKey): void => {
    sortKey.value = key;
  };

  // Read reactive store values lazily: these wrappers run inside consumer `computed()`s, and
  // the value getters below are only evaluated during a balance sort, so touching the refs at
  // that point registers the dependency exactly when the ordering actually depends on it.
  const baseCurrencyCode = (): string | undefined => baseCurrency.value?.currency?.code;
  const includeCreditLimit = (): boolean => !!userSettings.value?.includeCreditLimitInStats;

  const sortConnectionRows = (rows: ConnectionRow[]): ConnectionRow[] =>
    sortItems({
      items: rows,
      sortKey: sortKey.value,
      getName: (row) => row.connection.providerName || row.connection.bankName || '',
      getValue: (row) =>
        sumAccountsBaseBalance({
          accounts: row.accounts,
          baseCurrencyCode: baseCurrencyCode(),
          includeCreditLimit: includeCreditLimit(),
        }).total,
    });

  const sortLeafAccounts = (accounts: AccountModel[]): AccountModel[] =>
    sortItems({
      items: accounts,
      sortKey: sortKey.value,
      getName: (account) => account.name,
      getValue: (account) => accountBaseValue({ account, includeCreditLimit: includeCreditLimit() }),
    });

  const sortVehicles = (vehicles: VehicleModel[]): VehicleModel[] =>
    sortItems({
      items: vehicles,
      sortKey: sortKey.value,
      getName: (vehicle) => vehicle.account?.name ?? `${vehicle.make} ${vehicle.model}`,
      getValue: (vehicle) =>
        vehicle.account ? accountBaseValue({ account: vehicle.account, includeCreditLimit: includeCreditLimit() }) : 0,
    });

  const sortManual = (groups: AccountGroups[], accounts: AccountModel[]): AccountsListItem[] =>
    sortMixed({
      groups,
      accounts,
      sortKey: sortKey.value,
      baseCurrencyCode: baseCurrencyCode(),
      includeCreditLimit: includeCreditLimit(),
    });

  const sortGroupChildren = (group: AccountGroups): AccountsListItem[] =>
    sortMixed({
      groups: group.childGroups,
      accounts: group.accounts,
      sortKey: sortKey.value,
      baseCurrencyCode: baseCurrencyCode(),
      includeCreditLimit: includeCreditLimit(),
    });

  return {
    sortKey,
    setSortKey,
    sortConnectionRows,
    sortLeafAccounts,
    sortVehicles,
    sortManual,
    sortGroupChildren,
  };
}
