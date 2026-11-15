import { RESOURCE_TYPES, SHARE_PERMISSIONS } from '@bt/shared/types';
import { canUserAccessResource } from '@services/sharing/auth/can-user-access-resource.service';

import { findProposalRefs } from './placeholders';

/** The tools whose `categoryIds` the tracker services resolve against the tree of the tracker's owner. */
const TRACKER_LINE_TOOLS = new Set(['create_tracker_line', 'update_tracker_line']);

/**
 * The user whose categories a call's `categoryIds` name. A line of a tracker takes them from the owner of the
 * tracker, which is read only for a caller who may manage it: `null` is any other caller, with the same answer for a
 * tracker that does not exist. A `$proposal:` ref is a tracker the caller is making, so its tree is the caller's.
 */
export const categoryTreeOwner = async ({
  userId,
  toolName,
  args,
}: {
  userId: number;
  toolName: string;
  args: Record<string, unknown>;
}): Promise<number | null> => {
  const { trackerId } = args;
  if (!TRACKER_LINE_TOOLS.has(toolName) || typeof trackerId !== 'string') return userId;
  if (findProposalRefs({ value: trackerId }).length > 0) return userId;

  const access = await canUserAccessResource({
    userId,
    resourceType: RESOURCE_TYPES.tracker,
    resourceId: trackerId,
    requiredPermission: SHARE_PERMISSIONS.manage,
  });
  return access.granted ? access.ownerUserId : null;
};
