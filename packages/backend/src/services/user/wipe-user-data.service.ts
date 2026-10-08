import { HouseholdSharePermission, RecordId, RESOURCE_TYPES } from '@bt/shared/types';
import * as Accounts from '@models/accounts.model';
import ResourceShares from '@models/resource-shares.model';
import ShareInvitations from '@models/share-invitations.model';
import * as Users from '@models/users.model';
import { BACKUP_TABLES, type BackupFileName } from '@services/backup/registry';
import { Op } from 'sequelize';

import { seedUserDefaults } from './create-user-with-defaults.service';
import { runUserDestroyLifecycle } from './user-destroy-lifecycle';

interface SharedResourceSummary {
  /** Accounts this user OWNS that another user currently has share access to. */
  accounts: Array<{ id: string; name: string; recipientUserId: number }>;
  /** Households this user OWNS with at least one accepted member. */
  households: Array<{ shareId: RecordId; recipientUserId: number; permission: HouseholdSharePermission }>;
}

/**
 * Preflight check for the wipe-data flow. Returns a summary of shared resources the user
 * OWNS where other users currently have access. UI uses this to gate the destructive
 * action behind an extra acknowledgement step — wiping their data will revoke access for
 * those other users.
 */
export const getOwnedSharedResourceSummary = async ({ userId }: { userId: number }): Promise<SharedResourceSummary> => {
  const [accountShareRows, householdShareRows] = await Promise.all([
    ResourceShares.findAll({
      where: { ownerUserId: userId, resourceType: RESOURCE_TYPES.account },
      attributes: ['resourceId', 'sharedWithUserId'],
      raw: true,
    }) as unknown as Promise<Array<{ resourceId: string; sharedWithUserId: number }>>,
    ResourceShares.findAll({
      where: {
        ownerUserId: userId,
        resourceType: RESOURCE_TYPES.household,
        acceptedAt: { [Op.not]: null },
      },
      attributes: ['id', 'sharedWithUserId', 'permission'],
      raw: true,
    }) as unknown as Promise<Array<{ id: RecordId; sharedWithUserId: number; permission: HouseholdSharePermission }>>,
  ]);

  const accountIds = [...new Set(accountShareRows.map((s) => s.resourceId))];
  const accountRows = accountIds.length
    ? ((await Accounts.default.findAll({
        where: { id: { [Op.in]: accountIds } },
        attributes: ['id', 'name'],
        raw: true,
      })) as Array<{ id: string; name: string }>)
    : [];
  const namesById = new Map(accountRows.map((a) => [a.id, a.name]));

  return {
    accounts: accountShareRows.map((s) => ({
      id: s.resourceId,
      name: namesById.get(s.resourceId) ?? 'Shared account',
      recipientUserId: s.sharedWithUserId,
    })),
    households: householdShareRows.map((s) => ({
      shareId: s.id,
      recipientUserId: s.sharedWithUserId,
      permission: s.permission,
    })),
  };
};

// Transactions, splits and refunds carry the CREATOR's userId, so on a shared
// account they are the owner's data, not the wiper's. The Accounts cascade
// removes the ones on owned accounts; rows on other users' accounts stay.
const CREATOR_SCOPED_TABLES = new Set<BackupFileName>(['transactions', 'transaction-splits', 'refund-transactions']);

// Reverse of the restore insert order, so FK parents (Accounts, Categories, …) go after their dependants.
const WIPE_ORDER = BACKUP_TABLES.toReversed();

/**
 * Destroy of everything a user OWNS, minus the reseed. Two callers: wipe-data
 * (reseeds defaults afterwards) and backup-restore (inserts the backup's own
 * tables afterwards, no reseed). Must run inside a transaction — both callers
 * invoke it from `runUserDestroyLifecycle`'s `destroyInTx` hook so the
 * surrounding spine handles share-target snapshots and notification fan-out.
 *
 * Walks the backup registry's `userColumn` tables; `viaParent` children go
 * with their parents via FK cascade. Leaves the Users + `ba_user` rows intact
 * (identity is preserved); only the domain data + per-user settings go.
 */
export const destroyUserOwnedData = async ({ user }: { user: Users.default }) => {
  // Break Users → Categories FK before the Categories rows go. The caller repoints
  // `defaultCategoryId` afterwards (reseed for wipe, restored value for backup).
  // totalBalance gets recomputed from accounts on demand; zero it as the baseline.
  await Users.default.update({ defaultCategoryId: null, totalBalance: 0 }, { where: { id: user.id } });

  // Disentangle the sharing layer first. Both directions: rows where this user is the
  // owner AND rows where this user is the recipient of someone else's share.
  await ResourceShares.destroy({
    where: { [Op.or]: [{ ownerUserId: user.id }, { sharedWithUserId: user.id }] },
  });
  await ShareInvitations.destroy({
    where: { [Op.or]: [{ ownerUserId: user.id }, { inviteeUserId: user.id }] },
  });

  for (const def of WIPE_ORDER) {
    if (def.scope.strategy !== 'userColumn' || CREATOR_SCOPED_TABLES.has(def.fileName)) continue;
    // force:true so paranoid models hard-delete instead of leaving soft-deleted rows behind their default scope.
    await def.model.destroy({ where: { [def.scope.column]: user.id }, force: true });
  }
};

export const wipeUserData = async ({ userId }: { userId: number }) => {
  await runUserDestroyLifecycle({
    userId,
    cacheLogPrefix: 'user-wipe',
    failureLogCode: 'USER_WIPE_FAILED',
    failureLogMessage: 'User data wipe failed',
    destroyInTx: async ({ user }) => {
      await destroyUserOwnedData({ user });

      // Reseed default categories + tags + default-category pointer. A wiped user lands
      // on the same starter state a brand-new signup would — empty-state with common
      // categories (Food, Transport, …) already populated. Runs in the same tx so a
      // mid-flight failure rolls back the whole wipe rather than leaving a half-wiped,
      // un-seeded account.
      await seedUserDefaults({ userId: user.id });
    },
  });
};
