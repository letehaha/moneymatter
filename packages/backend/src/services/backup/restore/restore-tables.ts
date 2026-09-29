import type { BackupRestoreWarning } from '@bt/shared/types';
import { DEACTIVATION_REASON } from '@bt/shared/types';
import Currencies from '@models/currencies.model';
import MerchantCategoryCodes from '@models/merchant-category-codes.model';
import { encryptCredentials } from '@services/bank-data-providers/utils/credential-encryption';
import type { Transaction } from 'sequelize';
import { v7 as uuidv7 } from 'uuid';

import { BACKUP_TABLES, type BackupTableDef } from '../registry';
import type { ArchiveAnalysis, TableColumnPlan } from './analyze-archive';
import { buildInsertRecord, runBulkInsert } from './bulk-insert';
import type { ParsedArchive } from './load-archive';
import {
  type GuardedFk,
  buildGuardedReferenceMap,
  foreignReferenceDroppedMessage,
  foreignReferenceNulledMessage,
  guardRowReferences,
} from './owned-reference-guard';
import { remapEmbeddedReferences } from './remap-embedded-references';

type Row = Record<string, unknown>;

/** Progress tick after each table finishes inserting. */
type TableProgressCallback = (params: { tier: number; table: string; insertedRows: number }) => void | Promise<void>;

interface InsertContext {
  targetUserId: number;
  securitiesRemap: Map<string, string>;
  /** Target MCC id keyed by natural code (compared as strings). */
  mccByCode: Map<string, number>;
  /** Currency codes that exist on the target instance. */
  currencyCodes: Set<string>;
  /** Guarded FK columns per backup file name, derived from model metadata. */
  guardedFkMap: Map<string, GuardedFk[]>;
  /** Per-table backup id → final id map, keyed by DB target table name. A guarded
   *  FK is remapped through the target table's map; a value absent from it is
   *  foreign/forged. */
  insertedIds: Map<string, Map<string, string>>;
  transaction: Transaction;
  warnings: BackupRestoreWarning[];
}

const hasColumn = ({ plan, field }: { plan: TableColumnPlan; field: string }): boolean =>
  plan.columns.some((c) => c.field === field);

/**
 * Delete any restore-target rows that outlived the shared wipe, so this user's
 * own backup ids are free and the keep-if-free inserts below reuse them instead
 * of reminting. `destroyUserOwnedData` keeps the Users row, so tables whose only
 * owner link is `userId` with an ON DELETE CASCADE to Users (Payees,
 * PayeeIgnoredNames, …) are never reached by that wipe and would collide on their
 * primary keys when re-inserted. Delete every `insert`-mode `userColumn` table
 * for this user in reverse tier order (children before parents); each survivor's
 * `viaParent` children (e.g. PayeeAliases/PayeeTags off Payees) go with it via FK
 * cascade. Most rows are already gone via the wipe + cascades, so these are
 * usually no-ops — the pass exists to guarantee emptiness for the stragglers.
 */
export async function purgeUserOwnedRestoreTables({
  userId,
  transaction,
}: {
  userId: number;
  transaction: Transaction;
}): Promise<void> {
  const targets = BACKUP_TABLES.filter(
    (def): def is BackupTableDef & { scope: { strategy: 'userColumn'; column: 'userId' | 'ownerUserId' } } =>
      def.restoreMode === 'insert' && def.scope.strategy === 'userColumn',
  )
    .toSorted((a, b) => b.tier - a.tier)
    .map((def) => ({ model: def.model, column: def.scope.column }));

  for (const { model, column } of targets) {
    // force:true so paranoid models hard-delete instead of leaving soft-deleted rows behind their default scope.
    await model.destroy({ where: { [column]: userId }, transaction, force: true });
  }
}

/**
 * Rewrite one row's remappable columns and decide whether it survives. Returns
 * the overrides to layer onto the insert record, or `null` to drop the row —
 * `null` means only "MCC code missing on this target". The caller tallies the
 * drops into one aggregated warning rather than one per row.
 */
function buildRowOverrides({
  def,
  plan,
  row,
  ctx,
}: {
  def: BackupTableDef;
  plan: TableColumnPlan;
  row: Row;
  ctx: InsertContext;
}): Row | null {
  const overrides: Row = {};

  // userId / ownerUserId → the logged-in target user (constant substitution).
  if (hasColumn({ plan, field: 'userId' })) overrides.userId = ctx.targetUserId;
  if (hasColumn({ plan, field: 'ownerUserId' })) overrides.ownerUserId = ctx.targetUserId;

  // securityId → resolved catalog id (only Holdings + InvestmentTransactions
  // carry it; kept-if-free ids aren't in the map and stay verbatim).
  if (hasColumn({ plan, field: 'securityId' }) && typeof row.securityId === 'string') {
    const resolved = ctx.securitiesRemap.get(row.securityId);
    if (resolved) overrides.securityId = resolved;
  }

  // mccId → target id via the natural code carried on the row. Codes are stored
  // as Postgres strings, so compare as strings. A code absent on the target
  // means the row can't be linked — drop it (the caller aggregates the warning).
  if (def.enrichMccCode && row.mccId != null) {
    const code = row.mccCode != null ? String(row.mccCode) : null;
    const targetMccId = code != null ? ctx.mccByCode.get(code) : undefined;
    if (targetMccId === undefined) return null;
    overrides.mccId = targetMccId;
  }

  // Bank credentials never travel: re-encrypt an empty stub on THIS instance and
  // mark the connection deactivated so it reads as "reconnect required" and is
  // never sync-eligible until the user reconnects. Merge into existing metadata.
  if (def.stripSecret === 'bankCredentials') {
    overrides.credentials = encryptCredentials({});
    overrides.isActive = false;
    const metadata = (row.metadata && typeof row.metadata === 'object' ? row.metadata : {}) as Row;
    overrides.metadata = { ...metadata, deactivationReason: DEACTIVATION_REASON.RESTORED };
  }

  return overrides;
}

/**
 * Insert one `insert`-mode table. A standalone UUID `id` is kept when it's free
 * and reminted when another user's row already holds it; the resulting backup
 * id → final id map drives every reference rewrite. Self-referential tables
 * (Categories.parentId, AccountGroups.parentGroupId) go in two passes: each row
 * inserts with the parent nulled, then a batched UPDATE repoints each child at
 * its parent's final id once all rows exist.
 *
 * Every foreign-key column that targets a user-owned table is remapped to the
 * inserted final id; a value that isn't the restorer's own (a hand-edited archive
 * aiming a child row at another user's row) drops the row when the column is
 * required, or is nulled when it's nullable. Kept ids are recorded so a dropped
 * parent cascades to its children.
 */
async function insertTable({
  def,
  rows,
  plan,
  ctx,
}: {
  def: BackupTableDef;
  rows: Row[];
  plan: TableColumnPlan;
  ctx: InsertContext;
}): Promise<number> {
  if (rows.length === 0) return 0;

  const selfRefColumn = def.selfRefColumn;
  const targetTable = String(def.model.getTableName());
  let ownMap = ctx.insertedIds.get(targetTable);
  if (!ownMap) {
    ownMap = new Map<string, string>();
    ctx.insertedIds.set(targetTable, ownMap);
  }

  // A standalone UUID `id` (IdColumn) can be reminted when another user's row
  // already holds it; composite-PK tables (Holdings, join tables) have no such
  // column and rely on their FK columns being remapped by the guard instead.
  const pkAttrs = def.model.primaryKeyAttributes;
  const hasStandaloneId = pkAttrs.length === 1 && pkAttrs[0] === 'id';

  // Probe which backup ids another row already holds, inside the restore tx.
  // After the wipe only OTHER users' rows survive, so a hit is a real collision.
  // `paranoid: false` so a soft-deleted row still counts as taken — the primary
  // key ignores `deletedAt`, so keeping its id would collide on insert anyway.
  // Chunked so a table with tens of thousands of rows stays under Postgres's
  // bind-parameter cap on a single `id IN (...)`.
  const taken = new Set<string>();
  if (hasStandaloneId) {
    const rowIds = rows
      .map((r) => r.id)
      .filter((id) => id != null)
      .map((id) => String(id));
    const PROBE_CHUNK = 10000;
    for (let i = 0; i < rowIds.length; i += PROBE_CHUNK) {
      const existing = (await def.model.findAll({
        attributes: ['id'],
        where: { id: rowIds.slice(i, i + PROBE_CHUNK) },
        transaction: ctx.transaction,
        paranoid: false,
        raw: true,
      })) as unknown as Array<{ id: string }>;
      for (const e of existing) taken.add(String(e.id));
    }
  }

  // The self-ref column is validated in the second pass, not here — exclude it.
  const guardedFks = (ctx.guardedFkMap.get(def.fileName) ?? []).filter((fk) => fk.attrName !== selfRefColumn);

  const secondPass: Array<{ finalId: string; oldParent: unknown }> = [];
  const records: Row[] = [];

  // Tally dropped rows so each reason becomes one aggregated warning (with a total
  // count) instead of one warning per dropped row.
  let droppedMccCount = 0;
  let droppedCurrencyCount = 0;
  const fkDroppedByColumn = new Map<string, number>();
  const fkNulledByColumn = new Map<string, number>();

  for (const row of rows) {
    const overrides = buildRowOverrides({ def, plan, row, ctx });
    if (overrides === null) {
      droppedMccCount += 1;
      continue;
    }

    // Skip a row whose currency isn't seeded on the target (users-currencies).
    if (def.requireSeededCurrency && !ctx.currencyCodes.has(String(row.currencyCode))) {
      droppedCurrencyCount += 1;
      continue;
    }

    const guard = guardRowReferences({ guardedFks, row, insertedIds: ctx.insertedIds });
    if (!guard.keep) {
      const column = guard.droppedColumn;
      fkDroppedByColumn.set(column, (fkDroppedByColumn.get(column) ?? 0) + 1);
      continue;
    }
    for (const column of guard.nulledColumns) {
      fkNulledByColumn.set(column, (fkNulledByColumn.get(column) ?? 0) + 1);
    }
    Object.assign(overrides, guard.overrides);

    // Keep the backup id when free, else mint a fresh one; record the mapping so
    // this table's FK referrers and the self-ref second pass resolve to it.
    let finalId: string | undefined;
    if (hasStandaloneId && row.id != null) {
      const oldId = String(row.id);
      finalId = taken.has(oldId) ? uuidv7() : oldId;
      ownMap.set(oldId, finalId);
      overrides.id = finalId;
    }

    if (selfRefColumn && row[selfRefColumn] != null && finalId != null) {
      secondPass.push({ finalId, oldParent: row[selfRefColumn] });
      overrides[selfRefColumn] = null;
    }

    records.push(buildInsertRecord({ row, plan, overrides }));
  }

  if (droppedMccCount > 0) {
    ctx.warnings.push({
      code: 'mcc_code_missing',
      table: def.fileName,
      message: `Dropped ${droppedMccCount} user MCC rule(s) whose merchant category code doesn't exist on this instance.`,
      count: droppedMccCount,
    });
  }
  if (droppedCurrencyCount > 0) {
    ctx.warnings.push({
      code: 'currency_missing',
      table: def.fileName,
      message: `Skipped ${droppedCurrencyCount} currency row(s) whose currency isn't available on this instance.`,
      count: droppedCurrencyCount,
    });
  }
  for (const [column, count] of fkDroppedByColumn) {
    ctx.warnings.push({
      code: 'foreign_reference_dropped',
      table: def.fileName,
      message: foreignReferenceDroppedMessage({ table: def.fileName, column, count }),
      count,
    });
  }
  for (const [column, count] of fkNulledByColumn) {
    ctx.warnings.push({
      code: 'foreign_reference_nulled',
      table: def.fileName,
      message: foreignReferenceNulledMessage({ table: def.fileName, column, count }),
      count,
    });
  }

  const inserted = await runBulkInsert({ model: def.model, records, transaction: ctx.transaction });

  if (selfRefColumn && secondPass.length) {
    // Repoint each child at its parent's final id; a parent outside this table's
    // own remapped ids (forged, or dropped upstream) stays null.
    const byParent = new Map<string, string[]>();
    let selfRefNulled = 0;
    for (const { finalId, oldParent } of secondPass) {
      const mappedParent = ownMap.get(String(oldParent));
      if (mappedParent === undefined) {
        selfRefNulled += 1;
        continue;
      }
      const bucket = byParent.get(mappedParent);
      if (bucket) bucket.push(finalId);
      else byParent.set(mappedParent, [finalId]);
    }
    for (const [parent, ids] of byParent) {
      await def.model.update(
        { [selfRefColumn]: parent },
        { where: { id: ids }, transaction: ctx.transaction, paranoid: false },
      );
    }
    if (selfRefNulled > 0) {
      ctx.warnings.push({
        code: 'foreign_reference_nulled',
        table: def.fileName,
        message: foreignReferenceNulledMessage({ table: def.fileName, column: selfRefColumn, count: selfRefNulled }),
        count: selfRefNulled,
      });
    }
  }

  return inserted;
}

/**
 * Insert every `insert`-mode backup table in registry (tier) order inside the
 * caller's transaction, applying the ID remaps. `skip`-mode tables (shares,
 * invitations) are recorded as warnings and not restored. Users (updateUser)
 * and UserSettings (zodSettings) are finalized by the orchestrator, not here.
 */
export async function insertRestoreTables({
  archive,
  analysis,
  targetUserId,
  securitiesRemap,
  transaction,
  onProgress,
}: {
  archive: ParsedArchive;
  analysis: ArchiveAnalysis;
  targetUserId: number;
  securitiesRemap: Map<string, string>;
  transaction: Transaction;
  onProgress?: TableProgressCallback;
}): Promise<{
  insertedByTable: Record<string, number>;
  warnings: BackupRestoreWarning[];
  insertedIds: Map<string, Map<string, string>>;
}> {
  const warnings: BackupRestoreWarning[] = [];
  const insertedByTable: Record<string, number> = {};
  const insertedIds = new Map<string, Map<string, string>>();

  const needsMcc = BACKUP_TABLES.some((d) => d.enrichMccCode && (archive.data.get(d.fileName)?.length ?? 0) > 0);
  const needsCurrency = (archive.data.get('users-currencies')?.length ?? 0) > 0;

  const [mccRows, currencyRows] = await Promise.all([
    needsMcc
      ? (MerchantCategoryCodes.findAll({ attributes: ['id', 'code'], raw: true }) as unknown as Promise<
          Array<{ id: number; code: string | number }>
        >)
      : Promise.resolve<Array<{ id: number; code: string | number }>>([]),
    needsCurrency
      ? (Currencies.findAll({ attributes: ['code'], raw: true }) as unknown as Promise<Array<{ code: string }>>)
      : Promise.resolve<Array<{ code: string }>>([]),
  ]);

  const ctx: InsertContext = {
    targetUserId,
    securitiesRemap,
    mccByCode: new Map(mccRows.map((r) => [String(r.code), r.id])),
    currencyCodes: new Set(currencyRows.map((r) => r.code)),
    guardedFkMap: buildGuardedReferenceMap(),
    insertedIds,
    transaction,
    warnings,
  };

  for (const def of BACKUP_TABLES) {
    if (def.restoreMode === 'skip') {
      const count = archive.data.get(def.fileName)?.length ?? 0;
      // Every backup carries this file even when it's empty — only warn when
      // rows were actually dropped, so a normal restore doesn't show a
      // "skipped 0 rows" warning.
      if (count > 0) {
        warnings.push({
          code: 'shares_skipped',
          table: def.fileName,
          message: `Skipped ${count} "${def.fileName}" row(s): shared resources reference counterpart users that don't exist on this instance.`,
          count,
        });
      }
      continue;
    }
    if (def.restoreMode !== 'insert') continue;

    const rows = archive.data.get(def.fileName) ?? [];
    const plan = analysis.plans.get(def.fileName);
    if (!plan || rows.length === 0) continue;

    const inserted = await insertTable({ def, rows, plan, ctx });
    insertedByTable[def.fileName] = inserted;
    await onProgress?.({ tier: def.tier, table: def.fileName, insertedRows: inserted });
  }

  // Owned ids embedded in JSONB / array columns aren't reachable by the scalar FK
  // remap above and some point across tiers, so rewrite them once every owned map
  // is complete.
  await remapEmbeddedReferences({ archive, insertedIds, transaction });

  return { insertedByTable, warnings, insertedIds };
}
