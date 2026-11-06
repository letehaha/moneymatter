import type {
  AccountMappingConfig,
  CategoryMappingConfig,
  ColumnMappingConfig,
  CsvImportProgress,
  TagMappingConfig,
} from '@bt/shared/types';
import {
  AccountOptionValue,
  CategoryOptionValue,
  CurrencyOptionValue,
  PAYMENT_TYPES,
  TagOptionValue,
  TransactionTypeOptionValue,
} from '@bt/shared/types';
import { describe, expect, it } from '@jest/globals';
import Transactions from '@models/transactions.model';
import * as helpers from '@tests/helpers';
import { expectCsvImportCompleted, waitForCsvImportCompletion } from '@tests/helpers/import-export';

const CSV_HEADERS = ['Date', 'Amount', 'Description', 'Category', 'Account', 'Currency', 'Type', 'Tags'];

interface CsvRow {
  date: string;
  amount: string;
  description: string;
  account: string;
  currency: string;
  type: 'income' | 'expense';
  category?: string;
  tags?: string;
}

const buildCsv = (rows: CsvRow[]): string =>
  [
    CSV_HEADERS.join(','),
    ...rows.map((row) =>
      [
        row.date,
        row.amount,
        row.description,
        row.category ?? '',
        row.account,
        row.currency,
        row.type,
        row.tags ?? '',
      ].join(','),
    ),
  ].join('\n');

const buildColumnMapping = (overrides: Partial<ColumnMappingConfig> = {}): ColumnMappingConfig => ({
  date: 'Date',
  dateFieldOrder: 'month-first',
  amount: 'Amount',
  description: 'Description',
  category: {
    option: CategoryOptionValue.mapDataSourceColumn,
    columnName: 'Category',
  },
  currency: {
    option: CurrencyOptionValue.dataSourceColumn,
    columnName: 'Currency',
  },
  transactionType: {
    option: TransactionTypeOptionValue.dataSourceColumn,
    columnName: 'Type',
    incomeValues: ['income'],
    expenseValues: ['expense'],
  },
  account: {
    option: AccountOptionValue.dataSourceColumn,
    columnName: 'Account',
  },
  ...overrides,
});

const runImport = async (payload: {
  fileContent: string;
  columnMapping?: ColumnMappingConfig;
  accountMapping: AccountMappingConfig;
  categoryMapping?: CategoryMappingConfig;
  tagMapping?: TagMappingConfig;
  defaultCategoryId?: string;
  recalculateBalance?: boolean;
}): Promise<Extract<CsvImportProgress, { status: 'completed' }>> => {
  const { jobId } = await helpers.executeImport({
    payload: {
      fileContent: payload.fileContent,
      delimiter: ',',
      columnMapping: payload.columnMapping ?? buildColumnMapping(),
      accountMapping: payload.accountMapping,
      categoryMapping: payload.categoryMapping ?? {},
      tagMapping: payload.tagMapping,
      skipDuplicateIndices: [],
      defaultCategoryId: payload.defaultCategoryId,
      recalculateBalance: payload.recalculateBalance,
    },
    raw: true,
  });

  expect(jobId).toBeTruthy();

  const progress = await waitForCsvImportCompletion({ jobId });
  expectCsvImportCompleted(progress);
  return progress;
};

const CSV_ACCOUNT = 'CSV Account';
const ROW_DAY = '2024-01-15';
const ROW_INSTANT = '2024-01-15T00:00:00.000Z';

const daysFromRow = (days: number) => new Date(Date.parse(ROW_INSTANT) + days * 24 * 60 * 60 * 1000).toISOString();

const createOwnedAccount = ({ initialBalance = 0 }: { initialBalance?: number } = {}) =>
  helpers.createAccount({
    payload: helpers.buildAccountPayload({ initialBalance }),
    raw: true,
  });

const getBalance = async ({ accountId }: { accountId: string }) =>
  Number((await helpers.getAccount({ id: accountId, raw: true })).currentBalance);

const readExternalData = async ({ id }: { id: string }) => {
  const row = await Transactions.findByPk(id);
  return (row!.externalData ?? {}) as { plannedMerge?: { mergedAt?: string } };
};

const listAccountTransactions = ({ accountId }: { accountId: string }) =>
  helpers.getTransactions({ accountIds: [accountId], raw: true });

describe('Planned transactions – merge on import', () => {
  describe('CSV merge happy path', () => {
    it('folds the bank row into the plan and keeps every field the user entered', async () => {
      const account = await createOwnedAccount({ initialBalance: 1000 });
      const categories = await helpers.getCategoriesList();
      const planCategory = categories[1]!;
      const splitCategory = categories[2]!;
      const [payee, planTag] = await Promise.all([
        helpers.createPayee({ payload: { name: 'Landlord' }, raw: true }),
        helpers.createTag({
          payload: helpers.buildTagPayload({ name: 'plan-tag' }),
          raw: true,
        }),
      ]);

      const [plan] = await helpers.createPlannedTransaction({
        payload: {
          accountId: account.id,
          amount: 250,
          time: daysFromRow(3),
          note: 'Rent for January',
          categoryId: planCategory.id,
          paymentType: PAYMENT_TYPES.bankTransfer,
          splits: [{ categoryId: splitCategory.id, amount: 100 }],
          tagIds: [planTag.id],
          payeeId: payee.id,
        },
        raw: true,
      });

      expect(await getBalance({ accountId: account.id })).toBe(1000);

      const summary = (
        await runImport({
          fileContent: buildCsv([
            {
              date: ROW_DAY,
              amount: '250.00',
              description: 'RENT PAYMENT LANDLORD',
              account: CSV_ACCOUNT,
              currency: account.currencyCode,
              type: 'expense',
              tags: 'CsvTag',
            },
          ]),
          columnMapping: buildColumnMapping({
            tags: {
              option: TagOptionValue.mapDataSourceColumn,
              columnName: 'Tags',
            },
          }),
          accountMapping: {
            [CSV_ACCOUNT]: { action: 'link-existing', accountId: account.id },
          },
          tagMapping: { CsvTag: { action: 'create-new' } },
          recalculateBalance: true,
        })
      ).summary;

      expect(summary.merged).toBe(1);
      expect(summary.imported).toBe(0);
      expect(summary.newTransactionIds).toEqual([]);
      expect(summary.errors).toEqual([]);

      const merged = await helpers.getTransactionById({
        id: plan.id,
        raw: true,
      });
      expect(merged!.isPlanned).toBe(false);
      expect(merged!.categoryId).toBe(planCategory.id);
      expect(merged!.paymentType).toBe(PAYMENT_TYPES.bankTransfer);
      expect(merged!.payeeId).toBe(payee.id);
      expect(merged!.amount).toBe(250);
      expect(merged!.note).toBe('Rent for January | RENT PAYMENT LANDLORD');
      expect(merged!.splits).toHaveLength(1);
      expect(merged!.splits![0]!.categoryId).toBe(splitCategory.id);
      expect(new Date(merged!.time).toISOString().slice(0, 10)).toBe(ROW_DAY);

      const { plannedMerge } = await readExternalData({ id: plan.id });
      expect(typeof plannedMerge?.mergedAt).toBe('string');

      const withTags = await helpers.getTransactions({
        accountIds: [account.id],
        raw: true,
      });
      expect(withTags).toHaveLength(1);
      expect((withTags[0]!.tags ?? []).map((tag) => tag.name)).toEqual(['plan-tag']);

      // The plan had no balance effect, so the merge is the only thing that may move it.
      expect(await getBalance({ accountId: account.id })).toBe(750);
    });
  });

  describe('rows that must not merge', () => {
    it('creates a new row when the amount differs by a cent or the plan sits outside the seven-day window', async () => {
      // Separate accounts stop each imported row from matching the other account's plan.
      const [amountAccount, windowAccount] = await Promise.all([
        createOwnedAccount({ initialBalance: 1000 }),
        createOwnedAccount({ initialBalance: 1000 }),
      ]);

      const [amountPlan] = await helpers.createPlannedTransaction({
        payload: {
          accountId: amountAccount.id,
          amount: 250,
          time: daysFromRow(1),
          note: 'Plan',
        },
        raw: true,
      });
      const [windowPlan] = await helpers.createPlannedTransaction({
        payload: {
          accountId: windowAccount.id,
          amount: 250,
          time: daysFromRow(8),
          note: 'Plan',
        },
        raw: true,
      });

      const summary = (
        await runImport({
          fileContent: buildCsv([
            {
              date: ROW_DAY,
              amount: '249.99',
              description: 'ALMOST THE PLAN',
              account: 'Amount Account',
              currency: amountAccount.currencyCode,
              type: 'expense',
            },
            {
              date: ROW_DAY,
              amount: '250.00',
              description: 'TOO FAR FROM THE PLAN',
              account: 'Window Account',
              currency: windowAccount.currencyCode,
              type: 'expense',
            },
          ]),
          accountMapping: {
            'Amount Account': {
              action: 'link-existing',
              accountId: amountAccount.id,
            },
            'Window Account': {
              action: 'link-existing',
              accountId: windowAccount.id,
            },
          },
        })
      ).summary;

      expect(summary.merged).toBe(0);
      expect(summary.imported).toBe(2);

      const amountRows = await listAccountTransactions({
        accountId: amountAccount.id,
      });
      expect(amountRows).toHaveLength(2);
      expect(amountRows.find((row) => row.id === amountPlan.id)!.isPlanned).toBe(true);

      const windowRows = await listAccountTransactions({
        accountId: windowAccount.id,
      });
      expect(windowRows).toHaveLength(2);
      expect(windowRows.find((row) => row.id === windowPlan.id)!.isPlanned).toBe(true);
    });
  });

  describe('picking between candidates', () => {
    it('merges into the plan closest in time and leaves the other one planned', async () => {
      const account = await createOwnedAccount({ initialBalance: 1000 });

      const [farPlan] = await helpers.createPlannedTransaction({
        payload: {
          accountId: account.id,
          amount: 250,
          time: daysFromRow(5),
          note: 'Far plan',
        },
        raw: true,
      });
      const [nearPlan] = await helpers.createPlannedTransaction({
        payload: {
          accountId: account.id,
          amount: 250,
          time: daysFromRow(1),
          note: 'Near plan',
        },
        raw: true,
      });

      const summary = (
        await runImport({
          fileContent: buildCsv([
            {
              date: ROW_DAY,
              amount: '250.00',
              description: 'BANK CHARGE',
              account: CSV_ACCOUNT,
              currency: account.currencyCode,
              type: 'expense',
            },
          ]),
          accountMapping: {
            [CSV_ACCOUNT]: { action: 'link-existing', accountId: account.id },
          },
        })
      ).summary;

      expect(summary.merged).toBe(1);
      expect(summary.imported).toBe(0);

      const rows = await listAccountTransactions({ accountId: account.id });
      expect(rows).toHaveLength(2);
      expect(rows.find((row) => row.id === nearPlan.id)!.isPlanned).toBe(false);
      expect(rows.find((row) => row.id === farPlan.id)!.isPlanned).toBe(true);
    });

    it('lets only the first of two identical rows consume the plan', async () => {
      const account = await createOwnedAccount({ initialBalance: 1000 });
      const [plan] = await helpers.createPlannedTransaction({
        payload: {
          accountId: account.id,
          amount: 250,
          time: daysFromRow(1),
          note: 'Plan',
        },
        raw: true,
      });

      const summary = (
        await runImport({
          fileContent: buildCsv([
            {
              date: ROW_DAY,
              amount: '250.00',
              description: 'CHARGE ONE',
              account: CSV_ACCOUNT,
              currency: account.currencyCode,
              type: 'expense',
            },
            {
              date: ROW_DAY,
              amount: '250.00',
              description: 'CHARGE TWO',
              account: CSV_ACCOUNT,
              currency: account.currencyCode,
              type: 'expense',
            },
          ]),
          accountMapping: {
            [CSV_ACCOUNT]: { action: 'link-existing', accountId: account.id },
          },
        })
      ).summary;

      expect(summary.merged).toBe(1);
      expect(summary.imported).toBe(1);
      expect(summary.newTransactionIds).toHaveLength(1);

      const rows = await listAccountTransactions({ accountId: account.id });
      expect(rows).toHaveLength(2);
      expect(rows.every((row) => row.isPlanned === false)).toBe(true);
      expect(rows.find((row) => row.id === plan.id)!.note).toBe('Plan | CHARGE ONE');
    });
  });

  describe('duplicate detection', () => {
    it('never flags a planned row as a duplicate of the incoming row', async () => {
      const account = await createOwnedAccount({ initialBalance: 1000 });
      await helpers.createPlannedTransaction({
        payload: {
          accountId: account.id,
          amount: 250,
          time: `${ROW_DAY}T00:00:00.000Z`,
          note: 'Plan',
        },
        raw: true,
      });

      const result = await helpers.detectDuplicates({
        payload: {
          fileContent: buildCsv([
            {
              date: ROW_DAY,
              amount: '250.00',
              description: 'BANK CHARGE',
              account: CSV_ACCOUNT,
              currency: account.currencyCode,
              type: 'expense',
            },
          ]),
          delimiter: ',',
          columnMapping: buildColumnMapping(),
          accountMapping: {
            [CSV_ACCOUNT]: { action: 'link-existing', accountId: account.id },
          },
          categoryMapping: {},
        },
        raw: true,
      });

      expect(result.validRows).toHaveLength(1);
      expect(result.duplicates).toEqual([]);
    });
  });

  describe('balance recalculation boundary', () => {
    it('lands the same balance whether or not a future-dated plan sits on the account', async () => {
      const [planned, control] = await Promise.all([
        createOwnedAccount({ initialBalance: 1000 }),
        createOwnedAccount({ initialBalance: 1000 }),
      ]);

      await Promise.all(
        [planned, control].map((account) =>
          helpers.createTransaction({
            payload: helpers.buildTransactionPayload({
              accountId: account.id,
              amount: 100,
              time: daysFromRow(-5),
            }),
            raw: true,
          }),
        ),
      );

      // Far outside the match window and a different amount, so it can only act as a
      // (wrong) balance boundary, never as a merge target.
      await helpers.createPlannedTransaction({
        payload: {
          accountId: planned.id,
          amount: 777,
          time: daysFromRow(45),
          note: 'Future plan',
        },
        raw: true,
      });

      const summary = (
        await runImport({
          fileContent: buildCsv([
            {
              date: ROW_DAY,
              amount: '250.00',
              description: 'PLANNED ACCOUNT ROW',
              account: 'Planned Account',
              currency: planned.currencyCode,
              type: 'expense',
            },
            {
              date: ROW_DAY,
              amount: '250.00',
              description: 'CONTROL ACCOUNT ROW',
              account: 'Control Account',
              currency: control.currencyCode,
              type: 'expense',
            },
          ]),
          accountMapping: {
            'Planned Account': {
              action: 'link-existing',
              accountId: planned.id,
            },
            'Control Account': {
              action: 'link-existing',
              accountId: control.id,
            },
          },
          recalculateBalance: true,
        })
      ).summary;

      expect(summary.imported).toBe(2);
      expect(summary.merged).toBe(0);

      const plannedBalance = await getBalance({ accountId: planned.id });
      expect(plannedBalance).toBe(await getBalance({ accountId: control.id }));
      expect(plannedBalance).toBe(650);
    });
  });

  describe('backup restore', () => {
    it('restores an archive written before the planned column existed', async () => {
      const account = await createOwnedAccount({ initialBalance: 1000 });
      await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account.id,
          amount: 120,
          note: 'Pre-feature row',
        }),
        raw: true,
      });

      const exported = await helpers.exportBackup();
      expect(exported.statusCode).toBe(200);

      const { files } = helpers.parseBackupArchive({ buffer: exported.body });
      const rows = JSON.parse(files.get('data/transactions.json')!.toString('utf8')) as Record<string, unknown>[];
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) delete row.isPlanned;
      files.set('data/transactions.json', Buffer.from(JSON.stringify(rows)));

      const restore = await helpers.restoreBackup({
        fileContent: await helpers.repackBackup({ files }),
      });
      expect(restore.statusCode).toBe(200);

      const status = await helpers.waitForRestore({ jobId: restore.jobId! });
      expect(status.status).toBe('completed');

      const restored = await helpers.getTransactions({ raw: true });
      expect(restored.length).toBe(rows.length);
      expect(restored.every((row) => row.isPlanned === false)).toBe(true);
    });
  });
});
