import { RESOURCE_TYPES, SHARE_PERMISSIONS, SharePermission, SharePolicy } from '@bt/shared/types';
import { t } from '@i18n/index';
import { NotFoundError } from '@js/errors';
import {
  type GrantedAccessResult,
  canUserAccessResource,
} from '@services/sharing/auth/can-user-access-resource.service';

interface AuthorizeTrackerAccessResult {
  ownerUserId: number;
  isOwner: boolean;
  effectivePermission: SharePermission;
  policy: SharePolicy | null;
  access: GrantedAccessResult;
}

/**
 * Central read/write authorization for a tracker. Mirrors the tracker-side equivalent of
 * `authorizeAccountWrite` — central auth check that returns the resolved access context
 * so callers can scope downstream queries against the **owner's** `userId` (recipients
 * see the same numbers the owner would, not their own slice).
 *
 * Throws `NotFoundError` (404) for any denied case (no claim OR insufficient permission).
 * 404 masks existence per the F3 convention — a recipient with `read` who tries `write`
 * shouldn't get a different shape of error than a non-recipient, since both leak the
 * same bit ("yes this tracker exists"). Matches `authorizeAccountWrite`.
 */
export const authorizeTrackerAccess = async ({
  userId,
  trackerId,
  requiredPermission,
}: {
  userId: number;
  trackerId: string;
  requiredPermission: SharePermission;
}): Promise<AuthorizeTrackerAccessResult> => {
  const access = await canUserAccessResource({
    userId,
    resourceType: RESOURCE_TYPES.tracker,
    resourceId: trackerId,
    requiredPermission,
  });

  if (!access.granted) {
    throw new NotFoundError({ message: t({ key: 'budgets.budgetNotFound' }) });
  }

  return {
    ownerUserId: access.ownerUserId,
    isOwner: access.isOwner,
    effectivePermission: access.effectivePermission,
    policy: access.policy,
    access,
  };
};

/**
 * Convenience wrapper for read-only paths (stats, spending-stats, rules sync on visit).
 * The required permission is fixed at `read` so callers don't have to import
 * `SHARE_PERMISSIONS` themselves.
 */
export const authorizeTrackerRead = ({ userId, trackerId }: { userId: number; trackerId: string }) =>
  authorizeTrackerAccess({ userId, trackerId, requiredPermission: SHARE_PERMISSIONS.read });
