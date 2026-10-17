import type { AccountGroups } from '@/common/types/models';
import { buildAccountGroupTree } from '@/components/sidebar/accounts-view/helpers/build-account-group-tree';

export interface AccountGroupListItem {
  /** Hydrated group: its own `accounts`, and `childGroups` holding the nested nodes. */
  group: AccountGroups;
  /** Subgroups rendered under this row, sorted by name. */
  children: AccountGroupListItem[];
}

const toListItems = ({ groups }: { groups: AccountGroups[] }): AccountGroupListItem[] =>
  [...groups]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((group) => ({ group, children: toListItems({ groups: group.childGroups }) }));

/**
 * The endpoint returns every group in one flat list, and a nested group's own `childGroups`
 * entries come back without their accounts. The tree is rebuilt from the flat list so each
 * root becomes a top-level row with its subgroups nested beneath it, and every row still reads
 * its own fully hydrated `group.accounts`. Rolling a parent up over its subtree is left to the
 * caller (`collectGroupAccounts`).
 */
export const buildAccountGroupList = ({ groups }: { groups: AccountGroups[] }): AccountGroupListItem[] =>
  toListItems({ groups: buildAccountGroupTree({ groups }) });
