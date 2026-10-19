import { describe, expect, it } from '@jest/globals';

import {
  buildSuppressedFailuresEntry,
  buildSystemicFailureMessage,
  createImportFailureTally,
  type ImportFailureTally,
  MAX_CONSECUTIVE_FAILURES,
  MAX_LOGGED_FAILURES,
  MAX_RETAINED_ERROR_ENTRIES,
  recordImportFailure,
  recordImportSuccess,
} from './import-error-collector';

/** Bad rows scattered among good ones: a success after each failure keeps the
 *  consecutive counter down so only the retention/logging caps are exercised. */
const failIsolatedRows = ({ count, firstRowIndex = 0 }: { count: number; firstRowIndex?: number }) => {
  let tally = createImportFailureTally();
  const retainedRowIndices: number[] = [];
  let loggedCount = 0;
  let abortedAt: number | null = null;

  for (let i = 0; i < count; i += 1) {
    const decision = recordImportFailure({ tally, rowIndices: [firstRowIndex + i] });
    tally = decision.tally;
    retainedRowIndices.push(...decision.retainedRowIndices);
    if (decision.shouldLog) loggedCount += 1;
    if (decision.shouldAbort && abortedAt === null) abortedAt = i;
    tally = recordImportSuccess({ tally });
  }

  return { tally, retainedRowIndices, loggedCount, abortedAt };
};

describe('createImportFailureTally', () => {
  it('starts empty so a clean import retains nothing and reports nothing', () => {
    const tally = createImportFailureTally();

    const expected: ImportFailureTally = {
      retainedEntries: 0,
      suppressedRows: 0,
      firstSuppressedRowIndex: null,
      loggedFailures: 0,
      unloggedFailures: 0,
      consecutiveFailures: 0,
    };
    expect(tally).toEqual(expected);
    expect(buildSuppressedFailuresEntry({ tally })).toBeNull();
  });
});

describe('recordImportFailure', () => {
  it('retains and logs a single bad row without aborting', () => {
    const decision = recordImportFailure({ tally: createImportFailureTally(), rowIndices: [7] });

    expect(decision.retainedRowIndices).toEqual([7]);
    expect(decision.shouldLog).toBe(true);
    expect(decision.shouldAbort).toBe(false);
    expect(decision.tally.retainedEntries).toBe(1);
    expect(decision.tally.suppressedRows).toBe(0);
  });

  it('does not mutate the tally it is given', () => {
    const tally = createImportFailureTally();

    recordImportFailure({ tally, rowIndices: [1] });

    expect(tally.retainedEntries).toBe(0);
    expect(tally.consecutiveFailures).toBe(0);
  });

  it('returns one retained index per leg so both halves of a failed transfer are listed', () => {
    const decision = recordImportFailure({ tally: createImportFailureTally(), rowIndices: [4, 5] });

    expect(decision.retainedRowIndices).toEqual([4, 5]);
    expect(decision.tally.retainedEntries).toBe(2);
  });

  it('stops retaining entries at the cap and counts the rest as suppressed rows', () => {
    const failures = MAX_RETAINED_ERROR_ENTRIES + 20;
    const { tally, retainedRowIndices } = failIsolatedRows({ count: failures });

    expect(retainedRowIndices).toHaveLength(MAX_RETAINED_ERROR_ENTRIES);
    expect(tally.retainedEntries).toBe(MAX_RETAINED_ERROR_ENTRIES);
    expect(tally.suppressedRows).toBe(20);
    expect(tally.firstSuppressedRowIndex).toBe(MAX_RETAINED_ERROR_ENTRIES);
    expect(tally.retainedEntries + tally.suppressedRows).toBe(failures);
  });

  it('splits a transfer at the cap boundary, retaining the leg that fits', () => {
    const { tally } = failIsolatedRows({ count: MAX_RETAINED_ERROR_ENTRIES - 1 });

    const decision = recordImportFailure({ tally, rowIndices: [900, 901] });

    expect(decision.retainedRowIndices).toEqual([900]);
    expect(decision.tally.retainedEntries).toBe(MAX_RETAINED_ERROR_ENTRIES);
    expect(decision.tally.suppressedRows).toBe(1);
    expect(decision.tally.firstSuppressedRowIndex).toBe(901);
  });

  it('keeps the first suppressed row index once set, even as more rows are dropped', () => {
    const { tally } = failIsolatedRows({ count: MAX_RETAINED_ERROR_ENTRIES + 5 });

    const decision = recordImportFailure({ tally, rowIndices: [4242] });

    expect(decision.tally.firstSuppressedRowIndex).toBe(MAX_RETAINED_ERROR_ENTRIES);
    expect(decision.tally.suppressedRows).toBe(6);
  });

  it('logs only the first failures and counts the rest', () => {
    const failures = MAX_LOGGED_FAILURES + 15;
    const { tally, loggedCount } = failIsolatedRows({ count: failures });

    expect(loggedCount).toBe(MAX_LOGGED_FAILURES);
    expect(tally.loggedFailures).toBe(MAX_LOGGED_FAILURES);
    expect(tally.unloggedFailures).toBe(15);
  });

  it('aborts once failures run back to back, not before', () => {
    let tally = createImportFailureTally();
    const aborts: boolean[] = [];

    for (let i = 0; i < MAX_CONSECUTIVE_FAILURES; i += 1) {
      const decision = recordImportFailure({ tally, rowIndices: [i] });
      tally = decision.tally;
      aborts.push(decision.shouldAbort);
    }

    expect(aborts.slice(0, MAX_CONSECUTIVE_FAILURES - 1).every((abort) => abort === false)).toBe(true);
    expect(aborts[MAX_CONSECUTIVE_FAILURES - 1]).toBe(true);
    expect(tally.consecutiveFailures).toBe(MAX_CONSECUTIVE_FAILURES);
  });

  it('never aborts while successes keep interrupting the failures', () => {
    const { abortedAt } = failIsolatedRows({ count: MAX_CONSECUTIVE_FAILURES * 4 });

    expect(abortedAt).toBeNull();
  });
});

describe('recordImportSuccess', () => {
  it('resets the consecutive counter and leaves the retained/logged totals alone', () => {
    const { tally: afterFailure } = recordImportFailure({ tally: createImportFailureTally(), rowIndices: [3] });

    const tally = recordImportSuccess({ tally: afterFailure });

    expect(tally.consecutiveFailures).toBe(0);
    expect(tally.retainedEntries).toBe(1);
    expect(tally.loggedFailures).toBe(1);
  });

  it('returns the same tally when there is nothing to reset', () => {
    const tally = createImportFailureTally();

    expect(recordImportSuccess({ tally })).toBe(tally);
  });
});

describe('buildSuppressedFailuresEntry', () => {
  it('returns null while every failure still fits under the cap', () => {
    const { tally } = failIsolatedRows({ count: MAX_RETAINED_ERROR_ENTRIES });

    expect(buildSuppressedFailuresEntry({ tally })).toBeNull();
  });

  it('reports the dropped row count against the first dropped row', () => {
    const { tally } = failIsolatedRows({ count: MAX_RETAINED_ERROR_ENTRIES + 3, firstRowIndex: 10 });

    const entry = buildSuppressedFailuresEntry({ tally });

    expect(entry?.rowIndex).toBe(10 + MAX_RETAINED_ERROR_ENTRIES);
    expect(entry?.code).toBe('rows-suppressed');
    expect(entry?.params).toEqual({ count: 3, listed: MAX_RETAINED_ERROR_ENTRIES });
  });
});

describe('buildSystemicFailureMessage', () => {
  it('names the consecutive-failure threshold, the kept rows and the last cause', () => {
    const message = buildSystemicFailureMessage({ lastError: new Error('Connection terminated unexpectedly') });

    expect(message).toContain(String(MAX_CONSECUTIVE_FAILURES));
    expect(message).toContain('Rows written before that point were kept');
    expect(message).toContain('Connection terminated unexpectedly');
  });

  it('falls back to a generic cause when a non-Error was thrown', () => {
    expect(buildSystemicFailureMessage({ lastError: 'boom' })).toContain('Unknown error');
  });
});
