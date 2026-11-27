import {
  API_ERROR_CODES,
  RESOURCE_TYPES,
  ResourceShareModel,
  SHARE_INVITATION_STATUSES,
  ShareInvitationModel,
} from '@bt/shared/types';
import { ConflictError, NotFoundError, ValidationError } from '@js/errors';
import { logger } from '@js/utils/logger';
import { connection } from '@models/index';
import ResourceShares from '@models/resource-shares.model';
import ShareInvitations from '@models/share-invitations.model';
import { getBaseCurrency } from '@models/users-currencies.model';
import Users from '@models/users.model';
import { withTransaction } from '@services/common/with-transaction';
import { assertUsersNotBaseCurrencyLocked } from '@services/currencies/base-currency-lock';
import { Op, QueryTypes } from 'sequelize';

import { resolveResourceName } from '../auth/can-user-access-resource.service';
import { getEmailForUser } from '../find-user-by-email.service';
import { LIFECYCLE_NOTIFIERS } from '../share-notifications';
import { assertSeatAvailable } from './assert-seat-available';

interface AcceptInvitationResult {
  invitation: ShareInvitationModel;
  share: ResourceShareModel;
  /**
   * `true` only for accepted household invitations where the recipient does NOT already
   * share their own household back with the inviter. Lets the UI decide whether to prompt
   * for a reciprocal "share back" — false stops the second leg of an A↔B↔A loop where
   * both households are already mutually shared.
   */
  canBackInvite: boolean;
}

/**
 * Verifies that the logged-in user is the rightful recipient of this invitation. Returns
 * `true` when the invitation should be bound to `userId` on accept (only relevant when the
 * invitation was sent to an unregistered email and the recipient has now signed up).
 *
 * Throws 404 (masked) on any mismatch — we never want to confirm/deny token existence to
 * a non-recipient.
 */
const verifyRecipientAndComputeBinding = async ({
  invitation,
  userId,
}: {
  invitation: ShareInvitations;
  userId: number;
}): Promise<{ shouldBindUserId: boolean }> => {
  if (invitation.inviteeUserId !== null) {
    if (invitation.inviteeUserId !== userId) {
      throw new NotFoundError({ message: 'Invitation not found' });
    }
    return { shouldBindUserId: false };
  }

  // Unresolved invitation — fall back to email match against the caller's auth email.
  const callerEmail = await getEmailForUser({ userId });
  if (!callerEmail) {
    throw new NotFoundError({ message: 'Invitation not found' });
  }
  if (callerEmail.toLowerCase() !== invitation.inviteeEmail.toLowerCase()) {
    throw new NotFoundError({ message: 'Invitation not found' });
  }
  return { shouldBindUserId: true };
};

const acceptImpl = async ({ token, userId }: { token: string; userId: number }): Promise<AcceptInvitationResult> => {
  const invitation = await ShareInvitations.findOne({ where: { token } });
  if (!invitation) {
    throw new NotFoundError({ message: 'Invitation not found' });
  }

  const { shouldBindUserId } = await verifyRecipientAndComputeBinding({ invitation, userId });

  // Defensive self-share check — prevents the edge case where an owner sent an invite to
  // an email that later turns out to belong to themselves (or where they sign up with a
  // matching email after sending). Send-time only catches this when the email was already
  // resolved to the owner's own user.
  if (invitation.ownerUserId === userId) {
    throw new ValidationError({ message: 'You cannot accept an invitation you sent yourself.' });
  }

  if (invitation.status !== SHARE_INVITATION_STATUSES.pending) {
    throw new ConflictError({
      message: `Invitation is ${invitation.status} and can no longer be accepted.`,
    });
  }

  if (invitation.expiresAt.getTime() <= Date.now()) {
    // Status stays `pending` in the DB until the daily expiration cron sweeps it — the
    // cron is the canonical source for the `expired` status. We can't update it here
    // because the surrounding transaction rolls back when we throw.
    throw new ConflictError({ message: 'This invitation has expired.' });
  }

  // Refuse while either the acceptor or the resource owner is mid base-currency
  // migration. The route guard only inspects the acceptor's lock, so the owner's is
  // checked here too — accepting during their migration recreates exactly the
  // shared-account/mixed-base state `changeBaseCurrencyImpl`'s share validation forbids.
  await assertUsersNotBaseCurrencyLocked({ requesterUserId: userId, otherUserIds: [invitation.ownerUserId] });

  const resourceName = await resolveResourceName({
    resourceType: invitation.resourceType,
    resourceId: invitation.resourceId,
  });
  if (!resourceName) {
    throw new NotFoundError({ message: 'Shared resource is no longer available' });
  }

  // Currency check compares the recipient's base to the *owner's* base — not the
  // account's currency. The account's currency is unrelated; what matters is that both
  // users' refAmount aggregates line up. An owner can have a USD account even if their
  // base currency is AED — the share is fine as long as the recipient's base is also AED.
  const [ownerBaseCurrency, inviteeBaseCurrency] = await Promise.all([
    getBaseCurrency({ userId: invitation.ownerUserId }),
    getBaseCurrency({ userId }),
  ]);
  if (!ownerBaseCurrency) {
    // Defensive — an owner without a base currency shouldn't be able to share.
    throw new NotFoundError({ message: 'Shared resource is no longer available' });
  }
  if (!inviteeBaseCurrency || inviteeBaseCurrency.currencyCode !== ownerBaseCurrency.currencyCode) {
    // Structured error so the frontend can surface a "change base currency to X" CTA.
    throw new ValidationError({
      code: API_ERROR_CODES.shareCurrencyMismatch,
      message: `Your base currency must be ${ownerBaseCurrency.currencyCode} to accept this invitation.`,
      details: { expectedCurrency: ownerBaseCurrency.currencyCode },
    });
  }

  // Idempotent path: if the recipient already has an accepted share (e.g., from a prior
  // invitation), don't try to insert a duplicate row — mark this invitation accepted and
  // return the existing share. Avoids hitting the unique constraint on
  // (sharedWithUserId, resourceType, resourceId) and gives the user a coherent terminal state.
  const existingShare = await ResourceShares.findOne({
    where: {
      sharedWithUserId: userId,
      resourceType: invitation.resourceType,
      resourceId: invitation.resourceId,
    },
  });

  // Recipient cap is also re-checked here, not just at send-time. Multiple pending
  // invitations are allowed per resource, so without an accept-side cap two recipients
  // racing to accept could both win and exceed the cap. Existing-share path skips this
  // check — the recipient already has a slot, accepting again is idempotent.
  if (!existingShare) {
    // Serialize accept on (resourceType, resourceId) so concurrent recipients can't both
    // pass the seat check below. The unique constraint only blocks same-recipient
    // duplicates; without this lock two different recipients could both insert and exceed
    // the cap. Transaction-scoped (`pg_advisory_xact_lock`) — released automatically on
    // commit/rollback. CLS picks up the surrounding transaction from `withTransaction`.
    await connection.sequelize.query('SELECT pg_advisory_xact_lock(hashtext(:resourceType), hashtext(:resourceId))', {
      replacements: {
        resourceType: invitation.resourceType,
        resourceId: invitation.resourceId,
      },
      type: QueryTypes.SELECT,
    });

    await assertSeatAvailable({
      ownerUserId: invitation.ownerUserId,
      resourceType: invitation.resourceType,
      resourceId: invitation.resourceId,
      voice: 'recipient',
    });
  }

  const acceptedAt = new Date();
  const share =
    existingShare ??
    (await ResourceShares.create({
      ownerUserId: invitation.ownerUserId,
      sharedWithUserId: userId,
      resourceType: invitation.resourceType,
      resourceId: invitation.resourceId,
      permission: invitation.permission,
      policy: invitation.policy,
      acceptedAt,
    }));

  // The household grant supersedes prior account grants from the same owner; leftover rows would
  // resurface as access after a household revoke. Tracker shares stay: trackers never inherit
  // household access. No revoke notifications: the recipient initiated this.
  if (invitation.resourceType === RESOURCE_TYPES.household && !existingShare) {
    await ResourceShares.destroy({
      where: {
        ownerUserId: invitation.ownerUserId,
        sharedWithUserId: userId,
        resourceType: RESOURCE_TYPES.account,
        acceptedAt: { [Op.not]: null },
      },
    });
    await ShareInvitations.update(
      { status: SHARE_INVITATION_STATUSES.revoked },
      {
        where: {
          ownerUserId: invitation.ownerUserId,
          inviteeUserId: userId,
          resourceType: RESOURCE_TYPES.account,
          status: SHARE_INVITATION_STATUSES.pending,
        },
      },
    );
  }

  invitation.status = SHARE_INVITATION_STATUSES.accepted;
  invitation.acceptedAt = acceptedAt;
  if (shouldBindUserId) {
    invitation.inviteeUserId = userId;
  }
  await invitation.save();

  // Notify the owner. We need both Users rows for the snapshot — the recipient is `this`
  // user and the owner is the receiver of the notification.
  const recipient = await Users.findByPk(userId);
  if (recipient) {
    const notify = LIFECYCLE_NOTIFIERS.invitationAccepted[invitation.resourceType];
    await notify({
      ownerUserId: invitation.ownerUserId,
      recipient,
      shareId: share.id,
      invitationId: invitation.id,
      resource: {
        type: invitation.resourceType,
        id: invitation.resourceId,
        name: resourceName,
      },
      permission: invitation.permission,
    });
  } else {
    // Authenticated user has no Users row — should never happen (auth middleware guarantees
    // it). Indicates a data-integrity bug or DB hiccup. Skip the notification but flag it
    // for investigation rather than silently swallowing.
    logger.error(
      {
        message: 'Authenticated user not found when emitting share-accepted notification',
        error: new Error(`Users.findByPk returned null for userId=${userId}`),
      },
      {
        code: 'SHARE_ACCEPTED_RECIPIENT_USER_MISSING',
        userId,
        invitationId: invitation.id,
        shareId: share.id,
      },
    );
  }

  // Compute the back-invite prompt gate so the dialog can decide on the spot, without
  // a second round-trip. Only meaningful for household accepts; per-resource shares
  // don't have a back-invite flow.
  let canBackInvite = false;
  if (invitation.resourceType === RESOURCE_TYPES.household) {
    const [reciprocalShare, reciprocalPendingInvitation] = await Promise.all([
      ResourceShares.findOne({
        where: {
          ownerUserId: userId,
          sharedWithUserId: invitation.ownerUserId,
          resourceType: RESOURCE_TYPES.household,
          acceptedAt: { [Op.not]: null },
        },
      }),
      // A pending back-invite already in flight means the recipient previously clicked
      // "share back" but the inviter hasn't accepted yet. Don't prompt again — the
      // back-invite endpoint blocks the duplicate, and the dialog should match.
      ShareInvitations.findOne({
        where: {
          ownerUserId: userId,
          inviteeUserId: invitation.ownerUserId,
          resourceType: RESOURCE_TYPES.household,
          status: SHARE_INVITATION_STATUSES.pending,
        },
      }),
    ]);
    canBackInvite = !reciprocalShare && !reciprocalPendingInvitation;
  }

  return {
    invitation: invitation.toJSON() as ShareInvitationModel,
    share: share.toJSON() as ResourceShareModel,
    canBackInvite,
  };
};

export const acceptInvitation = withTransaction(acceptImpl);
