import type { AccountGroups } from '@/common/types/models';

/**
 * The `/account-group` endpoint returns every group in one flat list, each carrying its own
 * hydrated `accounts` plus a `parentGroupId`. Its nested `childGroups` entries are one level deep
 * and come back without accounts, so they can't be rendered as-is.
 *
 * This rebuilds the real tree from the flat list: only root groups (no parent, or a parent that
 * isn't in the response) are returned, and every `childGroups` array is replaced with the fully
 * hydrated child nodes, recursively. Input groups are not mutated.
 */
export const buildAccountGroupTree = ({ groups }: { groups: AccountGroups[] }): AccountGroups[] => {
  const ids = new Set(groups.map((group) => group.id));
  const childrenByParentId = new Map<string, AccountGroups[]>();
  const roots: AccountGroups[] = [];

  for (const group of groups) {
    if (group.parentGroupId && ids.has(group.parentGroupId)) {
      const siblings = childrenByParentId.get(group.parentGroupId) ?? [];
      siblings.push(group);
      childrenByParentId.set(group.parentGroupId, siblings);
    } else {
      roots.push(group);
    }
  }

  const hydrate = ({ group, ancestors }: { group: AccountGroups; ancestors: Set<string> }): AccountGroups => {
    const path = new Set(ancestors).add(group.id);
    return {
      ...group,
      childGroups: (childrenByParentId.get(group.id) ?? [])
        .filter((child) => !path.has(child.id))
        .map((child) => hydrate({ group: child, ancestors: path })),
    };
  };

  return roots.map((group) => hydrate({ group, ancestors: new Set() }));
};
