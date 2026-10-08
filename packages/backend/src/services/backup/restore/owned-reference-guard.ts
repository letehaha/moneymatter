import { BACKUP_TABLES, type BackupFileName } from '../registry';

type Row = Record<string, unknown>;

/**
 * One foreign-key column that must be validated on restore because it points at
 * a user-owned target table. The FK value in the archive is inserted verbatim,
 * so a hand-edited backup can aim it at another user's row — the DB constraint
 * is satisfied by ANY existing row. We only accept a value that belongs to the
 * set of ids actually inserted for the target table during THIS restore.
 */
export interface GuardedFk {
  /** Model-side attribute name — the key the `raw: true` dump uses. */
  attrName: string;
  /** DB column name — the key the insert record / overrides are keyed by. */
  field: string;
  /** DB table name of the referenced user-owned target (`model.getTableName()`). */
  targetTable: string;
  /** Whether the column permits null — decides drop (required) vs. null (nullable). */
  allowNull: boolean;
}

/** Users.defaultCategoryId has no `@ForeignKey` decorator, so Sequelize exposes
 *  no `references` metadata for it. It's written by `restoreUserRow`, not the
 *  table inserts, so it's declared here rather than derived. */
export const USER_ROW_GUARDED_FK: GuardedFk = {
  attrName: 'defaultCategoryId',
  field: 'defaultCategoryId',
  targetTable: 'Categories',
  allowNull: true,
};

/** Normalize a Sequelize `references.model` (a table-name string, or a model /
 *  options object) to the plain table name `getTableName()` returns. */
function resolveReferenceTable({ model }: { model: unknown }): string | null {
  if (typeof model === 'string') return model;
  if (model && typeof model === 'object') {
    const m = model as { tableName?: unknown; getTableName?: () => unknown };
    if (typeof m.getTableName === 'function') return String(m.getTableName());
    if (m.tableName != null) return String(m.tableName);
  }
  return null;
}

/**
 * DB table names of every `insert`-mode backup table — the set of user-owned
 * restore targets a FK may legitimately reference. Self-deriving from the
 * registry, so it naturally excludes the global catalogs (Users, Currencies,
 * Securities, MerchantCategoryCodes, …): FKs to those are never guarded.
 */
function getOwnedTargetTableNames(): Set<string> {
  const names = new Set<string>();
  for (const def of BACKUP_TABLES) {
    if (def.restoreMode === 'insert') names.add(String(def.model.getTableName()));
  }
  return names;
}

/**
 * The guarded FK columns for one `insert`-mode table: every attribute whose
 * `references` targets a user-owned table, PLUS the registry `selfRefColumn`
 * (Categories.parentId carries no `@ForeignKey`, so it only surfaces here).
 * `ownedTargets` is passed in so the map is built once per restore.
 */
function getGuardedFksForFileName({
  fileName,
  ownedTargets,
}: {
  fileName: BackupFileName;
  ownedTargets: Set<string>;
}): GuardedFk[] {
  const def = BACKUP_TABLES.find((d) => d.fileName === fileName);
  if (!def) return [];

  const attrs = def.model.getAttributes();
  const guarded: GuardedFk[] = [];
  const seen = new Set<string>();

  for (const [attrName, raw] of Object.entries(attrs)) {
    const d = raw as { field?: string; allowNull?: boolean; references?: { model?: unknown } };
    if (!d.references) continue;
    const targetTable = resolveReferenceTable({ model: d.references.model });
    if (!targetTable || !ownedTargets.has(targetTable)) continue;
    guarded.push({ attrName, field: d.field ?? attrName, targetTable, allowNull: d.allowNull !== false });
    seen.add(attrName);
  }

  // Self-ref parent (Categories.parentId, AccountGroups.parentGroupId): the target
  // is the table itself. AccountGroups.parentGroupId also carries `references`, so
  // dedupe; Categories.parentId is metadata-invisible and only added here.
  if (def.selfRefColumn && !seen.has(def.selfRefColumn)) {
    const selfAttr = attrs[def.selfRefColumn] as { field?: string; allowNull?: boolean } | undefined;
    guarded.push({
      attrName: def.selfRefColumn,
      field: selfAttr?.field ?? def.selfRefColumn,
      targetTable: String(def.model.getTableName()),
      allowNull: selfAttr ? selfAttr.allowNull !== false : true,
    });
  }

  return guarded;
}

/**
 * Guarded FK columns for every `insert`-mode table, keyed by backup file name.
 * Built once per restore from live model metadata; the drift-guard unit test
 * asserts it matches the authoritative user-owned FK list.
 */
export function buildGuardedReferenceMap(): Map<BackupFileName, GuardedFk[]> {
  const ownedTargets = getOwnedTargetTableNames();
  const map = new Map<BackupFileName, GuardedFk[]>();
  for (const def of BACKUP_TABLES) {
    if (def.restoreMode !== 'insert') continue;
    map.set(def.fileName, getGuardedFksForFileName({ fileName: def.fileName, ownedTargets }));
  }
  return map;
}

/** English warning text a restore surfaces when a foreign reference is dropped
 *  (the whole row) or nulled (one column). Rendered verbatim by the frontend. */
export function foreignReferenceDroppedMessage({
  table,
  column,
  count,
}: {
  table: string;
  column: string;
  count: number;
}): string {
  return `Dropped ${count} row(s) from "${table}" whose "${column}" referenced data outside this backup.`;
}

export function foreignReferenceNulledMessage({
  table,
  column,
  count,
}: {
  table: string;
  column: string;
  count: number;
}): string {
  return `Cleared "${column}" on ${count} row(s) in "${table}" that referenced data outside this backup.`;
}

type GuardRowResult =
  | {
      keep: true;
      /** Attribute names of nullable FKs that were reset to null on a kept row. */
      nulledColumns: string[];
      /** Column overrides (keyed by DB field): the remapped final id for each kept
       *  FK, plus null for each foreign nullable FK. */
      overrides: Row;
    }
  | {
      keep: false;
      /** Attribute name of the required FK that forced the whole row to drop. */
      droppedColumn: string;
    };

/**
 * Remap one row's guarded FKs through the ids inserted so far. Each target
 * table's map is backup id → final id for the restorer's own rows from this same
 * archive, so a kept FK is rewritten to its final id (equal to the old id when
 * that id was kept). A value absent from the target map is foreign/forged: it
 * drops the row on a required column, or is reset to null on a nullable one. Null
 * values are fine. `insertedIds` is keyed by DB table name; the caller passes the
 * guarded FK set for this table (self-ref columns handled in the second pass).
 */
export function guardRowReferences({
  guardedFks,
  row,
  insertedIds,
}: {
  guardedFks: GuardedFk[];
  row: Row;
  insertedIds: Map<string, Map<string, string>>;
}): GuardRowResult {
  const overrides: Row = {};
  const nulledColumns: string[] = [];

  for (const fk of guardedFks) {
    const value = row[fk.attrName];
    if (value == null) continue;

    const mapped = insertedIds.get(fk.targetTable)?.get(String(value));
    if (mapped !== undefined) {
      overrides[fk.field] = mapped;
      continue;
    }

    if (!fk.allowNull) {
      // A single required foreign FK is enough to drop the whole row; attribute
      // the drop to the first offender so each dropped row is counted once.
      return { keep: false, droppedColumn: fk.attrName };
    }
    overrides[fk.field] = null;
    nulledColumns.push(fk.attrName);
  }

  return { keep: true, nulledColumns, overrides };
}
