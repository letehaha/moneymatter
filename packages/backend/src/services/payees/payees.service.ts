import {
  CATEGORIZATION_MODE,
  type EntityLogoPayload,
  type PayeeLookupItem,
  RESOURCE_TYPES,
  SHARE_PERMISSIONS,
  type RecordId,
  type TransactionLocation,
} from '@bt/shared/types';
import { t } from '@i18n/index';
import { ConflictError, NotFoundError, ValidationError } from '@js/errors';
import Categories from '@models/categories.model';
import { connection } from '@models/connection';
import PayeeAliases from '@models/payee-aliases.model';
import PayeeTags from '@models/payee-tags.model';
import Payees from '@models/payees.model';
import Subscriptions from '@models/subscriptions.model';
import Tags from '@models/tags.model';
import TransactionTemplates from '@models/transaction-templates.model';
import { updateTransactions } from '@models/transactions-query';
import {
  applyCachedLogos,
  clearManualLogoFields,
  enqueueLogoResolution,
  enqueueLogoResolutionAfterCommit,
  resolveManualLogoFields,
} from '@services/brand-logos';
import { canUserAccessResource } from '@services/sharing/auth/can-user-access-resource.service';
import { pauseAutomationsReferencing, rewriteAutomationRef } from '@services/transaction-automations/references';
import { Op, QueryTypes } from 'sequelize';

import { withTransaction } from '../common/with-transaction';
import { normalizePayeeName } from './normalize-name';
import { ensureAliasExists, parsePayeeName, resolveNormalizedName } from './payee-namespace';
import { getPayeeStatsMap, PayeeStatsRow } from './payee-stats';

const MAX_LIST_LIMIT = 200;
const DEFAULT_LIST_LIMIT = 50;
const AUTOCOMPLETE_LIMIT = 20;

type PayeeSortBy = 'lastSeen' | 'name' | 'netFlow' | 'transactionCount' | 'defaultTagsCount';
type PayeeSortDir = 'asc' | 'desc';

async function assertCategoryOwnedByUser({
  userId,
  categoryId,
}: {
  userId: number;
  categoryId: string;
}): Promise<void> {
  const category = await Categories.findOne({
    where: { id: categoryId, userId },
    attributes: ['id'],
  });
  if (!category) {
    throw new ValidationError({ message: t({ key: 'payees.defaultCategoryNotOwned' }) });
  }
}

async function assertTagsOwnedByUser({ userId, tagIds }: { userId: number; tagIds: string[] }): Promise<void> {
  if (tagIds.length === 0) return;
  const ownedCount = await Tags.count({ where: { id: tagIds, userId } });
  if (ownedCount !== tagIds.length) {
    throw new ValidationError({ message: t({ key: 'payees.defaultTagsNotOwned' }) });
  }
}

/**
 * Lazy-on-read logo backfill for Payees with `logoSource IS NULL`.
 * Stamps `BrandLogos` cache hits onto the in-memory rows so hits surface on
 * THIS request; cache misses are enqueued for async logo.dev resolution.
 */
async function backfillLogosForUnresolved({ payees }: { payees: Payees[] }): Promise<void> {
  const misses = await applyCachedLogos({ entity: 'payee', rows: payees });
  for (const payee of misses) {
    void enqueueLogoResolution({ entity: 'payee', id: payee.id });
  }
}

export async function loadPayeeOrThrow({ userId, id }: { userId: number; id: string }): Promise<Payees> {
  const payee = await Payees.findOne({
    where: { id, userId },
    include: [
      { model: PayeeAliases, as: 'aliases' },
      { model: Tags, as: 'defaultTags', attributes: ['id'], through: { attributes: [] } },
    ],
  });
  if (!payee) {
    throw new NotFoundError({ message: t({ key: 'payees.notFound' }) });
  }
  return payee;
}

interface ListPayeesParams {
  userId: number;
  q?: string;
  limit?: number;
  offset?: number;
  sortBy?: PayeeSortBy;
  sortDir?: PayeeSortDir;
  /**
   * Scope to a single account's owner. On a shared account the recipient
   * sees the owner's payees active on that account, with stats scoped to it
   * so the owner's other accounts never leak; on an owned account it behaves
   * like the no-arg path. Mirrors the categories `?accountId=` pattern so the
   * recipient's transaction-form picker resolves to the same namespace
   * that backend write paths validate against. Stranger `accountId`
   * returns 404 to keep the param from leaking other users' resources.
   */
  accountId?: string;
}

interface PayeeListRow {
  payee: Payees;
  stats: PayeeStatsRow | null;
}

const SORT_COLUMN_BY_KEY: Record<PayeeSortBy, string> = {
  // LOWER() so the alphabetical order is case-insensitive, matching what users
  // expect when they pick "Name" from the sort menu.
  name: 'LOWER(p."name")',
  transactionCount: 's."transactionCount"',
  netFlow: 's."netFlowRefCents"',
  lastSeen: 's."lastSeenAt"',
  // Scalar subquery rather than a join so it cannot multiply the rows the
  // LIMIT/OFFSET pagination counts.
  defaultTagsCount: '(SELECT COUNT(*) FROM "PayeeTags" pt WHERE pt."payeeId" = p.id)',
};

/**
 * List Payees for the user, optionally filtered by autocomplete query `q`
 * (substring match against `normalizedName`).
 *
 * Sorted by the requested column at the SQL layer so pagination is stable
 * across pages. Default is `transactionCount` DESC, which surfaces the most
 * actively used Payees first. Payees with no transactions sort to the end via
 * NULLS LAST regardless of direction.
 *
 * Stats (count, net flow, first/last seen, top category) are computed at query
 * time and joined in-memory. No denormalized counters.
 *
 * The sort aggregate must count the same rows as `getPayeeStats` — real, non-transfer,
 * on accounts not hidden from stats — or the order disagrees with the numbers it sorts.
 */
export const listPayees = withTransaction(
  async ({
    userId,
    q,
    limit = DEFAULT_LIST_LIMIT,
    offset = 0,
    sortBy = 'transactionCount',
    sortDir = 'desc',
    accountId,
  }: ListPayeesParams): Promise<PayeeListRow[]> => {
    let scopedUserId = userId;
    // Only set for a NON-owner recipient scoping to a shared account: their stats
    // must never reach the owner's other (unshared) accounts, so the stats
    // aggregation is pinned to this account. The payee namespace stays the owner's
    // full set — the recipient's transaction-form picker needs to resolve it.
    let statsAccountId: string | undefined;
    if (accountId !== undefined) {
      const access = await canUserAccessResource({
        userId,
        resourceType: RESOURCE_TYPES.account,
        resourceId: accountId,
        requiredPermission: SHARE_PERMISSIONS.read,
      });
      if (!access.granted) {
        throw new NotFoundError({ message: t({ key: 'accounts.accountNotFoundForTransaction' }) });
      }
      scopedUserId = access.isOwner ? userId : access.ownerUserId!;
      if (!access.isOwner) {
        statsAccountId = accountId;
      }
    }

    let effectiveLimit = Math.min(Math.max(limit, 1), MAX_LIST_LIMIT);
    let normalizedQuery: string | null = null;
    if (q && q.trim().length > 0) {
      const normalized = normalizePayeeName({ raw: q.trim() });
      if (normalized.length > 0) {
        normalizedQuery = normalized;
      }
      effectiveLimit = AUTOCOMPLETE_LIMIT;
    }

    const sortColumn = SORT_COLUMN_BY_KEY[sortBy];
    const sortDirSql = sortDir === 'asc' ? 'ASC' : 'DESC';
    // p.id ASC as a tiebreaker keeps the order deterministic across pages
    // when two rows share the same primary sort key.
    const orderBy = `${sortColumn} ${sortDirSql} NULLS LAST, p.id ASC`;
    const nameWhere = normalizedQuery !== null ? 'AND p."normalizedName" LIKE :nameLike' : '';
    // Scoping to a shared account narrows the stats subquery to that account, so the
    // sort keys and shown stats reflect only shared-account activity. The join stays
    // LEFT so the owner's full payee namespace still surfaces (payees unused on the
    // shared account sort last with null stats), which the recipient's picker needs.
    const accountFilter = statsAccountId !== undefined ? 'AND t."accountId" = :statsAccountId' : '';

    const idRows: { id: string }[] = await connection.sequelize.query(
      `
      SELECT p.id
        FROM "Payees" p
        LEFT JOIN (
          SELECT t."payeeId",
                 COUNT(*) AS "transactionCount",
                 SUM(
                   CASE WHEN t."transactionType" = 'expense'
                        THEN -t."refAmount"
                        ELSE t."refAmount"
                   END
                 ) AS "netFlowRefCents",
                 MAX(t."time") AS "lastSeenAt"
            FROM real_transactions t
            JOIN "Accounts" a ON a.id = t."accountId"
           WHERE t."userId" = :scopedUserId
             AND t."transferNature" = 'not_transfer'
             AND a."excludeFromStats" = false
             ${accountFilter}
             AND (t."externalData" IS NULL OR NOT (t."externalData" @> '{"balanceAdjustment": true}'))
           GROUP BY t."payeeId"
        ) s ON s."payeeId" = p.id
       WHERE p."userId" = :scopedUserId
         ${nameWhere}
       ORDER BY ${orderBy}
       LIMIT :limit OFFSET :offset
      `,
      {
        type: QueryTypes.SELECT,
        replacements: {
          scopedUserId,
          statsAccountId: statsAccountId ?? null,
          nameLike: normalizedQuery !== null ? `%${normalizedQuery}%` : null,
          limit: effectiveLimit,
          offset,
        },
      },
    );

    if (idRows.length === 0) return [];

    const ids = idRows.map((r) => r.id);

    const [payees, statsMap] = await Promise.all([
      Payees.findAll({
        where: { id: { [Op.in]: ids } },
        include: [
          { model: PayeeAliases, as: 'aliases' },
          { model: Tags, as: 'defaultTags', attributes: ['id'], through: { attributes: [] } },
        ],
      }),
      getPayeeStatsMap({ userId: scopedUserId, payeeIds: ids, accountId: statsAccountId }),
    ]);

    const payeesById = new Map<string, Payees>(payees.map((p) => [p.id, p]));

    await backfillLogosForUnresolved({ payees });

    // Preserve the SQL-driven order – `findAll` returns rows in PK order, not
    // in our sort order, so re-project through the id list.
    return ids
      .map((id) => {
        const payee = payeesById.get(id);
        if (!payee) return null;
        return { payee, stats: statsMap.get(id) ?? null };
      })
      .filter((row): row is PayeeListRow => row !== null);
  },
);

/**
 * All of the user's payees as a minimal {id, name, logo fields} projection,
 * ordered by name. No stats and no limit, so the transaction table's
 * beneficiary column can resolve any payee id regardless of how many the
 * user has.
 */
export const getPayeesLookup = async ({ userId }: { userId: number }): Promise<PayeeLookupItem[]> => {
  const payees = await Payees.findAll({
    where: { userId },
    attributes: ['id', 'name', 'logoDomain', 'logoInitials', 'logoColor'],
    order: [['name', 'ASC']],
  });
  return payees.map((payee) => ({
    id: payee.id,
    name: payee.name,
    logoDomain: payee.logoDomain,
    logoInitials: payee.logoInitials,
    logoColor: payee.logoColor,
  }));
};

/**
 * Add-only attach of default tags to a Payee's rule – never removes existing
 * rows; duplicates are skipped via the `PayeeTags` composite PK. Full
 * replacement of the rule goes through `payee.$set('defaultTags', ...)` in
 * `updatePayee` instead.
 */
const addPayeeTags = async ({ payeeId, tagIds }: { payeeId: string; tagIds: string[] }): Promise<void> => {
  if (tagIds.length === 0) return;
  await PayeeTags.bulkCreate(
    tagIds.map((tagId) => ({ payeeId, tagId })),
    { ignoreDuplicates: true },
  );
};

interface CreatePayeeParams extends EntityLogoPayload {
  userId: number;
  name: string;
  defaultCategoryId?: string | null;
  categorizationMode?: CATEGORIZATION_MODE;
  defaultTagIds?: string[];
  defaultLocation?: TransactionLocation | null;
}

export const createPayee = withTransaction(
  async ({
    userId,
    name,
    defaultCategoryId,
    categorizationMode,
    defaultTagIds,
    defaultLocation,
    logoDomain,
    logoInitials,
    logoColor,
  }: CreatePayeeParams): Promise<Payees> => {
    const { display, normalized } = parsePayeeName({ raw: name, emptyMessageKey: 'payees.nameRequired' });

    if (defaultCategoryId) {
      await assertCategoryOwnedByUser({ userId, categoryId: defaultCategoryId });
    }
    if (defaultTagIds && defaultTagIds.length > 0) {
      await assertTagsOwnedByUser({ userId, tagIds: defaultTagIds });
    }

    // A canonical name that collides with an existing alias would shadow that
    // alias in `resolveNormalizedName` (canonical wins), silently re-routing
    // future extractions – so alias hits are rejected too, with a pointer to
    // the owning Payee.
    const hit = await resolveNormalizedName({ userId, normalized });
    if (hit) {
      if (hit.via === 'canonical') {
        throw new ConflictError({ message: t({ key: 'payees.duplicateName' }) });
      }
      throw new ConflictError({
        message: t({ key: 'payees.nameUsedByAliasOfOtherPayee', variables: { name: hit.name } }),
        details: { conflictingPayee: { id: hit.payeeId, name: hit.name } },
      });
    }

    const created = await Payees.create({
      userId,
      name: display,
      normalizedName: normalized,
      defaultCategoryId: defaultCategoryId ?? null,
      categorizationMode: categorizationMode ?? CATEGORIZATION_MODE.enforce,
      defaultLocation: defaultLocation ?? null,
      // A supplied logo value is a manual override (`logoSource: 'manual'` makes
      // the resolver treat it as authoritative); null keys on create change
      // nothing, so they resolve to no writes and the resolver stays in charge.
      ...resolveManualLogoFields({ input: { logoDomain, logoInitials, logoColor } }),
    });
    await addPayeeTags({ payeeId: created.id, tagIds: defaultTagIds ?? [] });
    // Covers both the manual POST /payees route and the YNAB import loop.
    // `createPayee` is `withTransaction`-wrapped, so an ambient transaction is
    // in scope here and the helper defers the enqueue to `afterCommit`; if a
    // future caller invokes it without a transaction, it enqueues directly.
    // Always enqueued: when this Payee was created with a manual logo the
    // resolver reads the committed `logoSource: 'manual'` row and no-ops, so the
    // manual choice is never clobbered.
    enqueueLogoResolutionAfterCommit({ entity: 'payee', id: created.id });
    return loadPayeeOrThrow({ userId, id: created.id });
  },
);

interface GetPayeeParams {
  userId: number;
  id: string;
}

export const getPayee = withTransaction(
  async ({ userId, id }: GetPayeeParams): Promise<{ payee: Payees; stats: PayeeStatsRow | null }> => {
    const payee = await loadPayeeOrThrow({ userId, id });
    const statsMap = await getPayeeStatsMap({ userId, payeeIds: [id] });
    await backfillLogosForUnresolved({ payees: [payee] });
    return { payee, stats: statsMap.get(id) ?? null };
  },
);

interface UpdatePayeeParams extends EntityLogoPayload {
  userId: number;
  id: string;
  name?: string;
  defaultCategoryId?: string | null;
  categorizationMode?: CATEGORIZATION_MODE;
  /** Full replacement of the Payee's default-tag set; `[]` clears the rule. */
  defaultTagIds?: string[];
  defaultLocation?: TransactionLocation | null;
}

/**
 * Rename + default-category change. Renaming preserves the OLD canonical name
 * as an alias so future syncs that match the old string keep linking – this is
 * the contract the extraction pipeline expects.
 *
 * Collisions on `normalizedName` produce a 409 with a hint to merge instead.
 */
export const updatePayee = withTransaction(
  async ({
    userId,
    id,
    name,
    defaultCategoryId,
    categorizationMode,
    defaultTagIds,
    defaultLocation,
    logoDomain,
    logoInitials,
    logoColor,
  }: UpdatePayeeParams): Promise<Payees> => {
    const payee = await loadPayeeOrThrow({ userId, id });

    if (defaultLocation !== undefined) {
      payee.defaultLocation = defaultLocation;
    }

    if (defaultCategoryId === null) {
      payee.defaultCategoryId = null;
    } else if (defaultCategoryId !== undefined) {
      await assertCategoryOwnedByUser({ userId, categoryId: defaultCategoryId });
      payee.defaultCategoryId = defaultCategoryId as RecordId;
    }

    if (categorizationMode !== undefined) {
      payee.categorizationMode = categorizationMode;
    }

    if (defaultTagIds !== undefined) {
      await assertTagsOwnedByUser({ userId, tagIds: defaultTagIds });
      await payee.$set('defaultTags', defaultTagIds);
    }

    if (name !== undefined) {
      const { display, normalized } = parsePayeeName({ raw: name, emptyMessageKey: 'payees.nameRequired' });

      if (normalized !== payee.normalizedName) {
        // Renaming onto a name already in the namespace – another Payee's
        // canonical name OR alias – would make `resolveNormalizedName`
        // ambiguous. A hit on the payee being renamed (one of its own
        // aliases) is fine: canonical + same-payee alias stay consistent.
        const hit = await resolveNormalizedName({ userId, normalized });
        if (hit && hit.payeeId !== id) {
          throw new ConflictError({
            message: t({ key: 'payees.renameCollision' }),
            details: { conflictingPayee: { id: hit.payeeId, name: hit.name } },
          });
        }

        const oldName = payee.name;
        const oldNormalized = payee.normalizedName;
        payee.name = display;
        payee.normalizedName = normalized;

        // Preserve the old canonical name as an alias so historical extractions
        // still match. `ensureAliasExists` is idempotent and race-safe.
        await ensureAliasExists({
          payeeId: id,
          rawName: oldName,
          normalizedName: oldNormalized,
        });
      } else {
        // Same normalized form (e.g. casing-only change) – just stamp the new
        // display name without alias bookkeeping.
        payee.name = display;
      }
    }

    // A logo key that changes a stored value → manual override. All keys absent,
    // or a payload that just re-states the stored values → no writes, so the
    // background resolver keeps ownership of the logo.
    payee.set(
      resolveManualLogoFields({
        input: { logoDomain, logoInitials, logoColor },
        stored: { logoDomain: payee.logoDomain, logoInitials: payee.logoInitials, logoColor: payee.logoColor },
      }),
    );

    await payee.save();
    return loadPayeeOrThrow({ userId, id });
  },
);

interface ResetPayeeLogoParams {
  userId: number;
  id: string;
}

/**
 * Clears the manual logo override so the background resolver can re-run and
 * pick a new domain automatically. Sets all four logo fields to null (logoSource
 * null signals the resolver that this Payee still needs a resolution pass),
 * then schedules resolution to run once the transaction commits rather than
 * waiting for the next lazy backfill. Enqueuing after commit is required: the
 * worker reads the Payee on a separate connection, so enqueuing inside the open
 * transaction races the commit and the worker can still see the stale
 * `logoSource = 'manual'` value, which its guard skips on – leaving the reset
 * payee with no logo and no re-resolution.
 */
export const resetPayeeLogo = withTransaction(async ({ userId, id }: ResetPayeeLogoParams): Promise<Payees> => {
  const payee = await loadPayeeOrThrow({ userId, id });
  clearManualLogoFields({ instance: payee });
  await payee.save();
  enqueueLogoResolutionAfterCommit({ entity: 'payee', id });
  return loadPayeeOrThrow({ userId, id });
});

interface DeletePayeeParams {
  userId: number;
  id: string;
}

export const deletePayee = withTransaction(async ({ userId, id }: DeletePayeeParams): Promise<void> => {
  const payee = await loadPayeeOrThrow({ userId, id });
  await pauseAutomationsReferencing({ userId, refType: 'payee', refId: payee.id, label: payee.name });
  // FK `SET NULL` on `Transactions.payeeId` unlinks transactions automatically.
  // Aliases cascade-delete via FK.
  await Payees.destroy({ where: { id, userId } });
});

interface MergePayeesParams {
  userId: number;
  sourceId: string;
  targetId: string;
}

/**
 * Move all transactions + aliases from source → target, then delete source.
 * Target's `defaultCategoryId` wins silently on conflict.
 */
export const mergePayees = withTransaction(
  async ({ userId, sourceId, targetId }: MergePayeesParams): Promise<Payees> => {
    if (sourceId === targetId) {
      throw new ValidationError({ message: t({ key: 'payees.mergeSelf' }) });
    }
    const [source, target] = await Promise.all([
      loadPayeeOrThrow({ userId, id: sourceId }),
      loadPayeeOrThrow({ userId, id: targetId }),
    ]);

    // Move transactions. Every row on the source has to move, including plans and
    // balance adjustments: the source is deleted below and the FK SET NULL would
    // drop the link instead of transferring it.
    await updateTransactions({
      values: { payeeId: target.id },
      planned: 'include',
      access: { creator: userId },
      balanceAdjustments: 'include',
      where: { payeeId: source.id },
      paranoid: false,
    });

    // Move subscription payee rules and template pre-fills before the source is deleted:
    // the FK SET NULL would otherwise silently drop the reference.
    await Subscriptions.update({ payeeId: target.id }, { where: { userId, payeeId: source.id } });
    await TransactionTemplates.update({ payeeId: target.id }, { where: { userId, payeeId: source.id } });

    await rewriteAutomationRef({ userId, refType: 'payee', from: source.id, to: target.id });

    // `categorizationMeta.payeeId` on previously-categorized rows still points
    // at the source id after merge – accepted as an audit-only dangling
    // reference (mirrors the documented behavior for deletes).

    // Carry the source's canonical name into target as an alias so historic
    // raw-merchant strings still resolve. Track every normalizedName that
    // ends up on the target so the alias-move loop below skips duplicates
    // – including the canonical-name alias we may have just inserted.
    const targetAliasNormalized = new Set((target.aliases ?? []).map((a) => a.normalizedName));
    await ensureAliasExists({
      payeeId: target.id,
      rawName: source.name,
      normalizedName: source.normalizedName,
    });
    targetAliasNormalized.add(source.normalizedName);

    // Move aliases. Source aliases that collide with target aliases on
    // `normalizedName` are skipped (we keep the target's existing one). The
    // source row gets deleted at the end, so its now-orphaned aliases go
    // with it via the FK CASCADE.
    const sourceAliases = source.aliases ?? [];
    for (const alias of sourceAliases) {
      if (targetAliasNormalized.has(alias.normalizedName)) continue;
      if (alias.normalizedName === target.normalizedName) continue;
      await PayeeAliases.update({ payeeId: target.id }, { where: { id: alias.id } });
      targetAliasNormalized.add(alias.normalizedName);
    }

    // Union the source's default tags into the target so the auto-tagging
    // rule survives the merge.
    await addPayeeTags({ payeeId: target.id, tagIds: (source.defaultTags ?? []).map((tag) => tag.id) });

    await Payees.destroy({ where: { id: source.id, userId } });
    return loadPayeeOrThrow({ userId, id: target.id });
  },
);

interface CreatePayeeAliasParams {
  userId: number;
  payeeId: string;
  rawName: string;
}

/**
 * User-curated alias for a Payee. Adding an alias makes the extraction
 * pipeline link future transactions whose raw merchant string normalizes to
 * the same form (exact match in `findExactMatch`) and boosts the fuzzy
 * haystack (`buildHaystack`) so near-variants score above the threshold.
 *
 * Refuses an alias whose normalized form is already in this user's namespace –
 * either on the same Payee (already attached) or on a different Payee (would
 * make the extraction step's exact-match path ambiguous). Cross-Payee conflicts
 * carry the conflicting Payee's id+name in `details.conflictingPayee` so the UI
 * can surface a "Already used by X" hint with a link.
 */
export const createPayeeAlias = withTransaction(
  async ({ userId, payeeId, rawName }: CreatePayeeAliasParams): Promise<Payees> => {
    await loadPayeeOrThrow({ userId, id: payeeId });

    const { display, normalized } = parsePayeeName({ raw: rawName, emptyMessageKey: 'payees.aliasNameRequired' });

    // The alias only adds value when its normalized form isn't already a
    // path to one of this user's Payees – otherwise the insert would break
    // the one-Payee-per-normalizedName invariant `resolveNormalizedName`
    // documents.
    const hit = await resolveNormalizedName({ userId, normalized });
    if (hit) {
      if (hit.payeeId === payeeId) {
        throw new ConflictError({ message: t({ key: 'payees.duplicateAlias' }) });
      }
      throw new ConflictError({
        message: t({ key: 'payees.aliasUsedByOtherPayee', variables: { name: hit.name } }),
        details: { conflictingPayee: { id: hit.payeeId, name: hit.name } },
      });
    }

    await PayeeAliases.create({
      payeeId,
      rawName: display,
      normalizedName: normalized,
    });

    return loadPayeeOrThrow({ userId, id: payeeId });
  },
);

interface DeletePayeeAliasParams {
  userId: number;
  payeeId: string;
  aliasId: string;
}

/**
 * Removes a single alias. Transactions previously linked via that alias keep
 * their `payeeId` – deletion only affects future extraction.
 *
 * Refuses to delete the alias whose normalized form matches the Payee's
 * canonical normalizedName: deletion would leave the Payee with no link to
 * its own name, and the next sync's inline extraction would just re-create
 * the alias via the exact-match path. The user can rename the Payee instead
 * if they want a different canonical form.
 */
export const deletePayeeAlias = withTransaction(
  async ({ userId, payeeId, aliasId }: DeletePayeeAliasParams): Promise<void> => {
    // Authorize through Payees scope.
    const payee = await loadPayeeOrThrow({ userId, id: payeeId });
    const alias = await PayeeAliases.findOne({
      where: { id: aliasId, payeeId },
      attributes: ['id', 'normalizedName'],
    });
    if (!alias) {
      throw new NotFoundError({ message: t({ key: 'payees.aliasNotFound' }) });
    }
    if (alias.normalizedName === payee.normalizedName) {
      throw new ValidationError({ message: t({ key: 'payees.cannotDeleteCanonicalAlias' }) });
    }
    await PayeeAliases.destroy({ where: { id: aliasId, payeeId } });
  },
);

interface BulkUpdateCategorizationModeParams {
  userId: number;
  mode: CATEGORIZATION_MODE;
}

/**
 * "Apply to all" quick action – flips every Payee owned by the user to the
 * same `categorizationMode`. Returns the count actually updated so the UI can
 * surface a precise success toast.
 */
export const bulkUpdateCategorizationMode = withTransaction(
  async ({ userId, mode }: BulkUpdateCategorizationModeParams): Promise<{ updatedCount: number }> => {
    const [updatedCount] = await Payees.update({ categorizationMode: mode }, { where: { userId } });
    return { updatedCount };
  },
);
