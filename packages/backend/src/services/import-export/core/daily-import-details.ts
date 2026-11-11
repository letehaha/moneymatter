import type { ImportSource, TransactionImportDetails } from '@bt/shared/types';
import { v5 as uuidv5 } from 'uuid';

const BATCH_NAMESPACE = '48a7e5ef-5b1b-4925-88a6-aa63df494ab1';

/**
 * The stamp for a source whose rows arrive one request at a time: one batch per user per UTC day.
 * Derived, not stored, so concurrent creates land in the same batch without a lookup.
 */
export const dailyImportDetails = ({
  userId,
  source,
  now = new Date(),
}: {
  userId: number;
  source: ImportSource;
  now?: Date;
}): TransactionImportDetails => {
  const importedAt = now.toISOString();

  return { batchId: uuidv5(`${userId}:${source}:${importedAt.slice(0, 10)}`, BATCH_NAMESPACE), importedAt, source };
};
