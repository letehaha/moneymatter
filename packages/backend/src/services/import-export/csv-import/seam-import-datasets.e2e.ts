import { describe, expect, it } from '@jest/globals';
import * as helpers from '@tests/helpers';
import {
  SEAM_DATASETS,
  type SeamDatasetKey,
  asDatasetUser,
  centsToDecimal,
  expectBatchMatchesRows,
  expectPreSeamHistoryMatchesRows,
  importDataset,
  listAccountRows,
  loadDatasetCsv,
  parseDatasetRows,
  reviewDataset,
  rowsBeforeSeam,
  setupDatasetAccount,
  sumCents,
  type TransactionRow,
} from '@tests/helpers/seam-datasets';

type Scenario = {
  file: string;
  timezone: string;
  utcOffsetHours: number;
  imported: number;
  skipped: number;
  netCents: number;
};

const LOCAL_TIME_FILE = '3b-seam-edges-local-time.csv';

/** Warsaw is UTC+1 and Kyiv UTC+2 on both seam days. */
const SCENARIOS: Record<SeamDatasetKey, Scenario[]> = {
  uah: [
    { file: '1-pre-link-clean.csv', timezone: 'UTC', utcOffsetHours: 0, imported: 10, skipped: 0, netCents: 4_120_020 },
    { file: '2-mixed.csv', timezone: 'UTC', utcOffsetHours: 0, imported: 5, skipped: 5, netCents: 147_775 },
    { file: '3-seam-edges.csv', timezone: 'UTC', utcOffsetHours: 0, imported: 2, skipped: 3, netCents: -43_620 },
    { file: LOCAL_TIME_FILE, timezone: 'UTC', utcOffsetHours: 0, imported: 1, skipped: 4, netCents: -25_000 },
    {
      file: LOCAL_TIME_FILE,
      timezone: 'Europe/Warsaw',
      utcOffsetHours: 1,
      imported: 2,
      skipped: 3,
      netCents: -56_000,
    },
    { file: LOCAL_TIME_FILE, timezone: 'Europe/Kyiv', utcOffsetHours: 2, imported: 3, skipped: 2, netCents: -63_550 },
    {
      file: '3c-seam-edges-date-only.csv',
      timezone: 'UTC',
      utcOffsetHours: 0,
      imported: 2,
      skipped: 2,
      netCents: -43_620,
    },
    { file: '5-post-link-only.csv', timezone: 'UTC', utcOffsetHours: 0, imported: 0, skipped: 8, netCents: 0 },
  ],
  pln: [
    { file: '1-pre-link-clean.csv', timezone: 'UTC', utcOffsetHours: 0, imported: 10, skipped: 0, netCents: 527_041 },
    { file: '2-mixed.csv', timezone: 'UTC', utcOffsetHours: 0, imported: 5, skipped: 5, netCents: 593_351 },
    { file: '3-seam-edges.csv', timezone: 'UTC', utcOffsetHours: 0, imported: 2, skipped: 3, netCents: -6_120 },
    { file: LOCAL_TIME_FILE, timezone: 'UTC', utcOffsetHours: 0, imported: 1, skipped: 4, netCents: -2_500 },
    { file: LOCAL_TIME_FILE, timezone: 'Europe/Warsaw', utcOffsetHours: 1, imported: 2, skipped: 3, netCents: -5_600 },
    { file: LOCAL_TIME_FILE, timezone: 'Europe/Kyiv', utcOffsetHours: 2, imported: 3, skipped: 2, netCents: -6_350 },
    {
      file: '3c-seam-edges-date-only.csv',
      timezone: 'UTC',
      utcOffsetHours: 0,
      imported: 2,
      skipped: 2,
      netCents: -6_120,
    },
    { file: '5-post-link-only.csv', timezone: 'UTC', utcOffsetHours: 0, imported: 0, skipped: 8, netCents: 0 },
  ],
};

const ledgerFields = (tx: TransactionRow) => ({
  id: tx.id,
  amount: tx.amount,
  refAmount: tx.refAmount,
  time: tx.time,
  note: tx.note,
  accountType: tx.accountType,
  transactionType: tx.transactionType,
});

const DATASET_KEYS = Object.keys(SEAM_DATASETS) as SeamDatasetKey[];

describe.each(DATASET_KEYS)('CSV import of the %s dataset into its bank-linked account', (dataset) => {
  const config = SEAM_DATASETS[dataset];

  it.each(SCENARIOS[dataset])(
    '$file in $timezone: imports $imported rows before the seam and skips $skipped',
    async ({ file, timezone, utcOffsetHours, imported, skipped, netCents }) => {
      await asDatasetUser({
        dataset,
        fn: async () => {
          const { accountId } = await setupDatasetAccount({ dataset });
          const before = await helpers.snapshotSeamAccount({ accountId });
          expect(before.account.bankSeamAt).toBe(`${config.seamDay}T00:00:00.000Z`);

          const fileRows = parseDatasetRows({ csv: loadDatasetCsv({ dataset, file }) });
          const expectedRows = rowsBeforeSeam({ dataset, rows: fileRows, utcOffsetHours });
          expect(expectedRows).toHaveLength(imported);
          expect(sumCents({ rows: expectedRows })).toBe(netCents);

          const { preview, summary } = await importDataset({ dataset, accountId, file, timezone });

          expect(preview.skippedAfterBankSeam).toBe(skipped);
          expect(preview.validRows.map((row) => row.rowIndex)).toEqual(expectedRows.map((row) => row.rowIndex));
          expect(preview.invalidRows).toEqual([]);
          expect(preview.duplicates).toEqual([]);

          expect(summary.imported).toBe(imported);
          expect(summary.skippedAfterBankSeam).toBe(skipped);
          expect(summary.errors).toEqual([]);

          await expectBatchMatchesRows({ dataset, batchId: summary.batchId, rows: expectedRows, utcOffsetHours });
          const after = await helpers.expectImportOnlyMovedOpening({
            accountId,
            before,
            shift: centsToDecimal({ cents: -netCents }),
            seamDayKey: config.seamDay,
          });
          expect(after.account.currentBalance).toBe(config.bankBalance);
          expect(after.account.refCurrentBalance).toBe(before.account.refCurrentBalance);
          expect(after.account.refInitialBalance).toBe(
            centsToDecimal({ cents: Math.round(after.account.initialBalance * 100) * config.refRate }),
          );
          await expectPreSeamHistoryMatchesRows({ accountId, seamDay: config.seamDay, refRate: config.refRate });
        },
      });
    },
    30_000,
  );

  it('leaves the account, its rows and its history untouched when every row is from the seam on', async () => {
    await asDatasetUser({
      dataset,
      fn: async () => {
        const { accountId } = await setupDatasetAccount({ dataset });
        const before = await helpers.snapshotSeamAccount({ accountId });
        const rowsBefore = (await listAccountRows({ accountId })).map(ledgerFields);

        const { summary } = await importDataset({ dataset, accountId, file: '5-post-link-only.csv' });

        expect(summary.imported).toBe(0);
        expect(await helpers.snapshotSeamAccount({ accountId })).toEqual(before);
        expect((await listAccountRows({ accountId })).map(ledgerFields)).toEqual(rowsBefore);
      },
    });
  }, 30_000);
});

/** Rows 1-6 of each duplicates file copy the dataset's existing pre-seam rows; row 7 is one minor unit off. */
const DUPLICATE_COPIES = 6;

describe.each(DATASET_KEYS)('Duplicate review of the %s dataset on its bank-linked account', (dataset) => {
  const config = SEAM_DATASETS[dataset];
  const file = '4-duplicates.csv';
  const fileRows = () => parseDatasetRows({ csv: loadDatasetCsv({ dataset, file }) });

  it('flags exactly the six copies of existing pre-seam rows, each against its own row', async () => {
    await asDatasetUser({
      dataset,
      fn: async () => {
        const { accountId, existingRows } = await setupDatasetAccount({ dataset });
        const rows = fileRows();
        const copies = rows.slice(0, DUPLICATE_COPIES);

        const preview = await reviewDataset({ dataset, accountId, file });

        expect(preview.validRows).toHaveLength(rows.length);
        expect(preview.skippedAfterBankSeam).toBe(0);
        const existingIdOf = ({ day, cents }: { day: string; cents: number }) =>
          existingRows.find(
            (tx) => String(tx.time).slice(0, 10) === day && Math.round(Number(tx.amount) * 100) === Math.abs(cents),
          )!.id;
        expect(
          preview.duplicates
            .map((match) => ({
              rowIndex: match.rowIndex,
              existingId: match.existingTransaction.id,
              matchType: match.matchType,
              confidence: match.confidence,
            }))
            .toSorted((a, b) => a.rowIndex - b.rowIndex),
        ).toEqual(
          copies.map((row) => ({
            rowIndex: row.rowIndex,
            existingId: existingIdOf({ day: row.cell.slice(0, 10), cents: row.cents }),
            matchType: 'exact',
            confidence: 100,
          })),
        );
      },
    });
  }, 30_000);

  it.each([
    ['skipping every flagged row', true],
    ['keeping every flagged row', false],
  ] as [string, boolean][])(
    'imports with %s and moves only the opening balance',
    async (_, skipDuplicates) => {
      await asDatasetUser({
        dataset,
        fn: async () => {
          const { accountId } = await setupDatasetAccount({ dataset });
          const before = await helpers.snapshotSeamAccount({ accountId });
          const rows = fileRows();
          const importedRows = skipDuplicates ? rows.slice(DUPLICATE_COPIES) : rows;

          const { summary } = await importDataset({ dataset, accountId, file, skipDuplicates });

          expect(summary.imported).toBe(importedRows.length);
          expect(summary.skipped).toBe(skipDuplicates ? DUPLICATE_COPIES : 0);
          expect(summary.skippedAfterBankSeam).toBe(0);
          await expectBatchMatchesRows({ dataset, batchId: summary.batchId, rows: importedRows });
          await helpers.expectImportOnlyMovedOpening({
            accountId,
            before,
            shift: centsToDecimal({ cents: -sumCents({ rows: importedRows }) }),
            seamDayKey: config.seamDay,
          });
          await expectPreSeamHistoryMatchesRows({ accountId, seamDay: config.seamDay, refRate: config.refRate });
          expect((await helpers.readAccount({ accountId })).currentBalance).toBe(config.bankBalance);
        },
      });
    },
    30_000,
  );
});
