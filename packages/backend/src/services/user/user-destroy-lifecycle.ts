import {
  HouseholdSharePermission,
  RecordId,
  RESOURCE_TYPES,
  SharePermission,
  TransactionCreatorSnapshot,
} from '@bt/shared/types';
import { CacheClient } from '@js/utils/cache';
import { logger } from '@js/utils/logger';
import * as Accounts from '@models/accounts.model';
import { namespace } from '@models/connection';
import ResourceShares from '@models/resource-shares.model';
import { updateTransactions } from '@models/transactions-query';
import * as Users from '@models/users.model';
import { Op, type Transaction } from 'sequelize';

import { removePendingJobsForUser } from '../bank-data-providers/monobank/transaction-sync-queue';
import { REDIS_KEYS as SYNC_REDIS_KEYS, clearAccountSyncStatus } from '../bank-data-providers/sync/sync-status-tracker';
import { withTransaction } from '../common/with-transaction';
import { pruneUnusedCustomCurrencies } from '../currencies/prune-custom-currencies';
import { buildRefAmountCachePattern } from '../ref-amount-cache';
import { fanOutNotifications } from '../sharing/fan-out-notifications';
import { convertCrossUserTransfersForAccountIds } from '../sharing/household/convert-cross-user-transfers.service';
import {
  notifyHouseholdMemberAccountDeleted,
  notifyHouseholdRevoked,
  notifyShareOwnerAccountDeleted,
} from '../sharing/share-notifications';
import { formatHouseholdLabel, toPositiveInt } from '../sharing/sharing-utils';

/**
 * Snapshotted ahead of the destroy step so post-commit notifications have everything they
 * need after the destroy wipes the underlying `ResourceShares` and `Accounts` rows.
 * Captured inside the transaction; consumed outside so a notify failure can't abort it.
 */
interface AccountDeleteNotificationTarget {
  recipientUserId: number;
  shareId: RecordId;
  resourceId: string;
  resourceName: string;
  permission: SharePermission;
}

interface HouseholdRevokedTarget {
  /** Member who loses access (recipient of the household share). */
  recipientUserId: number;
  shareId: RecordId;
  permission: HouseholdSharePermission;
}

interface HouseholdOwnerNotifyTarget {
  /** Owner who gets notified that one of their household members is gone. */
  ownerUserId: number;
  shareId: RecordId;
}

interface OwnerSnapshot {
  id: number;
  username: string;
  avatar: string | null;
}

interface DestroyInTxArgs {
  user: Users.default;
  /**
   * The active transaction the destroy runs inside. `runDestroyInTx` runs the hook
   * within `withTransaction`, so this is always live — passed explicitly so hooks
   * that write more rows (backup restore) don't re-read it from the CLS namespace.
   * Hooks that don't need it (delete-user, wipe-data) can ignore it.
   */
  transaction: Transaction;
}

interface RunUserDestroyLifecycleArgs {
  userId: number;
  /**
   * Caller-owned destroy step. Runs INSIDE the transaction after share targets have been
   * snapshotted, the (optional) creator-snapshot stamp has run, and cross-user transfers
   * have been converted. Delete-user destroys the Users row; wipe-data runs a sequence of
   * per-table destroys + a Users.update.
   */
  destroyInTx: (args: DestroyInTxArgs) => Promise<void>;
  /**
   * Optional caller-owned step that runs OUTSIDE the transaction, BEFORE the notification
   * fan-out. Used by delete-user to drop the corresponding `ba_user` row from the separate
   * better-auth Postgres pool — it must not share the app DB transaction.
   */
  postTxBeforeFanOut?: (args: { ownerSnapshot: OwnerSnapshot }) => Promise<void>;
  /**
   * When true, runs `stampCreatorSnapshotForOutboundTransactions` in-tx before the destroy.
   * Needed by delete-user so the user's transactions on OTHER users' shared accounts keep
   * a creator label after `Transactions.userId` is SET NULL by the cascade. Wipe-data
   * preserves the Users row so the FK stays live — no snapshot needed.
   */
  stampCreatorSnapshot?: boolean;
  /** Disambiguates Redis cleanup logs between the two flows ('user-deletion' / 'user-wipe'). */
  cacheLogPrefix: string;
  /** Top-level catch's structured log code + message. */
  failureLogCode: string;
  failureLogMessage: string;
}

/**
 * Shared lifecycle for "this user is going away" flows. Two callers today:
 *   1. delete-user — destroys the Users row, deletes the ba_user row post-tx.
 *   2. wipe-user-data — keeps Users + ba_user, runs ~17 manual per-table destroys.
 *
 * Both share the same surrounding structure: pre-tx best-effort cleanup (BullMQ + Redis),
 * an in-tx spine that snapshots share targets + converts cross-user transfers + invokes
 * the caller's destroyInTx, and a post-tx fan-out that notifies anyone who lost access to
 * a resource this user owned or hosted.
 *
 * Notification helpers + their snapshots live here too — both flows produce the same
 * `share_owner_account_deleted` / `household_revoked` / `household_member_account_deleted`
 * notifications from the recipient's POV, so the helper names use the neutral "destroy"
 * framing rather than "delete".
 *
 * Returns `true` when the in-tx destroy hook actually ran, `false` when the user row
 * had already vanished (a concurrent delete from another session) so the hook was
 * skipped. Callers that wrote data inside the hook (backup restore) must treat `false`
 * as a failure; wipe-data can ignore it.
 */
export const runUserDestroyLifecycle = async ({
  userId,
  destroyInTx,
  postTxBeforeFanOut,
  stampCreatorSnapshot = false,
  cacheLogPrefix,
  failureLogCode,
  failureLogMessage,
}: RunUserDestroyLifecycleArgs): Promise<boolean> => {
  try {
    // 1. BullMQ pending sync jobs — waiting/delayed only. Active jobs hold their lock and
    //    finish on their own; they reference accountIds that may be gone by then, but the
    //    workers handle the missing-row case gracefully.
    await removePendingJobsForUser({ userId });

    // 2. Redis caches keyed by userId / accountId. Pre-tx so a Redis brownout doesn't roll
    //    back the destroy; cache rebuilds on next read regardless.
    const cache = new CacheClient({ logPrefix: cacheLogPrefix });
    await cache.delete(buildRefAmountCachePattern({ userId }), true);
    await cache.delete(SYNC_REDIS_KEYS.userLastAutoSync(userId));

    const accounts = await Accounts.default.findAll({
      where: { userId },
      attributes: ['id'],
      raw: true,
    });
    await Promise.all(accounts.map((account) => clearAccountSyncStatus(account.id)));

    // 3. In-tx spine + caller's destroyInTx. Returns null when the user vanished between
    //    the route auth and the tx (concurrent delete from another session).
    const txResult = await runDestroyInTx({ userId, destroyInTx, stampCreatorSnapshot });
    if (!txResult) return false;

    const { notificationTargets, householdRevokedTargets, householdOwnerNotifyTargets, ownerSnapshot } = txResult;

    // 4. Caller-specific post-commit hook (e.g. better-auth row cleanup). Runs before the
    //    fan-out so a hook failure doesn't leave half-sent notifications.
    if (postTxBeforeFanOut) {
      await postTxBeforeFanOut({ ownerSnapshot });
    }

    // 5. Post-commit fan-out. Each fan-out function swallows per-recipient errors via
    //    `fanOutNotifications`; the destroy has already committed, so notify failures are
    //    best-effort.
    if (notificationTargets.length > 0) {
      await fanOutAccountDeleteNotifications({ targets: notificationTargets, ownerSnapshot });
    }
    if (householdRevokedTargets.length > 0) {
      await fanOutHouseholdRevokedNotifications({ targets: householdRevokedTargets, ownerSnapshot });
    }
    if (householdOwnerNotifyTargets.length > 0) {
      await fanOutHouseholdMemberDeletedNotifications({
        targets: householdOwnerNotifyTargets,
        memberSnapshot: ownerSnapshot,
      });
    }

    return true;
  } catch (e) {
    logger.error({ message: failureLogMessage, error: e as Error }, { code: failureLogCode, userId });
    throw e;
  }
};

interface DestroyInTxResult {
  notificationTargets: AccountDeleteNotificationTarget[];
  householdRevokedTargets: HouseholdRevokedTarget[];
  householdOwnerNotifyTargets: HouseholdOwnerNotifyTarget[];
  ownerSnapshot: OwnerSnapshot;
}

const runDestroyInTx = withTransaction(
  async ({
    userId,
    destroyInTx,
    stampCreatorSnapshot,
  }: {
    userId: number;
    destroyInTx: (args: DestroyInTxArgs) => Promise<void>;
    stampCreatorSnapshot: boolean;
  }): Promise<DestroyInTxResult | null> => {
    const user = await Users.default.findByPk(userId);
    if (!user) return null;

    // Snapshot share recipients BEFORE the destroy. The post-commit fan-out emits
    // notifications about resources that may not exist anymore by then; collecting after
    // would find nothing.
    const [notificationTargets, householdRevokedTargets, householdOwnerNotifyTargets] = await Promise.all([
      collectAccountDeleteNotificationTargets({ deletingUser: user }),
      collectHouseholdRevokedTargets({ deletingUser: user }),
      collectHouseholdOwnerNotifyTargets({ deletingUser: user }),
    ]);

    if (stampCreatorSnapshot) {
      await stampCreatorSnapshotForOutboundTransactions({ deletingUser: user });
    }

    // Convert cross-user transfer pairs before the destroy. Each pair has one leg on a
    // this-user account and the partner leg on a recipient-user account; without this
    // step the partner is left with a dangling `transferId` pointing at the now-gone
    // leg. Guarded on empty since a user with no accounts has no pairs to convert.
    const userOwnedAccountRows = (await Accounts.default.findAll({
      where: { userId },
      attributes: ['id'],
      raw: true,
    })) as Array<{ id: string }>;
    if (userOwnedAccountRows.length) {
      await convertCrossUserTransfersForAccountIds({
        accountIds: userOwnedAccountRows.map((row) => row.id),
        ownerUserId: userId,
      });
    }

    // Snapshot owner identity BEFORE the destroy — for delete-user the row is about to
    // disappear, for wipe-data the row stays but `defaultCategoryId` may flip to null.
    const ownerSnapshot: OwnerSnapshot = {
      id: user.id,
      username: user.username,
      avatar: user.avatar ?? null,
    };

    // Active transaction established by the surrounding `withTransaction`. Passed to
    // the hook so callers that write more rows use the same transaction directly.
    const transaction = namespace.get('transaction') as Transaction;
    await destroyInTx({ user, transaction });

    // The destroy removed this user's currency holdings. A custom currency nobody holds any more
    // goes with them, and one another user still holds stops naming this user as its creator.
    await pruneUnusedCustomCurrencies();

    return {
      notificationTargets,
      householdRevokedTargets,
      householdOwnerNotifyTargets,
      ownerSnapshot,
    };
  },
);

/**
 * Reads live `ResourceShares` + `Accounts` names while the rows still exist. The returned
 * snapshots are consumed post-commit, by which time those rows may be gone — the snapshot
 * is the only durable record of who needs notifying.
 */
async function collectAccountDeleteNotificationTargets({
  deletingUser,
}: {
  deletingUser: Users.default;
}): Promise<AccountDeleteNotificationTarget[]> {
  const shares = (await ResourceShares.findAll({
    where: { ownerUserId: deletingUser.id, resourceType: RESOURCE_TYPES.account },
    attributes: ['id', 'sharedWithUserId', 'resourceId', 'permission'],
    raw: true,
  })) as unknown as Array<{
    id: RecordId;
    sharedWithUserId: number;
    resourceId: RecordId;
    permission: SharePermission;
  }>;

  if (shares.length === 0) return [];

  const accountIds = [...new Set(shares.map((s) => s.resourceId))];
  const accountRows = (await Accounts.default.findAll({
    where: { id: { [Op.in]: accountIds } },
    attributes: ['id', 'name'],
    raw: true,
  })) as Array<{ id: string; name: string }>;
  const namesById = new Map(accountRows.map((a) => [a.id, a.name]));

  return shares.map((share) => ({
    recipientUserId: share.sharedWithUserId,
    shareId: share.id,
    resourceId: share.resourceId,
    resourceName: namesById.get(share.resourceId) ?? 'Shared account',
    permission: share.permission,
  }));
}

/**
 * Households where the deleting user is the OWNER. Each accepted row means a member who
 * will lose household-derived access once the share row goes.
 */
async function collectHouseholdRevokedTargets({
  deletingUser,
}: {
  deletingUser: Users.default;
}): Promise<HouseholdRevokedTarget[]> {
  const rows = (await ResourceShares.findAll({
    where: {
      ownerUserId: deletingUser.id,
      resourceType: RESOURCE_TYPES.household,
      acceptedAt: { [Op.not]: null },
    },
    attributes: ['id', 'sharedWithUserId', 'permission'],
    raw: true,
  })) as Array<{ id: RecordId; sharedWithUserId: number; permission: HouseholdSharePermission }>;

  return rows.map((row) => ({
    recipientUserId: row.sharedWithUserId,
    shareId: row.id,
    permission: row.permission,
  }));
}

/**
 * Households where the deleting user is the MEMBER. The household keeps existing for the
 * rest; the owner gets notified that this specific member is no longer in their household.
 */
async function collectHouseholdOwnerNotifyTargets({
  deletingUser,
}: {
  deletingUser: Users.default;
}): Promise<HouseholdOwnerNotifyTarget[]> {
  const rows = (await ResourceShares.findAll({
    where: {
      sharedWithUserId: deletingUser.id,
      resourceType: RESOURCE_TYPES.household,
      acceptedAt: { [Op.not]: null },
    },
    attributes: ['id', 'ownerUserId'],
    raw: true,
  })) as Array<{ id: RecordId; ownerUserId: number }>;

  return rows.map((row) => ({
    ownerUserId: row.ownerUserId,
    shareId: row.id,
  }));
}

async function fanOutAccountDeleteNotifications({
  targets,
  ownerSnapshot,
}: {
  targets: AccountDeleteNotificationTarget[];
  ownerSnapshot: OwnerSnapshot;
}) {
  // notify* helpers expect a `Users` instance; the row may already be gone by now, so wrap
  // the snapshot in the minimal shape they actually read (id / username / avatar only).
  const ownerLike = ownerSnapshot as unknown as Users.default;
  await fanOutNotifications({
    targets,
    notify: (target) =>
      notifyShareOwnerAccountDeleted({
        recipientUserId: target.recipientUserId,
        owner: ownerLike,
        shareId: target.shareId,
        resource: { type: RESOURCE_TYPES.account, id: target.resourceId, name: target.resourceName },
        permission: target.permission,
      }),
    errorCode: 'SHARE_OWNER_ACCOUNT_DELETED_NOTIFY_FAILED_USER_CASCADE',
    errorMessage: 'Failed to emit share_owner_account_deleted notification during user-delete cascade',
    buildLogContext: (target) => ({
      shareId: target.shareId,
      recipientUserId: target.recipientUserId,
      ownerUserId: ownerSnapshot.id,
    }),
  });
}

async function fanOutHouseholdRevokedNotifications({
  targets,
  ownerSnapshot,
}: {
  targets: HouseholdRevokedTarget[];
  ownerSnapshot: OwnerSnapshot;
}) {
  const ownerLike = ownerSnapshot as unknown as Users.default;
  const resource = {
    type: RESOURCE_TYPES.household,
    id: String(ownerSnapshot.id),
    name: formatHouseholdLabel(ownerSnapshot.username),
  } as const;
  await fanOutNotifications({
    targets,
    notify: (target) =>
      notifyHouseholdRevoked({
        recipientUserId: target.recipientUserId,
        owner: ownerLike,
        shareId: target.shareId,
        resource,
        permission: target.permission,
      }),
    errorCode: 'HOUSEHOLD_REVOKED_NOTIFY_FAILED_USER_CASCADE',
    errorMessage: 'Failed to emit household_revoked notification during owner-delete cascade',
    buildLogContext: (target) => ({
      shareId: target.shareId,
      recipientUserId: target.recipientUserId,
      ownerUserId: ownerSnapshot.id,
    }),
  });
}

async function fanOutHouseholdMemberDeletedNotifications({
  targets,
  memberSnapshot,
}: {
  targets: HouseholdOwnerNotifyTarget[];
  memberSnapshot: OwnerSnapshot;
}) {
  await fanOutNotifications({
    targets,
    notify: (target) =>
      notifyHouseholdMemberAccountDeleted({
        ownerUserId: target.ownerUserId,
        memberSnapshot,
        shareId: target.shareId,
        resource: {
          type: RESOURCE_TYPES.household,
          id: String(target.ownerUserId),
          name: 'your household',
        },
      }),
    errorCode: 'HOUSEHOLD_MEMBER_ACCOUNT_DELETED_NOTIFY_FAILED_USER_CASCADE',
    errorMessage: 'Failed to emit household_member_account_deleted notification during member-delete cascade',
    buildLogContext: (target) => ({
      shareId: target.shareId,
      ownerUserId: target.ownerUserId,
      memberUserId: memberSnapshot.id,
    }),
  });
}

/**
 * Stamps `creatorSnapshot` on transactions the deleting user created on accounts owned by
 * someone else (transactions on shared accounts the user has access to). The FK on
 * `Transactions.userId` is `ON DELETE SET NULL`, which would otherwise leave the row
 * anonymous; the snapshot lets the frontend keep rendering the original creator name with
 * a "(deleted)" indicator on the still-existing tx row.
 *
 * Bounded to accounts the user actually has share access to (typically a small set)
 * rather than the global Accounts table.
 */
async function stampCreatorSnapshotForOutboundTransactions({ deletingUser }: { deletingUser: Users.default }) {
  // Two paths into someone else's account:
  //   1. Per-resource share — `ResourceShares{type:account, resourceId:<accountId>}`
  //   2. Household membership — `ResourceShares{type:household, resourceId:<ownerUserId>}`
  //      grants write access to every account the granting user owns.
  // Both must contribute or household-derived txns end up anonymous after the destroy.
  const [perResourceRows, householdRows] = await Promise.all([
    ResourceShares.findAll({
      where: { sharedWithUserId: deletingUser.id, resourceType: RESOURCE_TYPES.account },
      attributes: ['resourceId'],
      raw: true,
    }) as unknown as Promise<Array<{ resourceId: string }>>,
    ResourceShares.findAll({
      where: {
        sharedWithUserId: deletingUser.id,
        resourceType: RESOURCE_TYPES.household,
        acceptedAt: { [Op.not]: null },
      },
      attributes: ['resourceId'],
      raw: true,
    }) as unknown as Promise<Array<{ resourceId: string }>>,
  ]);

  const accessibleAccountIds = new Set<string>();
  for (const row of perResourceRows) {
    if (row.resourceId) accessibleAccountIds.add(row.resourceId);
  }

  // Household shares: resourceId is the granting user's integer userId stored as a string.
  const householdGrantorIds = householdRows
    .map((row) => toPositiveInt(row.resourceId))
    .filter((id): id is number => id !== null);
  if (householdGrantorIds.length > 0) {
    const grantorAccounts = (await Accounts.default.findAll({
      where: { userId: { [Op.in]: householdGrantorIds } },
      attributes: ['id'],
      raw: true,
    })) as Array<{ id: string }>;
    for (const account of grantorAccounts) accessibleAccountIds.add(account.id);
  }

  if (accessibleAccountIds.size === 0) return;

  const snapshot: TransactionCreatorSnapshot = {
    userId: deletingUser.id,
    username: deletingUser.username,
    avatar: deletingUser.avatar ?? null,
  };

  // Total reach: every outbound row the user authored keeps a creator label, plans and
  // balance adjustments included — anything skipped here goes anonymous for good.
  await updateTransactions({
    values: { creatorSnapshot: snapshot },
    where: { accountId: { [Op.in]: Array.from(accessibleAccountIds) } },
    planned: 'include',
    access: { creator: deletingUser.id },
    balanceAdjustments: 'include',
  });
}
