import { loadAccountGroups } from '@/api/account-groups';
import { VUE_QUERY_CACHE_KEYS } from '@/common/const';
import { AccountGroups } from '@/common/types/models';
import { useAccountsStore } from '@/stores';
import { ACCOUNT_STATUSES, AccountModel, isDedicatedFlowAccountCategory } from '@bt/shared/types';
import { useQuery } from '@tanstack/vue-query';
import { storeToRefs } from 'pinia';
import { computed } from 'vue';

/** A top-level account group with every descendant account flattened into one list. */
export interface GroupedAccountsGroup {
  id: string;
  name: string;
  accounts: AccountModel[];
}

/**
 * Orders accounts so ones currently holding a balance surface first, then falls
 * back to alphabetical — the ordering the /transactions account filter has always
 * used, so grouped and ungrouped lists read consistently.
 */
export const sortAccounts = ({ accounts }: { accounts: AccountModel[] }): AccountModel[] =>
  [...accounts].sort((a, b) => {
    const aHasBalance = a.currentBalance !== 0;
    const bHasBalance = b.currentBalance !== 0;
    if (aHasBalance !== bHasBalance) return aHasBalance ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

/**
 * Collapses a nested `AccountGroups` node — the group plus every descendant group —
 * into a single flat list of accounts. Child groups are folded into their top-level
 * ancestor rather than shown as their own rows.
 */
export const flattenGroupAccounts = ({ group }: { group: AccountGroups }): AccountModel[] => {
  const accounts = [...group.accounts];
  for (const child of group.childGroups ?? []) {
    accounts.push(...flattenGroupAccounts({ group: child }));
  }
  return accounts;
};

/**
 * Narrows the account store to the set a multi-select should offer: active accounts only unless
 * `includeArchived`, and — when `excludeDedicatedFlow` is set — without loan/vehicle/property
 * accounts, which own their own sidebar sections and carry special transfer semantics (e.g. the
 * Pivot Report filters them out). Pure so it can be unit-tested without mounting the composable.
 */
export const filterSelectableAccounts = ({
  accounts,
  includeArchived = false,
  excludeDedicatedFlow = false,
}: {
  accounts: AccountModel[];
  includeArchived?: boolean;
  excludeDedicatedFlow?: boolean;
}): AccountModel[] => {
  let list = accounts;
  if (!includeArchived) list = list.filter((account) => account.status === ACCOUNT_STATUSES.active);
  if (excludeDedicatedFlow) list = list.filter((account) => !isDedicatedFlowAccountCategory(account.accountCategory));
  return list;
};

/**
 * Derives the account-group structure the account multi-select fields render.
 *
 * `AccountModel` carries no group id, so grouping is obtained by inverting the
 * nested `AccountGroups` tree: each top-level group keeps a flat list of all its
 * descendants' accounts, and any account absent from every group becomes ungrouped.
 * Only active accounts are considered by default so the selectable universe matches
 * what the group endpoint returns (which excludes archived accounts) — pass
 * `includeArchived` to surface archived accounts as ungrouped entries.
 *
 * `excludeDedicatedFlow` additionally drops loan, vehicle and property accounts — the
 * dedicated-flow categories that own their own sidebar sections and carry special
 * transfer semantics — so a host like the Pivot Report can keep them out of its
 * account filter.
 */
export const useGroupedAccounts = ({
  includeArchived = false,
  excludeDedicatedFlow = false,
}: { includeArchived?: boolean; excludeDedicatedFlow?: boolean } = {}) => {
  const { accounts: storeAccounts, isAccountsFetched } = storeToRefs(useAccountsStore());

  const { data: accountGroups, isLoading: isGroupsLoading } = useQuery({
    queryKey: VUE_QUERY_CACHE_KEYS.accountGroups,
    queryFn: () => loadAccountGroups(),
    staleTime: Infinity,
    placeholderData: [],
  });

  /** The selectable universe — see `filterSelectableAccounts`. */
  const allAccounts = computed<AccountModel[]>(() =>
    filterSelectableAccounts({ accounts: storeAccounts.value ?? [], includeArchived, excludeDedicatedFlow }),
  );

  const accountsById = computed<Map<string, AccountModel>>(
    () => new Map(allAccounts.value.map((account) => [account.id, account])),
  );

  /** Top-level groups, each carrying a flat list of its visible descendant accounts. Empty groups are dropped. */
  const groups = computed<GroupedAccountsGroup[]>(() => {
    const visible = accountsById.value;
    return (accountGroups.value ?? [])
      .map((group) => ({
        id: group.id,
        name: group.name,
        accounts: sortAccounts({
          accounts: flattenGroupAccounts({ group }).filter((account) => visible.has(account.id)),
        }),
      }))
      .filter((group) => group.accounts.length > 0);
  });

  /** Ids that belong to any group — used to derive the ungrouped remainder. */
  const groupedAccountIds = computed<Set<string>>(() => {
    const ids = new Set<string>();
    for (const group of groups.value) {
      for (const account of group.accounts) ids.add(account.id);
    }
    return ids;
  });

  const ungroupedAccounts = computed<AccountModel[]>(() =>
    sortAccounts({ accounts: allAccounts.value.filter((account) => !groupedAccountIds.value.has(account.id)) }),
  );

  const isLoading = computed(() => isGroupsLoading.value || !isAccountsFetched.value);

  return {
    /** Top-level groups with flattened accounts, empties removed. */
    groups,
    /** Active accounts that belong to no group. */
    ungroupedAccounts,
    /** Full selectable universe (active accounts, plus archived when opted in). */
    allAccounts,
    /** Lookup from account id to the account, for resolving a selected id back to its model. */
    accountsById,
    /** True until both the account store and the groups query have resolved. */
    isLoading,
  };
};
