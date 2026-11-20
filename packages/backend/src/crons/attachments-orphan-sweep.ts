import AccountGroups from '@models/accounts-groups/account-groups.model';
import Accounts from '@models/accounts.model';
import Goals from '@models/goals.model';
import Payees from '@models/payees.model';
import Subscriptions from '@models/subscriptions.model';
import Trackers from '@models/trackers.model';
import TransactionAttachments from '@models/transaction-attachments.model';
import { STORAGE_KEY_PATTERN, deleteObject, listObjects, storageKey } from '@services/attachments/storage';
import { LOGO_IMAGE_KEY_PATTERN } from '@services/logo-images/logo-images.service';
import { type Model, type ModelStatic, Op } from 'sequelize';

import { createScheduledSync } from './lib/create-scheduled-sync';

/** Upload writes the blob before the row, so a very young blob may simply be mid-upload. */
const MIN_AGE_MS = 24 * 60 * 60 * 1000;
const LOOKUP_BATCH = 500;
const MASS_DELETE_MIN_SCANNED = 50;

const LOGO_OWNER_MODELS: ModelStatic<Model>[] = [Trackers, Accounts, AccountGroups, Payees, Subscriptions, Goals];

const findOrphanAttachmentKeys = async ({ keys }: { keys: string[] }): Promise<string[]> => {
  const orphans: string[] = [];
  for (let i = 0; i < keys.length; i += LOOKUP_BATCH) {
    const batch = keys.slice(i, i + LOOKUP_BATCH);
    const ids = batch.map((key) => key.split('/')[1]).filter((id): id is string => Boolean(id));

    const rows = (await TransactionAttachments.findAll({
      where: { id: { [Op.in]: ids } },
      attributes: ['id', 'userId'],
      raw: true,
    })) as unknown as { id: string; userId: number }[];
    const known = new Set(rows.map((row) => storageKey({ userId: row.userId, id: row.id })));

    orphans.push(...batch.filter((key) => !known.has(key)));
  }
  return orphans;
};

const findOrphanLogoKeys = async ({ keys }: { keys: string[] }): Promise<string[]> => {
  const orphans: string[] = [];
  for (let i = 0; i < keys.length; i += LOOKUP_BATCH) {
    const batch = keys.slice(i, i + LOOKUP_BATCH);
    const ids = batch.map((key) => LOGO_IMAGE_KEY_PATTERN.exec(key)![1]!);

    const referenced = new Set<string>();
    for (const model of LOGO_OWNER_MODELS) {
      const rows = (await model.findAll({
        where: { logoImageId: { [Op.in]: ids } },
        attributes: ['logoImageId'],
        raw: true,
      })) as unknown as { logoImageId: string }[];
      for (const row of rows) referenced.add(row.logoImageId);
    }

    orphans.push(...batch.filter((_, index) => !referenced.has(ids[index]!)));
  }
  return orphans;
};

/**
 * Daily sweep that removes attachment and logo image blobs with no matching row. This is
 * the single cleanup mechanism behind every cascade path — transaction delete, account
 * delete, wipe, restore, user delete, demo cleanup — none of which touch storage themselves.
 *
 * ponytail: lists the whole bucket each run; switch to per-user prefix deletes on those
 * paths once object count makes a full listing slow.
 */
const sweepOrphanBlobs = async ({ minAgeMs = MIN_AGE_MS }: { minAgeMs?: number } = {}): Promise<{
  deleted: number;
  scanned: number;
}> => {
  const cutoff = Date.now() - minAgeMs;
  // A key outside the generated shapes was not written by us: it is never an orphan, and
  // its id segment must not reach the `Op.in` on a UUID column.
  const fresh = (await listObjects()).filter((object) => object.lastModified.getTime() <= cutoff);
  const attachmentKeys = fresh.map((object) => object.key).filter((key) => STORAGE_KEY_PATTERN.test(key));
  const logoKeys = fresh.map((object) => object.key).filter((key) => LOGO_IMAGE_KEY_PATTERN.test(key));
  const candidates = [...attachmentKeys, ...logoKeys];

  const orphans = [
    ...(await findOrphanAttachmentKeys({ keys: attachmentKeys })),
    ...(await findOrphanLogoKeys({ keys: logoKeys })),
  ];

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
