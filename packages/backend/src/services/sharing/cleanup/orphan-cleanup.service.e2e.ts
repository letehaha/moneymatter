import { RESOURCE_TYPES, SHARE_INVITATION_STATUSES, SHARE_PERMISSIONS } from '@bt/shared/types';
import { NONEXISTENT_ID } from '@common/lib/record-id-helpers';
import { describe, expect, it } from '@jest/globals';
import ResourceShares from '@models/resource-shares.model';
import ShareInvitations from '@models/share-invitations.model';
import { shareResourceOrphanCleanupCron } from '@root/crons/share-resource-orphan-cleanup';
import { cleanupOrphanShares } from '@services/sharing/cleanup/cleanup-orphan-shares.service';
import * as helpers from '@tests/helpers';

/**
 * Orphan-cleanup safety net. Runs the daily sweep directly (per the `tag-reminders` /
 * `share-invitations-expire` test precedent — crons have no HTTP surface) against a mix
 * of orphaned and live rows, and asserts only the orphans are pruned.
 */

describe('Share resource orphan cleanup', () => {
  describe('cleanupOrphanShares — direct call', () => {
    it('sweeps orphan share and invitation rows while leaving live account, invitation and household rows intact', async () => {
      const recipient = await helpers.provisionSecondUserWithBaseCurrency();
      const recipientApp = await helpers.findAppUserByEmail({ email: recipient.email });
      const account = await helpers.createAccount({ raw: true });

      // Controls: live, intact rows that must survive every sweep.
      const liveShare = await ResourceShares.create({
        ownerUserId: account.userId,
        sharedWithUserId: recipientApp.id,
        resourceType: RESOURCE_TYPES.account,
        resourceId: String(account.id),
        permission: SHARE_PERMISSIONS.read,
        acceptedAt: new Date(),
      });

      const liveInvite = await helpers.createShareInvitation({
        inviteeEmail: recipient.email,
        resourceType: RESOURCE_TYPES.account,
        resourceId: account.id,
        permission: SHARE_PERMISSIONS.read,
        raw: true,
      });

      // The CHECK constraint forces `resourceId = ownerUserId::text` and the FK on
      // `ownerUserId` cascades on user delete, so a real household orphan cannot be
      // created here. This row pins that the sweep leaves live household rows alone.
      const liveHousehold = await ResourceShares.create({
        ownerUserId: account.userId,
        sharedWithUserId: recipientApp.id,
        resourceType: RESOURCE_TYPES.household,
        resourceId: String(account.userId),
        permission: SHARE_PERMISSIONS.read,
        acceptedAt: new Date(),
      });

      const noopResult = await cleanupOrphanShares();
      expect(noopResult.deletedSharesCount).toBe(0);
      expect(noopResult.deletedInvitationsCount).toBe(0);

      // ResourceShares has no FK to Accounts (resourceId is a generic VARCHAR), so a row
      // pointing at a missing account survives until the cron sweeps it. The invitation is
      // written directly because send-time validation refuses a missing resource.
      const orphanShare = await ResourceShares.create({
        ownerUserId: account.userId,
        sharedWithUserId: recipientApp.id,
        resourceType: RESOURCE_TYPES.account,
        resourceId: NONEXISTENT_ID,
        permission: SHARE_PERMISSIONS.read,
        acceptedAt: new Date(),
      });

      const orphanInvite = await ShareInvitations.create({
        ownerUserId: account.userId,
        inviteeEmail: recipient.email,
        inviteeUserId: null,
        resourceType: RESOURCE_TYPES.account,
        resourceId: NONEXISTENT_ID,
        permission: SHARE_PERMISSIONS.read,
        policy: null,
        token: `orphan-token-${Date.now()}`,
        status: SHARE_INVITATION_STATUSES.pending,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      });

      const result = await cleanupOrphanShares();
      expect(result.deletedSharesCount).toBeGreaterThanOrEqual(1);
      expect(result.deletedInvitationsCount).toBeGreaterThanOrEqual(1);

      expect(await ResourceShares.findByPk(orphanShare.id)).toBeNull();
      expect(await ShareInvitations.findByPk(orphanInvite.id)).toBeNull();
      expect(await ResourceShares.findByPk(liveShare.id)).not.toBeNull();
      expect(await ShareInvitations.findByPk(liveInvite.id)).not.toBeNull();
      expect(await ResourceShares.findByPk(liveHousehold.id)).not.toBeNull();
    }, 60_000);
  });

  describe('cron manual trigger', () => {
    it('clears orphans end-to-end via the cron entry point', async () => {
      const recipient = await helpers.provisionSecondUserWithBaseCurrency();
      const recipientApp = await helpers.findAppUserByEmail({ email: recipient.email });
      const account = await helpers.createAccount({ raw: true });

      const orphan = await ResourceShares.create({
        ownerUserId: account.userId,
        sharedWithUserId: recipientApp.id,
        resourceType: RESOURCE_TYPES.account,
        resourceId: NONEXISTENT_ID,
        permission: SHARE_PERMISSIONS.read,
        acceptedAt: new Date(),
      });

      await shareResourceOrphanCleanupCron.triggerManualSync();

      const after = await ResourceShares.findByPk(orphan.id);
      expect(after).toBeNull();
    });
  });
});
