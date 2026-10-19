import { useSSE } from '@/composable/use-sse';
import { i18n } from '@/i18n';
import { isNotFoundError, NetworkError } from '@/js/errors';
import { captureException } from '@/lib/sentry';
import type { SSEEventType } from '@bt/shared/types';
import { ref } from 'vue';

/**
 * Structural shape every async-import progress payload shares (Wallet, YNAB, …).
 * Both the SSE event and the GET /status response converge on this discriminated
 * union, so the watchdog can read `jobId`/`status` without knowing the importer.
 */
type ImportJobProgress = {
  jobId: string;
  processedCount: number;
  totalCount: number;
} & (
  | { status: 'queued' | 'running' }
  | { status: 'completed'; summary: unknown }
  | { status: 'failed'; error: string }
);

const STATUS_POLL_INTERVAL_MS = 2000;
/** SSE is the primary progress channel. The HTTP status poll only fires after
 *  the connection has been quiet for this long, so a dropped event or dead
 *  connection still converges to the job's terminal state. */
const SSE_STALL_THRESHOLD_MS = 10_000;
/** Bail out of the watchdog after this many consecutive `/status` failures so
 *  the user gets a real error instead of an infinite spinner when their
 *  session expired or the job rolled off the 24h retention window. */
const MAX_POLL_FAILURES = 5;

/**
 * Shared SSE + status-poll watchdog for a single async import job. Owns the
 * progress state, the SSE subscription, and a poll loop that only wakes while
 * SSE has gone quiet, converging on the job's terminal state regardless of
 * which channel delivers it. Terminal handling is idempotent: the first
 * `completed`/`failed`/`expired`/`lost-contact` outcome tears down both timers
 * and listeners so a late event from the other channel is ignored.
 *
 * Parameterized by the bits that differ per importer: the SSE event name, the
 * status-fetch fn, and the terminal success/failure + lost-contact callbacks
 * (which own importer-specific navigation and summary/error placement).
 */
export function useImportJobProgress<TProgress extends ImportJobProgress>({
  sseEventType,
  fetchStatus,
  onComplete,
  onFailure,
  onLostContact,
}: {
  /** SSE event name carrying this importer's progress payload. */
  sseEventType: SSEEventType;
  /** Hits the importer's GET /status endpoint for the given job. */
  fetchStatus: (params: { jobId: string }) => Promise<TProgress>;
  /** Runs once when the job reports `completed`. Receives the terminal payload. */
  onComplete: (payload: Extract<TProgress, { status: 'completed' }>) => void | Promise<void>;
  /** Runs once when the job reports `failed`. Receives the terminal payload. */
  onFailure: (payload: Extract<TProgress, { status: 'failed' }>) => void | Promise<void>;
  /**
   * Runs when polling keeps failing transiently (network/session) past
   * `MAX_POLL_FAILURES` with no terminal result yet. The importer decides where
   * to send the user back to (review / picker step). NOT called for a 404 — a
   * job that 404s aged out of retention after finishing and must not discard a
   * possibly-successful import.
   */
  onLostContact: () => void;
}) {
  const sse = useSSE();

  /** Live progress for the active job. */
  const progress = ref<TProgress | null>(null);
  /** User-facing terminal error when the watchdog gives up (lost contact /
   *  expired job). The importer surfaces this in its results UI. Mutated only
   *  via `setExecuteError` — exposed read-only to callers. */
  const executeError = ref<string | null>(null);

  /**
   * Sets (or clears with `null`) the terminal error message. The single write
   * path for `executeError`, used both internally by the watchdog and by
   * external callers (e.g. the import store) so the ref stays read-only to them.
   */
  function setExecuteError(message: string | null): void {
    executeError.value = message;
  }

  // ---- Internal watchdog machinery — consumers never read these ----

  let jobId: string | null = null;
  let lastSseEventAt = 0;
  let unsubscribeSse: (() => void) | null = null;
  let pollHandle: ReturnType<typeof setInterval> | null = null;
  let consecutivePollFailures = 0;
  /** Guards the terminal callbacks against a double-fire when SSE and the poll
   *  both deliver the terminal state in the same tick. */
  let terminalHandled = false;

  /** Tears down both timers and the SSE listener. Idempotent. */
  function stop(): void {
    if (pollHandle) {
      clearInterval(pollHandle);
      pollHandle = null;
    }
    unsubscribeSse?.();
    unsubscribeSse = null;
    consecutivePollFailures = 0;
  }

  /** Dispatches a terminal payload to the right callback exactly once, after
   *  stopping the watchdog so a late event from the other channel is a no-op. */
  async function handleTerminal(payload: TProgress): Promise<void> {
    if (terminalHandled) return;
    terminalHandled = true;
    stop();
    if (payload.status === 'completed') {
      await onComplete(payload as Extract<TProgress, { status: 'completed' }>);
    } else if (payload.status === 'failed') {
      await onFailure(payload as Extract<TProgress, { status: 'failed' }>);
    }
  }

  /**
   * Begins tracking `initialProgress.jobId`: seeds state, subscribes to SSE for
   * live updates, and arms the stall watchdog. Safe to call again for a new job —
   * any prior subscription/timer is torn down first.
   */
  function start({ initialProgress }: { initialProgress: TProgress }): void {
    stop();
    terminalHandled = false;
    jobId = initialProgress.jobId;
    progress.value = initialProgress;
    setExecuteError(null);
    // Seed to 0 (not `Date.now()`) so the stall watchdog's first tick is allowed
    // to hit `/status` immediately. A fast import that already finished before
    // its SSE event arrives is then confirmed terminal on the first poll instead
    // of waiting out `SSE_STALL_THRESHOLD_MS`.
    lastSseEventAt = 0;

    // Hook up SSE for live updates.
    sse.connect().catch((error) => {
      // SSE unavailable; the stall watchdog below takes over via polling. Report
      // it so a systemic SSE outage is visible rather than silently degrading
      // every importer to polling.
      captureException({ error, context: { scope: 'import-job-progress:sse-connect', sseEventType } });
    });
    unsubscribeSse = sse.on(sseEventType, (data) => {
      // `data` is inferred from the event map as the union of all importer
      // payloads; narrow it to this composable's `TProgress`. The cast can't be
      // dropped because `sseEventType` is a plain `SSEEventType`, not tied to
      // `TProgress` at the type level — but every importer's payload is structurally
      // a `TProgress`, so the runtime shape matches.
      const payload = data as TProgress;
      if (payload.jobId !== jobId) return;
      lastSseEventAt = Date.now();
      progress.value = payload;
      if (payload.status === 'completed' || payload.status === 'failed') {
        handleTerminal(payload);
      }
    });

    // Stall watchdog: hits the HTTP status endpoint only while SSE has gone
    // quiet, instead of polling unconditionally alongside a healthy stream.
    consecutivePollFailures = 0;
    pollHandle = setInterval(async () => {
      if (!jobId || Date.now() - lastSseEventAt < SSE_STALL_THRESHOLD_MS) return;
      try {
        const update = await fetchStatus({ jobId });
        consecutivePollFailures = 0;
        progress.value = update;
        if (update.status === 'completed' || update.status === 'failed') {
          handleTerminal(update);
        }
      } catch (err) {
        // A 404 means the job no longer exists — it aged out of retention after
        // finishing rather than failing in flight. Treating that as a transient
        // failure would bounce the user back and discard a possibly-successful
        // import, so surface a distinct terminal "expired/lost" state and stop.
        if (isNotFoundError(err) && !terminalHandled) {
          terminalHandled = true;
          setExecuteError(i18n.global.t('pages.importExport.progress.jobExpired'));
          stop();
          return;
        }
        consecutivePollFailures += 1;
        if (consecutivePollFailures >= MAX_POLL_FAILURES) {
          // SSE gave up AND polling keeps failing transiently — surface the
          // error and stop the watchdog so the user isn't stuck on a phantom
          // spinner, then let the importer bounce them back to retry.
          setExecuteError(
            err instanceof NetworkError ? err.message : i18n.global.t('pages.importExport.progress.lostContact'),
          );
          stop();
          onLostContact();
        }
      }
    }, STATUS_POLL_INTERVAL_MS);
  }

  return {
    progress,
    /** Read-only to callers — mutate via `setExecuteError`, never `.value =`. */
    executeError,
    setExecuteError,
    start,
    stop,
  };
}
