import { ValidationError } from '@js/errors';

import type { BackupFileName } from '../registry';

type Row = Record<string, unknown>;

const FILE_NAME: BackupFileName = 'user-exchange-rates';

/** The UTC day of the ISO timestamp a rate row was saved with. */
const ISO_DAY = /^(\d{4}-\d{2}-\d{2})T/;

const rowKey = ({ row }: { row: Row }): string =>
  JSON.stringify([row.userId, row.baseCode, row.quoteCode, row.effectiveDate]);

const savedAt = ({ row }: { row: Row }): number => (typeof row.date === 'string' ? Date.parse(row.date) : 0);

/**
 * Give every user rate that has no `effectiveDate` the UTC day of its saved `date`, the rule the
 * migration that added the column applies to the rows it finds. Archives written before the column
 * existed (format versions 1 and 2, and version 3 exported earlier) carry no such field, and without it
 * the table's required key would fail the restore. Rows that already have a day are left alone.
 *
 * Two rows of one pair that land on the same day collapse to the one saved last, because the pair
 * and day are the table's key.
 */
export function fillUserRateEffectiveDates({ data }: { data: Map<BackupFileName, Row[]> }): void {
  const rows = data.get(FILE_NAME);
  if (!rows?.some((row) => row.effectiveDate === undefined || row.effectiveDate === null)) return;

  for (const row of rows) {
    if (row.effectiveDate !== undefined && row.effectiveDate !== null) continue;

    const day = typeof row.date === 'string' ? ISO_DAY.exec(row.date)?.[1] : undefined;
    if (!day) {
      throw new ValidationError({
        message: `Backup file data/${FILE_NAME}.json is corrupt: a rate has no usable saved date (${JSON.stringify(row.date)}).`,
      });
    }
    row.effectiveDate = day;
  }

  const latestByKey = new Map<string, Row>();
  for (const row of rows) {
    const key = rowKey({ row });
    const kept = latestByKey.get(key);
    if (!kept || savedAt({ row }) > savedAt({ row: kept })) latestByKey.set(key, row);
  }

  if (latestByKey.size !== rows.length) data.set(FILE_NAME, [...latestByKey.values()]);
}
