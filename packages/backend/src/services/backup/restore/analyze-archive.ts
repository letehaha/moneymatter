import type { BackupRestoreWarning } from '@bt/shared/types';
import { t } from '@i18n/index';
import Securities from '@models/investments/securities.model';
import { Model, type ModelStatic } from 'sequelize';

import { BACKUP_TABLES } from '../registry';
import type { ParsedArchive } from './load-archive';
import { type AttributeInfo, getModelAttributeInfos } from './model-attributes';

type Row = Record<string, unknown>;
type AnyModel = ModelStatic<Model>;

/** Column plan for one table: which columns to insert, which to drop. */
export interface TableColumnPlan {
  /** Model attributes present in the file — the columns bulkInsert writes. */
  columns: AttributeInfo[];
  /** File keys with no matching model attribute — dropped on insert. */
  droppedColumns: string[];
  /** Required model columns absent from the file — hard-fails the restore. */
  missingRequired: string[];
}

export interface ArchiveAnalysis {
  /** Column plans keyed by data-file / reference base name. */
  plans: Map<string, TableColumnPlan>;
  warnings: BackupRestoreWarning[];
  /** Translated reasons the restore cannot proceed (drives the 422). */
  hardFailReasons: string[];
}

/** Union of keys across every row — the file's effective column set. */
function collectFileColumns({ rows }: { rows: Row[] }): Set<string> {
  const columns = new Set<string>();
  for (const row of rows) {
    for (const key of Object.keys(row)) columns.add(key);
  }
  return columns;
}

/**
 * Column tolerance for one table: intersect the live model's attributes with
 * the file's columns. A model column absent from the file is tolerable when the
 * DB can fill it (nullable / default / serial) and required otherwise; a file
 * column absent from the model is always dropped.
 */
function buildTableColumnPlan({ model, rows }: { model: AnyModel; rows: Row[] }): TableColumnPlan {
  const fileColumns = collectFileColumns({ rows });
  const attributeInfos = getModelAttributeInfos({ model });
  const attrNames = new Set(attributeInfos.map((a) => a.attrName));

  const columns = attributeInfos.filter((a) => fileColumns.has(a.attrName));
  const droppedColumns = [...fileColumns].filter((c) => !attrNames.has(c));
  const missingRequired = attributeInfos
    .filter((a) => !fileColumns.has(a.attrName) && !a.allowNull && !a.hasDefault && !a.autoIncrement)
    .map((a) => a.attrName);

  return { columns, droppedColumns, missingRequired };
}

/**
 * Validate the parsed archive against the live schema and build the per-table
 * insert plans. Collects non-fatal warnings (dropped columns, unknown/absent
 * tables) and hard-fail reasons (a required column the backup can't supply) so
 * the preflight can reject before enqueuing and the worker can reuse the plans.
 */
export function analyzeArchive({ archive }: { archive: ParsedArchive }): ArchiveAnalysis {
  const plans = new Map<string, TableColumnPlan>();
  const warnings: BackupRestoreWarning[] = [];
  const hardFailReasons: string[] = [];

  // Structural sanity before anything downstream can wipe the target. Every real
  // export — even a brand-new all-empty account — writes data/user.json and a
  // manifest that vouches for at least that file. Their absence means the upload
  // is empty or corrupt, so refuse rather than wipe the user down to nothing. An
  // empty transactions/accounts dump is fine here: only the missing user record
  // or empty manifest is the corruption signal, never zero data rows.
  if (!archive.user) {
    hardFailReasons.push(t({ key: 'backup.restore.errors.noUserRecord' }));
  }
  const manifestFiles = archive.manifest?.files;
  const hasManifestFiles =
    !!manifestFiles && typeof manifestFiles === 'object' && Object.keys(manifestFiles).length > 0;
  if (!hasManifestFiles) {
    hardFailReasons.push(t({ key: 'backup.restore.errors.emptyManifest' }));
  }

  const addTablePlan = ({
    key,
    model,
    rows,
    present,
  }: {
    key: string;
    model: AnyModel;
    rows: Row[];
    present: boolean;
  }) => {
    if (!present) {
      warnings.push({ code: 'table_missing_treated_empty', table: key });
      return;
    }
    if (rows.length === 0) {
      plans.set(key, { columns: [], droppedColumns: [], missingRequired: [] });
      return;
    }
    const plan = buildTableColumnPlan({ model, rows });
    plans.set(key, plan);
    if (plan.missingRequired.length > 0) {
      hardFailReasons.push(
        t({
          key: 'backup.restore.errors.missingRequiredColumns',
          variables: { table: key, columns: plan.missingRequired.join(', '), count: plan.missingRequired.length },
        }),
      );
    }
    if (plan.droppedColumns.length > 0) {
      warnings.push({
        code: 'unknown_column_dropped',
        table: key,
        count: plan.droppedColumns.length,
        columns: plan.droppedColumns,
      });
    }
  };

  for (const def of BACKUP_TABLES) {
    if (def.restoreMode !== 'insert') continue;
    addTablePlan({
      key: def.fileName,
      model: def.model,
      rows: archive.data.get(def.fileName) ?? [],
      present: archive.data.has(def.fileName),
    });
  }

  addTablePlan({
    key: 'securities',
    model: Securities,
    rows: archive.reference.securities,
    present: true,
  });

  for (const name of archive.unknownFileNames) {
    warnings.push({ code: 'unknown_table_ignored', table: name });
  }

  return { plans, warnings, hardFailReasons };
}
