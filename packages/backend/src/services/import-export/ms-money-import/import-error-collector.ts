import type { ImportRowsSuppressedError } from '@bt/shared/types';

/**
 * Failure bookkeeping for an importer that writes rows one at a time. Separates
 * a handful of unimportable rows (record, carry on) from the import itself
 * breaking mid-run (stop, so the job fails and the user can retry). Pure
 * decisions — no DB, no logger — so the partial-success contract is testable.
 */

/** Error entries retained in the summary. The summary is stored as the BullMQ
 *  job result, pushed over SSE and held in the browser, so an import where every
 *  row fails must not grow it by one entry per row. */
export const MAX_RETAINED_ERROR_ENTRIES = 100;

/** Failures in a row, with no success in between, that mean the import itself is
 *  broken rather than the rows. */
export const MAX_CONSECUTIVE_FAILURES = 25;

/** Failures logged individually. Every `logger.error` is one Sentry event, so
 *  the remaining ones are counted and reported once. */
export const MAX_LOGGED_FAILURES = 10;

export interface ImportFailureTally {
  /** Error entries handed back for the summary so far. */
  retainedEntries: number;
  /** Rows whose error entry was dropped once the retention cap was reached. */
  suppressedRows: number;
  /** Row index of the first dropped entry, used to anchor the overflow entry. */
  firstSuppressedRowIndex: number | null;
  loggedFailures: number;
  unloggedFailures: number;
  /** Failures since the last successful row. Reset by `recordImportSuccess`. */
  consecutiveFailures: number;
}

export function createImportFailureTally(): ImportFailureTally {
  return {
    retainedEntries: 0,
    suppressedRows: 0,
    firstSuppressedRowIndex: null,
    loggedFailures: 0,
    unloggedFailures: 0,
    consecutiveFailures: 0,
  };
}

export function recordImportSuccess({ tally }: { tally: ImportFailureTally }): ImportFailureTally {
  if (tally.consecutiveFailures === 0) return tally;
  return { ...tally, consecutiveFailures: 0 };
}

interface ImportFailureDecision {
  tally: ImportFailureTally;
  /** Subset of `rowIndices` that still fits under `MAX_RETAINED_ERROR_ENTRIES`;
   *  the caller pushes one summary entry per index and drops the rest. */
  retainedRowIndices: number[];
  shouldLog: boolean;
  /** The failures look systemic — the caller must stop writing and throw. */
  shouldAbort: boolean;
}

/**
 * Fold one failed write into the tally. `rowIndices` is every source row the
 * failure covers: one for an ordinary row, both legs for a transfer.
 */
export function recordImportFailure({
  tally,
  rowIndices,
}: {
  tally: ImportFailureTally;
  rowIndices: number[];
}): ImportFailureDecision {
  const freeSlots = Math.max(MAX_RETAINED_ERROR_ENTRIES - tally.retainedEntries, 0);
  const retainedRowIndices = rowIndices.slice(0, freeSlots);
  const suppressedRowIndices = rowIndices.slice(retainedRowIndices.length);

  const shouldLog = tally.loggedFailures < MAX_LOGGED_FAILURES;
  const consecutiveFailures = tally.consecutiveFailures + 1;

  return {
    tally: {
      retainedEntries: tally.retainedEntries + retainedRowIndices.length,
      suppressedRows: tally.suppressedRows + suppressedRowIndices.length,
      firstSuppressedRowIndex: tally.firstSuppressedRowIndex ?? suppressedRowIndices[0] ?? null,
      loggedFailures: shouldLog ? tally.loggedFailures + 1 : tally.loggedFailures,
      unloggedFailures: shouldLog ? tally.unloggedFailures : tally.unloggedFailures + 1,
      consecutiveFailures,
    },
    retainedRowIndices,
    shouldLog,
    shouldAbort: consecutiveFailures >= MAX_CONSECUTIVE_FAILURES,
  };
}

/**
 * Single summary entry standing in for every dropped error, or null when nothing
 * was dropped. Anchored to the first dropped row so the "Row N:" prefix the UI
 * renders reads as the point the listing stops.
 */
export function buildSuppressedFailuresEntry({
  tally,
}: {
  tally: ImportFailureTally;
}): ImportRowsSuppressedError | null {
  if (tally.suppressedRows === 0) return null;
  return {
    rowIndex: tally.firstSuppressedRowIndex ?? 0,
    error: `${tally.suppressedRows} more rows failed to import from this row onward. Only the first ${MAX_RETAINED_ERROR_ENTRIES} errors are listed.`,
    code: 'rows-suppressed',
    params: { count: tally.suppressedRows, listed: MAX_RETAINED_ERROR_ENTRIES },
  };
}

/** Message for the job failure raised when `shouldAbort` fires. */
export function buildSystemicFailureMessage({ lastError }: { lastError: unknown }): string {
  const cause = lastError instanceof Error ? lastError.message : 'Unknown error';
  return (
    `Import stopped after ${MAX_CONSECUTIVE_FAILURES} rows failed in a row — the problem is with the import, not the file. ` +
    `Rows written before that point were kept; retry the import to write the rest. Last error: ${cause}`
  );
}
