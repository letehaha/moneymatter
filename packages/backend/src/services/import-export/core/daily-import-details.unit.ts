import { ImportSource } from '@bt/shared/types';
import { describe, expect, it } from '@jest/globals';

import { dailyImportDetails } from './daily-import-details';

const stamp = ({ userId = 1, at }: { userId?: number; at: string }) =>
  dailyImportDetails({ userId, source: ImportSource.messageImport, now: new Date(at) });

describe('dailyImportDetails', () => {
  it('files every row of one UTC day under one batch and keeps each row its own time', () => {
    const first = stamp({ at: '2026-01-01T00:00:00.000Z' });
    const last = stamp({ at: '2026-01-01T23:59:59.999Z' });

    expect(last.batchId).toBe(first.batchId);
    expect(last.importedAt).toBe('2026-01-01T23:59:59.999Z');
  });

  it('starts a new batch on the next UTC day', () => {
    expect(stamp({ at: '2026-01-02T00:00:00.000Z' }).batchId).not.toBe(
      stamp({ at: '2026-01-01T23:59:59.999Z' }).batchId,
    );
  });

  it('never shares a batch between users', () => {
    const at = '2026-01-01T12:00:00.000Z';

    expect(stamp({ userId: 2, at }).batchId).not.toBe(stamp({ userId: 1, at }).batchId);
  });
});
