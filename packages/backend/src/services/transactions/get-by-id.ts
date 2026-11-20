import { ACCESS_SOURCES, RESOURCE_TYPES, SHARE_PERMISSIONS, SharePermission } from '@bt/shared/types';
import { t } from '@i18n/index';
import { ForbiddenError, NotFoundError } from '@js/errors';
import Accounts from '@models/accounts.model';
import TrackerTransactions from '@models/tracker-transactions.model';
import { findOneTransaction } from '@models/transactions-query';
import * as Transactions from '@models/transactions.model';
import { assertOwnScopeOk } from '@services/sharing/auth/authorize-account-write.service';
import {
  type GrantedAccessResult,
  canUserAccessResource,
} from '@services/sharing/auth/can-user-access-resource.service';
import { getAccessibleTrackerIdsForUser } from '@services/sharing/auth/get-accessible-tracker-ids.service';
import { Includeable, Op } from 'sequelize';

import { withTransaction } from '../common/with-transaction';

interface GetTransactionByIdParams {
  id: string;
  userId: number;
  /** Defaults to `read`. Pass `write` from update/delete callers so the auth check happens once here instead of being re-run in the caller. */
  requiredPermission?: SharePermission;
}

/**
 * Fetch a transaction visible to the caller, paired with the resolved access result.
 *
 * Returns `{ tx, access }` when the caller has at least `requiredPermission` on the
 * transaction's parent account; returns `null` otherwise (so callers can throw a clean
 * 404 with no existence leak). Callers branch on `access.isOwner` and `access.policy`
 * for owner-vs-recipient logic and the `transactionsWriteScope: 'own'` rule, so they
 * don't need to call `canUserAccessResource` themselves.
 *
 * Visibility resolution:
 *   1. Caller authored the row AND owns the parent account → fast path, synthesize
 *      `isOwner: true` with `manage`. Saves a share-table lookup in the common case.
 *   2. Caller authored the row on a *shared* account (parent account belongs to someone
 *      else) → fall through to the share-aware resolver so `ownerUserId` resolves to
 *      the actual account owner. Without this, downstream code that scopes by
 *      `accountOwnerUserId` (category lookup, account currency lookup) would search
 *      under the recipient's userId and miss the owner's rows.
 *   3. Caller did NOT author the row but has an accepted share → granted at the share's
 *      permission level (subject to `requiredPermission`).
 *   4. Anything else → `null` (404 territory).
 */
const findVisibleTransaction = withTransaction(
  async ({
    id,
    userId,
    include,
    requiredPermission = SHARE_PERMISSIONS.read,
  }: GetTransactionByIdParams & { include?: Includeable[] }): Promise<{
    tx: Transactions.default;
    access: GrantedAccessResult;
  } | null> => {
    const authored = await Transactions.getTransactionById({ id, userId, include });
    if (authored) {
      // Verify the parent account also belongs to the caller before synthesizing the
      // owner-fast-path. A recipient who created a tx on a shared account would otherwise
      // be misclassified as "owner of everything", which then makes
      // `accountOwnerUserId === callerUserId` downstream and breaks owner-scoped lookups.
      const parentAccount = (await Accounts.findOne({
        where: { id: authored.accountId },
        attributes: ['userId'],
        raw: true,
      })) as { userId: number } | null;
      if (parentAccount?.userId === userId) {
        return {
          tx: authored,
          access: {
            granted: true,
            isOwner: true,
            effectivePermission: SHARE_PERMISSIONS.manage,
            policy: null,
            ownerUserId: userId,
            accessSource: ACCESS_SOURCES.owner,
          },
        };
      }

      // Caller authored the row on someone else's account — resolve real access info via
      // the share table so `ownerUserId` reflects the actual account owner.
      const access = await canUserAccessResource({
        userId,
        resourceType: RESOURCE_TYPES.account,
        resourceId: authored.accountId,
        requiredPermission,
      });
      if (!access.granted) return null;
      return { tx: authored, access };
    }

    // Caller didn't author the row. Cheap PK lookup first to short-circuit "no such tx"
    // without paying for a share-table query.
    const tx = await findOneTransaction({
      planned: 'include',
      access: 'unscoped-internal',
      balanceAdjustments: 'include',
      where: { id },
      include,
    });
    if (!tx) return null;

    // Planned rows belong to their creator only; nobody reaches them through a share.
    if (tx.isPlanned) return null;

    const access = await canUserAccessResource({
      userId,
      resourceType: RESOURCE_TYPES.account,
      resourceId: tx.accountId,
      requiredPermission,
    });
    if (access.granted) return { tx, access };

    // Tracker-share visibility fallback. The list endpoint already surfaces tx rows that
    // a caller can see only because they accepted a tracker share — keeping the detail
    // endpoint blind to that path made GET /transactions/:id 404 for rows the caller
    // could see in the list, which the dialog's lazy edit-access probe then misread as
    // "unknown" and unlocked the form. Only meaningful for read requests; write paths
    // (`requiredPermission: write`) intentionally don't fall through because tracker
    // share grants read-only access on attached txs.
    if (requiredPermission !== SHARE_PERMISSIONS.read) return null;

    const accessibleTrackerIds = await getAccessibleTrackerIdsForUser({ userId });
    if (!accessibleTrackerIds.length) return null;

    const trackerAttachment = (await TrackerTransactions.findOne({
      where: {
        transactionId: id,
        trackerId: { [Op.in]: accessibleTrackerIds },
      },
      attributes: ['trackerId'],
      raw: true,
    })) as { trackerId: string } | null;
    if (!trackerAttachment) return null;

    const trackerVisibilityAccess: GrantedAccessResult = {
      granted: true,
      isOwner: false,
      effectivePermission: SHARE_PERMISSIONS.read,
      policy: null,
      ownerUserId: access.ownerUserId ?? tx.userId,
      accessSource: ACCESS_SOURCES.tracker,
    };

    return { tx, access: trackerVisibilityAccess };
  },
);

/** Always returns the full transaction shape (tags, splits, groups). */
export const getTransactionById = (params: GetTransactionByIdParams) =>
  findVisibleTransaction({ ...params, include: Transactions.fullTransactionIncludes() });

interface WritableTransactionAuthContext {
  /** Caller owns the parent account. */
  isOwner: boolean;
  /** UserId to scope owner-scoped lookups (account row, category set) against. */
  accountOwnerUserId: number;
  /** Granted access result, in case callers need the policy / permission level. */
  access: GrantedAccessResult;
}

/**
 * One-shot fetch + write-authorization for a transaction. Combines the share-aware lookup,
 * the `transactionsWriteScope: 'own'` policy check, and the owner-userId resolution that
 * every write-path service used to assemble manually. Returns the transaction together
 * with a pre-resolved `{ isOwner, accountOwnerUserId, access }` context — callers no longer
 * need to know that auth is a three-step composition.
 *
 * Throws:
 *   - `NotFoundError` (404) when the row truly doesn't exist.
 *   - `ForbiddenError` (403) when the row exists but the caller has no claim. Tx ids are
 *     UUIDv7 so existence-leak via 403 vs 404 is not a meaningful side channel; surfacing
 *     "not authorized" gives a less confusing UX than the old "tx doesn't exist" message
 *     when a tracker-share recipient tries to edit an owner-only tx (e.g. visible inside
 *     the tracker but on an account they don't have write access to).
 *   - `Unauthorized` (401) when the caller is a recipient on `'own'` scope and didn't
 *     author the row.
 *
 * Phase-1 cross-boundary guards (transfer / refund / changes-account) stay separate via
 * `assertSharedWritePhase1Guards` — those depend on the *operation* (payload), not the
 * fetched row, so they live at the call site.
 */
export const getWritableTransactionById = withTransaction(
  async ({
    id,
    userId,
    include,
  }: {
    id: string;
    userId: number;
    include?: Includeable[];
  }): Promise<{ tx: Transactions.default; ctx: WritableTransactionAuthContext }> => {
    const fetched = await findVisibleTransaction({
      id,
      userId,
      include,
      requiredPermission: SHARE_PERMISSIONS.write,
    });
    if (!fetched) {
      // Distinguish "no such row" (404) from "row exists, no write claim" (403). The
      // share-aware getter above conflates them because the read path wanted them to
      // look identical (F3 existence masking). For UUID-keyed write paths the distinction
      // is the whole UX point — recipients editing an owner-only tx should see "not
      // authorized", not the misleading "transaction doesn't exist".
      const exists = await findOneTransaction({
        planned: 'include',
        access: 'unscoped-internal',
        balanceAdjustments: 'include',
        where: { id },
        attributes: ['id'],
        raw: true,
      });
      if (exists) {
        throw new ForbiddenError({
          message: t({ key: 'transactions.notAuthorizedToEdit' }),
        });
      }
      throw new NotFoundError({ message: t({ key: 'transactions.transactionIdNotExist' }) });
    }
    const { tx, access } = fetched;
    assertOwnScopeOk({ access, callerUserId: userId, txCreatorUserId: tx.userId });
    return {
      tx,
      ctx: {
        isOwner: access.isOwner,
        accountOwnerUserId: access.ownerUserId,
        access,
      },
    };
  },
);
