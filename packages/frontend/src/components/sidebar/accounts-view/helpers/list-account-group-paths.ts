import type { AccountGroups } from '@/common/types/models';

import { buildAccountGroupTree } from './build-account-group-tree';

const PATH_SEPARATOR = ' / ';

export interface AccountGroupPathEntry {
  /** The hydrated tree node: its own accounts plus its nested subgroups. */
  group: AccountGroups;
  /** Names from the root down to this group, e.g. `Banks / Indonesia`. */
  path: string;
}

/**
 * Flat, picker-friendly view of the group tree: depth-first, each parent directly followed by its
 * subgroups. Every entry carries its ancestry as a label, because two parents can each own a
 * subgroup with the same name (Banks / Indonesia, E-wallets / Indonesia) and a bare name can't
 * tell them apart.
 */
export const listAccountGroupPaths = ({ groups }: { groups: AccountGroups[] }): AccountGroupPathEntry[] => {
  const entries: AccountGroupPathEntry[] = [];

  const visit = ({ group, parentPath }: { group: AccountGroups; parentPath: string | null }) => {
    const path = parentPath === null ? group.name : `${parentPath}${PATH_SEPARATOR}${group.name}`;
    entries.push({ group, path });
    group.childGroups.forEach((child) => visit({ group: child, parentPath: path }));
  };

  buildAccountGroupTree({ groups }).forEach((root) => visit({ group: root, parentPath: null }));

  return entries;
};
