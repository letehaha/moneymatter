import {
  ACCOUNT_TYPES,
  AccountOptionValue,
  type AccountMappingConfig,
  CategoryOptionValue,
  type ColumnMappingConfig,
  CurrencyOptionValue,
  type RecordId,
  TRANSACTION_TYPES,
  TransactionTypeOptionValue,
} from '@bt/shared/types';
import { describe, expect, it } from '@jest/globals';
import { ERROR_CODES } from '@js/errors';
import * as helpers from '@tests/helpers';
import { expectCsvImportCompleted, waitForCsvImportCompletion } from '@tests/helpers/import-export';
import { addDays, addHours, format, startOfDay, subDays } from 'date-fns';

const TODAY = startOfDay(new Date());
const TODAY_KEY = format(TODAY, 'yyyy-MM-dd');
const dayKey = ({ daysAgo }: { daysAgo: number }) => format(subDays(TODAY, daysAgo), 'yyyy-MM-dd');

type BalanceRows = Awaited<ReturnType<typeof helpers.getBalanceHistory<true>>>;
type CsvRow = { date: string; amount: number; type: 'income' | 'expense'; description?: string; account?: string };

const chartCents = ({ rows }: { rows: BalanceRows }) =>
  Array.from({ length: 14 }, (_, index) => helpers.balanceCentsOn({ rows, date: subDays(addDays(TODAY, 1), index) }));

const createAccount = async ({ currencyCode = 'USD', name = 'Manual account' } = {}) =>
  helpers.createAccount({
    payload: helpers.buildAccountPayload({ name, currencyCode, initialBalance: 1000 }),
    raw: true,
  });

const createManualRow = async ({ accountId, amount, date }: { accountId: RecordId; amount: number; date: string }) => {
  const [category] = await helpers.getCategoriesList();
  const [tx] = await helpers.createTransaction({
    payload: helpers.buildTransactionPayload({
      accountId,
      categoryId: category!.id as RecordId,
      amount,
      transactionType: TRANSACTION_TYPES.expense,
      time: addHours(new Date(`${date}T00:00:00.000Z`), 12).toISOString(),
      note: 'Manual row',
    }),
    raw: true,
  });
  return tx!;
};

const buildCsv = ({ rows, currencyCode }: { rows: CsvRow[]; currencyCode: string }) =>
  [
    'Date,Amount,Description,Account,Currency,Type',
    ...rows.map(
      (row, index) =>
        `${row.date},${row.amount.toFixed(2)},${row.description ?? `Row ${index}`},${row.account ?? 'A'},${currencyCode},${row.type}`,
    ),
  ].join('\n');

const COLUMN_MAPPING: ColumnMappingConfig = {
  date: 'Date',
  dateFieldOrder: 'month-first',
  amount: 'Amount',
  description: 'Description',
  category: { option: CategoryOptionValue.mapDataSourceColumn, columnName: 'Category' },
  currency: { option: CurrencyOptionValue.dataSourceColumn, columnName: 'Currency' },
  transactionType: {
    option: TransactionTypeOptionValue.dataSourceColumn,
    columnName: 'Type',
    incomeValues: ['income'],
    expenseValues: ['expense'],
  },
  account: { option: AccountOptionValue.dataSourceColumn, columnName: 'Account' },
};

const detectCsv = ({
  rows,
  accountMapping,
  currencyCode = 'USD',
}: {
  rows: CsvRow[];
  accountMapping: AccountMappingConfig;
  currencyCode?: string;
}) =>
  helpers.detectDuplicates({
    payload: {
      fileContent: buildCsv({ rows, currencyCode }),
      delimiter: ',',
      columnMapping: COLUMN_MAPPING,
      accountMapping,
      categoryMapping: {},
    },
    raw: true,
  });

const executeCsv = async ({
  rows,
  accountMapping,
  currencyCode = 'USD',
  recalculateBalance,
  skipDuplicateIndices = [],
  skippedAfterBankSeam,
}: {
  rows: CsvRow[];
  accountMapping: AccountMappingConfig;
  currencyCode?: string;
  recalculateBalance?: boolean;
  skipDuplicateIndices?: number[];
  skippedAfterBankSeam?: number;
}) => {
  const { jobId } = await helpers.executeImport({
    payload: {
      fileContent: buildCsv({ rows, currencyCode }),
      delimiter: ',',
      columnMapping: COLUMN_MAPPING,
      accountMapping,
      categoryMapping: {},
      skipDuplicateIndices,
      recalculateBalance,
      skippedAfterBankSeam,
    },
    raw: true,
  });
  return waitForCsvImportCompletion({ jobId, timeoutMs: 120_000 });
};

const importInto = async (params: Parameters<typeof executeCsv>[0]) => {
  const progress = await executeCsv(params);
  expectCsvImportCompleted(progress);
  return progress.summary;
};

const SPANNING_ROWS: CsvRow[] = [
  { date: dayKey({ daysAgo: 8 }), amount: 40, type: 'expense' },
  { date: dayKey({ daysAgo: 6 }), amount: 15, type: 'income' },
  { date: dayKey({ daysAgo: 3 }), amount: 25, type: 'expense' },
  { date: TODAY_KEY, amount: 7, type: 'expense' },
  { date: format(addDays(TODAY, 1), 'yyyy-MM-dd'), amount: 9, type: 'income' },
];

describe('CSV import into an account with a bank seam', () => {
  it('imports the rows before the seam as manual history and skips the rest', async () => {
    await helpers.asBaseCurrencyUser({
      currencyCode: 'USD',
      fn: async () => {
        const account = await helpers.createSeamAccount();
        const before = await helpers.snapshotSeamAccount({ accountId: account.id });
        const accountMapping: AccountMappingConfig = { A: { action: 'link-existing', accountId: account.id } };

        const preview = await detectCsv({ rows: SPANNING_ROWS, accountMapping });
        expect(preview.skippedAfterBankSeam).toBe(2);
        expect(preview.validRows).toHaveLength(3);
        expect(preview.duplicates).toEqual([]);

        const summary = await importInto({ rows: SPANNING_ROWS, accountMapping });

        expect(summary.imported).toBe(3);
        expect(summary.skippedAfterBankSeam).toBe(2);
        expect(summary.errors).toEqual([]);
        expect(summary.accountBalanceChanges).toEqual([
          expect.objectContaining({
            accountId: account.id,
            balanceBefore: 1200,
            balanceAfter: 1200,
            delta: 0,
            movedCount: 0,
            historicalCount: 3,
            isNewAccount: false,
          }),
        ]);

        const created = await helpers.getTransactions({ batchId: summary.batchId, raw: true });
        expect(created).toHaveLength(3);
        expect(created.every((tx) => tx.accountType === ACCOUNT_TYPES.system)).toBe(true);
        expect(created.every((tx) => helpers.dateKey({ date: tx.time }) < TODAY_KEY)).toBe(true);

        await helpers.expectImportOnlyMovedOpening({
          accountId: account.id,
          before,
          shift: helpers.SPANNING_PRE_SEAM_NET_OUT,
        });
      },
    });
  });

  it('fails without importing anything when the account was unlinked after the review, and imports once reviewed again', async () => {
    await helpers.asBaseCurrencyUser({
      currencyCode: 'USD',
      fn: async () => {
        const account = await helpers.createSeamAccount();
        const accountMapping: AccountMappingConfig = { A: { action: 'link-existing', accountId: account.id } };
        const preview = await detectCsv({ rows: SPANNING_ROWS, accountMapping });
        expect(preview.skippedAfterBankSeam).toBe(2);

        const unlinked = await helpers.unlinkAccountFromBankConnection({ id: account.id, raw: false });
        expect(unlinked.statusCode).toBe(200);
        const before = await helpers.snapshotSeamAccount({ accountId: account.id });

        const progress = await executeCsv({
          rows: SPANNING_ROWS,
          accountMapping,
          skippedAfterBankSeam: preview.skippedAfterBankSeam,
        });
        expect(progress.status).toBe('failed');
        if (progress.status !== 'failed') throw new Error('unreachable');
        expect(progress.failure?.code).toBe('bank-link-changed');
        expect(await helpers.snapshotSeamAccount({ accountId: account.id })).toEqual(before);
        expect(await helpers.getTransactions({ accountIds: [account.id], raw: true })).toHaveLength(1);

        const reviewedAgain = await detectCsv({ rows: SPANNING_ROWS, accountMapping });
        expect(reviewedAgain.skippedAfterBankSeam).toBe(0);
        const summary = await importInto({
          rows: SPANNING_ROWS,
          accountMapping,
          skippedAfterBankSeam: reviewedAgain.skippedAfterBankSeam,
        });
        expect(summary.imported).toBe(SPANNING_ROWS.length);
      },
    });
  });

  it('creates nothing and touches no balance for a file dated from the seam on', async () => {
    await helpers.asBaseCurrencyUser({
      currencyCode: 'USD',
      fn: async () => {
        const account = await helpers.createSeamAccount();
        const before = await helpers.snapshotSeamAccount({ accountId: account.id });
        const rows = SPANNING_ROWS.slice(3);
        const accountMapping: AccountMappingConfig = { A: { action: 'link-existing', accountId: account.id } };

        const preview = await detectCsv({ rows, accountMapping });
        expect(preview.skippedAfterBankSeam).toBe(2);
        expect(preview.validRows).toEqual([]);

        const summary = await importInto({ rows, accountMapping });

        expect(summary.imported).toBe(0);
        expect(summary.skippedAfterBankSeam).toBe(2);
        expect(await helpers.getTransactions({ batchId: summary.batchId, raw: true })).toEqual([]);
        expect(await helpers.snapshotSeamAccount({ accountId: account.id })).toEqual(before);
      },
    });
  });

  it('detects duplicates of existing pre-seam rows like on a manual account', async () => {
    await helpers.asBaseCurrencyUser({
      currencyCode: 'USD',
      fn: async () => {
        const account = await helpers.createSeamAccount();
        const accountMapping: AccountMappingConfig = { A: { action: 'link-existing', accountId: account.id } };
        const rows: CsvRow[] = [
          { date: dayKey({ daysAgo: 10 }), amount: 100, type: 'expense', description: 'Manual row' },
          { date: dayKey({ daysAgo: 4 }), amount: 30, type: 'expense' },
        ];

        const preview = await detectCsv({ rows, accountMapping });
        expect(preview.duplicates.map((match) => match.rowIndex)).toEqual([preview.validRows[0]!.rowIndex]);

        const before = await helpers.snapshotSeamAccount({ accountId: account.id });
        const summary = await importInto({
          rows,
          accountMapping,
          skipDuplicateIndices: preview.duplicates.map((match) => match.rowIndex),
        });

        expect(summary.imported).toBe(1);
        expect(summary.skipped).toBe(1);
        await helpers.expectImportOnlyMovedOpening({ accountId: account.id, before, shift: 30 });
      },
    });
  });

  it('ignores recalculateBalance for the seam account and applies it to a manual account in the same file', async () => {
    await helpers.asBaseCurrencyUser({
      currencyCode: 'USD',
      fn: async () => {
        const seamAccount = await helpers.createSeamAccount();
        const manualAccount = await createAccount({ name: 'Wallet' });
        await createManualRow({ accountId: manualAccount.id, amount: 10, date: dayKey({ daysAgo: 5 }) });
        const seamBefore = await helpers.snapshotSeamAccount({ accountId: seamAccount.id });
        const manualBefore = await helpers.readAccount({ accountId: manualAccount.id });

        const summary = await importInto({
          rows: [
            { date: dayKey({ daysAgo: 7 }), amount: 20, type: 'expense', account: 'A' },
            { date: dayKey({ daysAgo: 1 }), amount: 5, type: 'expense', account: 'A' },
            { date: dayKey({ daysAgo: 1 }), amount: 30, type: 'expense', account: 'B' },
          ],
          accountMapping: {
            A: { action: 'link-existing', accountId: seamAccount.id },
            B: { action: 'link-existing', accountId: manualAccount.id },
          },
          recalculateBalance: true,
        });

        expect(summary.imported).toBe(3);
        await helpers.expectImportOnlyMovedOpening({ accountId: seamAccount.id, before: seamBefore, shift: 25 });
        expect((await helpers.readAccount({ accountId: manualAccount.id })).currentBalance).toBe(
          Number(manualBefore.currentBalance) - 30,
        );
        expect(summary.accountBalanceChanges).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ accountId: seamAccount.id, delta: 0, historicalCount: 2 }),
            expect.objectContaining({ accountId: manualAccount.id, delta: -30, movedCount: 1 }),
          ]),
        );

        const undone = await helpers.deleteImportBatch({ batchId: summary.batchId, raw: true });
        expect(undone.deletedCount).toBe(3);
        const manualAfterUndo = await helpers.readAccount({ accountId: manualAccount.id });
        expect(manualAfterUndo.currentBalance).toBe(990);
        expect(manualAfterUndo.initialBalance).toBe(1000);
        expect(await helpers.snapshotSeamAccount({ accountId: seamAccount.id })).toEqual(seamBefore);
      },
    });
  });

  it('keeps the seam split for a foreign-currency account', async () => {
    const seededDays = Array.from({ length: 14 }, (_, daysAgo) => subDays(TODAY, daysAgo));
    try {
      // 0.5 EUR per USD: every EUR amount converts to exactly twice as many USD.
      for (const date of seededDays) {
        await helpers.seedUsdExchangeRates({ date, ratesPerUsd: { EUR: 0.5 } });
      }

      await helpers.asBaseCurrencyUser({
        currencyCode: 'USD',
        fn: async () => {
          const account = await helpers.createSeamAccount({ currencyCode: 'EUR' });
          const before = await helpers.snapshotSeamAccount({ accountId: account.id });
          expect(before.account.initialBalance).toBe(1300);
          expect(before.account.refInitialBalance).toBe(2600);

          const summary = await importInto({
            rows: SPANNING_ROWS,
            currencyCode: 'EUR',
            accountMapping: { A: { action: 'link-existing', accountId: account.id } },
          });

          expect(summary.imported).toBe(3);
          expect(summary.skippedAfterBankSeam).toBe(2);
          const after = await helpers.expectImportOnlyMovedOpening({
            accountId: account.id,
            before,
            shift: helpers.SPANNING_PRE_SEAM_NET_OUT,
          });
          expect(after.account.refInitialBalance).toBe(2700);
          expect(after.account.refCurrentBalance).toBe(before.account.refCurrentBalance);
        },
      });
    } finally {
      await helpers.clearExchangeRatesForDates({ dates: seededDays });
    }
  });

  it('skips the rows from the seam on when the whole file goes to the seam account without an account column', async () => {
    await helpers.asBaseCurrencyUser({
      currencyCode: 'USD',
      fn: async () => {
        const account = await helpers.createSeamAccount();
        const before = await helpers.snapshotSeamAccount({ accountId: account.id });
        const fileContent = [
          'Date,Amount,Description,Currency,Type',
          ...SPANNING_ROWS.map((row, index) => `${row.date},${row.amount.toFixed(2)},Row ${index},USD,${row.type}`),
        ].join('\n');
        const request = {
          fileContent,
          delimiter: ',',
          columnMapping: {
            ...COLUMN_MAPPING,
            account: { option: AccountOptionValue.existingAccount, accountId: account.id },
          } satisfies ColumnMappingConfig,
          accountMapping: {},
          categoryMapping: {},
        };

        const preview = await helpers.detectDuplicates({ payload: request, raw: true });
        expect(preview.skippedAfterBankSeam).toBe(2);
        expect(preview.validRows).toHaveLength(3);

        const { jobId } = await helpers.executeImport({
          payload: { ...request, skipDuplicateIndices: [] },
          raw: true,
        });
        const progress = await waitForCsvImportCompletion({ jobId, timeoutMs: 120_000 });
        expectCsvImportCompleted(progress);

        expect(progress.summary.imported).toBe(3);
        expect(progress.summary.skippedAfterBankSeam).toBe(2);
        const after = await helpers.expectImportOnlyMovedOpening({
          accountId: account.id,
          before,
          shift: helpers.SPANNING_PRE_SEAM_NET_OUT,
        });
        expect(after.account.currentBalance).toBe(1200);
      },
    });
  });

  it('lets the statement importer into a seam account, and rejects both importers once the seam is dropped or never set', async () => {
    await helpers.asBaseCurrencyUser({
      currencyCode: 'USD',
      fn: async () => {
        const providerAccount = await helpers.createAccount({
          payload: helpers.buildAccountPayload({
            name: 'Monobank card',
            currencyCode: 'USD',
            type: ACCOUNT_TYPES.monobank,
          }),
          raw: true,
        });
        const seamAccount = await helpers.createSeamAccount();
        const coffee = {
          date: `${dayKey({ daysAgo: 4 })} 10:00:00`,
          description: 'Coffee',
          amount: 5,
          type: 'expense' as const,
        };
        const statement = await helpers.statementExecuteImportAndWait({
          payload: { accountId: seamAccount.id, transactions: [coffee], skipIndices: [] },
        });
        expect(statement.imported).toBe(1);

        await helpers.dropSeam({ accountId: seamAccount.id });
        const { jobId } = await helpers.statementExecuteImport({
          payload: { accountId: seamAccount.id, transactions: [{ ...coffee, description: 'Tea' }], skipIndices: [] },
          raw: true,
        });
        expect((await helpers.waitForStatementImportCompletion({ jobId })).status).toBe('failed');

        for (const accountId of [providerAccount.id, seamAccount.id]) {
          const progress = await executeCsv({
            rows: SPANNING_ROWS,
            accountMapping: { A: { action: 'link-existing', accountId } },
          });
          expect(progress.status).toBe('failed');
        }

        expect(await helpers.getTransactions({ accountIds: [providerAccount.id], raw: true })).toEqual([]);
        const seamRows = await helpers.getTransactions({ accountIds: [seamAccount.id], raw: true });
        expect(seamRows.map((tx) => tx.note).toSorted()).toEqual(['Coffee', 'Manual row']);
      },
    });
  });
});

/** Deletes the −40 row and turns the +15 row into +20: the batch now nets −5. */
const reshapeBatchRows = async ({ batchId }: { batchId: string }) => {
  const rows = await helpers.getTransactions({ batchId, raw: true });
  const expense40 = rows.find((tx) => Number(tx.amount) === 40)!;
  const income15 = rows.find((tx) => Number(tx.amount) === 15)!;
  expect((await helpers.deleteTransaction({ id: expense40.id })).statusCode).toBe(200);
  await helpers.updateTransaction({ id: income15.id, payload: { amount: 20 }, raw: true });
};
const RESHAPED_BATCH_NET = -5;

describe('Undoing a CSV import on an account with a bank seam', () => {
  it('returns every balance to its pre-import value while still linked', async () => {
    await helpers.asBaseCurrencyUser({
      currencyCode: 'USD',
      fn: async () => {
        const account = await helpers.createSeamAccount();
        const before = await helpers.snapshotSeamAccount({ accountId: account.id });
        const summary = await importInto({
          rows: SPANNING_ROWS,
          accountMapping: { A: { action: 'link-existing', accountId: account.id } },
        });

        const result = await helpers.deleteImportBatch({ batchId: summary.batchId, raw: true });
        expect(result.deletedCount).toBe(3);

        const after = await helpers.snapshotSeamAccount({ accountId: account.id });
        expect(after.account).toEqual(before.account);
        expect(after.history).toEqual(before.history);
      },
    });
  });

  it('keeps the current balance and removes the rows from history after the account was unlinked', async () => {
    await helpers.asBaseCurrencyUser({
      currencyCode: 'USD',
      fn: async () => {
        const account = await helpers.createSeamAccount();
        const before = await helpers.snapshotSeamAccount({ accountId: account.id });
        const summary = await importInto({
          rows: SPANNING_ROWS,
          accountMapping: { A: { action: 'link-existing', accountId: account.id } },
        });
        await helpers.unlinkAccountFromBankConnection({ id: account.id, raw: true });
        const unlinked = await helpers.snapshotSeamAccount({ accountId: account.id });

        const result = await helpers.deleteImportBatch({ batchId: summary.batchId, raw: true });
        expect(result.deletedCount).toBe(3);

        const after = await helpers.snapshotSeamAccount({ accountId: account.id });
        expect(after.account.currentBalance).toBe(unlinked.account.currentBalance);
        expect(after.account.initialBalance).toBe(before.account.initialBalance);
        expect(after.account.refInitialBalance).toBe(before.account.refInitialBalance);
        expect(chartCents({ rows: after.history })).toEqual(chartCents({ rows: before.history }));
      },
    });
  });

  it('undoes a batch imported while the account was manual once the account has a seam', async () => {
    await helpers.asBaseCurrencyUser({
      currencyCode: 'USD',
      fn: async () => {
        const account = await createAccount();
        await createManualRow({ accountId: account.id, amount: 100, date: dayKey({ daysAgo: 10 }) });
        const summary = await importInto({
          rows: SPANNING_ROWS.slice(0, 3),
          accountMapping: { A: { action: 'link-existing', accountId: account.id } },
        });
        await helpers.linkToLunchFlow({ accountId: account.id });
        const linked = await helpers.snapshotSeamAccount({ accountId: account.id });

        const result = await helpers.deleteImportBatch({ batchId: summary.batchId, raw: true });
        expect(result.deletedCount).toBe(3);

        await helpers.expectImportOnlyMovedOpening({
          accountId: account.id,
          before: linked,
          shift: -helpers.SPANNING_PRE_SEAM_NET_OUT,
        });
      },
    });
  });

  it('refuses to undo a batch imported while manual that holds rows dated on or after the link day', async () => {
    await helpers.asBaseCurrencyUser({
      currencyCode: 'USD',
      fn: async () => {
        const account = await createAccount();
        const summary = await importInto({
          rows: SPANNING_ROWS,
          accountMapping: { A: { action: 'link-existing', accountId: account.id } },
        });
        await helpers.linkToLunchFlow({ accountId: account.id });
        const linked = await helpers.snapshotSeamAccount({ accountId: account.id });

        const response = await helpers.deleteImportBatch({ batchId: summary.batchId });
        expect(response.statusCode).toBe(ERROR_CODES.ValidationError);
        expect(await helpers.getTransactions({ batchId: summary.batchId, raw: true })).toHaveLength(
          SPANNING_ROWS.length,
        );
        expect(await helpers.snapshotSeamAccount({ accountId: account.id })).toEqual(linked);
      },
    });
  });

  it('ends as if never imported when rows were deleted and edited while linked, then unlinked', async () => {
    await helpers.asBaseCurrencyUser({
      currencyCode: 'USD',
      fn: async () => {
        const account = await helpers.createSeamAccount();
        const before = await helpers.snapshotSeamAccount({ accountId: account.id });
        const summary = await importInto({
          rows: SPANNING_ROWS,
          accountMapping: { A: { action: 'link-existing', accountId: account.id } },
        });
        await reshapeBatchRows({ batchId: summary.batchId });
        await helpers.unlinkAccountFromBankConnection({ id: account.id, raw: true });
        const unlinked = await helpers.snapshotSeamAccount({ accountId: account.id });

        await helpers.deleteImportBatch({ batchId: summary.batchId, raw: true });

        const after = await helpers.snapshotSeamAccount({ accountId: account.id });
        expect(after.account.currentBalance).toBe(unlinked.account.currentBalance);
        expect(after.account.initialBalance).toBe(before.account.initialBalance);
        expect(after.account.refInitialBalance).toBe(before.account.refInitialBalance);
        expect(chartCents({ rows: after.history })).toEqual(chartCents({ rows: before.history }));
      },
    });
  });

  it('ends as if never imported for a batch imported while manual, reshaped while linked, then unlinked', async () => {
    await helpers.asBaseCurrencyUser({
      currencyCode: 'USD',
      fn: async () => {
        const account = await createAccount();
        await createManualRow({ accountId: account.id, amount: 100, date: dayKey({ daysAgo: 10 }) });
        const summary = await importInto({
          rows: SPANNING_ROWS.slice(0, 3),
          accountMapping: { A: { action: 'link-existing', accountId: account.id } },
        });
        await helpers.linkToLunchFlow({ accountId: account.id });
        await reshapeBatchRows({ batchId: summary.batchId });
        await helpers.unlinkAccountFromBankConnection({ id: account.id, raw: true });
        const unlinked = await helpers.snapshotSeamAccount({ accountId: account.id });

        await helpers.deleteImportBatch({ batchId: summary.batchId, raw: true });

        const after = await helpers.snapshotSeamAccount({ accountId: account.id });
        expect(after.account.currentBalance).toBe(unlinked.account.currentBalance);
        expect(after.account.initialBalance).toBe(unlinked.account.initialBalance + RESHAPED_BATCH_NET);
      },
    });
  });

  it('still refuses to undo a batch on a bank account without a seam', async () => {
    await helpers.asBaseCurrencyUser({
      currencyCode: 'USD',
      fn: async () => {
        const account = await createAccount();
        const summary = await importInto({
          rows: SPANNING_ROWS.slice(0, 3),
          accountMapping: { A: { action: 'link-existing', accountId: account.id } },
        });
        await helpers.linkToLunchFlow({ accountId: account.id });
        await helpers.dropSeam({ accountId: account.id });

        const response = await helpers.deleteImportBatch({ batchId: summary.batchId });
        expect(response.statusCode).toBe(ERROR_CODES.ValidationError);
        expect(await helpers.getTransactions({ batchId: summary.batchId, raw: true })).toHaveLength(3);
      },
    });
  });

  it('undoes an oversized batch in the background with the same result', async () => {
    await helpers.asBaseCurrencyUser({
      currencyCode: 'USD',
      fn: async () => {
        const account = await helpers.createSeamAccount();
        const before = await helpers.snapshotSeamAccount({ accountId: account.id });
        const rows: CsvRow[] = Array.from({ length: 1001 }, (_, index) => ({
          date: dayKey({ daysAgo: 2 + (index % 5) }),
          amount: 1 + index * 0.01,
          type: 'expense',
        }));
        const summary = await importInto({
          rows,
          accountMapping: { A: { action: 'link-existing', accountId: account.id } },
        });
        expect(summary.imported).toBe(1001);

        const response = await helpers.deleteImportBatch({ batchId: summary.batchId });
        expect(response.statusCode).toBe(202);
        const status = await helpers.waitForImportBatchDelete({ timeoutMs: 120_000 });
        expect(status).toMatchObject({ state: 'completed', deletedCount: 1001 });

        const after = await helpers.snapshotSeamAccount({ accountId: account.id });
        expect(after.account).toEqual(before.account);
        expect(after.history).toEqual(before.history);
      },
    });
  }, 300_000);
});

describe('Changing the base currency with a seam account', () => {
  it('leaves the native seam state alone and ends consistent with the seam rebuild', async () => {
    await helpers.asBaseCurrencyUser({
      currencyCode: 'USD',
      fn: async () => {
        const account = await helpers.createSeamAccount();
        const nativeBefore = await helpers.readAccount({ accountId: account.id });

        const status = await helpers.changeBaseCurrencyAndWait({ newCurrencyCode: 'EUR' });
        expect(status.state).toBe('completed');

        const changed = await helpers.snapshotSeamAccount({ accountId: account.id });
        expect(changed.account.initialBalance).toBe(nativeBefore.initialBalance);
        expect(changed.account.currentBalance).toBe(nativeBefore.currentBalance);

        const [row] = await helpers.getTransactions({ accountIds: [account.id], raw: true });
        await helpers.updateTransaction({ id: row!.id, payload: { amount: 101 }, raw: true });
        await helpers.updateTransaction({ id: row!.id, payload: { amount: 100 }, raw: true });

        expect(await helpers.snapshotSeamAccount({ accountId: account.id })).toEqual(changed);
      },
    });
  });
});
