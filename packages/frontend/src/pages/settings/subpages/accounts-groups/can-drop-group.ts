import type { AccountGroups } from '@/common/types/models';

import { flattenGroups } from './build-account-group-list';

type DraggedGroup = Pick<AccountGroups, 'id' | 'parentGroupId' | 'childGroups'>;
type DropTargetGroup = Pick<AccountGroups, 'id'>;

export type GroupDropError = 'self' | 'current-parent' | 'inside-itself' | 'already-top-level';

/** `target: null` is the top-level drop zone. Returns why the drop is forbidden, or `null` when it is allowed. */
export const groupDropError = ({
  dragged,
  target,
}: {
  dragged: DraggedGroup;
  target: DropTargetGroup | null;
}): GroupDropError | null => {
  if (target === null) return dragged.parentGroupId === null ? 'already-top-level' : null;
  if (target.id === dragged.id) return 'self';
  if (dragged.parentGroupId === target.id) return 'current-parent';
  if (flattenGroups({ groups: dragged.childGroups }).some((group) => group.id === target.id)) return 'inside-itself';

  return null;
};
