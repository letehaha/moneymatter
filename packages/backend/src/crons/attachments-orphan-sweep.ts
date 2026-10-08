import TransactionAttachments from '@models/transaction-attachments.model';
import { STORAGE_KEY_PATTERN, deleteObject, listObjects, storageKey } from '@services/attachments/storage';
import { Op } from 'sequelize';

import { createScheduledSync } from './lib/create-scheduled-sync';

/** Upload writes the blob before the row, so a very young blob may simply be mid-upload. */
const MIN_AGE_MS = 24 * 60 * 60 * 1000;
const LOOKUP_BATCH = 500;
const MASS_DELETE_MIN_SCANNED = 50;

/**
 * Daily sweep that removes attachment blobs with no matching row. This is the single
 * cleanup mechanism behind every cascade path — transaction delete, account delete, wipe,
 * restore, user delete, demo cleanup — none of which touch storage themselves.
 *
 * ponytail: lists the whole bucket each run; switch to per-user prefix deletes on those
 * paths once object count makes a full listing slow.
 */
const sweepOrphanBlobs = async ({ minAgeMs = MIN_AGE_MS }: { minAgeMs?: number } = {}): Promise<{
  deleted: number;
  scanned: number;
}> => {
  const cutoff = Date.now() - minAgeMs;
  // A key outside the generated shape was not written by us: it is never an orphan, and
  // its second segment must not reach the `Op.in` on a UUID column.
  const candidates = (await listObjects()).filter(
    (object) => object.lastModified.getTime() <= cutoff && STORAGE_KEY_PATTERN.test(object.key),
  );

  const orphans: string[] = [];
  for (let i = 0; i < candidates.length; i += LOOKUP_BATCH) {
    const batch = candidates.slice(i, i + LOOKUP_BATCH);
    const ids = batch.map((object) => object.key.split('/')[1]).filter((id): id is string => Boolean(id));

    const rows = (await TransactionAttachments.findAll({
      where: { id: { [Op.in]: ids } },
      attributes: ['id', 'userId'],
      raw: true,
    })) as unknown as { id: string; userId: number }[];
    const known = new Set(rows.map((row) => storageKey({ userId: row.userId, id: row.id })));

    for (const object of batch) {
      if (!known.has(object.key)) orphans.push(object.key);
    }
  }

  // A bucket pointed at the wrong database makes every blob look orphaned, and deletes
  // are unrecoverable — refuse a sweep that would remove most of the bucket.
  if (candidates.length > MASS_DELETE_MIN_SCANNED && orphans.length > candidates.length / 2) {
    throw new Error(
      `Attachments orphan sweep aborted: ${orphans.length} of ${candidates.length} blobs have no row. Verify the bucket matches this database.`,
    );
  }

  for (const key of orphans) await deleteObject({ key });

  return { deleted: orphans.length, scanned: candidates.length };
};

export const attachmentsOrphanSweepCron = createScheduledSync({
  name: 'attachments orphan sweep',
  cronExpression: '45 3 * * *',
  timeZone: 'UTC',
  scheduleDescription: 'runs daily at 03:45 UTC',
  errorCode: 'ATTACHMENTS_ORPHAN_SWEEP_CRON',
  run: sweepOrphanBlobs,
});
