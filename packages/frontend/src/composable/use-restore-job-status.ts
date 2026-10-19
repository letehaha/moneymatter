import { getActiveRestoreStatus } from '@/api/backup';
import {
  type BlockingJobWatchdog,
  createBlockingJobWatchdog,
} from '@/composable/blocking-job-watchdog/create-blocking-job-watchdog';
import { i18n } from '@/i18n';
import { queryClient } from '@/lib/query-client';
import { resetQueryCaches } from '@/lib/query-persister';
import { captureException } from '@/lib/sentry';
import { SSE_EVENT_TYPES, type BackupRestoreActiveStatus, type BackupRestoreSseProgress } from '@bt/shared/types';
import { ref } from 'vue';

/**
 * True while the restore dialog is mounted and driving its own progress/summary UI.
 * The app-root overlay and this watchdog's wipe+reload defer to the dialog while it is
 * the active presenter, so nothing double-renders and the summary survives; the dialog
 * clears it on unmount so the watchdog takes over if it disappears mid-restore.
 */
export const restoreDialogPresenting = ref(false);

/**
 * Map the restore worker's live SSE payload onto the watchdog's status shape. The
 * poll endpoint is authoritative (it carries the summary and the phase from the
 * job's persisted progress); this bonus channel just moves the overlay forward
 * between polls. A `completed` push without a summary yet is reported as running so
 * the wipe+reload never fires with an undefined summary — the next poll carries it.
 *
 * Exported for unit tests: it is a pure mapping and each SSE branch is worth pinning.
 */
export function sseToStatus(payload: BackupRestoreSseProgress): BackupRestoreActiveStatus | null {
  const { jobId, status, phase, processedCount, summary } = payload;
  switch (status) {
    case 'queued':
      return { state: 'queued', jobId };
    case 'running':
      return { state: 'running', jobId, phase, insertedRows: processedCount };
    case 'completed':
      return summary ? { state: 'completed', jobId, summary } : { state: 'running', jobId, phase };
    case 'failed':
      // The push's `error` is built in the worker, which has no request locale, so it
      // is English; show the localized generic message instead.
      return { state: 'failed', jobId, error: i18n.global.t('settings.security.backup.restore.failedGeneric') };
    default:
      return null;
  }
}

// Built lazily on first use, not at module top level: this composable and the
// base-currency one both sit in the api ↔ store import cycle, and a second
// synchronous factory call during that cycle runs the factory body before the
// factory module's own `vue` import has initialized (temporal dead zone). Deferring
// to first call means the watchdog is created after the graph has fully loaded.
let watchdog: BlockingJobWatchdog<BackupRestoreActiveStatus> | null = null;

// Singleton, same as the base-currency watchdog: one restore per user, one identical
// blocking overlay on every open screen. A restore wipes and replaces every table, so
// the default terminal side effect (full cache wipe + one reload) is exactly what it
// needs — no override.
function getWatchdog(): BlockingJobWatchdog<BackupRestoreActiveStatus> {
  if (!watchdog) {
    watchdog = createBlockingJobWatchdog<BackupRestoreActiveStatus, typeof SSE_EVENT_TYPES.BACKUP_RESTORE_PROGRESS>({
      scope: 'backup-restore-status',
      handledJobStorageKey: 'backup-restore-handled-job',
      fetchStatus: getActiveRestoreStatus,
      sse: {
        event: SSE_EVENT_TYPES.BACKUP_RESTORE_PROGRESS,
        toStatus: sseToStatus,
      },
      onCompleted: async (status) => {
        if (restoreDialogPresenting.value) {
          // The restore dialog is mounted and owns completion: it shows the summary and
          // reloads only when the user clicks Done. Stand down instead of wiping +
          // reloading out from under that summary; the dialog already marked it handled.
          getWatchdog().stop();
          return;
        }
        // No dialog present (another tab, or the dialog unmounted mid-restore): every
        // cached value was computed against pre-restore data, so wipe all caches and
        // reload once — the only honest repaint.
        await resetQueryCaches(queryClient).catch((error) =>
          captureException({ error, context: { scope: 'backup-restore-status:reset' } }),
        );
        if (status.state === 'completed') getWatchdog().markHandled({ jobId: status.jobId });
        window.location.reload();
      },
    });
  }
  return watchdog;
}

/**
 * Shared watchdog for the data-restore job. On boot (`checkOnBoot`) it blocks the
 * app if a restore is in flight and, if one completed while this device was away,
 * wipes caches and reloads once so nothing acts on the pre-restore dataset. The
 * restore dialog is the rich initiating UI; this watchdog owns the reload / other-
 * tab / closed-tab cases.
 */
export function useRestoreJobStatus() {
  return getWatchdog();
}
