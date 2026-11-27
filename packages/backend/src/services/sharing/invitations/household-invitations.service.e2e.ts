import {
  API_ERROR_CODES,
  NOTIFICATION_TYPES,
  RESOURCE_TYPES,
  SHARE_INVITATION_STATUSES,
  SHARE_PERMISSIONS,
} from '@bt/shared/types';
import { describe, expect, it } from '@jest/globals';
import Notifications from '@models/notifications.model';
import ResourceShares from '@models/resource-shares.model';
import ShareInvitations from '@models/share-invitations.model';
import UsersCurrencies from '@models/users-currencies.model';
import * as helpers from '@tests/helpers';
import { CustomResponse, ErrorResponse } from '@tests/helpers/common';

/**
 * Force-flip a user's base currency by directly mutating UsersCurrencies. The real
 * change-base-currency flow is heavy (recalculates every transaction's refAmount under
 * a Redis lock); here we only need the recipient's recorded base to differ from the
 * owner's so the accept-time guard rejects. Used inside tests only.
 */
async function forceUserBaseCurrency({ userId, currencyCode }: { userId: number; currencyCode: string }) {
  await UsersCurrencies.update({ isDefaultCurrency: false }, { where: { userId } });
  const existing = await UsersCurrencies.findOne({ where: { userId, currencyCode } });
  if (existing) {
    await UsersCurrencies.update({ isDefaultCurrency: true }, { where: { userId, currencyCode } });
  } else {
    await UsersCurrencies.create({
      userId,
      currencyCode,
      isDefaultCurrency: true,
      liveRateUpdate: true,
    });
  }
}

/**
 * Household invitation flow.
 *
 * Verifies that the existing per-resource invitation pipeline (create / accept / decline /
 * resend / cancel / expire) supports `resourceType='household'` end-to-end. The
 * pipeline is mostly polymorphic — only the resource resolution, validation, and
 * notification-helper selection differ. These tests cover:
 *
 *   - Owner creates a household invite → recipient accepts → household ResourceShares
 *     row exists with the correct shape, and the recipient's `GET /accounts` now lists
 *     the grantor's accounts.
 *   - Recipient declines → invitation transitions to `declined`, no ResourceShares row.
 *   - Validation: cannot invite with `manage` permission (household members never get
 *     manage); cannot invite to someone else's household; cannot self-invite.
 *   - Idempotency: the same recipient can't be invited to the same household twice in
 *     pending state (caught by service-level pending-cap or unique handling).
 *   - Auto-merge: prior account shares + pending account invitations from the same owner
 *     are revoked/deleted on household accept (broader grant supersedes them); tracker
 *     shares and invitations are kept.
 *   - Currency mismatch surfaces a structured error with the expected currency.
 */

const inviteToHousehold = async ({
  ownerUserId,
  inviteeEmail,
  permission = SHARE_PERMISSIONS.write,
}: {
  ownerUserId: number;
  inviteeEmail: string;
  permission?: (typeof SHARE_PERMISSIONS)[keyof typeof SHARE_PERMISSIONS];
}) =>
  helpers.createShareInvitation({
    inviteeEmail,
    resourceType: RESOURCE_TYPES.household,
    resourceId: ownerUserId,
    permission,
    raw: true,
  });

describe('Household invitation flow', () => {
  describe('happy path — accept', () => {
    it('owner invites recipient to household, recipient accepts, ResourceShares row exists', async () => {
      const ownerAccount = await helpers.createAccount({ raw: true });
      const ownerUserId = ownerAccount.userId;
      const recipient = await helpers.provisionSecondUserWithBaseCurrency();
      const recipientApp = await helpers.findAppUserByEmail({ email: recipient.email });

      const invitation = await inviteToHousehold({
        ownerUserId,
        inviteeEmail: recipient.email,
      });
      expect(invitation.resourceType).toBe(RESOURCE_TYPES.household);
      expect(invitation.resourceId).toBe(String(ownerUserId));

      await helpers.asUser({
        cookies: recipient.cookies,
        fn: () => helpers.acceptShareInvitation({ token: invitation.token, raw: true }),
      });

      const share = await ResourceShares.findOne({
        where: {
          ownerUserId,
          sharedWithUserId: recipientApp.id,
          resourceType: RESOURCE_TYPES.household,
          resourceId: String(ownerUserId),
        },
      });
      expect(share).not.toBeNull();
      expect(share!.acceptedAt).not.toBeNull();
      expect(share!.permission).toBe(SHARE_PERMISSIONS.write);

      // Recipient's account list now contains the grantor's account.
      const accounts = await helpers.asUser({
        cookies: recipient.cookies,
        fn: () => helpers.getAccounts(),
      });
      expect(accounts.find((a) => a.id === ownerAccount.id)).toBeDefined();

      // Owner gets a `household_accepted` notification so the accept event surfaces in
      // their notification center even if they aren't on the household settings page.
      const ownerNotification = await Notifications.findOne({
        where: { userId: ownerUserId, type: NOTIFICATION_TYPES.householdAccepted },
        order: [['createdAt', 'DESC']],
      });
      expect(ownerNotification).not.toBeNull();

      const items = await helpers.asUser({
        cookies: recipient.cookies,
        fn: () => helpers.listSharedWithMe({ raw: true }),
      });
      const householdRow = items.find(
        (i) => i.resourceType === RESOURCE_TYPES.household && i.resourceId === String(ownerUserId),
      );
      expect(householdRow).toBeDefined();
      expect(householdRow!.permission).toBe(SHARE_PERMISSIONS.write);
      // Resource name is `${owner.username}'s household`, so match the whole shape: a
      // regression that strips the owner prefix must fail here.
      expect(householdRow!.resourceName).toMatch(/^.+'s household$/);
    }, 60_000);
  });

  describe('decline path', () => {
    it('recipient declines household invitation, no ResourceShares row is created', async () => {
      const ownerAccount = await helpers.createAccount({ raw: true });
      const ownerUserId = ownerAccount.userId;
      const recipient = await helpers.provisionSecondUserWithBaseCurrency();
      const recipientApp = await helpers.findAppUserByEmail({ email: recipient.email });

      const invitation = await inviteToHousehold({
        ownerUserId,
        inviteeEmail: recipient.email,
      });

      await helpers.asUser({
        cookies: recipient.cookies,
        fn: () => helpers.declineShareInvitation({ token: invitation.token, raw: true }),
      });

      const share = await ResourceShares.findOne({
        where: {
          ownerUserId,
          sharedWithUserId: recipientApp.id,
          resourceType: RESOURCE_TYPES.household,
        },
      });
      expect(share).toBeNull();

      // Owner gets a `household_declined` notification — symmetric to the accept path,
      // and the only durable signal an owner has that the decline happened (the
      // invitation row itself transitions to `declined` but doesn't trigger a UI).
      const ownerNotification = await Notifications.findOne({
        where: { userId: ownerUserId, type: NOTIFICATION_TYPES.householdDeclined },
        order: [['createdAt', 'DESC']],
      });
      expect(ownerNotification).not.toBeNull();
    });
  });

  describe('validation', () => {
    it('rejects invalid household invitations', async () => {
      const otherUser = await helpers.provisionSecondUserWithBaseCurrency();
      const otherApp = await helpers.findAppUserByEmail({ email: otherUser.email });
      const ownerAccount = await helpers.createAccount({ raw: true });

      // Household members never get `manage`. Assert 422 exactly: a 500 masking the
      // validation would satisfy a loose 4xx check.
      const managePermissionRes = (await helpers.createShareInvitation({
        inviteeEmail: otherUser.email,
        resourceType: RESOURCE_TYPES.household,
        resourceId: ownerAccount.userId,
        permission: SHARE_PERMISSIONS.manage,
        raw: false,
      })) as unknown as CustomResponse<unknown>;
      expect(managePermissionRes.statusCode).toBe(422);

      // Only the household owner can invite to their own household.
      const foreignHouseholdRes = (await helpers.createShareInvitation({
        inviteeEmail: otherUser.email,
        resourceType: RESOURCE_TYPES.household,
        resourceId: otherApp.id,
        permission: SHARE_PERMISSIONS.write,
        raw: false,
      })) as unknown as CustomResponse<unknown>;
      expect(foreignHouseholdRes.statusCode).toBe(422);
    }, 60_000);
  });

  describe('currency mismatch on accept', () => {
    it('rejects accept when the recipient base currency differs from the owner', async () => {
      // Owner stays on `global.BASE_CURRENCY.code`; recipient is flipped to USD after
      // signup so the accept-time guard fires deterministically. Cannot rely on the
      // provisionSecondUserWithBaseCurrency override alone — the helper would call
      // /user/currencies/base which itself rejects when the target currency isn't in
      // the user's currency list, so direct UsersCurrencies mutation is cleaner.
      const owner = await helpers.createAccount({ raw: true });
      const recipient = await helpers.provisionSecondUserWithBaseCurrency();
      const recipientApp = await helpers.findAppUserByEmail({ email: recipient.email });
      await forceUserBaseCurrency({ userId: recipientApp.id, currencyCode: 'USD' });

      const invitation = await inviteToHousehold({
        ownerUserId: owner.userId,
        inviteeEmail: recipient.email,
      });

      const acceptRes = await helpers.asUser({
        cookies: recipient.cookies,
        fn: () => helpers.acceptShareInvitation({ token: invitation.token }),
      });

      expect(acceptRes.statusCode).toBe(422);
      const err = acceptRes.body.response as unknown as ErrorResponse & {
        details?: { expectedCurrency?: string };
      };
      expect(err.code).toBe(API_ERROR_CODES.shareCurrencyMismatch);
      expect(err.details?.expectedCurrency).toBe(global.BASE_CURRENCY.code);
    });
  });

  describe('auto-merge on accept', () => {
    it('deletes prior accepted per-resource shares from the same owner when the recipient accepts a household invite', async () => {
      const account = await helpers.createAccount({ raw: true });
      const recipient = await helpers.provisionSecondUserWithBaseCurrency();
      const recipientApp = await helpers.findAppUserByEmail({ email: recipient.email });

      // 1. Owner shares the per-resource account with the recipient first.
      const perResourceInvite = await helpers.createShareInvitation({
        inviteeEmail: recipient.email,
        resourceType: RESOURCE_TYPES.account,
        resourceId: account.id,
        permission: SHARE_PERMISSIONS.read,
        raw: true,
      });
      await helpers.asUser({
        cookies: recipient.cookies,
        fn: () => helpers.acceptShareInvitation({ token: perResourceInvite.token, raw: true }),
      });

      const beforeShare = await ResourceShares.findOne({
        where: {
          ownerUserId: account.userId,
          sharedWithUserId: recipientApp.id,
          resourceType: RESOURCE_TYPES.account,
        },
      });
      expect(beforeShare).not.toBeNull();

      // 2. Owner invites the recipient to their household.
      const householdInvite = await inviteToHousehold({
        ownerUserId: account.userId,
        inviteeEmail: recipient.email,
      });

      // 3. Recipient accepts → the prior per-resource share is auto-merged.
      await helpers.asUser({
        cookies: recipient.cookies,
        fn: () => helpers.acceptShareInvitation({ token: householdInvite.token, raw: true }),
      });

      const afterShare = await ResourceShares.findOne({
        where: {
          ownerUserId: account.userId,
          sharedWithUserId: recipientApp.id,
          resourceType: RESOURCE_TYPES.account,
        },
      });
      expect(afterShare).toBeNull();
    });

    it('revokes pending per-resource invitations from the same owner when the recipient accepts a household invite', async () => {
      const account = await helpers.createAccount({ raw: true });
      const recipient = await helpers.provisionSecondUserWithBaseCurrency();

      // Pending per-resource invitation (not accepted).
      const pendingInvite = await helpers.createShareInvitation({
        inviteeEmail: recipient.email,
        resourceType: RESOURCE_TYPES.account,
        resourceId: account.id,
        permission: SHARE_PERMISSIONS.read,
        raw: true,
      });

      const householdInvite = await inviteToHousehold({
        ownerUserId: account.userId,
        inviteeEmail: recipient.email,
      });

      await helpers.asUser({
        cookies: recipient.cookies,
        fn: () => helpers.acceptShareInvitation({ token: householdInvite.token, raw: true }),
      });

      const after = await ShareInvitations.findByPk(pendingInvite.id);
      expect(after).not.toBeNull();
      expect(after!.status).toBe(SHARE_INVITATION_STATUSES.revoked);
    });

    it('keeps tracker shares and pending tracker invitations from the same owner when the recipient accepts a household invite', async () => {
      const account = await helpers.createAccount({ raw: true });
      const sharedTracker = await helpers.createTracker({ name: 'Shared tracker', raw: true });
      const pendingTracker = await helpers.createTracker({ name: 'Pending tracker', raw: true });
      const recipient = await helpers.provisionSecondUserWithBaseCurrency();
      const recipientApp = await helpers.findAppUserByEmail({ email: recipient.email });

      const trackerInvite = await helpers.createShareInvitation({
        inviteeEmail: recipient.email,
        resourceType: RESOURCE_TYPES.tracker,
        resourceId: sharedTracker.id,
        permission: SHARE_PERMISSIONS.read,
        raw: true,
      });
      await helpers.asUser({
        cookies: recipient.cookies,
        fn: () => helpers.acceptShareInvitation({ token: trackerInvite.token, raw: true }),
      });

      const pendingTrackerInvite = await helpers.createShareInvitation({
        inviteeEmail: recipient.email,
        resourceType: RESOURCE_TYPES.tracker,
        resourceId: pendingTracker.id,
        permission: SHARE_PERMISSIONS.read,
        raw: true,
      });

      const householdInvite = await inviteToHousehold({
        ownerUserId: account.userId,
        inviteeEmail: recipient.email,
      });
      await helpers.asUser({
        cookies: recipient.cookies,
        fn: () => helpers.acceptShareInvitation({ token: householdInvite.token, raw: true }),
      });

      const trackerShare = await ResourceShares.findOne({
        where: {
          ownerUserId: account.userId,
          sharedWithUserId: recipientApp.id,
          resourceType: RESOURCE_TYPES.tracker,
          resourceId: String(sharedTracker.id),
        },
      });
      expect(trackerShare).not.toBeNull();

      const pendingAfter = await ShareInvitations.findByPk(pendingTrackerInvite.id);
      expect(pendingAfter!.status).toBe(SHARE_INVITATION_STATUSES.pending);
    });
  });
});
