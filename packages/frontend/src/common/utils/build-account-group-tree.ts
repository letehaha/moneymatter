import type { AccountGroups } from '@/common/types/models';

/**
 * Rebuilds the tree from the flat `/account-group` list, whose `childGroups` are account-less stubs.
 * Orphans and parent-cycle members surface as roots so they never vanish.
 */
export const buildAccountGroupTree = ({ groups }: { groups: AccountGroups[] }): AccountGroups[] => {
  const ids = new Set(groups.map((group) => group.id));
  const childrenByParentId = new Map<string, AccountGroups[]>();

  for (const group of groups) {
    if (group.parentGroupId && ids.has(group.parentGroupId)) {
      childrenByParentId.set(group.parentGroupId, [...(childrenByParentId.get(group.parentGroupId) ?? []), group]);
    }
  }

  const visited = new Set<string>();
  const hydrate = ({ group }: { group: AccountGroups }): AccountGroups => {
    visited.add(group.id);
    return {
      ...group,
      childGroups: (childrenByParentId.get(group.id) ?? [])
        .filter((child) => !visited.has(child.id))
        .map((child) => hydrate({ group: child })),
    };
  };

  const isRoot = (group: AccountGroups) => !group.parentGroupId || !ids.has(group.parentGroupId);
  const roots = groups.filter(isRoot).map((group) => hydrate({ group }));
  for (const group of groups) {
    if (!visited.has(group.id)) roots.push(hydrate({ group }));
  }

  return roots;
};
