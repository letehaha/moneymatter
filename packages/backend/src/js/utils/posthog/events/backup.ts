import { trackEvent } from '../index';

export function trackBackupExported({ userId, sizeBytes }: { userId: string | number; sizeBytes: number }): void {
  trackEvent({
    userId,
    event: 'backup_exported',
    properties: { size_bytes: sizeBytes },
  });
}

/** `false` means data moved between accounts; `null` when either email is unknown. */
export function trackBackupRestored({
  userId,
  sourceIsSameAccount,
  backupExportedAt,
}: {
  userId: string | number;
  sourceIsSameAccount: boolean | null;
  backupExportedAt?: string;
}): void {
  trackEvent({
    userId,
    event: 'backup_restored',
    properties: {
      source_is_same_account: sourceIsSameAccount,
      backup_exported_at: backupExportedAt,
    },
  });
}
