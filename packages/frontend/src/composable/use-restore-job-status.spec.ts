import type { BackupRestoreActiveStatus, BackupRestoreSseProgress } from '@bt/shared/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { getStatusMock, resetQueryCachesMock, captureExceptionMock, sseOnMock, reloadMock } = vi.hoisted(() => ({
  getStatusMock: vi.fn(),
  resetQueryCachesMock: vi.fn(),
  captureExceptionMock: vi.fn(),
  sseOnMock: vi.fn(),
  reloadMock: vi.fn(),
}));

vi.mock('@/api/backup', () => ({ getActiveRestoreStatus: getStatusMock }));
vi.mock('@/lib/query-persister', () => ({ resetQueryCaches: resetQueryCachesMock }));
vi.mock('@/lib/query-client', () => ({ queryClient: {} }));
vi.mock('@/lib/sentry', () => ({ captureException: captureExceptionMock }));
vi.mock('@/composable/use-sse', () => ({ useSSE: () => ({ on: sseOnMock }) }));
// Stable, prefix-tagged `t` so the failed-fallback assertion is deterministic.
vi.mock('@/i18n', () => ({ i18n: { global: { t: (key: string) => `t:${key}` } } }));

import { restoreDialogPresenting, sseToStatus, useRestoreJobStatus } from './use-restore-job-status';

const idle = (): BackupRestoreActiveStatus => ({ state: 'idle' });
const running = (jobId = 'r-1'): BackupRestoreActiveStatus => ({
  state: 'running',
  jobId,
  phase: 'restoring',
  insertedRows: 10,
});
const completed = (jobId = 'r-1'): BackupRestoreActiveStatus => ({
  state: 'completed',
  jobId,
  summary: { insertedByTable: { transactions: 3 }, warnings: [] },
});

/** localStorage key the restore watchdog uses to dedupe completion handling. */
const HANDLED_JOB_KEY = 'backup-restore-handled-job';

const makeStorageMock = () => {
  const store = new Map<string, string>();
  return {
    getItem: vi.fn((key: string): string | null => store.get(key) ?? null),
    setItem: vi.fn((key: string, value: string): void => void store.set(key, value)),
    removeItem: vi.fn((key: string): void => void store.delete(key)),
    clear: vi.fn((): void => store.clear()),
  };
};
let storageMock: ReturnType<typeof makeStorageMock>;

/** Latest SSE callback the watchdog registered — receives the raw SSE payload. */
const latestSseCallback = (): ((payload: BackupRestoreSseProgress) => void) =>
  sseOnMock.mock.calls[sseOnMock.mock.calls.length - 1]![1];

describe('sseToStatus', () => {
  const base = { jobId: 'r-1', processedCount: 5, totalCount: 10 } as const;

  it('maps a queued push to the queued state', () => {
    expect(sseToStatus({ ...base, status: 'queued' })).toEqual({ state: 'queued', jobId: 'r-1' });
  });

  it('maps a running push, carrying phase and processedCount as insertedRows', () => {
    expect(sseToStatus({ ...base, status: 'running', phase: 'restoring' })).toEqual({
      state: 'running',
      jobId: 'r-1',
      phase: 'restoring',
      insertedRows: 5,
    });
  });

  it('maps a completed push with a summary to the completed state', () => {
    const summary = { insertedByTable: { transactions: 3 }, warnings: [] };
    expect(sseToStatus({ ...base, status: 'completed', summary })).toEqual({
      state: 'completed',
      jobId: 'r-1',
      summary,
    });
  });

  it('downgrades a completed push with no summary yet to running (waits for the poll)', () => {
    expect(sseToStatus({ ...base, status: 'completed', phase: 'finalizing' })).toEqual({
      state: 'running',
      jobId: 'r-1',
      phase: 'finalizing',
    });
  });

  it('maps a failed push to the localized generic message, never the worker-built English reason', () => {
    expect(sseToStatus({ ...base, status: 'failed', error: 'disk full' })).toEqual({
      state: 'failed',
      jobId: 'r-1',
      error: 't:settings.security.backup.restore.failedGeneric',
    });
  });

  it('uses the localized generic message when a failed push carries no reason', () => {
    expect(sseToStatus({ ...base, status: 'failed' })).toEqual({
      state: 'failed',
      jobId: 'r-1',
      error: 't:settings.security.backup.restore.failedGeneric',
    });
  });

  it('returns null for an unrecognized status', () => {
    expect(sseToStatus({ ...base, status: 'bogus' as never })).toBeNull();
  });
});

describe('useRestoreJobStatus', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetQueryCachesMock.mockResolvedValue(undefined);
    sseOnMock.mockReturnValue(() => {});
    storageMock = makeStorageMock();
    vi.stubGlobal('location', { reload: reloadMock });
    vi.stubGlobal('localStorage', storageMock);
  });

  afterEach(() => {
    useRestoreJobStatus().stop();
    // Shared module singleton: reset the presenter flag so it can't bleed between tests.
    restoreDialogPresenting.value = false;
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('does not block or reload when no restore is running at boot', async () => {
    getStatusMock.mockResolvedValue(idle());

    const store = useRestoreJobStatus();
    await store.checkOnBoot();

    expect(store.isBlocking.value).toBe(false);
    expect(reloadMock).not.toHaveBeenCalled();
  });

  it('blocks the app when a restore is in flight at boot, then reloads on completion', async () => {
    getStatusMock.mockResolvedValueOnce(running()).mockResolvedValueOnce(running()).mockResolvedValueOnce(completed());

    const store = useRestoreJobStatus();
    await store.checkOnBoot();

    expect(store.isBlocking.value).toBe(true);

    await vi.advanceTimersByTimeAsync(2000);

    expect(resetQueryCachesMock).toHaveBeenCalledTimes(1);
    expect(reloadMock).toHaveBeenCalledTimes(1);
    expect(storageMock.setItem).toHaveBeenCalledWith(HANDLED_JOB_KEY, 'r-1');
  });

  it('wipes caches, marks handled and reloads once for an unhandled completion at boot', async () => {
    getStatusMock.mockResolvedValue(completed());

    const store = useRestoreJobStatus();
    await store.checkOnBoot();

    expect(resetQueryCachesMock).toHaveBeenCalledTimes(1);
    expect(storageMock.setItem).toHaveBeenCalledWith(HANDLED_JOB_KEY, 'r-1');
    expect(reloadMock).toHaveBeenCalledTimes(1);
  });

  it('treats an already-handled completion at boot as informational — no wipe, no reload', async () => {
    storageMock.getItem.mockReturnValue('r-1');
    getStatusMock.mockResolvedValue(completed());

    const store = useRestoreJobStatus();
    await store.checkOnBoot();

    expect(resetQueryCachesMock).not.toHaveBeenCalled();
    expect(reloadMock).not.toHaveBeenCalled();
    expect(store.isBlocking.value).toBe(false);
  });

  it('maps a completed SSE push (with summary) to a single wipe + reload', async () => {
    // The poll keeps returning running; SSE delivers the terminal completed first.
    getStatusMock.mockResolvedValue(running());

    const store = useRestoreJobStatus();
    store.start({ initialStatus: running() });

    const sseCompleted: BackupRestoreSseProgress = {
      jobId: 'r-1',
      status: 'completed',
      processedCount: 3,
      totalCount: 3,
      summary: { insertedByTable: { transactions: 3 }, warnings: [] },
    };
    latestSseCallback()(sseCompleted);
    await vi.advanceTimersByTimeAsync(0);

    // A later poll also seeing terminal must not fire the side effect twice.
    await vi.advanceTimersByTimeAsync(2000);

    expect(reloadMock).toHaveBeenCalledTimes(1);
    expect(resetQueryCachesMock).toHaveBeenCalledTimes(1);
  });

  it('defers to the restore dialog while it is presenting: a completion neither wipes nor reloads', async () => {
    // The dialog owns the completion UX (summary + reload on Done) while mounted, so the
    // watchdog must stand down instead of wiping caches and reloading out from under it.
    restoreDialogPresenting.value = true;
    getStatusMock.mockResolvedValueOnce(completed());

    const store = useRestoreJobStatus();
    store.start({ initialStatus: running() });

    await vi.advanceTimersByTimeAsync(0);

    expect(reloadMock).not.toHaveBeenCalled();
    expect(resetQueryCachesMock).not.toHaveBeenCalled();
    expect(store.isBlocking.value).toBe(false);
  });

  it('ignores a completed SSE push with no summary yet (waits for the poll to carry it)', async () => {
    getStatusMock.mockResolvedValue(running());

    const store = useRestoreJobStatus();
    store.start({ initialStatus: running() });

    // `completed` without a summary maps to `running`, so no terminal side effect.
    const sseNoSummary: BackupRestoreSseProgress = {
      jobId: 'r-1',
      status: 'completed',
      processedCount: 3,
      totalCount: 3,
    };
    latestSseCallback()(sseNoSummary);
    await vi.advanceTimersByTimeAsync(0);

    expect(reloadMock).not.toHaveBeenCalled();
    expect(store.isBlocking.value).toBe(true);
  });
});
