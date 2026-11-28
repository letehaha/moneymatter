import { NOTIFICATION_TYPES, RESOURCE_TYPES, SHARE_PERMISSIONS } from '@bt/shared/types';
import { describe, expect, it } from '@jest/globals';
import Notifications from '@models/notifications.model';
import ResourceShares from '@models/resource-shares.model';
import * as helpers from '@tests/helpers';

/**
 * Cleanup + notification lifecycle for household memberships.
 *
 * Verifies that household-specific notifications fire on each lifecycle event:
 *   - owner deletes a household-shared account → members get
 *     `household_owner_account_deleted`
 *   - member leaves household → owner gets `household_left`
 *   - owner revokes a member → member gets `household_revoked`
 *   - owner changes member permission → member gets `household_permission_changed`
 *
 * Membership rows are seeded directly via `ResourceShares.create` to isolate cleanup
 * behavior from the invitation accept path — each scenario stands on its own without
 * dragging in invite-flow assertions.
 */

const seedHousehold = async ({
  ownerUserId,
  sharedWithUserId,
  permission = SHARE_PERMISSIONS.write,
}: {
  ownerUserId: number;
  sharedWithUserId: number;
  permission?: (typeof SHARE_PERMISSIONS)[keyof typeof SHARE_PERMISSIONS];
}) =>
  ResourceShares.create({
    ownerUserId,
    sharedWithUserId,
    resourceType: RESOURCE_TYPES.household,
    resourceId: String(ownerUserId),
    permission,
    acceptedAt: new Date(),
  });

const findLatestNotification = async ({
  userId,
  type,
}: {
  userId: number;
  type: (typeof NOTIFICATION_TYPES)[keyof typeof NOTIFICATION_TYPES];
}) =>
  Notifications.findOne({
    where: { userId, type },
    order: [
      ['createdAt', 'DESC'],
      ['id', 'DESC'],
    ],
  });

describe('Household cleanup + notification lifecycle', () => {
  describe('account delete', () => {
    it('emits household_owner_account_deleted to every household member when the owner deletes a shared account', async () => {
      const account = await helpers.createAccount({ raw: true });
      const recipient = await helpers.provisionSecondUserWithBaseCurrency();
      const recipientApp = await helpers.findAppUserByEmail({ email: recipient.email });

      await seedHousehold({ ownerUserId: account.userId, sharedWithUserId: recipientApp.id });

      await helpers.deleteAccount({ id: account.id, raw: true });

      const note = await findLatestNotification({
        userId: recipientApp.id,
        type: NOTIFICATION_TYPES.householdOwnerAccountDeleted,
      });
      expect(note).not.toBeNull();
      const payload = note!.payload as { resourceId: string; resourceName: string };
      expect(payload.resourceId).toBe(String(account.id));
    });

    it('does not emit household_owner_account_deleted when the deleting owner has no household members', async () => {
      const account = await helpers.createAccount({ raw: true });
      const before = await Notifications.count({
        where: { type: NOTIFICATION_TYPES.householdOwnerAccountDeleted },
      });

      await helpers.deleteAccount({ id: account.id, raw: true });

      const after = await Notifications.count({
        where: { type: NOTIFICATION_TYPES.householdOwnerAccountDeleted },
      });
      expect(after).toBe(before);
    });
  });

  describe('member leaves household', () => {
    it('emits household_left to the owner when a member leaves', async () => {
      const ownerAccount = await helpers.createAccount({ raw: true });
      const recipient = await helpers.provisionSecondUserWithBaseCurrency();
      const recipientApp = await helpers.findAppUserByEmail({ email: recipient.email });

      await seedHousehold({ ownerUserId: ownerAccount.userId, sharedWithUserId: recipientApp.id });

      await helpers.asUser({
        cookies: recipient.cookies,
        fn: () =>
          helpers.leaveShare({
            resourceType: RESOURCE_TYPES.household,
            resourceId: String(ownerAccount.userId),
            raw: true,
          }),
      });

      const note = await findLatestNotification({
        userId: ownerAccount.userId,
        type: NOTIFICATION_TYPES.householdLeft,
      });
      expect(note).not.toBeNull();

      // Membership row also gone.
      const stillThere = await ResourceShares.findOne({
        where: {
          ownerUserId: ownerAccount.userId,
          sharedWithUserId: recipientApp.id,
          resourceType: RESOURCE_TYPES.household,
        },
      });
      expect(stillThere).toBeNull();
    });
  });

  describe('owner changes membership', () => {
    it('emits household_permission_changed on a permission level change and on a policy-only change, then household_revoked on revoke', async () => {
      const ownerAccount = await helpers.createAccount({ raw: true });
      const recipient = await helpers.provisionSecondUserWithBaseCurrency();
      const recipientApp = await helpers.findAppUserByEmail({ email: recipient.email });

      await seedHousehold({
        ownerUserId: ownerAccount.userId,
        sharedWithUserId: recipientApp.id,
        permission: SHARE_PERMISSIONS.read,
      });

      await helpers.updateShareMember({
        resourceType: RESOURCE_TYPES.household,
        resourceId: String(ownerAccount.userId),
        memberUserId: recipientApp.id,
        permission: SHARE_PERMISSIONS.write,
        raw: true,
      });

      const permissionNote = await findLatestNotification({
        userId: recipientApp.id,
        type: NOTIFICATION_TYPES.householdPermissionChanged,
      });
      expect(permissionNote).not.toBeNull();
      expect((permissionNote!.payload as { permission: string }).permission).toBe(SHARE_PERMISSIONS.write);
      expect(permissionNote!.title).toContain('"Can edit"');

      // Policy changes are user-visible (writeScope flips between `all` and `own`), so
      // we surface them through the same notification. The recipient otherwise has no
      // way to learn that their write scope tightened or relaxed until they hit a
      // surprise 403.
      const before = await Notifications.count({
        where: { userId: recipientApp.id, type: NOTIFICATION_TYPES.householdPermissionChanged },
      });

      await helpers.updateShareMember({
        resourceType: RESOURCE_TYPES.household,
        resourceId: String(ownerAccount.userId),
        memberUserId: recipientApp.id,
        policy: { transactionsWriteScope: 'own' },
        raw: true,
      });

      const after = await Notifications.count({
        where: { userId: recipientApp.id, type: NOTIFICATION_TYPES.householdPermissionChanged },
      });
      expect(after).toBe(before + 1);

      // Notification payload must carry the new policy so the recipient's UI can render
      // "your write scope is now `own`" — a count-only assertion would still pass if the
      // payload regressed to omit the policy field.
      const policyNote = await findLatestNotification({
        userId: recipientApp.id,
        type: NOTIFICATION_TYPES.householdPermissionChanged,
      });
      const payload = policyNote!.payload as { policy?: { transactionsWriteScope?: string } };
      expect(payload.policy?.transactionsWriteScope).toBe('own');

      await helpers.revokeShareMember({
        resourceType: RESOURCE_TYPES.household,
        resourceId: String(ownerAccount.userId),
        memberUserId: recipientApp.id,
        raw: true,
      });

      const revokedNote = await findLatestNotification({
        userId: recipientApp.id,
        type: NOTIFICATION_TYPES.householdRevoked,
      });
      expect(revokedNote).not.toBeNull();
    }, 30000);
  });
});
