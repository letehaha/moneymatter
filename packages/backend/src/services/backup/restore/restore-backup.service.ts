import type { BackupRestoreProgress, BackupRestoreSummary, BackupRestoreWarning } from '@bt/shared/types';
import { logger } from '@js/utils/logger';
import { trackBackupRestored } from '@js/utils/posthog';
import UserSettings, { type SettingsSchema, ZodSettingsSchema } from '@models/user-settings.model';
import Users from '@models/users.model';
import { unifyAiConnections } from '@root/migrations/utils/unify-ai-connections';
import { runUserDestroyLifecycle } from '@services/user/user-destroy-lifecycle';
import { destroyUserOwnedData } from '@services/user/wipe-user-data.service';

import { stripConnectionKeys } from '../dump-tables.service';
import { BACKUP_TABLES } from '../registry';
import { type ParsedArchive } from './load-archive';
import { loadValidatedArchive } from './load-validated-archive';
import { USER_ROW_GUARDED_FK, foreignReferenceNulledMessage } from './owned-reference-guard';
import { triggerPostRestorePriceSync } from './post-restore-price-sync';
import { remapFireSettingsIds, remapSavedPivotViewIds } from './remap-embedded-references';
import { resolveSecurities } from './resolve-securities';
import { insertRestoreTables } from './restore-tables';

type Row = Record<string, unknown>;
type ProgressCallback = (progress: BackupRestoreProgress) => void | Promise<void>;

const USER_RESTORE_DEF = BACKUP_TABLES.find((def) => def.restoreMode === 'updateUser');
if (!USER_RESTORE_DEF?.fields) {
  // A missing def / empty field list would silently restore zero user fields.
  throw new Error('Backup registry misconfig: the updateUser table def is missing or has no restorable fields.');
}
const USER_RESTORE_FIELDS = USER_RESTORE_DEF.fields;

/** UPDATE the target Users row with the tier-1 restorable fields only. Identity
 *  (id/username/authUserId/role) is never touched. Category UUIDs may be
 *  reminted on restore, so `defaultCategoryId` is remapped to the category's
 *  final id; a value that isn't one of this restore's categories (forged or
 *  foreign) is nulled with a warning. */
async function restoreUserRow({
  archive,
  user,
  categoriesMap,
  warnings,
}: {
  archive: ParsedArchive;
  user: Users;
  categoriesMap: Map<string, string>;
  warnings: BackupRestoreWarning[];
}): Promise<void> {
  const src = archive.user;
  if (!src) return;
  const update: Row = {};
  for (const field of USER_RESTORE_FIELDS) {
    if (field in src) update[field] = src[field];
  }

  const defaultCategoryId = update[USER_ROW_GUARDED_FK.attrName];
  if (defaultCategoryId != null) {
    const mapped = categoriesMap.get(String(defaultCategoryId));
    if (mapped === undefined) {
      update[USER_ROW_GUARDED_FK.attrName] = null;
      warnings.push({
        code: 'foreign_reference_nulled',
        table: 'user',
        message: foreignReferenceNulledMessage({ table: 'user', column: USER_ROW_GUARDED_FK.attrName, count: 1 }),
        count: 1,
      });
    } else {
      update[USER_ROW_GUARDED_FK.attrName] = mapped;
    }
  }

  if (Object.keys(update).length > 0) {
    await Users.update(update, { where: { id: user.id } });
  }
}

/** Recreate the user's settings row through the Zod schema (never a raw JSONB
 *  write) so a drifted blob is normalized/defaulted instead of restored blind.
 *  The wipe step already removed the old row in this transaction, so a settings
 *  row is always written here — falling back to schema defaults (with a warning)
 *  when the backup has none or its blob no longer validates, rather than leaving
 *  the user without any settings or failing the whole restore. */
async function upsertUserSettings({
  archive,
  userId,
  insertedIds,
  warnings,
}: {
  archive: ParsedArchive;
  userId: number;
  insertedIds: Map<string, Map<string, string>>;
  warnings: BackupRestoreWarning[];
}): Promise<void> {
  const rows = archive.data.get('user-settings') ?? [];
  const src = rows[0];

  if (!src || src.settings == null) {
    warnings.push({
      code: 'no_settings',
      table: 'user-settings',
      message: 'Backup had no saved settings; defaults were applied.',
    });
    await UserSettings.create({ userId, settings: ZodSettingsSchema.parse({}) });
    return;
  }

  // Legacy archives (API keys, custom endpoints) convert exactly like the DB rows did. Keys
  // are stripped here too, so a hand-edited archive can't bring ciphertext in.
  const settings = stripConnectionKeys({ settings: unifyAiConnections({ settings: src.settings }) });
  const parsed = ZodSettingsSchema.safeParse(settings);
  const restored = parsed.success ? parsed : ZodSettingsSchema.omit({ fire: true }).safeParse(settings);
  if (!restored.success) {
    logger.warn('Backup restore: settings failed schema and were reset', { userId, issues: restored.error.issues });
    // A backup taken across a settings-schema change can carry a blob the current
    // schema rejects. Reset to defaults and warn rather than aborting an otherwise
    // valid restore over a non-critical field.
    warnings.push({
      code: 'settings_reset',
      table: 'user-settings',
      message: 'Saved settings did not match the current schema and were reset to defaults.',
    });
    await UserSettings.create({ userId, settings: ZodSettingsSchema.parse({}) });
    return;
  }

  if (!parsed.success) {
    logger.warn('Backup restore: FIRE settings failed schema and were reset', { userId, issues: parsed.error.issues });
    warnings.push({
      code: 'fire_settings_reset',
      table: 'user-settings',
      message: 'Saved FIRE settings did not match the current schema and were reset to defaults.',
    });
  }
  const restoredSettings: SettingsSchema = restored.data;

  // Category/account/payee/portfolio UUIDs may be reminted on restore, so rewrite the
  // ids saved inside Pivot views and the FIRE slice before persisting the settings blob.
  remapSavedPivotViewIds({ views: restoredSettings.savedPivotViews, insertedIds });
  remapFireSettingsIds({ fire: restoredSettings.fire, insertedIds });

  await UserSettings.create({ userId, settings: restoredSettings });
}

/**
 * Restore a user's lossless backup, replacing all of their current data. The
 * securities catalog is resolved/created first, outside the transaction (global,
 * idempotent). Everything the user owns is then wiped and reinserted inside ONE
 * transaction via `runUserDestroyLifecycle`'s in-tx hook, so any failure rolls
 * back to the exact pre-restore state and the destroy's share-revocation
 * notifications still fan out on success.
 */
export async function restoreUserBackup({
  userId,
  fileContent,
  onProgress,
}: {
  userId: number;
  fileContent: string;
  onProgress?: ProgressCallback;
}): Promise<BackupRestoreSummary> {
  await onProgress?.({ phase: 'validating' });
  const { archive, analysis } = await loadValidatedArchive({ fileContent });

  await onProgress?.({ phase: 'preparing-securities' });
  const securities = await resolveSecurities({ archive, analysis });

  const insertedByTable: Record<string, number> = { ...securities.insertedByTable };
  const warnings = [...analysis.warnings];

  await onProgress?.({ phase: 'wiping' });
  const destroyRan = await runUserDestroyLifecycle({
    userId,
    cacheLogPrefix: 'backup-restore',
    failureLogCode: 'BACKUP_RESTORE_FAILED',
    failureLogMessage: 'Backup restore failed',
    destroyInTx: async ({ user, transaction }) => {
      await destroyUserOwnedData({ user });

      const tableResult = await insertRestoreTables({
        archive,
        analysis,
        targetUserId: user.id,
        securitiesRemap: securities.remap,
        transaction,
        onProgress: ({ tier, table, insertedRows }) => onProgress?.({ phase: 'restoring', tier, table, insertedRows }),
      });
      Object.assign(insertedByTable, tableResult.insertedByTable);
      warnings.push(...tableResult.warnings);

      const categoriesMap = tableResult.insertedIds.get(USER_ROW_GUARDED_FK.targetTable) ?? new Map<string, string>();
      await restoreUserRow({ archive, user, categoriesMap, warnings });
      await upsertUserSettings({ archive, userId: user.id, insertedIds: tableResult.insertedIds, warnings });
    },
  });

  // The destroy lifecycle skips its in-tx hook (where every owner-scoped write
  // happens) when the target user row vanished mid-restore, returning cleanly. A
  // successful-looking resolve with nothing written would report bogus securities
  // counts, so fail loudly instead.
  if (!destroyRan) {
    throw new Error('Backup restore aborted: target user no longer exists.');
  }

  await onProgress?.({ phase: 'finalizing' });

  // Self-host only: backfill historical prices for the restored securities now
  // that the restore transaction has committed. `runUserDestroyLifecycle` scopes
  // and commits its own transaction internally, and `restoreUserBackup` runs with
  // no ambient transaction (the BullMQ worker calls it directly), so each
  // fire-and-forget `syncHistoricalPrices` opens its own fresh transaction rather
  // than joining a committed one.
  triggerPostRestorePriceSync({ securityIds: securities.resolvedSecurityIds });

  trackBackupRestored({
    userId,
    sourceUsername: archive.manifest.user?.username,
    sourceEmail: archive.manifest.user?.email,
    backupExportedAt: archive.manifest.exportedAt,
  });

  return { insertedByTable, warnings };
}
