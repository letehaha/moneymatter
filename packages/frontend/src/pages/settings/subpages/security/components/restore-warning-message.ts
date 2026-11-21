import type { BackupRestoreWarning, BackupRestoreWarningCode } from '@bt/shared/types';

const WARNING_KEYS = {
  shares_skipped: 'settings.security.backup.restore.warnings.sharesSkipped',
  currency_missing: 'settings.security.backup.restore.warnings.currencyMissing',
  unknown_table_ignored: 'settings.security.backup.restore.warnings.unknownTableIgnored',
  unknown_column_dropped: 'settings.security.backup.restore.warnings.unknownColumnDropped',
  table_missing_treated_empty: 'settings.security.backup.restore.warnings.tableMissingTreatedEmpty',
  settings_reset: 'settings.security.backup.restore.warnings.settingsReset',
  fire_settings_reset: 'settings.security.backup.restore.warnings.fireSettingsReset',
  no_settings: 'settings.security.backup.restore.warnings.noSettings',
  foreign_reference_dropped: 'settings.security.backup.restore.warnings.foreignReferenceDropped',
  invalid_row_dropped: 'settings.security.backup.restore.warnings.invalidRowDropped',
  foreign_reference_nulled: 'settings.security.backup.restore.warnings.foreignReferenceNulled',
} satisfies Record<BackupRestoreWarningCode, string>;

const UNKNOWN_WARNING_KEY = 'settings.security.backup.restore.warnings.unknown';

/**
 * i18n key, named params and plural count for one restore warning. A code from a
 * newer backend falls back to a generic key instead of rendering a raw key path.
 */
export function getRestoreWarningMessage({ warning }: { warning: BackupRestoreWarning }): {
  key: string;
  params: Record<string, string | number>;
  plural: number;
} {
  const count = warning.count ?? 1;
  return {
    key: (WARNING_KEYS as Record<string, string>)[warning.code] ?? UNKNOWN_WARNING_KEY,
    params: {
      count,
      table: warning.table ?? '',
      column: warning.column ?? '',
      columns: warning.columns?.join(', ') ?? '',
    },
    plural: count,
  };
}
