import type { AccountGroups } from '@/common/types/models';

export interface AccountGroupPathEntry {
  group: AccountGroups;
  /** Names from the root down to this group, e.g. `Banks / Indonesia`. */
  path: string;
}

/** Depth-first list of a group tree, each entry labelled with its full path so same-named subgroups differ. */
export const listAccountGroupPaths = ({ groups }: { groups: AccountGroups[] }): AccountGroupPathEntry[] => {
  const entries: AccountGroupPathEntry[] = [];

  const visit = ({ group, parentPath }: { group: AccountGroups; parentPath: string | null }) => {
    const path = parentPath === null ? group.name : `${parentPath} / ${group.name}`;
    entries.push({ group, path });
    group.childGroups.forEach((child) => visit({ group: child, parentPath: path }));
  };

  groups.forEach((root) => visit({ group: root, parentPath: null }));

  return entries;
};
