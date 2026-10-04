import type {
  AccountMappingConfig,
  CategoryMappingConfig,
  ColumnMappingConfig,
  TagMappingConfig,
  TransactionImportDetails,
} from '@bt/shared/types';
import {
  AccountOptionValue,
  CATEGORIZATION_MODE,
  CategoryOptionValue,
  CurrencyOptionValue,
  ImportSource,
  TagOptionValue,
  TransactionTypeOptionValue,
} from '@bt/shared/types';
import { generateRandomRecordId } from '@common/lib/record-id-helpers';
import { describe, expect, it } from '@jest/globals';
import { ERROR_CODES } from '@js/errors';
import Transactions from '@models/transactions.model';
import * as helpers from '@tests/helpers';
import { expectCsvImportCompleted, waitForCsvImportCompletion } from '@tests/helpers/import-export';
import { asUser, signUpSecondUser } from '@tests/helpers/share';

describe('Execute Import endpoint (async)', () => {
  // ---------------------------------------------------------------------------
  // CSV-content builders
  //
  // The execute step is now async: the request carries the raw `fileContent` +
  // `columnMapping` (NOT pre-parsed rows), the worker re-parses via the same
  // `parseValidRows` the interactive preview uses, then runs `executeImport`.
  // Tests therefore drive the endpoint exactly as the UI does – they build a CSV
  // file and a column mapping rather than constructing `ParsedTransactionRow[]`.
  // ---------------------------------------------------------------------------

  /** A single CSV data row. Optional fields fall back to safe column defaults. */
  interface CsvRow {
    date?: string;
    amount?: string;
    description?: string;
    category?: string;
    account?: string;
    currency?: string;
    type?: 'income' | 'expense';
    tags?: string;
    payee?: string;
  }

  const CSV_HEADERS = ['Date', 'Amount', 'Description', 'Category', 'Account', 'Currency', 'Type', 'Tags', 'Payee'];

  /**
   * Build a comma-delimited CSV `fileContent` from row objects. The header order
   * is fixed so the `buildColumnMapping` defaults line up with it.
   */
  const buildCsv = (rows: CsvRow[]): string => {
    const cell = (value: string | undefined) => value ?? '';
    const lines = [
      CSV_HEADERS.join(','),
      ...rows.map((row) =>
        [
          cell(row.date),
          cell(row.amount),
          cell(row.description),
          cell(row.category),
          cell(row.account),
          cell(row.currency),
          cell(row.type),
          cell(row.tags),
          cell(row.payee),
        ].join(','),
      ),
    ];
    return lines.join('\n');
  };

  /**
   * Column mapping matching {@link CSV_HEADERS}. Override pieces per test (e.g.
   * to use a single existing account/category/currency instead of a column).
   */
  const buildColumnMapping = (overrides: Partial<ColumnMappingConfig> = {}): ColumnMappingConfig => ({
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
    ...overrides,
  });

  /**
   * Enqueue an async CSV import and poll it to its terminal state. The first
   * status response is asserted to be a real progress envelope so a broken
   * enqueue fails fast (per project e2e guidance) instead of timing out the poll.
   */
  const runImport = async (payload: {
    fileContent: string;
    columnMapping?: ColumnMappingConfig;
    accountMapping: AccountMappingConfig;
    categoryMapping?: CategoryMappingConfig;
    tagMapping?: TagMappingConfig;
    skipDuplicateIndices?: number[];
    skipUnpriceableIndices?: number[];
    defaultAccountId?: string;
    defaultCategoryId?: string;
  }) => {
    const { jobId } = await helpers.executeImport({
      payload: {
        fileContent: payload.fileContent,
        delimiter: ',',
        columnMapping: payload.columnMapping ?? buildColumnMapping(),
        accountMapping: payload.accountMapping,
        categoryMapping: payload.categoryMapping ?? {},
        tagMapping: payload.tagMapping,
        skipDuplicateIndices: payload.skipDuplicateIndices ?? [],
        skipUnpriceableIndices: payload.skipUnpriceableIndices,
        defaultAccountId: payload.defaultAccountId,
        defaultCategoryId: payload.defaultCategoryId,
      },
      raw: true,
    });

    // Fail-fast: a broken enqueue must surface immediately, not as a 30s poll
    // timeout. The job id must be the documented `csv-import-<userId>-<uuid>`.
    expect(jobId).toBeTruthy();
    expect(jobId).toMatch(/^csv-import-/);

    // The very first status read must be a valid CsvImportProgress envelope for
    // this job. If the status route or enqueue is broken this throws now.
    const firstStatus = await helpers.getCsvImportStatus({ jobId, raw: true });
    expect(firstStatus.jobId).toBe(jobId);
    expect(['queued', 'running', 'completed', 'failed']).toContain(firstStatus.status);

    return { jobId, progress: await waitForCsvImportCompletion({ jobId }) };
  };

  // The three default rows reused across happy-path tests: two expenses and one
  // income, mirroring the original suite's `createValidRows`.
  const defaultRows = ({
    account = 'CSV Account',
    category = 'Test Category',
    currency = 'USD',
  }: {
    account?: string;
    category?: string;
    currency?: string;
  } = {}): CsvRow[] => [
    {
      date: '2024-01-15',
      amount: '100.50',
      description: 'Grocery shopping',
      category,
      account,
      currency,
      type: 'expense',
    },
    { date: '2024-01-16', amount: '50.00', description: 'Coffee shop', category, account, currency, type: 'expense' },
    { date: '2024-01-17', amount: '2500.00', description: 'Salary', account, currency, type: 'income' },
  ];

  describe('successful import', () => {
    it('should import transactions with existing account', async () => {
      const account = await helpers.createAccount({ raw: true });

      const { progress } = await runImport({
        fileContent: buildCsv(defaultRows({ account: 'CSV Account', currency: account.currencyCode })),
        accountMapping: { 'CSV Account': { action: 'link-existing', accountId: account.id } },
      });
      expectCsvImportCompleted(progress);
      const { summary } = progress;

      expect(summary.imported).toBe(3);
      expect(summary.skipped).toBe(0);
      expect(summary.skippedUnpriceable).toBe(0);
      expect(summary.accountsCreated).toBe(0);
      expect(summary.categoriesCreated).toBe(0);
      expect(summary.errors).toHaveLength(0);
      expect(summary.newTransactionIds).toHaveLength(3);
      expect(summary.batchId).toBeDefined();

      const transactions = await helpers.getTransactions({ raw: true });
      const createdTxs = transactions.filter((tx) => summary.newTransactionIds.includes(tx.id));
      expect(createdTxs).toHaveLength(3);
      expect(createdTxs.every((tx) => tx.accountId === account.id)).toBe(true);

      const groceryTx = createdTxs.find((tx) => tx.note === 'Grocery shopping');
      expect(groceryTx).toBeDefined();
      expect(groceryTx?.amount).toBe(100.5);
    });

    // Every date cell here is ambiguous (both fields ≤ 12), so only the
    // user-confirmed dateFieldOrder decides the calendar day: the same file
    // must land on different days depending on the confirmed order.
    it('applies the confirmed dateFieldOrder verbatim to an all-ambiguous date column', async () => {
      // Both runs link to accounts in the same (base) currency so the only
      // varying input between them is the confirmed dateFieldOrder.
      const dayFirstAccount = await helpers.createAccount({ raw: true });
      const monthFirstAccount = await helpers.createAccount({ raw: true });

      const ambiguousRows: CsvRow[] = [
        {
          date: '05/06/2026',
          amount: '10.00',
          description: 'Ambiguous A',
          account: 'CSV Account',
          currency: dayFirstAccount.currencyCode,
          type: 'expense',
        },
        {
          date: '02/03/2026',
          amount: '20.00',
          description: 'Ambiguous B',
          account: 'CSV Account',
          currency: dayFirstAccount.currencyCode,
          type: 'expense',
        },
      ];
      const fileContent = buildCsv(ambiguousRows);

      const txDay = (time: string | Date) => new Date(time).toISOString().split('T')[0];

      // Same content, day-first: 05/06 → June 5, 02/03 → March 2.
      // The asserts-guard narrowing doesn't survive into closures, so summary
      // is captured into a local before the .filter() callbacks below.
      const { progress: dayFirstProgress } = await runImport({
        fileContent,
        columnMapping: buildColumnMapping({ dateFieldOrder: 'day-first' }),
        accountMapping: { 'CSV Account': { action: 'link-existing', accountId: dayFirstAccount.id } },
      });
      expectCsvImportCompleted(dayFirstProgress);
      const dayFirstSummary = dayFirstProgress.summary;
      expect(dayFirstSummary.imported).toBe(2);

      const afterDayFirst = await helpers.getTransactions({ raw: true });
      const dayFirstTxs = afterDayFirst.filter((tx) => dayFirstSummary.newTransactionIds.includes(tx.id));
      expect(dayFirstTxs.map((tx) => txDay(tx.time)).sort()).toEqual(['2026-03-02', '2026-06-05']);

      // Same content, month-first: 05/06 → May 6, 02/03 → Feb 3.
      const { progress: monthFirstProgress } = await runImport({
        fileContent,
        columnMapping: buildColumnMapping({ dateFieldOrder: 'month-first' }),
        accountMapping: { 'CSV Account': { action: 'link-existing', accountId: monthFirstAccount.id } },
      });
      expectCsvImportCompleted(monthFirstProgress);
      const monthFirstSummary = monthFirstProgress.summary;
      expect(monthFirstSummary.imported).toBe(2);

      const afterMonthFirst = await helpers.getTransactions({ raw: true });
      const monthFirstTxs = afterMonthFirst.filter((tx) => monthFirstSummary.newTransactionIds.includes(tx.id));
      expect(monthFirstTxs.map((tx) => txDay(tx.time)).sort()).toEqual(['2026-02-03', '2026-05-06']);
    });

    it('should create new account when action is create-new', async () => {
      const accountsBefore = await helpers.getAccounts();

      const { progress } = await runImport({
        fileContent: buildCsv(defaultRows({ account: 'New Import Account', currency: 'USD' })),
        accountMapping: { 'New Import Account': { action: 'create-new', currentBalance: null } },
      });
      expectCsvImportCompleted(progress);

      expect(progress.summary.imported).toBe(3);
      expect(progress.summary.accountsCreated).toBe(1);
      expect(progress.summary.errors).toHaveLength(0);
      expect(progress.summary.newTransactionIds).toHaveLength(3);

      const accountsAfter = await helpers.getAccounts();
      expect(accountsAfter.length).toBe(accountsBefore.length + 1);
      const newAccount = accountsAfter.find((a) => a.name === 'New Import Account');
      expect(newAccount).toBeDefined();
      expect(newAccount?.currencyCode).toBe('USD');
    });

    it('should create new category when action is create-new', async () => {
      const account = await helpers.createAccount({ raw: true });
      const categoriesBefore = await helpers.getCategoriesList();

      const { progress } = await runImport({
        fileContent: buildCsv(
          defaultRows({ account: 'CSV Account', category: 'New Import Category', currency: account.currencyCode }),
        ),
        accountMapping: { 'CSV Account': { action: 'link-existing', accountId: account.id } },
        categoryMapping: { 'New Import Category': { action: 'create-new' } },
      });
      expectCsvImportCompleted(progress);

      expect(progress.summary.imported).toBe(3);
      expect(progress.summary.categoriesCreated).toBe(1);
      expect(progress.summary.errors).toHaveLength(0);

      const categoriesAfter = await helpers.getCategoriesList();
      expect(categoriesAfter.length).toBe(categoriesBefore.length + 1);
      expect(categoriesAfter.find((c) => c.name === 'New Import Category')).toBeDefined();
    });

    it('should skip duplicate rows based on skipDuplicateIndices', async () => {
      const account = await helpers.createAccount({ raw: true });
      const fileContent = buildCsv(defaultRows({ account: 'CSV Account', currency: account.currencyCode }));
      const accountMapping = { 'CSV Account': { action: 'link-existing' as const, accountId: account.id } };

      const partial = await runImport({
        fileContent,
        accountMapping,
        skipDuplicateIndices: [2, 3], // Skip first two rows (rowIndex 2 and 3)
      });
      expectCsvImportCompleted(partial.progress);

      expect(partial.progress.summary.imported).toBe(1);
      expect(partial.progress.summary.skipped).toBe(2);
      expect(partial.progress.summary.newTransactionIds).toHaveLength(1);

      const all = await runImport({
        fileContent,
        accountMapping,
        skipDuplicateIndices: [2, 3, 4], // Skip all rows
      });
      expectCsvImportCompleted(all.progress);

      expect(all.progress.summary.imported).toBe(0);
      expect(all.progress.summary.skipped).toBe(3);
      expect(all.progress.summary.accountsCreated).toBe(0);
      expect(all.progress.summary.categoriesCreated).toBe(0);
      expect(all.progress.summary.newTransactionIds).toHaveLength(0);
    }, 60_000);
  });

  describe('single existing account/category fallbacks', () => {
    // When the user picks "assign all rows to a single existing account" in the
    // column-mapping step, the account column maps to an existing account id and
    // accountMapping is empty. The currency is derived from that account.
    it('should import rows mapped to a single existing account via column mapping', async () => {
      const account = await helpers.createAccount({ raw: true });

      // No Account/Currency columns referenced – both come from the chosen account.
      const fileContent = buildCsv([
        { date: '2024-01-15', amount: '100.50', description: 'Grocery shopping', type: 'expense' },
        { date: '2024-01-16', amount: '50.00', description: 'Coffee shop', type: 'expense' },
        { date: '2024-01-17', amount: '2500.00', description: 'Salary', type: 'income' },
      ]);

      const { progress } = await runImport({
        fileContent,
        columnMapping: buildColumnMapping({
          account: { option: AccountOptionValue.existingAccount, accountId: account.id },
          currency: { option: CurrencyOptionValue.existingCurrency, currencyCode: account.currencyCode },
          category: { option: CategoryOptionValue.mapDataSourceColumn, columnName: 'Category' },
        }),
        accountMapping: {},
      });
      expectCsvImportCompleted(progress);

      expect(progress.summary.imported).toBe(3);
      expect(progress.summary.errors).toHaveLength(0);
      expect(progress.summary.newTransactionIds).toHaveLength(3);

      const transactions = await helpers.getTransactions({ raw: true });
      const created = transactions.filter((tx) => progress.summary.newTransactionIds.includes(tx.id));
      expect(created).toHaveLength(3);
      expect(created.every((tx) => tx.accountId === account.id)).toBe(true);
    });

    it('still imports mismatched-currency rows in the single-existing-account flow (warned coercion)', async () => {
      // The single-existing-account flow deliberately allows a currency
      // mismatch: the wizard warns "all transactions will be imported using
      // <account currency>" at the mapping step. Only per-name link-existing
      // mappings are guarded — this flow must keep completing, with every row
      // booked in the account's own currency.
      const account = await helpers.createAccount({ raw: true });
      const mismatchedCurrency = account.currencyCode === 'USD' ? 'EUR' : 'USD';

      const fileContent = buildCsv([
        {
          date: '2024-01-15',
          amount: '100.50',
          description: 'Groceries',
          currency: mismatchedCurrency,
          type: 'expense',
        },
        { date: '2024-01-17', amount: '2500.00', description: 'Salary', currency: mismatchedCurrency, type: 'income' },
      ]);

      const { progress } = await runImport({
        fileContent,
        columnMapping: buildColumnMapping({
          account: { option: AccountOptionValue.existingAccount, accountId: account.id },
          currency: { option: CurrencyOptionValue.dataSourceColumn, columnName: 'Currency' },
        }),
        accountMapping: {},
      });
      expectCsvImportCompleted(progress);

      expect(progress.summary.imported).toBe(2);
      expect(progress.summary.errors).toHaveLength(0);

      const transactions = await helpers.getTransactions({ raw: true });
      const created = transactions.filter((tx) => progress.summary.newTransactionIds.includes(tx.id));
      expect(created).toHaveLength(2);
      expect(created.every((tx) => tx.accountId === account.id)).toBe(true);
      // Coercion contract: rows land in the account's currency, numbers verbatim.
      expect(created.every((tx) => tx.currencyCode === account.currencyCode)).toBe(true);
    });

    // When the user picks "assign all rows to a single existing category", the
    // rows carry no category and defaultCategoryId fills it in. Without the
    // fallback the transactions would import with no category at all.
    it('should assign defaultCategoryId to rows with no category column', async () => {
      const account = await helpers.createAccount({ raw: true });
      const existingCategories = await helpers.getCategoriesList();
      const categoryId = existingCategories[0]!.id;

      const fileContent = buildCsv([
        {
          date: '2024-01-15',
          amount: '100.50',
          description: 'Grocery shopping',
          account: 'CSV Account',
          currency: account.currencyCode,
          type: 'expense',
        },
        {
          date: '2024-01-16',
          amount: '50.00',
          description: 'Coffee shop',
          account: 'CSV Account',
          currency: account.currencyCode,
          type: 'expense',
        },
        {
          date: '2024-01-17',
          amount: '2500.00',
          description: 'Salary',
          account: 'CSV Account',
          currency: account.currencyCode,
          type: 'income',
        },
      ]);

      const { progress } = await runImport({
        fileContent,
        // No category column mapped – the single chosen category fills every row.
        columnMapping: buildColumnMapping({
          category: { option: CategoryOptionValue.existingCategory, categoryId },
        }),
        accountMapping: { 'CSV Account': { action: 'link-existing', accountId: account.id } },
        defaultCategoryId: categoryId,
      });
      expectCsvImportCompleted(progress);

      expect(progress.summary.imported).toBe(3);
      expect(progress.summary.errors).toHaveLength(0);

      const transactions = await helpers.getTransactions({ raw: true });
      const created = transactions.filter((tx) => progress.summary.newTransactionIds.includes(tx.id));
      expect(created).toHaveLength(3);
      expect(created.every((tx) => tx.categoryId === categoryId)).toBe(true);
    });
  });

  describe('mixed account and category mappings', () => {
    it('should handle mixed account mappings (some new, some existing)', async () => {
      const accountsBefore = await helpers.getAccounts();
      const existingAccount = await helpers.createAccount({
        payload: { ...helpers.buildAccountPayload(), name: 'Existing Account' },
        raw: true,
      });

      const fileContent = buildCsv([
        {
          date: '2024-01-15',
          amount: '100.50',
          description: 'Transaction to new account',
          account: 'New Account A',
          currency: 'USD',
          type: 'expense',
        },
        {
          date: '2024-01-16',
          amount: '50.00',
          description: 'Transaction to existing account',
          account: 'CSV Existing Account',
          currency: existingAccount.currencyCode,
          type: 'expense',
        },
        {
          date: '2024-01-17',
          amount: '75.00',
          description: 'Transaction to another new account',
          account: 'New Account B',
          currency: 'EUR',
          type: 'income',
        },
      ]);

      const { progress } = await runImport({
        fileContent,
        accountMapping: {
          'New Account A': { action: 'create-new', currentBalance: null },
          'CSV Existing Account': { action: 'link-existing', accountId: existingAccount.id },
          'New Account B': { action: 'create-new', currentBalance: null },
        },
      });
      expectCsvImportCompleted(progress);

      expect(progress.summary.imported).toBe(3);
      expect(progress.summary.accountsCreated).toBe(2);
      expect(progress.summary.errors).toHaveLength(0);

      const accountsAfter = await helpers.getAccounts();
      expect(accountsAfter.length).toBe(accountsBefore.length + 3); // +1 existing, +2 import
      expect(accountsAfter.find((a) => a.name === 'New Account A')?.currencyCode).toBe('USD');
      expect(accountsAfter.find((a) => a.name === 'New Account B')?.currencyCode).toBe('EUR');

      const transactions = await helpers.getTransactions({ raw: true });
      const importedTxs = transactions.filter((tx) => progress.summary.newTransactionIds.includes(tx.id));
      const existingAccountTx = importedTxs.find((tx) => tx.note === 'Transaction to existing account');
      expect(existingAccountTx?.accountId).toBe(existingAccount.id);
    });

    it('should handle mixed category mappings (some new, some existing)', async () => {
      const account = await helpers.createAccount({ raw: true });
      const seededCategories = await helpers.getCategoriesList();

      let existingCategory1 = seededCategories[0];
      if (!existingCategory1) {
        existingCategory1 = await helpers.addCustomCategory({ name: 'Existing Cat 1', color: '#FF0000', raw: true });
      }
      const existingCategory2 = await helpers.addCustomCategory({
        name: 'Existing Cat 2',
        color: '#00FF00',
        raw: true,
      });

      // Snapshotted after both existing categories exist, so the delta below
      // counts only what the import itself creates.
      const categoriesBefore = await helpers.getCategoriesList();

      const fileContent = buildCsv([
        {
          date: '2024-01-15',
          amount: '100.50',
          description: 'Transaction with new category',
          category: 'New Category A',
          account: 'CSV Account',
          currency: account.currencyCode,
          type: 'expense',
        },
        {
          date: '2024-01-16',
          amount: '50.00',
          description: 'Transaction with existing category 1',
          category: 'CSV Existing Cat 1',
          account: 'CSV Account',
          currency: account.currencyCode,
          type: 'expense',
        },
        {
          date: '2024-01-17',
          amount: '75.00',
          description: 'Transaction with another new category',
          category: 'New Category B',
          account: 'CSV Account',
          currency: account.currencyCode,
          type: 'income',
        },
        {
          date: '2024-01-18',
          amount: '30.00',
          description: 'Transaction with existing category 2',
          category: 'CSV Existing Cat 2',
          account: 'CSV Account',
          currency: account.currencyCode,
          type: 'expense',
        },
      ]);

      const { progress } = await runImport({
        fileContent,
        accountMapping: { 'CSV Account': { action: 'link-existing', accountId: account.id } },
        categoryMapping: {
          'New Category A': { action: 'create-new' },
          'CSV Existing Cat 1': { action: 'link-existing', categoryId: existingCategory1.id },
          'New Category B': { action: 'create-new' },
          'CSV Existing Cat 2': { action: 'link-existing', categoryId: existingCategory2.id },
        },
      });
      expectCsvImportCompleted(progress);

      expect(progress.summary.imported).toBe(4);
      expect(progress.summary.categoriesCreated).toBe(2);
      expect(progress.summary.errors).toHaveLength(0);

      const categoriesAfter = await helpers.getCategoriesList();
      expect(categoriesAfter.length).toBe(categoriesBefore.length + 2);
      expect(categoriesAfter.find((c) => c.name === 'New Category A')).toBeDefined();
      expect(categoriesAfter.find((c) => c.name === 'New Category B')).toBeDefined();

      const transactions = await helpers.getTransactions({ raw: true });
      const importedTxs = transactions.filter((tx) => progress.summary.newTransactionIds.includes(tx.id));
      expect(importedTxs.find((tx) => tx.note === 'Transaction with existing category 1')?.categoryId).toBe(
        existingCategory1.id,
      );
      expect(importedTxs.find((tx) => tx.note === 'Transaction with existing category 2')?.categoryId).toBe(
        existingCategory2.id,
      );
    });

    it('should reuse same category across multiple accounts', async () => {
      const fileContent = buildCsv([
        {
          date: '2024-01-15',
          amount: '100.50',
          description: 'Food expense from Account A',
          category: 'Food',
          account: 'Account A',
          currency: 'USD',
          type: 'expense',
        },
        {
          date: '2024-01-16',
          amount: '50.00',
          description: 'Food expense from Account B',
          category: 'Food',
          account: 'Account B',
          currency: 'USD',
          type: 'expense',
        },
        {
          date: '2024-01-17',
          amount: '75.00',
          description: 'Food expense from Account A again',
          category: 'Food',
          account: 'Account A',
          currency: 'USD',
          type: 'expense',
        },
      ]);

      const { progress } = await runImport({
        fileContent,
        accountMapping: {
          'Account A': { action: 'create-new', currentBalance: null },
          'Account B': { action: 'create-new', currentBalance: null },
        },
        categoryMapping: { Food: { action: 'create-new' } },
      });
      expectCsvImportCompleted(progress);

      expect(progress.summary.imported).toBe(3);
      expect(progress.summary.accountsCreated).toBe(2);
      expect(progress.summary.categoriesCreated).toBe(1); // Only ONE Food category

      const categoriesAfter = await helpers.getCategoriesList();
      expect(categoriesAfter.filter((c) => c.name === 'Food')).toHaveLength(1);

      const transactions = await helpers.getTransactions({ raw: true });
      const importedTxs = transactions.filter((tx) => progress.summary.newTransactionIds.includes(tx.id));
      expect(importedTxs).toHaveLength(3);
      expect([...new Set(importedTxs.map((tx) => tx.categoryId))]).toHaveLength(1);
      expect([...new Set(importedTxs.map((tx) => tx.accountId))]).toHaveLength(2);
    });

    it('should handle mix of transactions with and without categories', async () => {
      const account = await helpers.createAccount({ raw: true });

      const fileContent = buildCsv([
        {
          date: '2024-01-15',
          amount: '100.50',
          description: 'Transaction with category',
          category: 'New Category',
          account: 'CSV Account',
          currency: account.currencyCode,
          type: 'expense',
        },
        {
          date: '2024-01-16',
          amount: '50.00',
          description: 'Transaction without category',
          account: 'CSV Account',
          currency: account.currencyCode,
          type: 'expense',
        },
        {
          date: '2024-01-17',
          amount: '75.00',
          description: 'Another transaction with category',
          category: 'New Category',
          account: 'CSV Account',
          currency: account.currencyCode,
          type: 'income',
        },
      ]);

      const { progress } = await runImport({
        fileContent,
        accountMapping: { 'CSV Account': { action: 'link-existing', accountId: account.id } },
        categoryMapping: { 'New Category': { action: 'create-new' } },
      });
      expectCsvImportCompleted(progress);

      expect(progress.summary.imported).toBe(3);
      expect(progress.summary.categoriesCreated).toBe(1);
      expect(progress.summary.errors).toHaveLength(0);

      const transactions = await helpers.getTransactions({ raw: true });
      const importedTxs = transactions.filter((tx) => progress.summary.newTransactionIds.includes(tx.id));
      expect(importedTxs.find((tx) => tx.note === 'Transaction without category')?.categoryId).toBeNull();
      expect(importedTxs.find((tx) => tx.note === 'Transaction with category')?.categoryId).not.toBeNull();
    });

    it('should handle all link-existing mappings (no entity creation)', async () => {
      const account1 = await helpers.createAccount({
        payload: { ...helpers.buildAccountPayload(), name: 'Account 1' },
        raw: true,
      });
      const account2 = await helpers.createAccount({
        payload: { ...helpers.buildAccountPayload(), name: 'Account 2' },
        raw: true,
      });
      const category1 = await helpers.addCustomCategory({ name: 'Category 1', color: '#FF0000', raw: true });
      const category2 = await helpers.addCustomCategory({ name: 'Category 2', color: '#00FF00', raw: true });

      const accountsBefore = await helpers.getAccounts();
      const categoriesBefore = await helpers.getCategoriesList();

      const fileContent = buildCsv([
        {
          date: '2024-01-15',
          amount: '100.50',
          description: 'Transaction 1',
          category: 'CSV Category 1',
          account: 'CSV Account 1',
          currency: account1.currencyCode,
          type: 'expense',
        },
        {
          date: '2024-01-16',
          amount: '50.00',
          description: 'Transaction 2',
          category: 'CSV Category 2',
          account: 'CSV Account 2',
          currency: account2.currencyCode,
          type: 'expense',
        },
      ]);

      const { progress } = await runImport({
        fileContent,
        accountMapping: {
          'CSV Account 1': { action: 'link-existing', accountId: account1.id },
          'CSV Account 2': { action: 'link-existing', accountId: account2.id },
        },
        categoryMapping: {
          'CSV Category 1': { action: 'link-existing', categoryId: category1.id },
          'CSV Category 2': { action: 'link-existing', categoryId: category2.id },
        },
      });
      expectCsvImportCompleted(progress);

      expect(progress.summary.imported).toBe(2);
      expect(progress.summary.accountsCreated).toBe(0);
      expect(progress.summary.categoriesCreated).toBe(0);
      expect(progress.summary.errors).toHaveLength(0);

      expect((await helpers.getAccounts()).length).toBe(accountsBefore.length);
      expect((await helpers.getCategoriesList()).length).toBe(categoriesBefore.length);
    });
  });

  describe('skipped accounts', () => {
    it('skips a mapped-out account and imports the remaining rows', async () => {
      const accountsBefore = await helpers.getAccounts();

      const fileContent = buildCsv([
        {
          date: '2024-01-15',
          amount: '100.50',
          description: 'skipped-row-1',
          account: 'Skipped Account',
          currency: 'USD',
          type: 'expense',
        },
        {
          date: '2024-01-16',
          amount: '20.00',
          description: 'skipped-row-2',
          account: 'Skipped Account',
          currency: 'USD',
          type: 'expense',
        },
        {
          date: '2024-01-17',
          amount: '75.00',
          description: 'kept-row',
          account: 'Kept Account',
          currency: 'USD',
          type: 'expense',
        },
      ]);

      const { progress } = await runImport({
        fileContent,
        accountMapping: {
          'Skipped Account': { action: 'skip' },
          'Kept Account': { action: 'create-new', currentBalance: null },
        },
      });
      expectCsvImportCompleted(progress);
      const { summary } = progress;

      expect(summary.imported).toBe(1);
      expect(summary.accountsSkipped).toBe(1);
      expect(summary.accountsCreated).toBe(1);
      expect(summary.errors).toHaveLength(0);
      expect(progress.totalCount).toBe(1);

      const accountsAfter = await helpers.getAccounts();
      expect(accountsAfter.length).toBe(accountsBefore.length + 1);
      expect(accountsAfter.find((a) => a.name === 'Skipped Account')).toBeUndefined();
      const keptAccount = accountsAfter.find((a) => a.name === 'Kept Account');
      expect(keptAccount).toBeDefined();

      const transactions = await helpers.getTransactions({ raw: true });
      const importedTxs = transactions.filter((tx) => summary.newTransactionIds.includes(tx.id));
      expect(importedTxs).toHaveLength(1);
      expect(importedTxs[0]!.note).toBe('kept-row');
      expect(importedTxs[0]!.accountId).toBe(keptAccount!.id);
    });

    it('completes with zeroed counts when every account is mapped to skip', async () => {
      const accountsBefore = await helpers.getAccounts();

      const { progress } = await runImport({
        fileContent: buildCsv(defaultRows({ account: 'Skipped Account', currency: 'USD' })),
        accountMapping: { 'Skipped Account': { action: 'skip' } },
      });
      expectCsvImportCompleted(progress);

      expect(progress.processedCount).toBe(0);
      expect(progress.totalCount).toBe(0);
      expect(progress.summary).toMatchObject({
        imported: 0,
        skipped: 0,
        skippedUnpriceable: 0,
        accountsSkipped: 1,
        accountsCreated: 0,
        categoriesCreated: 0,
        tagsCreated: 0,
        payeesCreated: 0,
        errors: [],
        newTransactionIds: [],
        accountBalanceChanges: [],
      });

      expect((await helpers.getAccounts()).length).toBe(accountsBefore.length);
      expect(await helpers.getTransactions({ raw: true })).toHaveLength(0);
    });

    it('imports only the linked account rows when the other source account is skipped', async () => {
      const account = await helpers.createAccount({ raw: true });
      const accountsBefore = await helpers.getAccounts();
      // The skipped rows carry a currency the linked account does not use: they
      // are filtered before the currency guard, so the import still completes.
      const skippedCurrency = account.currencyCode === 'USD' ? 'EUR' : 'USD';

      const fileContent = buildCsv([
        {
          date: '2024-01-15',
          amount: '30.00',
          description: 'linked-row',
          account: 'Linked Account',
          currency: account.currencyCode,
          type: 'expense',
        },
        {
          date: '2024-01-16',
          amount: '40.00',
          description: 'skipped-row',
          account: 'Other Account',
          currency: skippedCurrency,
          type: 'expense',
        },
      ]);

      const { progress } = await runImport({
        fileContent,
        accountMapping: {
          'Linked Account': { action: 'link-existing', accountId: account.id },
          'Other Account': { action: 'skip' },
        },
      });
      expectCsvImportCompleted(progress);
      const { summary } = progress;

      expect(summary.imported).toBe(1);
      expect(summary.accountsSkipped).toBe(1);
      expect(summary.accountsCreated).toBe(0);
      expect(summary.errors).toHaveLength(0);

      const transactions = await helpers.getTransactions({ raw: true });
      expect(transactions.map((tx) => tx.note)).toEqual(['linked-row']);
      expect(transactions[0]!.accountId).toBe(account.id);
      expect((await helpers.getAccounts()).length).toBe(accountsBefore.length);
    });

    it('creates no category or tag that only skipped-account rows reference', async () => {
      const account = await helpers.createAccount({ raw: true });

      const fileContent = buildCsv([
        {
          date: '2024-01-15',
          amount: '100.50',
          description: 'kept-row',
          category: 'KeptCategory',
          account: 'Kept Account',
          currency: account.currencyCode,
          type: 'expense',
          tags: 'KeptTag',
        },
        {
          date: '2024-01-16',
          amount: '20.00',
          description: 'skipped-row',
          category: 'OrphanCategory',
          account: 'Skipped Account',
          currency: account.currencyCode,
          type: 'expense',
          tags: 'OrphanTag',
        },
      ]);

      const { progress } = await runImport({
        fileContent,
        columnMapping: buildColumnMapping({
          tags: { option: TagOptionValue.mapDataSourceColumn, columnName: 'Tags' },
        }),
        accountMapping: {
          'Kept Account': { action: 'link-existing', accountId: account.id },
          'Skipped Account': { action: 'skip' },
        },
        // The client sends the mapping it built before the account was skipped,
        // so the orphan entries arrive alongside the surviving row's entries.
        categoryMapping: {
          KeptCategory: { action: 'create-new' },
          OrphanCategory: { action: 'create-new' },
        },
        tagMapping: {
          KeptTag: { action: 'create-new' },
          OrphanTag: { action: 'create-new' },
        },
      });
      expectCsvImportCompleted(progress);
      const { summary } = progress;

      expect(summary.imported).toBe(1);
      expect(summary.accountsSkipped).toBe(1);
      expect(summary.categoriesCreated).toBe(1);
      expect(summary.tagsCreated).toBe(1);
      expect(summary.errors).toHaveLength(0);

      const categoryNames = (await helpers.getCategoriesList()).map((category) => category.name);
      expect(categoryNames).toContain('KeptCategory');
      expect(categoryNames).not.toContain('OrphanCategory');

      const tagNames = (await helpers.getTags({ raw: true })).map((tag) => tag.name);
      expect(tagNames).toContain('KeptTag');
      expect(tagNames).not.toContain('OrphanTag');
    });
  });

  describe('error handling – failed jobs', () => {
    // The controller only validates the request shape; mapping/ownership failures
    // happen inside the worker and surface as `status: 'failed'`, mirroring the
    // Wallet importer. The summary is never present on a failed job.

    it('fails the job on unresolvable mappings and over-long create-new names', async () => {
      const account = await helpers.createAccount({ raw: true });

      const missingMapping = await runImport({
        fileContent: buildCsv(defaultRows({ account: 'Unknown Account' })),
        accountMapping: {}, // Missing mapping for 'Unknown Account'
      });
      expect(missingMapping.progress.status).toBe('failed');
      if (missingMapping.progress.status !== 'failed') throw new Error('unreachable');
      expect(missingMapping.progress.error).toMatch(/no mapping found/i);

      const unknownAccount = await runImport({
        fileContent: buildCsv(defaultRows({ account: 'CSV Account' })),
        accountMapping: { 'CSV Account': { action: 'link-existing', accountId: generateRandomRecordId() } },
      });
      expect(unknownAccount.progress.status).toBe('failed');
      if (unknownAccount.progress.status !== 'failed') throw new Error('unreachable');
      expect(unknownAccount.progress.error).toMatch(/not found/i);

      const unknownCategory = await runImport({
        fileContent: buildCsv(
          defaultRows({ account: 'CSV Account', category: 'Some Category', currency: account.currencyCode }),
        ),
        accountMapping: { 'CSV Account': { action: 'link-existing', accountId: account.id } },
        categoryMapping: { 'Some Category': { action: 'link-existing', categoryId: generateRandomRecordId() } },
      });
      expect(unknownCategory.progress.status).toBe('failed');
      if (unknownCategory.progress.status !== 'failed') throw new Error('unreachable');
      expect(unknownCategory.progress.error).toMatch(/not found/i);

      // Categories.name is varchar(255): a longer source name must surface as a
      // ValidationError, not Postgres's raw "value too long..." text.
      const tooLongCategoryName = 'A'.repeat(300);
      const overlongCategory = await runImport({
        fileContent: buildCsv(
          defaultRows({
            account: 'CSV Account',
            category: tooLongCategoryName,
            currency: account.currencyCode,
          }),
        ),
        accountMapping: { 'CSV Account': { action: 'link-existing', accountId: account.id } },
        categoryMapping: { [tooLongCategoryName]: { action: 'create-new' } },
      });
      expect(overlongCategory.progress.status).toBe('failed');
      if (overlongCategory.progress.status !== 'failed') throw new Error('unreachable');
      expect(overlongCategory.progress.error).toMatch(/category name.*too long|too long.*category/i);
      expect(overlongCategory.progress.error).not.toMatch(/character varying|sequelize/i);
    }, 60_000);

    it('fails the job when link-existing rows carry a different currency than the linked account', async () => {
      // A transaction's currency always comes from the account it lands on, so
      // a mismatched row would keep its number and silently change meaning
      // (100 USD booked as 100 <account currency>). The guard fails the job
      // BEFORE any side effect, so the account must stay completely untouched.
      const account = await helpers.createAccount({ raw: true });
      const mismatchedCurrency = account.currencyCode === 'USD' ? 'EUR' : 'USD';

      const { progress } = await runImport({
        fileContent: buildCsv(defaultRows({ account: 'CSV Account', currency: mismatchedCurrency })),
        accountMapping: { 'CSV Account': { action: 'link-existing', accountId: account.id } },
      });

      expect(progress.status).toBe('failed');
      if (progress.status !== 'failed') throw new Error('unreachable');
      expect(progress.error).toMatch(/currencies must match/i);
      expect(progress.error).toContain(mismatchedCurrency);
      expect(progress.error).toContain(account.currencyCode);

      // Zero state: no rows were written and the balance never moved.
      const after = await helpers.getAccount({ id: account.id, raw: true });
      expect(after.currentBalance).toStrictEqual(account.currentBalance);
      const transactions = await helpers.getTransactions({ raw: true });
      expect(transactions.filter((tx) => tx.accountId === account.id)).toHaveLength(0);
    });

    it('leaves no created account behind when a later create-new account fails', async () => {
      // Accounts are created in row order and Accounts.name is varchar(255), so
      // the second insert fails after the first one succeeded.
      const firstAccountName = 'Rolled Back Account';
      const tooLongAccountName = 'A'.repeat(300);

      const { progress } = await runImport({
        fileContent: buildCsv([
          { date: '2024-01-15', amount: '10.00', account: firstAccountName, currency: 'USD', type: 'expense' },
          { date: '2024-01-16', amount: '20.00', account: tooLongAccountName, currency: 'USD', type: 'expense' },
        ]),
        accountMapping: {
          [firstAccountName]: { action: 'create-new', currentBalance: null },
          [tooLongAccountName]: { action: 'create-new', currentBalance: null },
        },
      });

      expect(progress.status).toBe('failed');
      if (progress.status !== 'failed') throw new Error('unreachable');
      expect(progress.error).toMatch(/too long/i);

      const accountNames = (await helpers.getAccounts()).map((account) => account.name);
      expect(accountNames).not.toContain(firstAccountName);
    });

    it('completes with an empty summary when the CSV has only a header row', async () => {
      // No data rows → the worker parses zero valid rows and completes with an
      // empty summary (not a failure).
      const { progress } = await runImport({
        fileContent: CSV_HEADERS.join(','),
        accountMapping: {},
      });
      expectCsvImportCompleted(progress);
      expect(progress.summary.imported).toBe(0);
      expect(progress.summary.skipped).toBe(0);
      expect(progress.summary.newTransactionIds).toHaveLength(0);
    });
  });

  describe('status endpoint', () => {
    it("returns 404 for an unknown job id and for another user's job (cross-user authZ)", async () => {
      const unknownJob = await helpers.getCsvImportStatus({ jobId: 'no-such-csv-job' });
      expect(unknownJob.statusCode).toBe(ERROR_CODES.NotFoundError);

      const account = await helpers.createAccount({ raw: true });

      // User A enqueues a job – the status row is visible the moment it enqueues.
      const { jobId } = await helpers.executeImport({
        payload: {
          fileContent: buildCsv(defaultRows({ account: 'CSV Account', currency: account.currencyCode })),
          delimiter: ',',
          columnMapping: buildColumnMapping(),
          accountMapping: { 'CSV Account': { action: 'link-existing', accountId: account.id } },
          categoryMapping: {},
          skipDuplicateIndices: [],
        },
        raw: true,
      });
      expect(jobId).toBeTruthy();

      const otherUser = await signUpSecondUser();
      const statusAsOther = await asUser({
        cookies: otherUser.cookies,
        fn: () => helpers.getCsvImportStatus({ jobId }),
      });
      expect(statusAsOther.statusCode).toBe(ERROR_CODES.NotFoundError);
    });
  });

  describe('skipUnpriceableIndices', () => {
    it('reports duplicate and unpriceable skips separately', async () => {
      const account = await helpers.createAccount({ raw: true });
      const fileContent = buildCsv(defaultRows({ account: 'CSV Account', currency: account.currencyCode }));
      const accountMapping = { 'CSV Account': { action: 'link-existing' as const, accountId: account.id } };

      // rowIndices 2 and 3 are marked unpriceable; only rowIndex 4 imports.
      const unpriceableOnly = await runImport({ fileContent, accountMapping, skipUnpriceableIndices: [2, 3] });
      expectCsvImportCompleted(unpriceableOnly.progress);

      expect(unpriceableOnly.progress.summary.imported).toBe(1);
      expect(unpriceableOnly.progress.summary.skipped).toBe(0);
      expect(unpriceableOnly.progress.summary.skippedUnpriceable).toBe(2);
      expect(unpriceableOnly.progress.summary.newTransactionIds).toHaveLength(1);

      // rowIndex 2 → duplicate-skip; rowIndex 3 → unpriceable-skip; rowIndex 4 → imported.
      const both = await runImport({
        fileContent,
        accountMapping,
        skipDuplicateIndices: [2],
        skipUnpriceableIndices: [3],
      });
      expectCsvImportCompleted(both.progress);

      expect(both.progress.summary.imported).toBe(1);
      expect(both.progress.summary.skipped).toBe(1);
      expect(both.progress.summary.skippedUnpriceable).toBe(1);
      expect(both.progress.summary.newTransactionIds).toHaveLength(1);

      const allSkipped = await runImport({
        fileContent,
        accountMapping,
        skipDuplicateIndices: [2],
        skipUnpriceableIndices: [3, 4],
      });
      expectCsvImportCompleted(allSkipped.progress);

      expect(allSkipped.progress.summary.imported).toBe(0);
      expect(allSkipped.progress.summary.skipped).toBe(1);
      expect(allSkipped.progress.summary.skippedUnpriceable).toBe(2);
      expect(allSkipped.progress.summary.newTransactionIds).toHaveLength(0);
    }, 60_000);
  });

  describe('importDetails in externalData', () => {
    it('should have different batchIds for separate imports', async () => {
      const account = await helpers.createAccount({ raw: true });
      const fileContent = buildCsv(defaultRows({ account: 'CSV Account', currency: account.currencyCode }));
      const accountMapping = { 'CSV Account': { action: 'link-existing' as const, accountId: account.id } };

      const first = await runImport({ fileContent, accountMapping });
      const second = await runImport({ fileContent, accountMapping });
      expectCsvImportCompleted(first.progress);
      expectCsvImportCompleted(second.progress);

      const firstSummary = first.progress.summary;
      expect(firstSummary.imported).toBe(3);
      expect(firstSummary.errors).toHaveLength(0);

      const firstImportedTx = await Transactions.findByPk(firstSummary.newTransactionIds[0]);
      const importDetails = firstImportedTx?.externalData?.importDetails as TransactionImportDetails | undefined;
      expect(importDetails).toBeDefined();
      expect(importDetails?.source).toBe(ImportSource.csv);
      expect(importDetails?.importedAt).toBeDefined();
      expect(() => new Date(importDetails!.importedAt)).not.toThrow();
      expect(new Date(importDetails!.importedAt).toISOString()).toBe(importDetails!.importedAt);

      // Every transaction in the import shares the same batchId.
      const firstImportedTxs = await Transactions.findAll({ where: { id: firstSummary.newTransactionIds } });
      const batchIds = firstImportedTxs.map(
        (tx) => (tx.externalData?.importDetails as TransactionImportDetails)?.batchId,
      );
      expect(batchIds.every((id) => id === firstSummary.batchId)).toBe(true);

      const tx1 = await Transactions.findByPk(first.progress.summary.newTransactionIds[0]);
      const tx2 = await Transactions.findByPk(second.progress.summary.newTransactionIds[0]);
      const batchId1 = (tx1?.externalData?.importDetails as TransactionImportDetails)?.batchId;
      const batchId2 = (tx2?.externalData?.importDetails as TransactionImportDetails)?.batchId;

      expect(batchId1).toBe(first.progress.summary.batchId);
      expect(batchId2).toBe(second.progress.summary.batchId);
      expect(batchId1).not.toBe(batchId2);
    }, 60_000);
  });

  describe('tags import', () => {
    const tagsOf = async (transactionId: string): Promise<string[]> => {
      const list = await helpers.getTransactions({ includeTags: true, raw: true });
      const tx = list.find((item) => item.id === transactionId);
      return (tx?.tags ?? []).map((t) => t.name);
    };

    // A single tagged expense row, tag column mapped.
    const tagRow = ({
      account = 'CSV Account',
      currency = 'USD',
      description = 'Tagged purchase',
      tags,
    }: {
      account?: string;
      currency?: string;
      description?: string;
      tags?: string;
    }): string =>
      buildCsv([{ date: '2024-01-15', amount: '100.50', description, account, currency, type: 'expense', tags }]);

    const tagColumnMapping = () =>
      buildColumnMapping({ tags: { option: TagOptionValue.mapDataSourceColumn, columnName: 'Tags' } });

    it('links an existing tag without creating a duplicate', async () => {
      const [account, existing] = await Promise.all([
        helpers.createAccount({ raw: true }),
        helpers.createTag({ payload: helpers.buildTagPayload({ name: 'Groceries' }), raw: true }),
      ]);

      const { progress } = await runImport({
        fileContent: tagRow({ currency: account.currencyCode, tags: 'Groceries' }),
        columnMapping: tagColumnMapping(),
        accountMapping: { 'CSV Account': { action: 'link-existing', accountId: account.id } },
        tagMapping: { Groceries: { action: 'link-existing', tagId: existing.id } },
      });
      expectCsvImportCompleted(progress);

      expect(progress.summary.imported).toBe(1);
      expect(progress.summary.tagsCreated).toBe(0);

      const allTags = await helpers.getTags({ raw: true });
      expect(allTags.filter((t) => t.name === 'Groceries')).toHaveLength(1);
      expect(await tagsOf(progress.summary.newTransactionIds[0]!)).toEqual(['Groceries']);
    });

    it('drops source values whose mapping is skip', async () => {
      const account = await helpers.createAccount({ raw: true });

      const { progress } = await runImport({
        // Comma-separated tags in one quoted cell – the parser splits them.
        fileContent: tagRow({ currency: account.currencyCode, tags: '"Keep,Drop"' }),
        columnMapping: tagColumnMapping(),
        accountMapping: { 'CSV Account': { action: 'link-existing', accountId: account.id } },
        tagMapping: {
          Keep: { action: 'create-new' },
          Drop: { action: 'skip' },
        },
      });
      expectCsvImportCompleted(progress);

      expect(progress.summary.imported).toBe(1);
      expect(progress.summary.tagsCreated).toBe(1);

      const allTags = await helpers.getTags({ raw: true });
      expect(allTags.map((t) => t.name)).toContain('Keep');
      expect(allTags.map((t) => t.name)).not.toContain('Drop');
      expect(await tagsOf(progress.summary.newTransactionIds[0]!)).toEqual(['Keep']);
    });

    it('unions imported tags with the payee default tags', async () => {
      // createTransaction extracts the payee from the description when this
      // setting is on – the e2e-reachable way to link a payee via execute.
      await helpers.updateUserSettings({ settings: { locale: 'en', payeeExtractionUsesDescription: true } });

      const [account, defaultTag] = await Promise.all([
        helpers.createAccount({ raw: true }),
        helpers.createTag({ payload: helpers.buildTagPayload({ name: 'PayeeDefault' }), raw: true }),
      ]);
      await helpers.createPayee({
        payload: helpers.buildPayeePayload({ name: 'Spotify', defaultTagIds: [defaultTag.id] }),
        raw: true,
      });

      const { progress } = await runImport({
        fileContent: tagRow({ currency: account.currencyCode, description: 'Spotify', tags: 'Imported' }),
        columnMapping: tagColumnMapping(),
        accountMapping: { 'CSV Account': { action: 'link-existing', accountId: account.id } },
        tagMapping: { Imported: { action: 'create-new' } },
      });
      expectCsvImportCompleted(progress);

      expect(progress.summary.imported).toBe(1);
      // Both the imported tag and the payee's default tag must be present.
      expect((await tagsOf(progress.summary.newTransactionIds[0]!)).toSorted()).toEqual(['Imported', 'PayeeDefault']);
    });

    it('fails the job when a tag mapping link-existing id does not belong to the user', async () => {
      const account = await helpers.createAccount({ raw: true });

      const { progress } = await runImport({
        fileContent: tagRow({ currency: account.currencyCode, tags: 'Ghost' }),
        columnMapping: tagColumnMapping(),
        accountMapping: { 'CSV Account': { action: 'link-existing', accountId: account.id } },
        tagMapping: { Ghost: { action: 'link-existing', tagId: generateRandomRecordId() } },
      });
      expect(progress.status).toBe('failed');
      if (progress.status !== 'failed') throw new Error('unreachable');
      expect(progress.error).toMatch(/not found/i);
    });
  });

  describe('categories import', () => {
    const categoryIdOf = async (transactionId: string): Promise<string | null | undefined> => {
      const list = await helpers.getTransactions({ raw: true });
      return list.find((item) => item.id === transactionId)?.categoryId;
    };

    const categoryRow = ({
      account = 'CSV Account',
      currency = 'USD',
      category,
    }: {
      account?: string;
      currency?: string;
      category?: string;
    }): string =>
      buildCsv([
        {
          date: '2024-01-15',
          amount: '100.50',
          description: 'Categorised purchase',
          category,
          account,
          currency,
          type: 'expense',
        },
      ]);

    it('reuses an existing same-named category case-insensitively for create-new and does not count it', async () => {
      const existingName = `Repeat Cat ${generateRandomRecordId()}`;
      const [account, seeded] = await Promise.all([
        helpers.createAccount({ raw: true }),
        helpers.addCustomCategory({ name: existingName, color: '#AABBCC', raw: true }),
      ]);
      expect(seeded.name).toBe(existingName);
      expect(seeded.id).toBeTruthy();

      const categoriesBefore = await helpers.getCategoriesList();
      const lowercased = existingName.toLowerCase();

      const { progress } = await runImport({
        fileContent: categoryRow({ currency: account.currencyCode, category: lowercased }),
        accountMapping: { 'CSV Account': { action: 'link-existing', accountId: account.id } },
        categoryMapping: { [lowercased]: { action: 'create-new' } },
      });
      expectCsvImportCompleted(progress);

      expect(progress.summary.imported).toBe(1);
      expect(progress.summary.categoriesCreated).toBe(0); // reuse, not a creation
      expect(progress.summary.errors).toHaveLength(0);

      expect(await categoryIdOf(progress.summary.newTransactionIds[0]!)).toBe(seeded.id);
      expect((await helpers.getCategoriesList()).length).toBe(categoriesBefore.length);
    });

    it('treats create-new source values with ILIKE wildcards as literals, creating new categories', async () => {
      // '50%' as an ILIKE pattern would match this decoy; as a literal it must not.
      const decoyName = `50% off ${generateRandomRecordId()}`;
      const [account, decoy] = await Promise.all([
        helpers.createAccount({ raw: true }),
        helpers.addCustomCategory({ name: decoyName, color: '#AABBCC', raw: true }),
      ]);
      expect(decoy.id).toBeTruthy();

      const categoriesBefore = await helpers.getCategoriesList();

      const { progress } = await runImport({
        fileContent: categoryRow({ currency: account.currencyCode, category: '50%' }),
        accountMapping: { 'CSV Account': { action: 'link-existing', accountId: account.id } },
        categoryMapping: { '50%': { action: 'create-new' } },
      });
      expectCsvImportCompleted(progress);

      expect(progress.summary.imported).toBe(1);
      expect(progress.summary.categoriesCreated).toBe(1); // genuine insert, not the decoy
      expect(progress.summary.errors).toHaveLength(0);

      const linkedCategoryId = await categoryIdOf(progress.summary.newTransactionIds[0]!);
      expect(linkedCategoryId).toBeTruthy();
      expect(linkedCategoryId).not.toBe(decoy.id);

      const categoriesAfter = await helpers.getCategoriesList();
      expect(categoriesAfter.length).toBe(categoriesBefore.length + 1);
      expect(categoriesAfter.find((c) => c.id === linkedCategoryId)?.name).toBe('50%');
    });
  });

  // ---------------------------------------------------------------------------
  // CSV importer – auto-create Payee on import (columnMapping.payee).
  //
  // Drives the CSV execute endpoints as the UI does: CSV `fileContent` + a
  // `columnMapping` that maps "Payee", enqueue, poll to terminal, then assert on
  // `summary.payeesCreated` and the persisted `payeeId`/`categoryId` (Docker e2e
  // swallows console.*, so response fields are the only signal).
  // ---------------------------------------------------------------------------
  describe('CSV Execute Import – payee auto-create', () => {
    /** Fetch the persisted transaction created by this import, matched by note. */
    const txByNote = async (note: string) => {
      const list = await helpers.getTransactions({ raw: true });
      return list.find((tx) => tx.note === note);
    };

    const expenseRow = ({
      amount = '100.50',
      description,
      account,
      currency,
      category,
      payee,
    }: {
      amount?: string;
      description: string;
      account: string;
      currency: string;
      category?: string;
      payee?: string;
    }): CsvRow => ({ date: '2024-01-15', amount, description, category, account, currency, type: 'expense', payee });
    it('scenario 1 – creates a new Payee per distinct brand-new name (payeesCreated === 2)', async () => {
      const account = await helpers.createAccount({ raw: true });
      const payeeA = `Payee One ${generateRandomRecordId()}`;
      const payeeB = `Payee Two ${generateRandomRecordId()}`;

      const { progress } = await runImport({
        fileContent: buildCsv([
          expenseRow({ description: 'row-a', account: 'CSV Account', currency: account.currencyCode, payee: payeeA }),
          expenseRow({ description: 'row-b', account: 'CSV Account', currency: account.currencyCode, payee: payeeB }),
        ]),
        columnMapping: buildColumnMapping({ payee: 'Payee' }),
        accountMapping: { 'CSV Account': { action: 'link-existing', accountId: account.id } },
      });
      expectCsvImportCompleted(progress);

      expect(progress.summary.imported).toBe(2);
      expect(progress.summary.payeesCreated).toBe(2);
      expect(progress.summary.errors).toHaveLength(0);

      const txA = await txByNote('row-a');
      const txB = await txByNote('row-b');
      expect(txA?.payeeId).toBeTruthy();
      expect(txB?.payeeId).toBeTruthy();
      // The two distinct names produced two distinct Payees.
      expect(txA?.payeeId).not.toBe(txB?.payeeId);
      // An import-assigned Payee is advisory: payeeLocked stays false so the user
      // (or a later payee rule) can re-resolve the merchant.
      expect(txA?.payeeLocked).toBe(false);

      // Both Payees are persisted under their source names.
      const payees = await helpers.listPayees({ raw: true });
      const names = payees.map((p) => p.name);
      expect(names).toContain(payeeA);
      expect(names).toContain(payeeB);
    });

    it('scenario 2 – links a normalized case/punctuation variant to an existing Payee without counting it', async () => {
      const account = await helpers.createAccount({ raw: true });
      const token = generateRandomRecordId();
      const existingName = `Acme Corp ${token}`;
      const existingPayee = await helpers.createPayee({
        payload: helpers.buildPayeePayload({ name: existingName }),
        raw: true,
      });

      // Case + punctuation variant: normalizePayeeName lowercases, strips
      // punctuation, collapses whitespace, so this resolves to `existingPayee`
      // rather than creating a second Payee.
      const variant = `acme corp. ${token}!`;

      const { progress } = await runImport({
        fileContent: buildCsv([
          expenseRow({
            description: 'variant-row',
            account: 'CSV Account',
            currency: account.currencyCode,
            payee: variant,
          }),
        ]),
        columnMapping: buildColumnMapping({ payee: 'Payee' }),
        accountMapping: { 'CSV Account': { action: 'link-existing', accountId: account.id } },
      });
      expectCsvImportCompleted(progress);

      expect(progress.summary.imported).toBe(1);
      expect(progress.summary.payeesCreated).toBe(0); // linked, not created
      expect(progress.summary.errors).toHaveLength(0);

      const tx = await txByNote('variant-row');
      expect(tx?.payeeId).toBe(existingPayee.id);
    });

    it('scenario 3 – leaves payeeId null and payeesCreated 0 when no payee column is mapped', async () => {
      const account = await helpers.createAccount({ raw: true });

      // The Payee cells carry values, but the column is NOT mapped — the mapping
      // is the only gate, so nothing is read and no Payee is created/linked.
      const { progress } = await runImport({
        fileContent: buildCsv([
          expenseRow({
            description: 'unmapped-row',
            account: 'CSV Account',
            currency: account.currencyCode,
            payee: `Ignored Payee ${generateRandomRecordId()}`,
          }),
        ]),
        columnMapping: buildColumnMapping(), // no `payee` override
        accountMapping: { 'CSV Account': { action: 'link-existing', accountId: account.id } },
      });
      expectCsvImportCompleted(progress);

      expect(progress.summary.imported).toBe(1);
      expect(progress.summary.payeesCreated).toBe(0);

      const tx = await txByNote('unmapped-row');
      expect(tx?.payeeId).toBeNull();
    });

    it('scenario 4 – dedupes repeated payee names: one create, both rows link the same Payee', async () => {
      const account = await helpers.createAccount({ raw: true });
      const payeeName = `Dupe Payee ${generateRandomRecordId()}`;

      const { progress } = await runImport({
        fileContent: buildCsv([
          expenseRow({
            description: 'dupe-1',
            account: 'CSV Account',
            currency: account.currencyCode,
            payee: payeeName,
          }),
          expenseRow({
            description: 'dupe-2',
            account: 'CSV Account',
            currency: account.currencyCode,
            payee: payeeName,
          }),
        ]),
        columnMapping: buildColumnMapping({ payee: 'Payee' }),
        accountMapping: { 'CSV Account': { action: 'link-existing', accountId: account.id } },
      });
      expectCsvImportCompleted(progress);

      expect(progress.summary.imported).toBe(2);
      expect(progress.summary.payeesCreated).toBe(1); // counted once

      const tx1 = await txByNote('dupe-1');
      const tx2 = await txByNote('dupe-2');
      expect(tx1?.payeeId).toBeTruthy();
      expect(tx1?.payeeId).toBe(tx2?.payeeId);
    });

    it('scenario 5 – mapped category wins over an enforce-mode payee default; payee default applies only when no category is mapped', async () => {
      const account = await helpers.createAccount({ raw: true });
      const token = generateRandomRecordId();

      // categoryA = the enforce-mode payee's default; categoryB = the per-row
      // mapped category. Distinct, unique names so they don't collide with seeded
      // defaults (which would read as 0 created / hang polls).
      const [categoryA, categoryB] = await Promise.all([
        helpers.addCustomCategory({ name: `Cat A ${token}`, color: '#111111', raw: true }),
        helpers.addCustomCategory({ name: `Cat B ${token}`, color: '#222222', raw: true }),
      ]);

      const payeeName = `Enforce Payee ${token}`;
      const payee = await helpers.createPayee({
        payload: helpers.buildPayeePayload({
          name: payeeName,
          defaultCategoryId: categoryA.id,
          categorizationMode: CATEGORIZATION_MODE.enforce,
        }),
        raw: true,
      });

      const catBSource = `Cat B ${token}`;

      const { progress } = await runImport({
        fileContent: buildCsv([
          // Row X: same payee AND a mapped category → mapped category must win.
          expenseRow({
            description: 'precedence-mapped',
            account: 'CSV Account',
            currency: account.currencyCode,
            category: catBSource,
            payee: payeeName,
          }),
          // Row Y: same payee, NO mapped category → payee enforce default applies.
          expenseRow({
            description: 'precedence-payee-default',
            account: 'CSV Account',
            currency: account.currencyCode,
            payee: payeeName,
          }),
        ]),
        columnMapping: buildColumnMapping({ payee: 'Payee' }),
        accountMapping: { 'CSV Account': { action: 'link-existing', accountId: account.id } },
        categoryMapping: { [catBSource]: { action: 'link-existing', categoryId: categoryB.id } },
      });
      expectCsvImportCompleted(progress);

      expect(progress.summary.imported).toBe(2);
      expect(progress.summary.payeesCreated).toBe(0); // pre-existing payee, linked
      expect(progress.summary.categoriesCreated).toBe(0); // categoryB linked, not created
      expect(progress.summary.errors).toHaveLength(0);

      const mappedTx = await txByNote('precedence-mapped');
      const payeeDefaultTx = await txByNote('precedence-payee-default');

      // Both rows link the same enforce-mode payee.
      expect(mappedTx?.payeeId).toBe(payee.id);
      expect(payeeDefaultTx?.payeeId).toBe(payee.id);

      // Row X: the explicitly mapped category beats the payee enforce default.
      expect(mappedTx?.categoryId).toBe(categoryB.id);
      // Row Y: with no mapped category, the payee enforce default is applied.
      expect(payeeDefaultTx?.categoryId).toBe(categoryA.id);
    });

    describe('error handling – payee failures', () => {
      // Payees are resolved before the per-row loop, so these failures abort the
      // whole batch and surface as `status: 'failed'`. Docker e2e swallows
      // console.*, so `progress.error` is the only signal.

      it('fails the job on an absent payee column and on an over-long payee name', async () => {
        const account = await helpers.createAccount({ raw: true });
        const accountMapping = { 'CSV Account': { action: 'link-existing' as const, accountId: account.id } };

        // A mapped payee column absent from CSV_HEADERS must be rejected up front
        // (parse-valid-rows throws csvImport.payeeColumnNotFound), not silently
        // imported with no payee data.
        const missingColumn = `Missing Payee Column ${generateRandomRecordId()}`;

        const missingColumnJob = await runImport({
          fileContent: buildCsv([
            expenseRow({
              description: 'missing-payee-col',
              account: 'CSV Account',
              currency: account.currencyCode,
              payee: 'ignored',
            }),
          ]),
          columnMapping: buildColumnMapping({ payee: missingColumn }),
          accountMapping,
        });

        expect(missingColumnJob.progress.status).toBe('failed');
        if (missingColumnJob.progress.status !== 'failed') throw new Error('unreachable');
        expect(missingColumnJob.progress.error).toMatch(/payee column.*not found/i);
        // The bad column name is echoed so the UI can point at the exact mapping.
        expect(missingColumnJob.progress.error).toContain(missingColumn);

        // Nothing was imported.
        expect(await txByNote('missing-payee-col')).toBeUndefined();

        // Payees.name is varchar(200): a longer brand-new name must surface as a
        // ValidationError (from create-payees-if-needed, before the row loop), not
        // Postgres's raw "value too long..." text.
        const tooLongPayeeName = `Overlong ${generateRandomRecordId()} ${'A'.repeat(250)}`;

        const overlongJob = await runImport({
          fileContent: buildCsv([
            expenseRow({
              description: 'overlong-payee',
              account: 'CSV Account',
              currency: account.currencyCode,
              payee: tooLongPayeeName,
            }),
          ]),
          columnMapping: buildColumnMapping({ payee: 'Payee' }),
          accountMapping,
        });

        expect(overlongJob.progress.status).toBe('failed');
        if (overlongJob.progress.status !== 'failed') throw new Error('unreachable');
        expect(overlongJob.progress.error).toMatch(/payee name.*too long|too long.*payee/i);
        expect(overlongJob.progress.error).not.toMatch(/character varying|sequelize/i);

        // The batch aborted before the row loop, so nothing was imported.
        expect(await txByNote('overlong-payee')).toBeUndefined();
      }, 60_000);

      it('lists and undoes an account created by an import that then failed on an over-long payee name', async () => {
        const accountName = 'Failed Import Account';

        const { progress } = await runImport({
          fileContent: buildCsv([
            expenseRow({
              description: 'overlong-payee-new-account',
              account: accountName,
              currency: 'USD',
              payee: `Overlong ${generateRandomRecordId()} ${'A'.repeat(250)}`,
            }),
          ]),
          columnMapping: buildColumnMapping({ payee: 'Payee' }),
          accountMapping: { [accountName]: { action: 'create-new', currentBalance: null } },
        });

        expect(progress.status).toBe('failed');

        const created = (await helpers.getAccounts()).find((account) => account.name === accountName)!;
        expect(created).toBeDefined();

        const history = await helpers.getBatchesHistory({ raw: true });
        expect(history).toEqual({
          items: [expect.objectContaining({ transactionCount: 0, accountIds: [created.id], createdAccountCount: 1 })],
          totalCount: 1,
        });

        await helpers.deleteImportBatch({ batchId: history.items[0]!.batchId, raw: true });

        expect(await helpers.getBatchesHistory({ raw: true })).toEqual({ items: [], totalCount: 0 });
        expect((await helpers.getAccounts()).map((account) => account.id)).not.toContain(created.id);
      });
    });
  });
});
