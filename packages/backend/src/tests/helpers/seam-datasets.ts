import {
  ACCOUNT_TYPES,
  AccountOptionValue,
  type CategoryMappingConfig,
  CategoryOptionValue,
  type ColumnMappingConfig,
  CurrencyOptionValue,
  type RecordId,
  TRANSACTION_TYPES,
  TransactionTypeOptionValue,
  asDecimal,
} from '@bt/shared/types';
import { Money } from '@common/types/money';
import { expect } from '@jest/globals';
import * as helpers from '@tests/helpers';
import { expectCsvImportCompleted, loadCsvFixture, waitForCsvImportCompletion } from '@tests/helpers/import-export';
import {
  LUNCHFLOW_EXTERNAL_ACCOUNT_ID,
  getLunchFlowBalanceMock,
  getLunchFlowTransactionsMock,
} from '@tests/mocks/lunchflow/mock-api';

type ExistingRow = { day: string; cents: number; description: string };

type SeamDataset = {
  folder: string;
  accountName: string;
  currencyCode: string;
  baseCurrencyCode: string;
  /** Base-currency units per account-currency unit, set as the user's manual rate. */
  refRate: number;
  seamDay: string;
  bankBalance: number;
  existingRows: ExistingRow[];
};

export const SEAM_DATASETS = {
  uah: {
    folder: 'monobank-main-uah',
    accountName: 'Monobank main',
    currencyCode: 'UAH',
    baseCurrencyCode: 'UAH',
    refRate: 1,
    seamDay: '2025-11-08',
    bankBalance: 113_099.54,
    existingRows: [
      { day: '2025-01-22', cents: -42_852, description: 'Tefal Grill' },
      { day: '2025-10-24', cents: 970_000, description: 'Incoming transfer' },
      { day: '2025-11-01', cents: -268_770, description: 'ORLEN' },
      { day: '2025-11-04', cents: -84_370, description: 'Claude' },
      { day: '2025-11-04', cents: -33_706, description: 'Spotify' },
      { day: '2025-11-07', cents: -119_848, description: 'Orange Polska' },
    ],
  },
  pln: {
    folder: 'personal-pln',
    accountName: 'Personal',
    currencyCode: 'PLN',
    baseCurrencyCode: 'USD',
    refRate: 2,
    seamDay: '2025-12-24',
    bankBalance: 1_562.87,
    existingRows: [
      { day: '2025-09-10', cents: -20_000, description: 'Gym membership' },
      { day: '2025-10-08', cents: 547_617, description: 'Salary - Acme Sp. z o.o.' },
      { day: '2025-11-05', cents: -15_500, description: 'Bakery cake' },
      { day: '2025-12-07', cents: -6_299, description: 'Card payment' },
      { day: '2025-12-13', cents: -6_655, description: 'Card payment' },
      { day: '2025-12-16', cents: 95_000, description: 'PRZELEW BLIK NA TELEFON' },
    ],
  },
} satisfies Record<string, SeamDataset>;

export type SeamDatasetKey = keyof typeof SEAM_DATASETS;

type DatasetRow = { rowIndex: number; cell: string; cents: number; description: string; category: string };

export type TransactionRow = Awaited<ReturnType<typeof helpers.getTransactions<true>>>[number];

const CSV_LINE = /^([^,]*),([^,]*),("(?:[^"]|"")*"|[^,]*),(.*)$/;

export const loadDatasetCsv = ({ dataset, file }: { dataset: SeamDatasetKey; file: string }) =>
  loadCsvFixture(`bank-seam/${SEAM_DATASETS[dataset].folder}/${file}`);

/** `rowIndex` follows the importer: 1-based with the header as row 1. */
export const parseDatasetRows = ({ csv }: { csv: string }): DatasetRow[] =>
  csv
    .trim()
    .split('\n')
    .slice(1)
    .map((line, index) => {
      const [, cell, amount, description, category] = CSV_LINE.exec(line.trim())!;
      return {
        rowIndex: index + 2,
        cell: cell!,
        cents: Math.round(Number(amount) * 100),
        description: description!.startsWith('"') ? description!.slice(1, -1).replaceAll('""', '"') : description!,
        category: category!,
      };
    });

/** The importer keeps zoned cells as-is, anchors date-only cells at local noon and reads wall clocks as local time. */
const instantOf = ({ cell, utcOffsetHours = 0 }: { cell: string; utcOffsetHours?: number }) => {
  if (cell.endsWith('Z')) return new Date(cell);
  const [datePart, timePart = '12:00'] = cell.split(' ');
  return new Date(Date.parse(`${datePart}T${timePart}:00.000Z`) - utcOffsetHours * 3_600_000);
};

const seamStartOf = ({ dataset }: { dataset: SeamDatasetKey }) =>
  new Date(`${SEAM_DATASETS[dataset].seamDay}T00:00:00.000Z`);

export const rowsBeforeSeam = ({
  dataset,
  rows,
  utcOffsetHours = 0,
}: {
  dataset: SeamDatasetKey;
  rows: DatasetRow[];
  utcOffsetHours?: number;
}) => rows.filter((row) => instantOf({ cell: row.cell, utcOffsetHours }) < seamStartOf({ dataset }));

export const sumCents = ({ rows }: { rows: { cents: number }[] }) => rows.reduce((sum, row) => sum + row.cents, 0);

export const centsToDecimal = ({ cents }: { cents: number }) => Money.fromCents(cents).toNumber();

export const asDatasetUser = async ({ dataset, fn }: { dataset: SeamDatasetKey; fn: () => Promise<void> }) => {
  const config = SEAM_DATASETS[dataset];
  await helpers.asBaseCurrencyUser({
    currencyCode: config.baseCurrencyCode,
    fn: async () => {
      if (config.currencyCode !== config.baseCurrencyCode) {
        await helpers.addUserCurrencies({ currencyCodes: [config.currencyCode], raw: true });
        await helpers.updateUserCurrency({
          currency: { currencyCode: config.currencyCode, liveRateUpdate: false },
          raw: true,
        });
        await helpers.editCurrencyExchangeRate({
          pairs: [
            { baseCode: config.currencyCode, quoteCode: config.baseCurrencyCode, rate: config.refRate },
            { baseCode: config.baseCurrencyCode, quoteCode: config.currencyCode, rate: 1 / config.refRate },
          ],
          raw: true,
        });
      }
      await fn();
    },
  });
};

export type BankFeedRow = { id: string; time: string; cents: number; description: string };

export const mockBankFeed = ({
  dataset,
  balance,
  feed = [],
}: {
  dataset: SeamDatasetKey;
  balance: number;
  feed?: BankFeedRow[];
}) => {
  const { currencyCode } = SEAM_DATASETS[dataset];
  global.mswMockServer.use(
    getLunchFlowTransactionsMock({
      accountId: LUNCHFLOW_EXTERNAL_ACCOUNT_ID,
      response: {
        transactions: feed.map((row) => ({
          id: row.id,
          accountId: Number(LUNCHFLOW_EXTERNAL_ACCOUNT_ID),
          amount: asDecimal(row.cents / 100),
          currency: currencyCode,
          date: row.time,
          merchant: row.description,
          description: row.description,
          isPending: false,
        })),
        total: feed.length,
      },
    }),
    getLunchFlowBalanceMock({
      accountId: LUNCHFLOW_EXTERNAL_ACCOUNT_ID,
      response: { balance: { amount: asDecimal(balance), currency: currencyCode } },
    }),
  );
};

/**
 * The dataset's account with its six existing pre-seam rows, linked to LunchFlow and then given the
 * dataset's past seam. No row sits between that seam and today, so the stamped seam balance still holds.
 */
export const setupDatasetAccount = async ({ dataset }: { dataset: SeamDatasetKey }) => {
  const config = SEAM_DATASETS[dataset];
  const account = await helpers.createAccount({
    payload: helpers.buildAccountPayload({
      name: config.accountName,
      currencyCode: config.currencyCode,
      initialBalance: 0,
    }),
    raw: true,
  });
  const [category] = await helpers.getCategoriesList();

  const existingRows: TransactionRow[] = [];
  for (const row of config.existingRows) {
    const [tx] = await helpers.createTransaction({
      payload: helpers.buildTransactionPayload({
        accountId: account.id,
        categoryId: category!.id as RecordId,
        amount: centsToDecimal({ cents: Math.abs(row.cents) }),
        transactionType: row.cents >= 0 ? TRANSACTION_TYPES.income : TRANSACTION_TYPES.expense,
        time: `${row.day}T12:00:00.000Z`,
        note: row.description,
      }),
      raw: true,
    });
    existingRows.push(tx as unknown as TransactionRow);
  }

  const { connectionId } = await helpers.linkToLunchFlow({
    accountId: account.id,
    currency: config.currencyCode,
    balance: config.bankBalance,
  });
  await helpers.backdateLink({ accountId: account.id, linkedAt: new Date(`${config.seamDay}T09:00:00.000Z`) });

  return { accountId: account.id as RecordId, connectionId, existingRows };
};

const columnMappingOf = ({ accountId, currencyCode }: { accountId: string; currencyCode: string }) =>
  ({
    date: 'date',
    dateFieldOrder: 'day-first',
    amount: 'amount',
    description: 'description',
    category: { option: CategoryOptionValue.mapDataSourceColumn, columnName: 'category' },
    currency: { option: CurrencyOptionValue.existingCurrency, currencyCode },
    transactionType: { option: TransactionTypeOptionValue.amountSign },
    account: { option: AccountOptionValue.existingAccount, accountId },
  }) satisfies ColumnMappingConfig;

const categoryMappingOf = ({ rows }: { rows: DatasetRow[] }): CategoryMappingConfig =>
  Object.fromEntries([...new Set(rows.map((row) => row.category))].map((name) => [name, { action: 'create-new' }]));

type DatasetFileParams = { dataset: SeamDatasetKey; accountId: string; file: string; timezone?: string };

const importRequestOf = ({ dataset, accountId, file, timezone }: DatasetFileParams) => {
  const fileContent = loadDatasetCsv({ dataset, file });
  return {
    fileContent,
    delimiter: ',',
    columnMapping: columnMappingOf({ accountId, currencyCode: SEAM_DATASETS[dataset].currencyCode }),
    accountMapping: {},
    categoryMapping: categoryMappingOf({ rows: parseDatasetRows({ csv: fileContent }) }),
    timezone,
  };
};

export const reviewDataset = (params: DatasetFileParams) =>
  helpers.detectDuplicates({ payload: importRequestOf(params), raw: true });

export const importDataset = async ({
  skipDuplicates = false,
  ...params
}: DatasetFileParams & { skipDuplicates?: boolean }) => {
  const request = importRequestOf(params);
  const preview = await helpers.detectDuplicates({ payload: request, raw: true });
  const { jobId } = await helpers.executeImport({
    payload: {
      ...request,
      skipDuplicateIndices: skipDuplicates ? preview.duplicates.map((match) => match.rowIndex) : [],
      skippedAfterBankSeam: preview.skippedAfterBankSeam,
    },
    raw: true,
  });
  const progress = await waitForCsvImportCompletion({ jobId, timeoutMs: 25_000 });
  expectCsvImportCompleted(progress);
  return { preview, summary: progress.summary };
};

export const listAccountRows = ({ accountId }: { accountId: string }) =>
  helpers.getTransactions({ accountIds: [accountId], limit: 1000, raw: true });

export const listBatchRows = ({ batchId }: { batchId: string }) =>
  helpers.getTransactions({ batchId, limit: 1000, raw: true });

const signedCentsOf = ({ tx }: { tx: TransactionRow }) =>
  (tx.transactionType === TRANSACTION_TYPES.income ? 1 : -1) * Money.fromDecimal(Number(tx.amount)).toCents();

export const signedSumCents = ({ rows }: { rows: TransactionRow[] }) =>
  rows.reduce((sum, tx) => sum + signedCentsOf({ tx }), 0);

export const findRow = ({ rows, note }: { rows: TransactionRow[]; note: string }) => {
  const matches = rows.filter((tx) => tx.note === note);
  expect(matches).toHaveLength(1);
  return matches[0]!;
};

export const historyCents = ({ rows }: { rows: { date: string | Date; amount: unknown }[] }) =>
  rows
    .map((row) => ({ date: helpers.dateKey({ date: row.date }), cents: Math.round(Number(row.amount) * 100) }))
    .toSorted((a, b) => a.date.localeCompare(b.date));

export const expectPreSeamHistoryMatchesRows = async ({
  accountId,
  seamDay,
  refRate,
}: {
  accountId: string;
  seamDay: string;
  refRate: number;
}) => {
  const preSeam = await helpers.expectPreSeamHistoryConsistent({ accountId, seamDayKey: seamDay, refRate });
  expect(preSeam).not.toHaveLength(0);
};

const byTimeThenNote = (a: { time: string; note: string | null }, b: { time: string; note: string | null }) =>
  a.time.localeCompare(b.time) || (a.note ?? '').localeCompare(b.note ?? '');

export const expectBatchMatchesRows = async ({
  dataset,
  batchId,
  rows,
  utcOffsetHours = 0,
}: {
  dataset: SeamDatasetKey;
  batchId: string;
  rows: DatasetRow[];
  utcOffsetHours?: number;
}) => {
  const { refRate } = SEAM_DATASETS[dataset];
  const [batch, categories] = await Promise.all([listBatchRows({ batchId }), helpers.getCategoriesList()]);
  const categoryNameById = new Map(categories.map((category) => [category.id, category.name.toLowerCase()]));

  expect(
    batch
      .map((tx) => ({
        time: new Date(tx.time).toISOString(),
        note: tx.note,
        amount: Number(tx.amount),
        refAmount: Number(tx.refAmount),
        transactionType: tx.transactionType,
        accountType: tx.accountType,
        category: categoryNameById.get(tx.categoryId!),
      }))
      .toSorted(byTimeThenNote),
  ).toEqual(
    rows
      .map((row) => ({
        time: instantOf({ cell: row.cell, utcOffsetHours }).toISOString(),
        note: row.description,
        amount: centsToDecimal({ cents: Math.abs(row.cents) }),
        refAmount: centsToDecimal({ cents: Math.abs(row.cents) * refRate }),
        transactionType: row.cents >= 0 ? TRANSACTION_TYPES.income : TRANSACTION_TYPES.expense,
        accountType: ACCOUNT_TYPES.system,
        category: row.category.toLowerCase(),
      }))
      .toSorted(byTimeThenNote),
  );
  return batch;
};
