import type { AccountGroups } from '@/common/types/models';
import type { AccountModel } from '@bt/shared/types';

export interface AccountGroupListItem {
  group: AccountGroups;
  /** Subgroups rendered under this row, sorted by name. */
  children: AccountGroupListItem[];
}

export type AccountGroupTreeRow =
  | { type: 'group'; item: AccountGroupListItem; depth: number }
  | { type: 'account'; account: AccountModel; groupId: string; depth: number };

/** Sorts a built group tree by name at every level into nested list rows. */
export const buildAccountGroupList = ({ groups }: { groups: AccountGroups[] }): AccountGroupListItem[] =>
  [...groups]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((group) => ({
      group,
      children: buildAccountGroupList({ groups: group.childGroups }),
    }));

/** Flattens the visible part of the tree: an expanded group lists its subgroups first, then its own accounts. */
export const listTreeRows = ({
  items,
  isExpanded,
  includeAccounts,
  depth = 0,
}: {
  items: AccountGroupListItem[];
  isExpanded: (params: { id: string }) => boolean;
  includeAccounts: boolean;
  depth?: number;
}): AccountGroupTreeRow[] =>
  items.flatMap((item): AccountGroupTreeRow[] => {
    const row: AccountGroupTreeRow = { type: 'group', item, depth };
    if (!isExpanded({ id: item.group.id })) return [row];

    const accounts: AccountGroupTreeRow[] = includeAccounts
      ? item.group.accounts.map((account) => ({
          type: 'account',
          account,
          groupId: item.group.id,
          depth: depth + 1,
        }))
      : [];

    return [
      row,
      ...listTreeRows({
        items: item.children,
        isExpanded,
        includeAccounts,
        depth: depth + 1,
      }),
      ...accounts,
    ];
  });

export const flattenGroups = ({ groups }: { groups: AccountGroups[] }): AccountGroups[] =>
  groups.flatMap((group) => [group, ...flattenGroups({ groups: group.childGroups })]);
