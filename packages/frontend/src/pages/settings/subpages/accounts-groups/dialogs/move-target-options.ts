import type { AccountGroups } from '@/common/types/models';
import type { AccountGroupPathEntry } from '@/components/sidebar/accounts-view/helpers/list-account-group-paths';

import { groupDropError } from '../can-drop-group';

/** Groups the given group can be moved under: not itself, not its own subtree. The current parent stays listed. */
export const listMoveTargets = ({
  group,
  entries,
}: {
  group: AccountGroups;
  entries: AccountGroupPathEntry[];
}): AccountGroupPathEntry[] => {
  // Flat-list `childGroups` are stubs without their own children, so resolve the built-tree node.
  const treeNode = entries.find((entry) => entry.group.id === group.id)?.group ?? group;

  return entries.filter((entry) => {
    const error = groupDropError({ dragged: treeNode, target: entry.group });
    return error === null || error === 'current-parent';
  });
};
