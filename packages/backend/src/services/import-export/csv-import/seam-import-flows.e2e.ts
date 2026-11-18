import { ACCOUNT_TYPES, type RecordId, TRANSACTION_TRANSFER_NATURE, TRANSACTION_TYPES } from '@bt/shared/types';
import { Money } from '@common/types/money';
import { describe, expect, it } from '@jest/globals';
import { ERROR_CODES } from '@js/errors';
import * as helpers from '@tests/helpers';
import {
  type BankFeedRow,
  SEAM_DATASETS,
  type SeamDatasetKey,
  type TransactionRow,
  asDatasetUser,
  centsToDecimal,
  expectBatchMatchesRows,
  expectPreSeamHistoryMatchesRows,
  findRow,
  historyCents,
  importDataset,
  listAccountRows,
  listBatchRows,
  loadDatasetCsv,
  mockBankFeed,
  parseDatasetRows,
  rowsBeforeSeam,
  setupDatasetAccount,
  signedSumCents,
  sumCents,
} from '@tests/helpers/seam-datasets';
import { LUNCHFLOW_EXTERNAL_ACCOUNT_ID } from '@tests/mocks/lunchflow/mock-api';

const DATASETS = Object.keys(SEAM_DATASETS) as SeamDatasetKey[];
const MIXED_FILE = '2-mixed.csv';
const TEST_TIMEOUT = 30_000;
const DAY_MS = 86_400_000;

const shiftDay = ({ day, days }: { day: string; days: number }) =>
  new Date(Date.parse(`${day}T00:00:00.000Z`) + days * DAY_MS).toISOString().slice(0, 10);

const notesOf = ({ rows }: { rows: TransactionRow[] }) => rows.map((tx) => tx.note).toSorted();

const batchFields = (tx: TransactionRow) => ({
  id: tx.id,
  amount: tx.amount,
  refAmount: tx.refAmount,
  time: tx.time,
  note: tx.note,
  categoryId: tx.categoryId,
  accountType: tx.accountType,
  transactionType: tx.transactionType,
  originalId: tx.originalId,
});

const byId = (a: { id: string }, b: { id: string }) => a.id.localeCompare(b.id);

const STATS_MONTH: Record<SeamDatasetKey, { from: string; to: string }> = {
  uah: { from: '2023-05-01', to: '2023-05-31' },
  pln: { from: '2024-01-01', to: '2024-01-31' },
};

const toRow = (row: ReturnType<typeof parseDatasetRows>[number]) => ({
  note: row.description,
  cents: row.cents,
  day: row.cell.slice(0, 10),
});

/** Both mixed files hold five rows before the seam: three expenses, one income, one expense. */
const mixedFileOf = ({ dataset }: { dataset: SeamDatasetKey }) => {
  const fileRows = parseDatasetRows({ csv: loadDatasetCsv({ dataset, file: MIXED_FILE }) });
  const preSeamRows = rowsBeforeSeam({ dataset, rows: fileRows });
  const preSeamIndices = new Set(preSeamRows.map((row) => row.rowIndex));
  type Row = ReturnType<typeof toRow>;
  const [first, second, third, income, last] = preSeamRows.map(toRow) as [Row, Row, Row, Row, Row];
  const postSeam = fileRows.filter((row) => !preSeamIndices.has(row.rowIndex)).map(toRow);
  return { preSeamRows, first, second, third, income, last, postSeam };
};

const syncBank = async ({ connectionId, accountId }: { connectionId: string; accountId: string }) => {
  await helpers.bankDataProviders.syncTransactionsForAccount({ connectionId, accountId, raw: true });
};

describe.each(DATASETS)('%s dataset', (dataset) => {
  const CONFIG = SEAM_DATASETS[dataset];
  const SEAM_DAY = CONFIG.seamDay;
  const { preSeamRows, first, second, third, income, last, postSeam } = mixedFileOf({ dataset });
  const PAST_SEAM_TIME = `${shiftDay({ day: SEAM_DAY, days: 12 })}T10:00:00.000Z`;

  /** Bank rows the feed reports from the seam on, plus a pre-link copy of the first imported row. */
  const BANK_ROWS_FROM_SEAM: BankFeedRow[] = [postSeam[0]!, postSeam[2]!, postSeam[4]!].map((row, index) => ({
    id: `lf-${index}`,
    time: `${row.day}T09:00:00.000Z`,
    cents: row.cents,
    description: row.note,
  }));
  const BANK_FEED: BankFeedRow[] = [
    ...BANK_ROWS_FROM_SEAM,
    { id: 'lf-pre-link', time: `${first.day}T12:00:00.000Z`, cents: first.cents, description: first.note },
  ];

  const toRef = ({ amount }: { amount: number }) => Money.fromDecimal(amount).multiply(CONFIG.refRate).toNumber();

  const setupImported = async ({ file = MIXED_FILE }: { file?: string } = {}) => {
    const { accountId, connectionId, existingRows } = await setupDatasetAccount({ dataset });
    const beforeImport = await helpers.snapshotSeamAccount({ accountId });
    const { summary } = await importDataset({ dataset, accountId, file });
    const batch = await listBatchRows({ batchId: summary.batchId });
    const imported = await helpers.snapshotSeamAccount({ accountId });
    return { accountId, connectionId, existingRows, batchId: summary.batchId, batch, beforeImport, imported };
  };

  const expectOpeningShift = async ({
    accountId,
    before,
    cents,
    seamDayKey = SEAM_DAY,
  }: {
    accountId: string;
    before: Awaited<ReturnType<typeof helpers.snapshotSeamAccount>>;
    cents: number;
    seamDayKey?: string;
  }) => {
    const after = await helpers.expectImportOnlyMovedOpening({
      accountId,
      before,
      shift: centsToDecimal({ cents }),
      seamDayKey,
      refRate: CONFIG.refRate,
    });
    expect({
      refInitialBalance: after.account.refInitialBalance,
      refCurrentBalance: after.account.refCurrentBalance,
    }).toEqual({
      refInitialBalance: toRef({ amount: after.account.initialBalance }),
      refCurrentBalance: toRef({ amount: after.account.currentBalance }),
    });
    return after;
  };

  const expectHistoryConsistent = ({ accountId, seamDay = SEAM_DAY }: { accountId: string; seamDay?: string }) =>
    expectPreSeamHistoryMatchesRows({ accountId, seamDay, refRate: CONFIG.refRate });

  const syncOneBankRow = async ({ connectionId, accountId }: { connectionId: string; accountId: string }) => {
    mockBankFeed({ dataset, balance: CONFIG.bankBalance, feed: [BANK_ROWS_FROM_SEAM[0]!] });
    await syncBank({ connectionId, accountId });
    const bankRow = findRow({ rows: await listAccountRows({ accountId }), note: BANK_ROWS_FROM_SEAM[0]!.description });
    expect(bankRow.accountType).toBe(ACCOUNT_TYPES.lunchflow);
    return bankRow;
  };

  const createPreSeamTransferFromCash = async ({ accountId }: { accountId: string }) => {
    const cash = await helpers.createAccount({
      payload: helpers.buildAccountPayload({ name: 'Cash', currencyCode: CONFIG.currencyCode, initialBalance: 5000 }),
      raw: true,
    });
    const [category] = await helpers.getCategoriesList();
    const [fromLeg, toLeg] = await helpers.createTransaction({
      payload: helpers.buildTransactionPayload({
        accountId: cash.id,
        amount: 1000,
        destinationAmount: 1000,
        destinationAccountId: accountId as RecordId,
        transferNature: TRANSACTION_TRANSFER_NATURE.common_transfer,
        transactionType: TRANSACTION_TYPES.expense,
        time: `${shiftDay({ day: SEAM_DAY, days: -5 })}T15:00:00.000Z`,
        categoryId: category!.id as RecordId,
      }),
      raw: true,
    });
    return { cash, fromLeg: fromLeg!, toLeg: toLeg! };
  };

  describe('Imported pre-seam rows in the transaction list', () => {
    it(
      'lists them on the account as manual rows with their amounts and categories, and nothing from the seam on',
      async () => {
        await asDatasetUser({
          dataset,
          fn: async () => {
            const { accountId, batchId } = await setupImported();
            await expectBatchMatchesRows({ dataset, batchId, rows: preSeamRows });

            const all = await listAccountRows({ accountId });
            expect(notesOf({ rows: all })).toEqual(
              [
                ...CONFIG.existingRows.map((row) => row.description),
                ...preSeamRows.map((row) => row.description),
              ].toSorted(),
            );
            expect([...new Set(all.map((tx) => tx.accountType))]).toEqual([ACCOUNT_TYPES.system]);

            const inRange = await helpers.getTransactions({
              accountIds: [accountId],
              from: `${second.day}T00:00:00.000Z`,
              to: `${third.day}T23:59:59.999Z`,
              limit: 100,
              raw: true,
            });
            const inRangeNotes = [
              ...CONFIG.existingRows.map((row) => ({ day: row.day, note: row.description })),
              first,
              second,
              third,
              income,
              last,
            ]
              .filter((row) => row.day >= second.day && row.day <= third.day)
              .map((row) => row.note)
              .toSorted();
            expect(inRangeNotes.length).toBeGreaterThan(2);
            expect(notesOf({ rows: inRange })).toEqual(inRangeNotes);

            const searched = await helpers.getTransactions({ accountIds: [accountId], search: last.note, raw: true });
            expect(notesOf({ rows: searched })).toEqual([last.note]);
            const byNote = await helpers.getTransactions({
              accountIds: [accountId],
              noteSearch: first.note,
              raw: true,
            });
            expect(notesOf({ rows: byNote })).toEqual([first.note]);

            const fromSeam = await helpers.getTransactions({
              accountIds: [accountId],
              from: `${SEAM_DAY}T00:00:00.000Z`,
              raw: true,
            });
            expect(fromSeam).toEqual([]);
            expect(
              await helpers.getTransactions({ accountIds: [accountId], search: postSeam[1]!.note, raw: true }),
            ).toEqual([]);
          },
        });
      },
      TEST_TIMEOUT,
    );
  });

  describe('Editing one imported pre-seam row', () => {
    it(
      'an amount edit moves only the opening balance',
      async () => {
        await asDatasetUser({
          dataset,
          fn: async () => {
            const { accountId, batch, imported } = await setupImported();
            const row = findRow({ rows: batch, note: first.note });

            const response = await helpers.updateTransaction({
              id: row.id,
              payload: { amount: centsToDecimal({ cents: Math.abs(first.cents) + 10_000 }) },
            });
            expect(response.statusCode).toBe(200);

            await expectOpeningShift({ accountId, before: imported, cents: 10_000 });
            await expectHistoryConsistent({ accountId });
          },
        });
      },
      TEST_TIMEOUT,
    );

    it(
      'a date edit that stays before the seam keeps both balances and re-derives the days in between',
      async () => {
        await asDatasetUser({
          dataset,
          fn: async () => {
            const { accountId, batch, imported } = await setupImported();
            const row = findRow({ rows: batch, note: third.note });
            const time = `${shiftDay({ day: SEAM_DAY, days: -1 })}T18:00:00.000Z`;

            const response = await helpers.updateTransaction({ id: row.id, payload: { time } });
            expect(response.statusCode).toBe(200);

            const after = await expectOpeningShift({ accountId, before: imported, cents: 0 });
            const moved = await helpers.getTransactionById({ id: row.id, raw: true });
            expect(new Date(moved!.time).toISOString()).toBe(time);
            const dayBetween = new Date(`${shiftDay({ day: third.day, days: 1 })}T00:00:00.000Z`);
            expect(
              helpers.balanceCentsOn({ rows: after.history, date: dayBetween }) -
                helpers.balanceCentsOn({ rows: imported.history, date: dayBetween }),
            ).toBe(-third.cents * CONFIG.refRate);
            await expectHistoryConsistent({ accountId });
          },
        });
      },
      TEST_TIMEOUT,
    );

    it(
      'a category and note edit changes no balance',
      async () => {
        await asDatasetUser({
          dataset,
          fn: async () => {
            const { accountId, batch, imported } = await setupImported();
            const row = findRow({ rows: batch, note: first.note });
            const otherCategoryId = findRow({ rows: batch, note: last.note }).categoryId!;
            expect(otherCategoryId).not.toBe(row.categoryId);
            const note = `${first.note}, lunch with the team`;

            const response = await helpers.updateTransaction({
              id: row.id,
              payload: { categoryId: otherCategoryId as RecordId, note },
            });
            expect(response.statusCode).toBe(200);

            const edited = await helpers.getTransactionById({ id: row.id, raw: true });
            expect({ categoryId: edited!.categoryId, note: edited!.note, amount: edited!.amount }).toEqual({
              categoryId: otherCategoryId,
              note,
              amount: centsToDecimal({ cents: Math.abs(first.cents) }),
            });
            expect(await helpers.snapshotSeamAccount({ accountId })).toEqual(imported);
          },
        });
      },
      TEST_TIMEOUT,
    );

    it(
      'refuses moving the row onto or past the seam, naming the seam day',
      async () => {
        await asDatasetUser({
          dataset,
          fn: async () => {
            const { accountId, batch, imported } = await setupImported();
            const row = findRow({ rows: batch, note: last.note });

            for (const time of [`${SEAM_DAY}T00:00:00.000Z`, PAST_SEAM_TIME]) {
              const response = await helpers.updateTransaction({ id: row.id, payload: { time } });
              expect(response.statusCode).toBe(ERROR_CODES.ValidationError);
              expect(helpers.errorMessage({ response })).toContain(SEAM_DAY);
            }

            const unchanged = await helpers.getTransactionById({ id: row.id, raw: true });
            expect(new Date(unchanged!.time).toISOString()).toBe(new Date(row.time).toISOString());
            expect(await helpers.snapshotSeamAccount({ accountId })).toEqual(imported);
          },
        });
      },
      TEST_TIMEOUT,
    );

    it(
      'deleting the row moves the opening balance by its signed amount',
      async () => {
        await asDatasetUser({
          dataset,
          fn: async () => {
            const { accountId, batch, imported } = await setupImported();
            const row = findRow({ rows: batch, note: income.note });

            expect((await helpers.deleteTransaction({ id: row.id })).statusCode).toBe(200);

            expect(await helpers.getTransactionById({ id: row.id, raw: true })).toBeNull();
            await expectOpeningShift({ accountId, before: imported, cents: income.cents });
            await expectHistoryConsistent({ accountId });
          },
        });
      },
      TEST_TIMEOUT,
    );
  });

  describe('Bulk actions on imported pre-seam rows', () => {
    it(
      'a bulk category change touches no balance',
      async () => {
        await asDatasetUser({
          dataset,
          fn: async () => {
            const { accountId, batch, imported } = await setupImported();
            const ids = [first, second, third].map((row) => findRow({ rows: batch, note: row.note }).id as RecordId);
            const incomeCategoryId = findRow({ rows: batch, note: income.note }).categoryId! as RecordId;

            const result = await helpers.bulkUpdateTransactions({
              payload: { transactionIds: ids, categoryId: incomeCategoryId },
              raw: true,
            });

            expect(result.updatedCount).toBe(3);
            expect(result.updatedIds.toSorted()).toEqual(ids.toSorted());
            const updated = await helpers.getTransactionsByIds({ ids, raw: true });
            expect(updated.map((tx) => tx.categoryId)).toEqual(ids.map(() => incomeCategoryId));
            expect(await helpers.snapshotSeamAccount({ accountId })).toEqual(imported);
          },
        });
      },
      TEST_TIMEOUT,
    );

    it(
      'a bulk tag, note and exclude-from-stats edit touches no balance',
      async () => {
        await asDatasetUser({
          dataset,
          fn: async () => {
            const { accountId, batch, imported } = await setupImported();
            const ids = [first, income, last].map((row) => findRow({ rows: batch, note: row.note }).id as RecordId);
            const tag = await helpers.createTag({ payload: helpers.buildTagPayload(), raw: true });

            const result = await helpers.bulkUpdateTransactions({
              payload: {
                transactionIds: ids,
                tagIds: [tag.id as RecordId],
                tagMode: 'add',
                note: 'Reviewed',
                excludeFromStats: true,
              },
              raw: true,
            });

            expect(result.updatedCount).toBe(3);
            expect(result.updatedIds.toSorted()).toEqual(ids.toSorted());
            const rowsById = new Map((await listAccountRows({ accountId })).map((tx) => [tx.id, tx]));
            expect(
              ids.map((id) => {
                const tx = rowsById.get(id)!;
                return { note: tx.note, excludeFromStats: tx.excludeFromStats, tagIds: tx.tags?.map((t) => t.id) };
              }),
            ).toEqual(ids.map(() => ({ note: 'Reviewed', excludeFromStats: true, tagIds: [tag.id] })));
            expect(await helpers.snapshotSeamAccount({ accountId })).toEqual(imported);
          },
        });
      },
      TEST_TIMEOUT,
    );

    it(
      'a bulk category and tag edit over an imported row and a bank row updates both and touches no balance',
      async () => {
        await asDatasetUser({
          dataset,
          fn: async () => {
            const { accountId, connectionId, batch } = await setupImported();
            const bankRow = await syncOneBankRow({ connectionId, accountId });
            const importedRow = findRow({ rows: batch, note: first.note });
            const before = await helpers.snapshotSeamAccount({ accountId });
            const categoryId = findRow({ rows: batch, note: last.note }).categoryId! as RecordId;
            const tag = await helpers.createTag({ payload: helpers.buildTagPayload(), raw: true });
            const ids = [importedRow.id, bankRow.id] as RecordId[];

            const result = await helpers.bulkUpdateTransactions({
              payload: { transactionIds: ids, categoryId, tagIds: [tag.id as RecordId], tagMode: 'add' },
              raw: true,
            });

            expect(result.updatedIds.toSorted()).toEqual(ids.toSorted());
            const rowsById = new Map((await listAccountRows({ accountId })).map((tx) => [tx.id, tx]));
            expect(
              ids.map((id) => ({
                categoryId: rowsById.get(id)!.categoryId,
                tagIds: rowsById.get(id)!.tags?.map((t) => t.id),
                amount: rowsById.get(id)!.amount,
              })),
            ).toEqual([
              { categoryId, tagIds: [tag.id], amount: importedRow.amount },
              { categoryId, tagIds: [tag.id], amount: bankRow.amount },
            ]);
            expect(await helpers.snapshotSeamAccount({ accountId })).toEqual(before);
          },
        });
      },
      TEST_TIMEOUT,
    );

    it(
      'a bulk delete of imported rows moves the opening balance by their signed sum',
      async () => {
        await asDatasetUser({
          dataset,
          fn: async () => {
            const { accountId, batchId, batch, imported } = await setupImported();
            const ids = [first, income].map((row) => findRow({ rows: batch, note: row.note }).id as RecordId);

            const result = await helpers.bulkDeleteTransactions({ payload: { transactionIds: ids }, raw: true });

            expect(result.deletedCount).toBe(2);
            expect(result.deletedIds.toSorted()).toEqual(ids.toSorted());
            expect(result.skippedIds).toEqual([]);
            expect(notesOf({ rows: await listBatchRows({ batchId }) })).toEqual(
              [second, third, last].map((row) => row.note).toSorted(),
            );
            await expectOpeningShift({ accountId, before: imported, cents: first.cents + income.cents });
            await expectHistoryConsistent({ accountId });
          },
        });
      },
      TEST_TIMEOUT,
    );

    it(
      'a bulk delete of pre-seam transfer legs removes both legs and restores both accounts',
      async () => {
        await asDatasetUser({
          dataset,
          fn: async () => {
            const { accountId, imported } = await setupImported();
            const { cash, fromLeg, toLeg } = await createPreSeamTransferFromCash({ accountId });
            const ids = [fromLeg.id, toLeg.id] as RecordId[];

            const result = await helpers.bulkDeleteTransactions({ payload: { transactionIds: ids }, raw: true });

            // The twin leaves with its pair, so it is not counted again.
            expect(result.deletedCount).toBe(1);
            expect(result.skippedIds).toEqual([]);
            expect(await helpers.getTransactionsByIds({ ids, raw: true })).toEqual([]);

            await expectOpeningShift({ accountId, before: imported, cents: 0 });
            await expectHistoryConsistent({ accountId });

            const cashAfter = await helpers.readAccount({ accountId: cash.id });
            expect({ currentBalance: cashAfter.currentBalance, initialBalance: cashAfter.initialBalance }).toEqual({
              currentBalance: 5000,
              initialBalance: 5000,
            });
            const cashHistory = await helpers.getBalanceHistory({ accountId: cash.id, raw: true });
            expect([...new Set(historyCents({ rows: cashHistory }).map((row) => row.cents))]).toEqual([
              500_000 * CONFIG.refRate,
            ]);
          },
        });
      },
      TEST_TIMEOUT,
    );

    it(
      'refuses a bulk delete that includes a bank row and deletes nothing',
      async () => {
        await asDatasetUser({
          dataset,
          fn: async () => {
            const { accountId, connectionId, batch } = await setupImported();
            const bankRow = await syncOneBankRow({ connectionId, accountId });
            const before = await helpers.snapshotSeamAccount({ accountId });
            const ids = [
              findRow({ rows: batch, note: first.note }).id,
              findRow({ rows: batch, note: second.note }).id,
              bankRow.id,
            ] as RecordId[];

            const response = await helpers.bulkDeleteTransactions({ payload: { transactionIds: ids } });

            expect(response.statusCode).toBe(ERROR_CODES.ValidationError);
            const error = response.body.response as unknown as { details?: { disallowedIds?: string[] } };
            expect(error.details?.disallowedIds).toEqual([bankRow.id]);
            expect((await helpers.getTransactionsByIds({ ids, raw: true })).map((tx) => tx.id).toSorted()).toEqual(
              ids.toSorted(),
            );
            expect(await helpers.snapshotSeamAccount({ accountId })).toEqual(before);
          },
        });
      },
      TEST_TIMEOUT,
    );
  });

  describe('Trashing an imported pre-seam row', () => {
    it(
      'returns every balance to its value after the import once the row is restored',
      async () => {
        await asDatasetUser({
          dataset,
          fn: async () => {
            const { accountId, batch, imported } = await setupImported();
            const row = findRow({ rows: batch, note: third.note });

            expect((await helpers.deleteTransaction({ id: row.id })).statusCode).toBe(200);
            await expectOpeningShift({ accountId, before: imported, cents: third.cents });

            const restored = await helpers.restoreTrash({ transactionIds: [row.id as RecordId] });
            expect(restored.statusCode).toBe(200);

            const after = await helpers.snapshotSeamAccount({ accountId });
            expect(after.account).toEqual(imported.account);
            expect(historyCents({ rows: after.history })).toEqual(historyCents({ rows: imported.history }));
            const back = await helpers.getTransactionById({ id: row.id, raw: true });
            expect({ amount: back!.amount, time: new Date(back!.time).toISOString() }).toEqual({
              amount: Math.abs(centsToDecimal({ cents: third.cents })),
              time: new Date(row.time).toISOString(),
            });
            await expectHistoryConsistent({ accountId });
          },
        });
      },
      TEST_TIMEOUT,
    );
  });

  describe('Undoing a dataset import on a bank-linked account', () => {
    it(
      'restores the account and its history exactly while still linked',
      async () => {
        await asDatasetUser({
          dataset,
          fn: async () => {
            const { accountId, batchId, beforeImport } = await setupImported();

            const result = await helpers.deleteImportBatch({ batchId, raw: true });

            expect(result.deletedCount).toBe(5);
            expect(await listBatchRows({ batchId })).toEqual([]);
            expect(await helpers.snapshotSeamAccount({ accountId })).toEqual(beforeImport);
          },
        });
      },
      TEST_TIMEOUT,
    );

    it(
      'restores the account exactly while still linked after batch rows were edited, trashed and bulk-deleted',
      async () => {
        await asDatasetUser({
          dataset,
          fn: async () => {
            const { accountId, batchId, batch, beforeImport } = await setupImported();
            const idOf = ({ note }: { note: string }) => findRow({ rows: batch, note }).id as RecordId;

            const amountEdit = await helpers.updateTransaction({
              id: idOf(first),
              payload: { amount: centsToDecimal({ cents: Math.abs(first.cents) + 10_000 }) },
            });
            expect(amountEdit.statusCode).toBe(200);
            const dateEdit = await helpers.updateTransaction({
              id: idOf(third),
              payload: { time: `${shiftDay({ day: SEAM_DAY, days: -1 })}T18:00:00.000Z` },
            });
            expect(dateEdit.statusCode).toBe(200);
            expect((await helpers.deleteTransaction({ id: idOf(second) })).statusCode).toBe(200);
            const bulkDeleted = await helpers.bulkDeleteTransactions({
              payload: { transactionIds: [idOf(income)] },
              raw: true,
            });
            expect(bulkDeleted.deletedCount).toBe(1);

            const result = await helpers.deleteImportBatch({ batchId, raw: true });

            expect(result.deletedCount).toBe(5);
            expect(await listBatchRows({ batchId })).toEqual([]);
            expect(await helpers.snapshotSeamAccount({ accountId })).toEqual(beforeImport);
          },
        });
      },
      TEST_TIMEOUT,
    );

    it(
      'keeps the current balance and restores the opening balance when undone after unlink',
      async () => {
        await asDatasetUser({
          dataset,
          fn: async () => {
            const { accountId, batchId, beforeImport } = await setupImported();
            expect((await helpers.unlinkAccountFromBankConnection({ id: accountId, raw: false })).statusCode).toBe(200);
            const unlinked = await helpers.readAccount({ accountId });

            const result = await helpers.deleteImportBatch({ batchId, raw: true });

            expect(result.deletedCount).toBe(5);
            const after = await helpers.readAccount({ accountId });
            expect({ currentBalance: after.currentBalance, initialBalance: after.initialBalance }).toEqual({
              currentBalance: unlinked.currentBalance,
              initialBalance: beforeImport.account.initialBalance,
            });
          },
        });
      },
      TEST_TIMEOUT,
    );
  });

  describe('Unlinking and relinking after a dataset import', () => {
    it(
      'makes the imported rows fully editable once unlinked, with the current balance following them',
      async () => {
        await asDatasetUser({
          dataset,
          fn: async () => {
            const { accountId, batch, imported } = await setupImported();

            expect((await helpers.unlinkAccountFromBankConnection({ id: accountId, raw: false })).statusCode).toBe(200);
            const unlinked = await helpers.readAccount({ accountId });
            expect({
              type: unlinked.type,
              bankSeamAt: unlinked.bankSeamAt,
              currentBalance: unlinked.currentBalance,
              initialBalance: unlinked.initialBalance,
            }).toEqual({
              type: ACCOUNT_TYPES.system,
              bankSeamAt: null,
              currentBalance: CONFIG.bankBalance,
              initialBalance: imported.account.initialBalance,
            });

            const edited = await helpers.updateTransaction({
              id: findRow({ rows: batch, note: first.note }).id,
              payload: { amount: centsToDecimal({ cents: Math.abs(first.cents) + 10_000 }) },
            });
            expect(edited.statusCode).toBe(200);
            const moved = await helpers.updateTransaction({
              id: findRow({ rows: batch, note: last.note }).id,
              payload: { time: PAST_SEAM_TIME },
            });
            expect(moved.statusCode).toBe(200);

            const after = await helpers.readAccount({ accountId });
            const rows = await listAccountRows({ accountId });
            expect({ currentBalance: after.currentBalance, initialBalance: after.initialBalance }).toEqual({
              currentBalance: centsToDecimal({ cents: Math.round(CONFIG.bankBalance * 100) - 10_000 }),
              initialBalance: imported.account.initialBalance,
            });
            expect(Math.round(after.currentBalance * 100)).toBe(
              Math.round(after.initialBalance * 100) + signedSumCents({ rows }),
            );
          },
        });
      },
      TEST_TIMEOUT,
    );

    it(
      'stamps a new seam on relink and keeps every imported row as editable history',
      async () => {
        await asDatasetUser({
          dataset,
          fn: async () => {
            const { accountId, connectionId, batchId, batch } = await setupImported();
            await helpers.unlinkAccountFromBankConnection({ id: accountId, raw: true });
            const movedRow = findRow({ rows: batch, note: last.note });
            await helpers.updateTransaction({ id: movedRow.id, payload: { time: PAST_SEAM_TIME }, raw: true });

            const relinkBalanceCents = 12_000_000;
            mockBankFeed({ dataset, balance: centsToDecimal({ cents: relinkBalanceCents }) });
            const dayBeforeRelink = helpers.dateKey({ date: new Date() });
            await helpers.bankDataProviders.connectSelectedAccounts({
              connectionId,
              accountExternalIds: [LUNCHFLOW_EXTERNAL_ACCOUNT_ID],
              raw: true,
            });

            const relinked = await helpers.snapshotSeamAccount({ accountId });
            const relinkDay = relinked.account.bankSeamAt!.slice(0, 10);
            expect([dayBeforeRelink, helpers.dateKey({ date: new Date() })]).toContain(relinkDay);
            const rows = await listAccountRows({ accountId });
            expect({
              type: relinked.account.type,
              bankSeamAt: relinked.account.bankSeamAt,
              currentBalance: relinked.account.currentBalance,
              initialBalance: relinked.account.initialBalance,
            }).toEqual({
              type: ACCOUNT_TYPES.lunchflow,
              bankSeamAt: `${relinkDay}T00:00:00.000Z`,
              currentBalance: centsToDecimal({ cents: relinkBalanceCents }),
              initialBalance: centsToDecimal({ cents: relinkBalanceCents - signedSumCents({ rows }) }),
            });

            const batchAfter = await listBatchRows({ batchId });
            const shape = (tx: TransactionRow) => ({
              id: tx.id,
              amount: tx.amount,
              accountType: tx.accountType,
              time: tx.id === movedRow.id ? PAST_SEAM_TIME : new Date(tx.time).toISOString(),
            });
            expect(batchAfter.map(shape).toSorted(byId)).toEqual(
              batch.map((tx) => ({ ...shape(tx), accountType: ACCOUNT_TYPES.system })).toSorted(byId),
            );
            expect(new Date(findRow({ rows: batchAfter, note: last.note }).time).toISOString()).toBe(PAST_SEAM_TIME);
            await expectHistoryConsistent({ accountId, seamDay: relinkDay });

            const edited = await helpers.updateTransaction({
              id: findRow({ rows: batchAfter, note: first.note }).id,
              payload: { amount: centsToDecimal({ cents: Math.abs(first.cents) + 10_000 }) },
            });
            expect(edited.statusCode).toBe(200);
            await expectOpeningShift({ accountId, before: relinked, cents: 10_000, seamDayKey: relinkDay });
          },
        });
      },
      TEST_TIMEOUT,
    );
  });

  describe('Bank sync after a dataset import', () => {
    it(
      'adds only the bank rows from the seam on and leaves the imported rows and pre-seam history alone',
      async () => {
        await asDatasetUser({
          dataset,
          fn: async () => {
            const { accountId, connectionId, batchId, batch, imported } = await setupImported();
            const syncedBalanceCents =
              Math.round(CONFIG.bankBalance * 100) +
              sumCents({ rows: BANK_ROWS_FROM_SEAM.map(({ cents }) => ({ cents })) });
            mockBankFeed({ dataset, balance: centsToDecimal({ cents: syncedBalanceCents }), feed: BANK_FEED });

            await syncBank({ connectionId, accountId });

            const rows = await listAccountRows({ accountId });
            const bankRows = rows.filter((tx) => tx.accountType !== ACCOUNT_TYPES.system);
            expect(
              bankRows
                .map((tx) => ({
                  originalId: tx.originalId,
                  accountType: tx.accountType,
                  time: new Date(tx.time).toISOString(),
                  amount: tx.amount,
                  transactionType: tx.transactionType,
                }))
                .toSorted((a, b) => a.time.localeCompare(b.time)),
            ).toEqual(
              BANK_ROWS_FROM_SEAM.map((row) => ({
                originalId: row.id,
                accountType: ACCOUNT_TYPES.lunchflow,
                time: row.time,
                amount: Math.abs(centsToDecimal({ cents: row.cents })),
                transactionType: row.cents >= 0 ? TRANSACTION_TYPES.income : TRANSACTION_TYPES.expense,
              })),
            );
            expect(rows.filter((tx) => tx.note === first.note).map((tx) => tx.id)).toEqual([
              findRow({ rows: batch, note: first.note }).id,
            ]);

            expect((await listBatchRows({ batchId })).map(batchFields).toSorted(byId)).toEqual(
              batch.map(batchFields).toSorted(byId),
            );

            const after = await helpers.snapshotSeamAccount({ accountId });
            expect(after.account.initialBalance).toBe(imported.account.initialBalance);
            expect(after.account.currentBalance).toBe(centsToDecimal({ cents: syncedBalanceCents }));
            expect(after.account.refInitialBalance).toBe(imported.account.refInitialBalance);
            const preSeam = ({ history }: { history: typeof after.history }) =>
              historyCents({ rows: history }).filter((row) => row.date < SEAM_DAY);
            expect(preSeam(after)).toEqual(preSeam(imported));
            await expectHistoryConsistent({ accountId });

            await syncBank({ connectionId, accountId });
            expect((await listAccountRows({ accountId })).map((tx) => tx.id).toSorted()).toEqual(
              rows.map((tx) => tx.id).toSorted(),
            );
          },
        });
      },
      TEST_TIMEOUT,
    );
  });

  describe('Cash flow over imported pre-seam rows', () => {
    it(
      'counts the rows in the base currency and drops them after a bulk delete',
      async () => {
        const file = '1-pre-link-clean.csv';
        const fileRows = parseDatasetRows({ csv: loadDatasetCsv({ dataset, file }) });
        const totalsOf = ({ rows }: { rows: { cents: number }[] }) => {
          const incomeCents = sumCents({ rows: rows.filter((row) => row.cents > 0) }) * CONFIG.refRate;
          const expenseCents = -sumCents({ rows: rows.filter((row) => row.cents < 0) }) * CONFIG.refRate;
          return {
            income: centsToDecimal({ cents: incomeCents }),
            expenses: centsToDecimal({ cents: expenseCents }),
            netFlow: centsToDecimal({ cents: incomeCents - expenseCents }),
          };
        };

        await asDatasetUser({
          dataset,
          fn: async () => {
            const { accountId, batch, imported } = await setupImported({ file });
            const readTotals = async () => {
              const cashFlow = await helpers.getCashFlow({
                ...STATS_MONTH[dataset],
                granularity: 'monthly',
                accountId,
                raw: true,
              });
              expect(cashFlow.periods).toHaveLength(1);
              const { income: totalIncome, expenses, netFlow } = cashFlow.totals;
              return { income: totalIncome, expenses, netFlow };
            };

            expect(await readTotals()).toEqual(totalsOf({ rows: fileRows }));

            const largestIncome = fileRows.reduce((max, row) => (row.cents > max.cents ? row : max));
            const removed = [largestIncome, fileRows[0]!];
            const result = await helpers.bulkDeleteTransactions({
              payload: {
                transactionIds: removed.map((row) => findRow({ rows: batch, note: row.description }).id as RecordId),
              },
              raw: true,
            });
            expect(result.deletedCount).toBe(2);

            expect(await readTotals()).toEqual(totalsOf({ rows: fileRows.filter((row) => !removed.includes(row)) }));
            await expectOpeningShift({ accountId, before: imported, cents: sumCents({ rows: removed }) });
          },
        });
      },
      TEST_TIMEOUT,
    );
  });

  describe('A pre-seam transfer into the bank-linked account', () => {
    it(
      'creates both legs, absorbs the incoming leg into the opening balance and moves the manual account',
      async () => {
        await asDatasetUser({
          dataset,
          fn: async () => {
            const { accountId, imported } = await setupImported();
            const { cash, fromLeg, toLeg } = await createPreSeamTransferFromCash({ accountId });

            const legs = await helpers.getTransactionsByTransferId({ transferId: fromLeg.transferId!, raw: true });
            expect(
              legs
                .map((tx) => ({
                  accountId: tx.accountId,
                  accountType: tx.accountType,
                  transactionType: tx.transactionType,
                  amount: Number(tx.amount),
                }))
                .toSorted((a, b) => a.transactionType.localeCompare(b.transactionType)),
            ).toEqual([
              {
                accountId: cash.id,
                accountType: ACCOUNT_TYPES.system,
                transactionType: TRANSACTION_TYPES.expense,
                amount: 1000,
              },
              { accountId, accountType: ACCOUNT_TYPES.system, transactionType: TRANSACTION_TYPES.income, amount: 1000 },
            ]);
            expect(toLeg.transferId).toBe(fromLeg.transferId);

            await expectOpeningShift({ accountId, before: imported, cents: -100_000 });
            await expectHistoryConsistent({ accountId });
            const cashAfter = await helpers.readAccount({ accountId: cash.id });
            expect({ currentBalance: cashAfter.currentBalance, initialBalance: cashAfter.initialBalance }).toEqual({
              currentBalance: 4000,
              initialBalance: 5000,
            });
          },
        });
      },
      TEST_TIMEOUT,
    );
  });
});
