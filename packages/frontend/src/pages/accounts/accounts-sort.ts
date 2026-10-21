import type { AccountGroups } from '@/common/types/models';
import { computeAccountDisplayBalances } from '@/common/utils/account-balance';
import {
  collectGroupAccounts,
  sumAccountsBaseBalance,
} from '@/components/sidebar/accounts-view/helpers/account-totals';
import type { AccountModel } from '@bt/shared/types';

export type AccountsSortKey = 'auto' | 'name' | 'balance';

export const ACCOUNTS_SORT_KEYS: readonly AccountsSortKey[] = ['auto', 'name', 'balance'];

/** A single row in the sorted accounts list: either a folder group or a leaf account. */
export type AccountsListItem =
  | { kind: 'group'; id: string; group: AccountGroups }
  | { kind: 'account'; id: string; account: AccountModel };

/**
 * Base-currency value of one account, run through the shared credit-limit adjustment so a
 * balance sort ranks accounts by the same figure their rows display.
 */
export const accountBaseValue = ({
  account,
  includeCreditLimit,
}: {
  account: {
    currentBalance: number;
    refCurrentBalance: number | null;
    creditLimit: number;
    refCreditLimit: number | null;
  };
  includeCreditLimit: boolean;
}): number =>
  computeAccountDisplayBalances({
    currentBalance: account.currentBalance,
    refCurrentBalance: account.refCurrentBalance,
    creditLimit: account.creditLimit,
    refCreditLimit: account.refCreditLimit,
    includeCreditLimit,
  }).displayRefBalance;

/**
 * Base-currency value of a group: the roll-up of its own accounts plus every descendant
 * group's accounts, matching the total shown on the group's row.
 */
export const groupBaseValue = ({
  group,
  baseCurrencyCode,
  includeCreditLimit,
}: {
  group: AccountGroups;
  baseCurrencyCode: string | undefined;
  includeCreditLimit: boolean;
}): number =>
  sumAccountsBaseBalance({
    accounts: collectGroupAccounts({ group }),
    baseCurrencyCode,
    includeCreditLimit,
  }).total;

/** Case-insensitive, natural-order name comparison ("Item 2" before "Item 10"). */
const compareNames = (a: string, b: string): number =>
  a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });

/**
 * Sort a homogeneous list into a NEW array (never mutates the input).
 * `auto`/`name` order ascending by name; `balance` orders descending by value.
 */
export function sortItems<T>({
  items,
  sortKey,
  getName,
  getValue,
}: {
  items: readonly T[];
  sortKey: AccountsSortKey;
  getName: (item: T) => string;
  getValue: (item: T) => number;
}): T[] {
  const copy = [...items];

  if (sortKey === 'balance') {
    // Balance sort leads with the largest holdings so the accounts that move net worth the
    // most sit on top; equal balances fall back to name order for a stable, readable result.
    return copy.sort((a, b) => {
      const diff = getValue(b) - getValue(a);
      if (diff !== 0) return diff;
      return compareNames(getName(a), getName(b));
    });
  }

  // `auto` and `name` both order alphabetically for a single list; `auto` only diverges in
  // the mixed list, where it additionally floats folder groups above loose accounts.
  return copy.sort((a, b) => compareNames(getName(a), getName(b)));
}

/** Groups and accounts annotated with the fields the sort compares, then discarded. */
interface AnnotatedItem {
  name: string;
  value: number;
  item: AccountsListItem;
}

/**
 * Sort folder-groups and loose accounts together into a single tagged list.
 * `auto` keeps groups as a leading block; `name`/`balance` interleave the two.
 */
export function sortMixed({
  groups,
  accounts,
  sortKey,
  baseCurrencyCode,
  includeCreditLimit,
}: {
  groups: readonly AccountGroups[];
  accounts: readonly AccountModel[];
  sortKey: AccountsSortKey;
  baseCurrencyCode: string | undefined;
  includeCreditLimit: boolean;
}): AccountsListItem[] {
  const annotateGroup = (group: AccountGroups): AnnotatedItem => ({
    name: group.name,
    value: groupBaseValue({ group, baseCurrencyCode, includeCreditLimit }),
    item: { kind: 'group', id: group.id, group },
  });

  const annotateAccount = (account: AccountModel): AnnotatedItem => ({
    name: account.name,
    value: accountBaseValue({ account, includeCreditLimit }),
    item: { kind: 'account', id: account.id, account },
  });

  const getName = (entry: AnnotatedItem): string => entry.name;
  const getValue = (entry: AnnotatedItem): number => entry.value;

  if (sortKey === 'auto') {
    // `auto` keeps folder groups as a block above loose accounts, each block name-sorted, so
    // the page always reads folders-first regardless of the balances inside them.
    const sortedGroups = sortItems({ items: groups.map(annotateGroup), sortKey, getName, getValue });
    const sortedAccounts = sortItems({ items: accounts.map(annotateAccount), sortKey, getName, getValue });
    return [...sortedGroups, ...sortedAccounts].map((entry) => entry.item);
  }

  // `name` and `balance` rank folders and accounts in one interleaved list.
  const merged = [...groups.map(annotateGroup), ...accounts.map(annotateAccount)];
  return sortItems({ items: merged, sortKey, getName, getValue }).map((entry) => entry.item);
}
