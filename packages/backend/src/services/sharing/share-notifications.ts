import {
  NOTIFICATION_TYPES,
  RecordId,
  RESOURCE_TYPES,
  ResourceType,
  ShareInvitationNotificationPayload,
  ShareInvitationSendFailedPayload,
  ShareLifecycleNotificationPayload,
  SharePermission,
  SharePolicy,
} from '@bt/shared/types';
import Users from '@models/users.model';
import { createNotification } from '@services/notifications';

import { SHARE_SNAPSHOT_MISSING_USER_ID, snapshotShareUser } from './share-user-snapshot';
import { formatHouseholdLabel } from './sharing-utils';

/**
 * Helpers that wrap `createNotification` for share-related notification types so callers
 * don't need to remember the exact `type` constants and payload shape.
 *
 * Notification payloads use `SHARE_SNAPSHOT_MISSING_USER_ID` (0) as the fallback when the
 * source user row is missing — the frontend renders the embedded `username`/`avatar`
 * snapshot without dereferencing the id, so a `0` lookup never happens. Callers that pass
 * a nullable user (e.g. `notifyInvitationDeclined`) log the missing-row case so it isn't
 * a silent loss.
 */

const snapshotUser = (user: Users | null | undefined) => snapshotShareUser(user, SHARE_SNAPSHOT_MISSING_USER_ID);

interface InvitationContext {
  invitationId: RecordId;
  /** Token is denormalized into the notification payload so the frontend can deep-link
   *  to the accept page without a separate lookup. */
  token: string;
  resourceType: ResourceType;
  resourceId: string;
  resourceName: string;
  permission: SharePermission;
  expiresAt: Date;
}

/**
 * Sent to the invitee when an owner sends them an invitation. The invitee acts on this
 * notification (or the email) to accept/decline.
 */
export const notifyInvitationReceived = async ({
  inviteeUserId,
  owner,
  invitation,
}: {
  inviteeUserId: number;
  owner: Users;
  invitation: InvitationContext;
}) => {
  const payload: ShareInvitationNotificationPayload = {
    invitationId: invitation.invitationId,
    token: invitation.token,
    resourceType: invitation.resourceType,
    resourceId: invitation.resourceId,
    resourceName: invitation.resourceName,
    permission: invitation.permission,
    owner: snapshotUser(owner),
    expiresAt: invitation.expiresAt.toISOString(),
  };

  return createNotification({
    userId: inviteeUserId,
    type: NOTIFICATION_TYPES.shareInvitationReceived,
    title: `${owner.username} shared "${invitation.resourceName}" with you`,
    message: `Open to accept or decline the invitation. Expires ${invitation.expiresAt.toISOString().slice(0, 10)}.`,
    payload,
    expiresAt: invitation.expiresAt,
    push: true,
  });
};

/**
 * Sent to the owner when a recipient accepts a previously-sent invitation.
 */
const notifyInvitationAccepted = async ({
  ownerUserId,
  recipient,
  shareId,
  invitationId,
  resource,
  permission,
}: {
  ownerUserId: number;
  recipient: Users;
  shareId: RecordId;
  invitationId: RecordId;
  resource: { type: ResourceType; id: string; name: string };
  permission: SharePermission;
}) => {
  const payload: ShareLifecycleNotificationPayload = {
    shareId,
    invitationId,
    resourceType: resource.type,
    resourceId: resource.id,
    resourceName: resource.name,
    permission,
    counterpartUser: snapshotUser(recipient),
  };

  return createNotification({
    userId: ownerUserId,
    type: NOTIFICATION_TYPES.shareAccepted,
    title: `${recipient.username} accepted your share for "${resource.name}"`,
    payload,
  });
};

/**
 * Sent to the owner when a recipient declines a previously-sent invitation.
 */
const notifyInvitationDeclined = async ({
  ownerUserId,
  recipient,
  invitationId,
  resource,
}: {
  ownerUserId: number;
  recipient: Users | null;
  invitationId: RecordId;
  resource: { type: ResourceType; id: string; name: string };
}) => {
  const recipientSnapshot = snapshotUser(recipient);
  const payload: ShareLifecycleNotificationPayload = {
    invitationId,
    resourceType: resource.type,
    resourceId: resource.id,
    resourceName: resource.name,
    counterpartUser: recipientSnapshot,
  };

  return createNotification({
    userId: ownerUserId,
    type: NOTIFICATION_TYPES.shareDeclined,
    title: `${recipientSnapshot.username} declined your share for "${resource.name}"`,
    payload,
  });
};

/**
 * Sent to the owner when a pending invitation is swept up by the daily expiration cron.
 * The recipient never gets a separate notification — the invitation card simply disappears
 * from their inbox once they refetch.
 */
const notifyInvitationExpired = async ({
  ownerUserId,
  invitee,
  invitationId,
  resource,
  permission,
}: {
  ownerUserId: number;
  invitee: Users | null;
  invitationId: RecordId;
  resource: { type: ResourceType; id: string; name: string };
  permission: SharePermission;
}) => {
  const payload: ShareLifecycleNotificationPayload = {
    invitationId,
    resourceType: resource.type,
    resourceId: resource.id,
    resourceName: resource.name,
    permission,
    counterpartUser: snapshotUser(invitee),
  };

  return createNotification({
    userId: ownerUserId,
    type: NOTIFICATION_TYPES.shareExpired,
    title: `Your invitation to "${resource.name}" expired`,
    payload,
  });
};

/**
 * Sent to a recipient when an owner (or a `manage` co-recipient) revokes their share.
 * Stamps the resource snapshot at the moment of revocation so the recipient still sees a
 * meaningful entry even if the underlying resource is later deleted.
 */
const notifyShareRevoked = async ({
  recipientUserId,
  owner,
  shareId,
  resource,
  permission,
}: {
  recipientUserId: number;
  owner: Users | null;
  shareId: RecordId;
  resource: { type: ResourceType; id: string; name: string };
  permission: SharePermission;
}) => {
  const payload: ShareLifecycleNotificationPayload = {
    shareId,
    resourceType: resource.type,
    resourceId: resource.id,
    resourceName: resource.name,
    permission,
    counterpartUser: snapshotUser(owner),
  };

  return createNotification({
    userId: recipientUserId,
    type: NOTIFICATION_TYPES.shareRevoked,
    title: `Your access to "${resource.name}" was revoked`,
    payload,
  });
};

/**
 * Sent to a recipient when an owner deletes a shared tracker. Mirrors
 * `notifyShareOwnerAccountDeleted` — distinct from `shareRevoked` because the resource
 * itself is gone, so any deep-link will 404 and there's nothing to re-share.
 */
export const notifyShareOwnerTrackerDeleted = async ({
  recipientUserId,
  owner,
  shareId,
  resource,
  permission,
}: {
  recipientUserId: number;
  owner: Users | null;
  shareId: RecordId;
  resource: { type: ResourceType; id: string; name: string };
  permission: SharePermission;
}) => {
  const payload: ShareLifecycleNotificationPayload = {
    shareId,
    resourceType: resource.type,
    resourceId: resource.id,
    resourceName: resource.name,
    permission,
    counterpartUser: snapshotUser(owner),
  };

  return createNotification({
    userId: recipientUserId,
    type: NOTIFICATION_TYPES.shareOwnerTrackerDeleted,
    title: `The shared tracker "${resource.name}" was deleted`,
    payload,
  });
};

/**
 * Sent to a recipient when an owner deletes the underlying resource (e.g. the shared
 * account). Distinct from `notifyShareRevoked` because the resource itself is gone — there
 * is nothing to be re-shared and any deep-link to the resource will 404. Stamps the
 * resource snapshot at the moment of deletion so the recipient still sees a meaningful
 * entry after the row vanishes.
 */
export const notifyShareOwnerAccountDeleted = async ({
  recipientUserId,
  owner,
  shareId,
  resource,
  permission,
}: {
  recipientUserId: number;
  owner: Users | null;
  shareId: RecordId;
  resource: { type: ResourceType; id: string; name: string };
  permission: SharePermission;
}) => {
  const payload: ShareLifecycleNotificationPayload = {
    shareId,
    resourceType: resource.type,
    resourceId: resource.id,
    resourceName: resource.name,
    permission,
    counterpartUser: snapshotUser(owner),
  };

  return createNotification({
    userId: recipientUserId,
    type: NOTIFICATION_TYPES.shareOwnerAccountDeleted,
    title: `The shared account "${resource.name}" was deleted`,
    payload,
  });
};

/**
 * Sent to the owner when the inline Resend send for an invitation email rejected or errored
 * after the DB row was already committed. The invitation row itself stays in `pending` so
 * the owner can resend from the UI; this notification is the durable surface for the
 * failure (the synchronous API response carries `emailOutcome: 'failed'` but a toast on a
 * single page load is easy to miss).
 */
export const notifyInvitationSendFailed = async ({
  ownerUserId,
  invitee,
  inviteeEmail,
  invitationId,
  resource,
}: {
  ownerUserId: number;
  invitee: Users | null;
  inviteeEmail: string;
  invitationId: RecordId;
  resource: { type: ResourceType; id: string; name: string };
}) => {
  const payload: ShareInvitationSendFailedPayload = {
    invitationId,
    resourceType: resource.type,
    resourceId: resource.id,
    resourceName: resource.name,
    inviteeEmail,
    inviteeSnapshot: invitee ? snapshotUser(invitee) : null,
  };

  return createNotification({
    userId: ownerUserId,
    type: NOTIFICATION_TYPES.shareInvitationSendFailed,
    title: `Couldn't deliver your invitation email for "${resource.name}"`,
    message: `We saved the invitation but the email to ${inviteeEmail} didn't go through. You can resend it from the sharing panel.`,
    payload,
  });
};

/**
 * Sent to the owner when a recipient voluntarily leaves a share. Symmetric counterpart of
 * `notifyShareRevoked` — used by the recipient-initiated "leave" flow.
 */
const notifyShareLeft = async ({
  ownerUserId,
  recipient,
  shareId,
  resource,
  permission,
}: {
  ownerUserId: number;
  recipient: Users | null;
  shareId: RecordId;
  resource: { type: ResourceType; id: string; name: string };
  permission: SharePermission;
}) => {
  const recipientSnapshot = snapshotUser(recipient);
  const payload: ShareLifecycleNotificationPayload = {
    shareId,
    resourceType: resource.type,
    resourceId: resource.id,
    resourceName: resource.name,
    permission,
    counterpartUser: recipientSnapshot,
  };

  return createNotification({
    userId: ownerUserId,
    type: NOTIFICATION_TYPES.shareLeft,
    title: `${recipientSnapshot.username} left "${resource.name}"`,
    payload,
  });
};

/* ─── Household lifecycle ────────────────────────────────────────────────────
 *
 * Mirror of the per-resource set with messages framed for the membership
 * relationship instead of a single named resource. Payload shapes are reused
 * (`ShareInvitationNotificationPayload`, `ShareLifecycleNotificationPayload`,
 * `ShareInvitationSendFailedPayload`) — only the `type` constant and copy
 * differ. The frontend routes household-typed notifications to the
 * Settings → Household page rather than the per-resource share dialog.
 *
 * `resource.name` for household rows is the inviting/granting user's display
 * name — there's no single resource to label, and the recipient gets access
 * to "everything that user owns".
 */

const HOUSEHOLD_RESOURCE_LABEL = 'household';

/** Recipient-side: a household invite has just landed. */
const notifyHouseholdInvitationReceived = async ({
  inviteeUserId,
  owner,
  invitation,
}: {
  inviteeUserId: number;
  owner: Users;
  invitation: InvitationContext;
}) => {
  const payload: ShareInvitationNotificationPayload = {
    invitationId: invitation.invitationId,
    token: invitation.token,
    resourceType: invitation.resourceType,
    resourceId: invitation.resourceId,
    resourceName: invitation.resourceName,
    permission: invitation.permission,
    owner: snapshotUser(owner),
    expiresAt: invitation.expiresAt.toISOString(),
  };

  return createNotification({
    userId: inviteeUserId,
    type: NOTIFICATION_TYPES.householdInvitationReceived,
    title: `${owner.username} invited you to their ${HOUSEHOLD_RESOURCE_LABEL}`,
    message: `Joining gives you ${invitation.permission} access to every account they own. Expires ${invitation.expiresAt.toISOString().slice(0, 10)}.`,
    payload,
    expiresAt: invitation.expiresAt,
    push: true,
  });
};

/** Owner-side: recipient accepted the household invite. */
const notifyHouseholdAccepted = async ({
  ownerUserId,
  recipient,
  shareId,
  invitationId,
  resource,
  permission,
}: {
  ownerUserId: number;
  recipient: Users;
  shareId: RecordId;
  invitationId: RecordId;
  resource: { type: ResourceType; id: string; name: string };
  permission: SharePermission;
}) => {
  const payload: ShareLifecycleNotificationPayload = {
    shareId,
    invitationId,
    resourceType: resource.type,
    resourceId: resource.id,
    resourceName: resource.name,
    permission,
    counterpartUser: snapshotUser(recipient),
  };

  return createNotification({
    userId: ownerUserId,
    type: NOTIFICATION_TYPES.householdAccepted,
    title: `${recipient.username} joined your ${HOUSEHOLD_RESOURCE_LABEL}`,
    payload,
  });
};

/** Owner-side: recipient declined the household invite. */
const notifyHouseholdDeclined = async ({
  ownerUserId,
  recipient,
  invitationId,
  resource,
}: {
  ownerUserId: number;
  recipient: Users | null;
  invitationId: RecordId;
  resource: { type: ResourceType; id: string; name: string };
}) => {
  const recipientSnapshot = snapshotUser(recipient);
  const payload: ShareLifecycleNotificationPayload = {
    invitationId,
    resourceType: resource.type,
    resourceId: resource.id,
    resourceName: resource.name,
    counterpartUser: recipientSnapshot,
  };

  return createNotification({
    userId: ownerUserId,
    type: NOTIFICATION_TYPES.householdDeclined,
    title: `${recipientSnapshot.username} declined your ${HOUSEHOLD_RESOURCE_LABEL} invite`,
    payload,
  });
};

/** Owner-side: pending household invite was swept by the daily expiration cron. */
const notifyHouseholdExpired = async ({
  ownerUserId,
  invitee,
  invitationId,
  resource,
  permission,
}: {
  ownerUserId: number;
  invitee: Users | null;
  invitationId: RecordId;
  resource: { type: ResourceType; id: string; name: string };
  permission: SharePermission;
}) => {
  const payload: ShareLifecycleNotificationPayload = {
    invitationId,
    resourceType: resource.type,
    resourceId: resource.id,
    resourceName: resource.name,
    permission,
    counterpartUser: snapshotUser(invitee),
  };

  return createNotification({
    userId: ownerUserId,
    type: NOTIFICATION_TYPES.householdExpired,
    title: `Your ${HOUSEHOLD_RESOURCE_LABEL} invitation expired`,
    payload,
  });
};

/** Recipient-side: owner revoked their household membership. */
export const notifyHouseholdRevoked = async ({
  recipientUserId,
  owner,
  shareId,
  resource,
  permission,
}: {
  recipientUserId: number;
  owner: Users | null;
  shareId: RecordId;
  resource: { type: ResourceType; id: string; name: string };
  permission: SharePermission;
}) => {
  const ownerSnapshot = snapshotUser(owner);
  const payload: ShareLifecycleNotificationPayload = {
    shareId,
    resourceType: resource.type,
    resourceId: resource.id,
    resourceName: resource.name,
    permission,
    counterpartUser: ownerSnapshot,
  };

  return createNotification({
    userId: recipientUserId,
    type: NOTIFICATION_TYPES.householdRevoked,
    title: `Your access to ${formatHouseholdLabel(ownerSnapshot.username)} was revoked`,
    payload,
  });
};

/** Owner-side: recipient voluntarily left the household. */
const notifyHouseholdLeft = async ({
  ownerUserId,
  recipient,
  shareId,
  resource,
  permission,
}: {
  ownerUserId: number;
  recipient: Users | null;
  shareId: RecordId;
  resource: { type: ResourceType; id: string; name: string };
  permission: SharePermission;
}) => {
  const recipientSnapshot = snapshotUser(recipient);
  const payload: ShareLifecycleNotificationPayload = {
    shareId,
    resourceType: resource.type,
    resourceId: resource.id,
    resourceName: resource.name,
    permission,
    counterpartUser: recipientSnapshot,
  };

  return createNotification({
    userId: ownerUserId,
    type: NOTIFICATION_TYPES.householdLeft,
    title: `${recipientSnapshot.username} left your ${HOUSEHOLD_RESOURCE_LABEL}`,
    payload,
  });
};

/** Recipient-side: owner changed the recipient's permission level on the household. */
export const notifyHouseholdPermissionChanged = async ({
  recipientUserId,
  owner,
  shareId,
  resource,
  permission,
  policy,
}: {
  recipientUserId: number;
  owner: Users | null;
  shareId: RecordId;
  resource: { type: ResourceType; id: string; name: string };
  permission: SharePermission;
  policy?: SharePolicy | null;
}) => {
  const ownerSnapshot = snapshotUser(owner);
  const payload: ShareLifecycleNotificationPayload = {
    shareId,
    resourceType: resource.type,
    resourceId: resource.id,
    resourceName: resource.name,
    permission,
    policy: policy ?? null,
    counterpartUser: ownerSnapshot,
  };

  return createNotification({
    userId: recipientUserId,
    type: NOTIFICATION_TYPES.householdPermissionChanged,
    title: `Your access to ${formatHouseholdLabel(ownerSnapshot.username)} is now ${permission}`,
    payload,
  });
};

/**
 * Recipient-side: an account they previously had household access to was deleted by the
 * owner. Distinct from `notifyHouseholdRevoked` — the membership is still active for the
 * remaining accounts; just one resource vanished.
 */
export const notifyHouseholdOwnerAccountDeleted = async ({
  recipientUserId,
  owner,
  shareId,
  resource,
}: {
  recipientUserId: number;
  owner: Users | null;
  /** The household ResourceShares.id. */
  shareId: RecordId;
  /** Identifies the deleted account so the frontend can drop any cached references. */
  resource: { type: ResourceType; id: string; name: string };
}) => {
  const ownerSnapshot = snapshotUser(owner);
  const payload: ShareLifecycleNotificationPayload = {
    shareId,
    resourceType: resource.type,
    resourceId: resource.id,
    resourceName: resource.name,
    counterpartUser: ownerSnapshot,
  };

  return createNotification({
    userId: recipientUserId,
    type: NOTIFICATION_TYPES.householdOwnerAccountDeleted,
    title: `${ownerSnapshot.username} deleted the account "${resource.name}"`,
    payload,
  });
};

/**
 * Owner-side: a household member's user account on the platform was deleted (cascade
 * from user-delete). Distinct from `notifyHouseholdLeft` so the owner can tell apart a
 * voluntary leave from a platform-driven removal.
 */
export const notifyHouseholdMemberAccountDeleted = async ({
  ownerUserId,
  memberSnapshot,
  shareId,
  resource,
}: {
  ownerUserId: number;
  /**
   * Pre-snapshotted member info — the Users row is already gone by the time this fires,
   * so the caller captures it just before the cascade.
   */
  memberSnapshot: { id: number; username: string; avatar: string | null };
  shareId: RecordId;
  resource: { type: ResourceType; id: string; name: string };
}) => {
  const payload: ShareLifecycleNotificationPayload = {
    shareId,
    resourceType: resource.type,
    resourceId: resource.id,
    resourceName: resource.name,
    counterpartUser: memberSnapshot,
  };

  return createNotification({
    userId: ownerUserId,
    type: NOTIFICATION_TYPES.householdMemberAccountDeleted,
    title: `${memberSnapshot.username} is no longer in your ${HOUSEHOLD_RESOURCE_LABEL}`,
    payload,
  });
};

/**
 * Owner-side: post-commit email send for a household invite failed. Symmetric to
 * `notifyInvitationSendFailed`. The invitation row stays `pending` — this surface lets
 * the owner re-trigger the email from the UI.
 */
const notifyHouseholdInvitationSendFailed = async ({
  ownerUserId,
  invitee,
  inviteeEmail,
  invitationId,
  resource,
}: {
  ownerUserId: number;
  invitee: Users | null;
  inviteeEmail: string;
  invitationId: RecordId;
  resource: { type: ResourceType; id: string; name: string };
}) => {
  const payload: ShareInvitationSendFailedPayload = {
    invitationId,
    resourceType: resource.type,
    resourceId: resource.id,
    resourceName: resource.name,
    inviteeEmail,
    inviteeSnapshot: invitee ? snapshotUser(invitee) : null,
  };

  return createNotification({
    userId: ownerUserId,
    type: NOTIFICATION_TYPES.householdInvitationSendFailed,
    title: `Couldn't deliver your ${HOUSEHOLD_RESOURCE_LABEL} invitation email`,
    message: `We saved the invitation but the email to ${inviteeEmail} didn't go through. You can resend it from Settings → Household.`,
    payload,
  });
};

/**
 * Per-`resourceType` dispatch for each share lifecycle event. Callers read the right
 * helper from here instead of inlining `resourceType === household ? ... : ...` ternaries
 * at every send site, which was the pattern across 7+ services. Each entry's halves
 * are signature-compatible by construction (matching parameter shapes per event).
 *
 * Trackers reuse the per-resource (account-style) notifiers — the copy template
 * `${owner.username} shared "${resource.name}" with you` is resource-agnostic, so a
 * dedicated set wouldn't add anything.
 */
export const LIFECYCLE_NOTIFIERS = {
  invitationReceived: {
    [RESOURCE_TYPES.account]: notifyInvitationReceived,
    [RESOURCE_TYPES.household]: notifyHouseholdInvitationReceived,
    [RESOURCE_TYPES.tracker]: notifyInvitationReceived,
  },
  invitationAccepted: {
    [RESOURCE_TYPES.account]: notifyInvitationAccepted,
    [RESOURCE_TYPES.household]: notifyHouseholdAccepted,
    [RESOURCE_TYPES.tracker]: notifyInvitationAccepted,
  },
  invitationDeclined: {
    [RESOURCE_TYPES.account]: notifyInvitationDeclined,
    [RESOURCE_TYPES.household]: notifyHouseholdDeclined,
    [RESOURCE_TYPES.tracker]: notifyInvitationDeclined,
  },
  invitationExpired: {
    [RESOURCE_TYPES.account]: notifyInvitationExpired,
    [RESOURCE_TYPES.household]: notifyHouseholdExpired,
    [RESOURCE_TYPES.tracker]: notifyInvitationExpired,
  },
  invitationSendFailed: {
    [RESOURCE_TYPES.account]: notifyInvitationSendFailed,
    [RESOURCE_TYPES.household]: notifyHouseholdInvitationSendFailed,
    [RESOURCE_TYPES.tracker]: notifyInvitationSendFailed,
  },
  shareRevoked: {
    [RESOURCE_TYPES.account]: notifyShareRevoked,
    [RESOURCE_TYPES.household]: notifyHouseholdRevoked,
    [RESOURCE_TYPES.tracker]: notifyShareRevoked,
  },
  shareLeft: {
    [RESOURCE_TYPES.account]: notifyShareLeft,
    [RESOURCE_TYPES.household]: notifyHouseholdLeft,
    [RESOURCE_TYPES.tracker]: notifyShareLeft,
  },
} as const;
