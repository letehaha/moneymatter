import type { AccountGroups } from '@/common/types/models';

export interface AccountGroupListItem {
  group: AccountGroups;
  /** Subgroups rendered under this row, sorted by name. */
  children: AccountGroupListItem[];
}

/** Sorts a built group tree by name at every level into nested list rows. */
export const buildAccountGroupList = ({ groups }: { groups: AccountGroups[] }): AccountGroupListItem[] =>
  [...groups]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((group) => ({ group, children: buildAccountGroupList({ groups: group.childGroups }) }));
