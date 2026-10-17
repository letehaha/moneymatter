import {
  AccountOptionValue,
  CategoryOptionValue,
  type ColumnMappingConfig,
  CurrencyOptionValue,
  TRANSACTION_TYPES,
  TagOptionValue,
  type RecordId,
  TransactionTypeOptionValue,
  asDecimal,
} from '@bt/shared/types';
import { describe, expect, it } from '@jest/globals';
import { ERROR_CODES } from '@js/errors';
import * as helpers from '@tests/helpers';

describe('Detect Duplicates endpoint', () => {
  // Helper to build common column mapping
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

  describe('row parsing and validation', () => {
    it('should parse valid rows successfully', async () => {
      const fileContent = helpers.loadCsvFixture('valid-comma.csv');

      const result = await helpers.detectDuplicates({
        payload: {
          fileContent,
          delimiter: ',',
          columnMapping: buildColumnMapping(),
          accountMapping: {
            'Main Account': { action: 'create-new', currentBalance: null },
          },
          categoryMapping: {},
        },
        raw: true,
      });

      expect(result.validRows).toHaveLength(5);
      expect(result.invalidRows).toHaveLength(0);
      expect(result.duplicates).toHaveLength(0);

      // Verify first row is parsed correctly. `date` is a full ISO instant
      // (date-only cell anchored to UTC noon with no timezone supplied), so the
      // assertion checks the resolved calendar day.
      const firstRow = result.validRows[0];
      expect(firstRow?.date).toBe('2024-01-15T12:00:00.000Z');
      expect(firstRow?.date.split('T')[0]).toBe('2024-01-15');
      expect(firstRow?.amount).toBe(100.5);
      expect(firstRow?.description).toBe('Grocery shopping');
      expect(firstRow?.categoryName).toBe('Food');
      expect(firstRow?.accountName).toBe('Main Account');
      expect(firstRow?.currencyCode).toBe('USD');
      expect(firstRow?.transactionType).toBe('expense');

      // Amounts are absolute decimals, sign carried by transactionType.
      expect(result.validRows.find((r) => r.description === 'Coffee shop')?.amount).toBe(50);
      expect(result.validRows.find((r) => r.description === 'Salary')?.amount).toBe(2500);
    });

    it('should identify invalid rows with errors', async () => {
      const fileContent = helpers.loadCsvFixture('invalid-data.csv');

      const result = await helpers.detectDuplicates({
        payload: {
          fileContent,
          delimiter: ',',
          columnMapping: buildColumnMapping(),
          accountMapping: {
            'Main Account': { action: 'create-new', currentBalance: null },
          },
          categoryMapping: {},
        },
        raw: true,
      });

      // Should have 2 valid rows (first and last)
      expect(result.validRows.length).toBeGreaterThanOrEqual(2);

      // Should have invalid rows for: invalid date, invalid amount, unknown type, empty account
      expect(result.invalidRows.length).toBeGreaterThanOrEqual(1);

      // Check that invalid rows contain error messages
      const invalidDateRow = result.invalidRows.find((r) => r.errors.some((e) => e.includes('date')));
      expect(invalidDateRow).toBeDefined();

      const invalidAmountRow = result.invalidRows.find((r) => r.errors.some((e) => e.includes('amount')));
      expect(invalidAmountRow).toBeDefined();
    });

    it('should use existing currency for all rows when specified', async () => {
      const fileContent = helpers.loadCsvFixture('minimal-columns.csv');
      const existingCategories = await helpers.getCategoriesList();
      const firstCategoryId = existingCategories[0]!.id;

      const result = await helpers.detectDuplicates({
        payload: {
          fileContent,
          delimiter: ',',
          columnMapping: {
            date: 'Date',
            dateFieldOrder: 'month-first',
            amount: 'Amount',
            category: { option: CategoryOptionValue.existingCategory, categoryId: firstCategoryId },
            currency: { option: CurrencyOptionValue.existingCurrency, currencyCode: 'EUR' },
            transactionType: { option: TransactionTypeOptionValue.amountSign },
            account: { option: AccountOptionValue.dataSourceColumn, columnName: 'Date' },
          },
          accountMapping: {
            '2024-01-15': { action: 'create-new', currentBalance: null },
            '2024-01-16': { action: 'create-new', currentBalance: null },
            '2024-01-17': { action: 'create-new', currentBalance: null },
          },
          categoryMapping: {},
        },
        raw: true,
      });

      expect(result.validRows.length).toBeGreaterThan(0);
      result.validRows.forEach((row) => {
        expect(row.currencyCode).toBe('EUR');
      });
    });
  });

  describe('duplicate detection', () => {
    it('should detect a duplicate against an existing balance-adjustment transaction', async () => {
      const account = await helpers.createAccount({
        payload: helpers.buildAccountPayload({ initialBalance: 1000 }),
        raw: true,
      });

      // Drops the balance by 100.50 on 2024-01-15, matching the first row of `valid-comma.csv`.
      const adjustment = await helpers.balanceAdjustment({
        id: account.id,
        payload: { targetBalance: asDecimal(899.5), time: '2024-01-15T12:00:00.000Z' },
        raw: true,
      });

      const result = await helpers.detectDuplicates({
        payload: {
          fileContent: helpers.loadCsvFixture('valid-comma.csv'),
          delimiter: ',',
          columnMapping: buildColumnMapping(),
          accountMapping: {
            'Main Account': { action: 'link-existing', accountId: account.id },
          },
          categoryMapping: {},
        },
        raw: true,
      });

      expect(result.duplicates.map((d) => d.existingTransaction.id)).toContain(adjustment.transaction!.id);
    });

    it('should not detect duplicates when transaction type differs', async () => {
      // Create an account
      const account = await helpers.createAccount({ raw: true });

      // Create a transaction with INCOME type (CSV has expense)
      const txPayload = helpers.buildTransactionPayload({
        accountId: account.id,
        amount: 100.5, // Same amount as CSV
        transactionType: TRANSACTION_TYPES.income, // Different type
        time: new Date('2024-01-15').toISOString(),
      });
      await helpers.createTransaction({ payload: txPayload, raw: true });

      const fileContent = helpers.loadCsvFixture('valid-comma.csv');

      const result = await helpers.detectDuplicates({
        payload: {
          fileContent,
          delimiter: ',',
          columnMapping: buildColumnMapping(),
          accountMapping: {
            'Main Account': { action: 'link-existing', accountId: account.id },
          },
          categoryMapping: {},
        },
        raw: true,
      });

      // The duplicate for row 1 should not be found since types differ
      const duplicateForFirstRow = result.duplicates.find((d) => d.rowIndex === 2);
      expect(duplicateForFirstRow).toBeUndefined();
    });
  });

  describe('duplicate detection with different account mappings', () => {
    it('should not detect duplicates when using different account mapping', async () => {
      const accountA = await helpers.createAccount({ raw: true });
      const accountB = await helpers.createAccount({ raw: true });

      // Create transaction in accountA
      const txPayload = helpers.buildTransactionPayload({
        accountId: accountA.id,
        amount: 100.5,
        transactionType: TRANSACTION_TYPES.expense,
        time: new Date('2024-01-15').toISOString(),
      });
      await helpers.createTransaction({ payload: txPayload, raw: true });

      const fileContent = helpers.loadCsvFixture('valid-comma.csv');

      const result = await helpers.detectDuplicates({
        payload: {
          fileContent,
          delimiter: ',',
          columnMapping: buildColumnMapping({
            account: { option: AccountOptionValue.dataSourceColumn, columnName: 'Account' },
          }),
          accountMapping: {
            'Main Account': { action: 'link-existing', accountId: accountB.id }, // Map to different account
          },
          categoryMapping: {},
        },
        raw: true,
      });

      // No duplicates should be found - transaction is in accountA, CSV maps to accountB
      const duplicateForFirstRow = result.duplicates.find((d) => d.rowIndex === 2);
      expect(duplicateForFirstRow).toBeUndefined();
    });

    it('should detect duplicates with existingAccount option', async () => {
      const account = await helpers.createAccount({ raw: true });

      // Create multiple matching transactions
      const tx1Payload = helpers.buildTransactionPayload({
        accountId: account.id,
        amount: 100.5,
        transactionType: TRANSACTION_TYPES.expense,
        time: new Date('2024-01-15').toISOString(),
      });
      await helpers.createTransaction({ payload: tx1Payload, raw: true });

      const tx2Payload = helpers.buildTransactionPayload({
        accountId: account.id,
        amount: 50.0,
        transactionType: TRANSACTION_TYPES.expense,
        time: new Date('2024-01-16').toISOString(),
      });
      await helpers.createTransaction({ payload: tx2Payload, raw: true });

      const fileContent = helpers.loadCsvFixture('valid-comma.csv');

      const result = await helpers.detectDuplicates({
        payload: {
          fileContent,
          delimiter: ',',
          columnMapping: buildColumnMapping({
            account: { option: AccountOptionValue.existingAccount, accountId: account.id },
          }),
          accountMapping: {}, // No mapping needed with existingAccount
          categoryMapping: {},
        },
        raw: true,
      });

      // All rows should be checked against the same account
      expect(result.duplicates.length).toBeGreaterThanOrEqual(2);

      // All duplicates should reference the same account
      result.duplicates.forEach((duplicate) => {
        expect(duplicate.existingTransaction.accountId).toBe(account.id);
      });
    });

    it('should detect duplicates across multiple existing accounts correctly', async () => {
      const account1 = await helpers.createAccount({ raw: true });
      const account3 = await helpers.createAccount({ raw: true });

      // Create transaction in account1 matching Checking Account CSV row
      const tx1Payload = helpers.buildTransactionPayload({
        accountId: account1.id,
        amount: 100.5,
        transactionType: TRANSACTION_TYPES.expense,
        time: new Date('2024-01-15').toISOString(),
      });
      await helpers.createTransaction({ payload: tx1Payload, raw: true });

      // Create transaction in account3 matching Credit Card CSV row (75.00 = 7500 cents)
      const tx3Payload = helpers.buildTransactionPayload({
        accountId: account3.id,
        amount: 75.0,
        transactionType: TRANSACTION_TYPES.expense,
        time: new Date('2024-01-18').toISOString(),
      });
      await helpers.createTransaction({ payload: tx3Payload, raw: true });

      const fileContent = helpers.loadCsvFixture('multiple-accounts.csv');

      const result = await helpers.detectDuplicates({
        payload: {
          fileContent,
          delimiter: ',',
          columnMapping: buildColumnMapping(),
          accountMapping: {
            'Checking Account': { action: 'link-existing', accountId: account1.id },
            'Savings Account': { action: 'create-new', currentBalance: null },
            'Credit Card': { action: 'link-existing', accountId: account3.id },
          },
          categoryMapping: {},
        },
        raw: true,
      });

      // Should detect duplicates from account1 and account3
      const duplicatesAccount1 = result.duplicates.filter((d) => d.existingTransaction.accountId === account1.id);
      const duplicatesAccount3 = result.duplicates.filter((d) => d.existingTransaction.accountId === account3.id);

      expect(duplicatesAccount1.length).toBeGreaterThanOrEqual(1);
      expect(duplicatesAccount3.length).toBeGreaterThanOrEqual(1);

      // A create-new account can never produce duplicates.
      const duplicatesForNewAccount = result.duplicates.filter(
        (d) => result.validRows.find((r) => r.rowIndex === d.rowIndex)?.accountName === 'Savings Account',
      );
      expect(duplicatesForNewAccount).toHaveLength(0);
    });

    it('should correctly match duplicates based on date, amount, and account combination', async () => {
      const account = await helpers.createAccount({ raw: true });

      // Create exact match
      const tx1Payload = helpers.buildTransactionPayload({
        accountId: account.id,
        amount: 100.5,
        transactionType: TRANSACTION_TYPES.expense,
        time: new Date('2024-01-15').toISOString(),
      });
      await helpers.createTransaction({ payload: tx1Payload, raw: true });

      // Create same amount but different date (not a duplicate)
      const tx2Payload = helpers.buildTransactionPayload({
        accountId: account.id,
        amount: 100.5,
        transactionType: TRANSACTION_TYPES.expense,
        time: new Date('2024-02-15').toISOString(),
      });
      await helpers.createTransaction({ payload: tx2Payload, raw: true });

      // Create same date but different amount (not a duplicate)
      const tx3Payload = helpers.buildTransactionPayload({
        accountId: account.id,
        amount: 999.99,
        transactionType: TRANSACTION_TYPES.expense,
        time: new Date('2024-01-15').toISOString(),
      });
      await helpers.createTransaction({ payload: tx3Payload, raw: true });

      const fileContent = helpers.loadCsvFixture('valid-comma.csv');

      const result = await helpers.detectDuplicates({
        payload: {
          fileContent,
          delimiter: ',',
          columnMapping: buildColumnMapping(),
          accountMapping: {
            'Main Account': { action: 'link-existing', accountId: account.id },
          },
          categoryMapping: {},
        },
        raw: true,
      });

      expect(result.duplicates).toHaveLength(1);
      const duplicatesForFirstRow = result.duplicates.filter((d) => d.rowIndex === 2);
      expect(duplicatesForFirstRow).toHaveLength(1);

      // Verify it's the correct match. `importedTransaction.date` is a full ISO
      // instant; the meaningful match is on its calendar day.
      const duplicate = duplicatesForFirstRow[0];
      expect(duplicate).toHaveProperty('rowIndex');
      expect(duplicate).toHaveProperty('importedTransaction');
      expect(duplicate).toHaveProperty('existingTransaction');
      expect(duplicate).toHaveProperty('matchType');
      expect(duplicate).toHaveProperty('confidence');
      expect(duplicate?.existingTransaction.amount).toBe(100.5);
      expect(duplicate?.importedTransaction.date.split('T')[0]).toBe('2024-01-15');
    });
  });

  describe('amounts at the account currency decimals', () => {
    const HEADERS = 'Date,Amount,Description,Category,Account,Currency,Type';

    const detectRowAgainst = async ({
      account,
      amount,
    }: {
      account: { id: string; currencyCode: string };
      amount: string;
    }) =>
      helpers.detectDuplicates({
        payload: {
          fileContent: `${HEADERS}\n2024-01-15,${amount},Row,,Acc,${account.currencyCode},expense`,
          delimiter: ',',
          columnMapping: buildColumnMapping(),
          accountMapping: { Acc: { action: 'link-existing', accountId: account.id } },
          categoryMapping: {},
        },
        raw: true,
      });

    const createExpense = ({ accountId, amount }: { accountId: RecordId; amount: number }) =>
      helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId,
          amount,
          transactionType: TRANSACTION_TYPES.expense,
          time: new Date('2024-01-15').toISOString(),
        }),
        raw: true,
      });

    const createKwdAccount = async () => {
      await helpers.addUserCurrencies({ currencyCodes: ['KWD'], raw: true });
      return helpers.createAccount({ payload: helpers.buildAccountPayload({ currencyCode: 'KWD' }), raw: true });
    };

    it('returns every parsed digit and does not flag a KWD 1.234 against an existing 1.231', async () => {
      const account = await createKwdAccount();
      await createExpense({ accountId: account.id, amount: 1.231 });

      const result = await detectRowAgainst({ account, amount: '1.234' });

      expect(result.validRows[0]?.amount).toBe(1.234);
      expect(result.duplicates).toHaveLength(0);
    });

    it('flags a KWD 1.234 against an existing 1.234 and reports the existing amount in decimals', async () => {
      const account = await createKwdAccount();
      await createExpense({ accountId: account.id, amount: 1.234 });

      const result = await detectRowAgainst({ account, amount: '1.234' });

      expect(result.duplicates).toHaveLength(1);
      expect(result.duplicates[0]?.existingTransaction.amount).toBe(1.234);
    });

    it('rounds the row to the account decimals before keying it', async () => {
      const kwdAccount = await createKwdAccount();
      const baseAccount = await helpers.createAccount({ raw: true });
      await createExpense({ accountId: kwdAccount.id, amount: 1.235 });
      await createExpense({ accountId: baseAccount.id, amount: 12.35 });

      expect((await detectRowAgainst({ account: kwdAccount, amount: '1.2345' })).duplicates).toHaveLength(1);
      expect((await detectRowAgainst({ account: baseAccount, amount: '12.345' })).duplicates).toHaveLength(1);
    });
  });

  describe('error handling', () => {
    it('should return validation error for empty file', async () => {
      const result = await helpers.detectDuplicates({
        payload: {
          fileContent: '',
          delimiter: ',',
          columnMapping: buildColumnMapping(),
          accountMapping: {},
          categoryMapping: {},
        },
        raw: false,
      });

      expect(result.statusCode).toBe(ERROR_CODES.ValidationError);
    });

    it('should handle CSV with only headers (no data rows)', async () => {
      const fileContent = helpers.loadCsvFixture('headers-only.csv');

      const result = await helpers.detectDuplicates({
        payload: {
          fileContent,
          delimiter: ',',
          columnMapping: buildColumnMapping(),
          accountMapping: {},
          categoryMapping: {},
        },
        raw: true,
      });

      expect(result.validRows).toHaveLength(0);
      expect(result.invalidRows).toHaveLength(0);
      expect(result.duplicates).toHaveLength(0);
    });

    it('should handle CSV where every row is invalid but mapped to an existing account', async () => {
      const account = await helpers.createAccount({ raw: true });

      // Every row has an invalid date so validRows ends up empty, but the
      // accountMapping links to a real account so existingAccountIds is non-empty.
      const csvContent = `Date,Amount,Description,Category,Currency,Type,Account
not-a-date,100.50,Bad row 1,Food,USD,expense,Main Account
also-bad,50.00,Bad row 2,Transport,USD,expense,Main Account`;

      const result = await helpers.detectDuplicates({
        payload: {
          fileContent: csvContent,
          delimiter: ',',
          columnMapping: buildColumnMapping(),
          accountMapping: {
            'Main Account': { action: 'link-existing', accountId: account.id },
          },
          categoryMapping: {},
        },
        raw: true,
      });

      expect(result.validRows).toHaveLength(0);
      expect(result.invalidRows).toHaveLength(2);
      expect(result.duplicates).toHaveLength(0);
    });
  });

  describe('transaction type edge cases', () => {
    it('resolves transaction types from custom, unknown, whitespaced and absent values', async () => {
      const customValuesCsv = `Date,Amount,Description,Category,Currency,Type,Account
2024-01-15,100.50,Transaction 1,Food,USD,credit,Main Account
2024-01-16,50.00,Transaction 2,Transport,USD,debit,Main Account
2024-01-17,75.00,Transaction 3,Entertainment,USD,deposit,Main Account
2024-01-18,25.00,Transaction 4,Food,USD,withdrawal,Main Account`;

      const customValues = await helpers.detectDuplicates({
        payload: {
          fileContent: customValuesCsv,
          delimiter: ',',
          columnMapping: buildColumnMapping({
            transactionType: {
              option: TransactionTypeOptionValue.dataSourceColumn,
              columnName: 'Type',
              incomeValues: ['credit', 'deposit'],
              expenseValues: ['debit', 'withdrawal'],
            },
          }),
          accountMapping: {
            'Main Account': { action: 'create-new', currentBalance: null },
          },
          categoryMapping: {},
        },
        raw: true,
      });

      expect(customValues.validRows).toHaveLength(4);
      expect(customValues.validRows.find((r) => r.description === 'Transaction 1')?.transactionType).toBe('income');
      expect(customValues.validRows.find((r) => r.description === 'Transaction 2')?.transactionType).toBe('expense');
      expect(customValues.validRows.find((r) => r.description === 'Transaction 3')?.transactionType).toBe('income');
      expect(customValues.validRows.find((r) => r.description === 'Transaction 4')?.transactionType).toBe('expense');

      const unrecognizedCsv = `Date,Amount,Description,Category,Currency,Type,Account
2024-01-15,100.50,Transaction 1,Food,USD,income,Main Account
2024-01-16,50.00,Transaction 2,Transport,USD,UNKNOWN,Main Account
2024-01-17,75.00,Transaction 3,Entertainment,USD,expense,Main Account
2024-01-18,25.00,Transaction 4,Food,USD,invalid_type,Main Account`;

      const unrecognized = await helpers.detectDuplicates({
        payload: {
          fileContent: unrecognizedCsv,
          delimiter: ',',
          columnMapping: buildColumnMapping({
            transactionType: {
              option: TransactionTypeOptionValue.dataSourceColumn,
              columnName: 'Type',
              incomeValues: ['income'],
              expenseValues: ['expense'],
            },
          }),
          accountMapping: {
            'Main Account': { action: 'create-new', currentBalance: null },
          },
          categoryMapping: {},
        },
        raw: true,
      });

      expect(unrecognized.validRows).toHaveLength(2);
      expect(unrecognized.invalidRows).toHaveLength(2);

      const unknownTypeRow = unrecognized.invalidRows.find((r) => r.rawData['Type'] === 'UNKNOWN');
      expect(unknownTypeRow).toBeDefined();
      expect(unknownTypeRow?.errors.some((e) => e.toLowerCase().includes('type'))).toBe(true);

      const invalidTypeRow = unrecognized.invalidRows.find((r) => r.rawData['Type'] === 'invalid_type');
      expect(invalidTypeRow).toBeDefined();
      expect(invalidTypeRow?.errors.some((e) => e.toLowerCase().includes('type'))).toBe(true);

      const whitespaceCsv = `Date,Amount,Description,Category,Currency,Type,Account
2024-01-15,100.50,Transaction 1,Food,USD,  income  ,Main Account
2024-01-16,50.00,Transaction 2,Transport,USD,expense  ,Main Account
2024-01-17,75.00,Transaction 3,Entertainment,USD,  INCOME,Main Account`;

      const whitespace = await helpers.detectDuplicates({
        payload: {
          fileContent: whitespaceCsv,
          delimiter: ',',
          columnMapping: buildColumnMapping({
            transactionType: {
              option: TransactionTypeOptionValue.dataSourceColumn,
              columnName: 'Type',
              incomeValues: ['income', 'INCOME'], // Include both cases
              expenseValues: ['expense'],
            },
          }),
          accountMapping: {
            'Main Account': { action: 'create-new', currentBalance: null },
          },
          categoryMapping: {},
        },
        raw: true,
      });

      expect(whitespace.validRows).toHaveLength(3);
      expect(whitespace.invalidRows).toHaveLength(0);
      expect(whitespace.validRows.filter((r) => r.transactionType === 'income')).toHaveLength(2);

      const amountSignCsv = `Date,Amount,Description,Category,Currency,Type,Account
2024-01-15,100.50,Income transaction,Salary,USD,,Main Account
2024-01-16,-50.00,Expense transaction,Food,USD,,Main Account
2024-01-17,75.00,Another income,Bonus,USD,,Main Account`;

      const amountSign = await helpers.detectDuplicates({
        payload: {
          fileContent: amountSignCsv,
          delimiter: ',',
          columnMapping: buildColumnMapping({
            transactionType: { option: TransactionTypeOptionValue.amountSign },
          }),
          accountMapping: {
            'Main Account': { action: 'create-new', currentBalance: null },
          },
          categoryMapping: {},
        },
        raw: true,
      });

      expect(amountSign.validRows).toHaveLength(3);
      expect(amountSign.validRows.find((r) => r.description === 'Income transaction')?.transactionType).toBe('income');
      expect(amountSign.validRows.find((r) => r.description === 'Expense transaction')?.transactionType).toBe(
        'expense',
      );
      expect(amountSign.validRows.find((r) => r.description === 'Another income')?.transactionType).toBe('income');
    }, 60_000);
  });

  describe('date engine and timezone anchoring', () => {
    it('anchors each supported date shape to the right instant', async () => {
      // A cell carrying a time component imports as a full ISO instant and keeps
      // the absolute moment.
      const isoCsv = `Date,Amount,Description,Category,Currency,Type,Account
2026-06-16T18:17:19.587Z,100.50,Morning coffee,Food,USD,expense,Main Account
2026-06-17T09:00:00Z,50.00,Lunch,Food,USD,expense,Main Account`;

      const isoResult = await helpers.detectDuplicates({
        payload: {
          fileContent: isoCsv,
          delimiter: ',',
          columnMapping: buildColumnMapping(),
          accountMapping: {
            'Main Account': { action: 'create-new', currentBalance: null },
          },
          categoryMapping: {},
          timezone: 'America/Montevideo',
        },
        raw: true,
      });

      expect(isoResult.invalidRows).toHaveLength(0);
      expect(isoResult.validRows).toHaveLength(2);

      // An explicit-zone instant is stored verbatim, ignoring the request tz.
      expect(isoResult.validRows.find((r) => r.description === 'Morning coffee')?.date).toBe(
        '2026-06-16T18:17:19.587Z',
      );

      // The user-confirmed day-first order applies to every row uniformly, so
      // 08/06 is June 8 — never Aug 6 via a per-row US tiebreak.
      const dayFirstCsv = `Date,Amount,Description,Category,Currency,Type,Account
08/06/2026,100.50,Ambiguous day,Food,USD,expense,Main Account
15/06/2026,50.00,Disambiguating day,Food,USD,expense,Main Account`;

      const dayFirstResult = await helpers.detectDuplicates({
        payload: {
          fileContent: dayFirstCsv,
          delimiter: ',',
          columnMapping: buildColumnMapping({ dateFieldOrder: 'day-first' }),
          accountMapping: {
            'Main Account': { action: 'create-new', currentBalance: null },
          },
          categoryMapping: {},
          timezone: 'America/Montevideo',
        },
        raw: true,
      });

      expect(dayFirstResult.invalidRows).toHaveLength(0);
      expect(dayFirstResult.validRows).toHaveLength(2);
      // June 8 in Montevideo (UTC-3) anchored at local noon -> 15:00 UTC, still June 8.
      expect(dayFirstResult.validRows.find((r) => r.description === 'Ambiguous day')?.date.split('T')[0]).toBe(
        '2026-06-08',
      );

      // A date-only cell anchors to local noon. Plain `new Date("2026-06-01")` is
      // UTC midnight and renders as May 31 for a UTC-3 user.
      const dateOnlyCsv = `Date,Amount,Description,Category,Currency,Type,Account
2026-06-01,100.50,First of June,Food,USD,expense,Main Account`;

      const anchoredResult = await helpers.detectDuplicates({
        payload: {
          fileContent: dateOnlyCsv,
          delimiter: ',',
          columnMapping: buildColumnMapping(),
          accountMapping: {
            'Main Account': { action: 'create-new', currentBalance: null },
          },
          categoryMapping: {},
          timezone: 'America/Montevideo',
        },
        raw: true,
      });

      expect(anchoredResult.validRows).toHaveLength(1);
      const anchoredRow = anchoredResult.validRows[0]!;

      // Stored instant is June 1 local noon = 15:00 UTC.
      expect(anchoredRow.date).toBe('2026-06-01T15:00:00.000Z');

      // And as seen by the UTC-3 user it must still be June 1, never May 31.
      const dayForUser = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Montevideo',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date(anchoredRow.date));
      expect(dayForUser).toBe('2026-06-01');

      // No timezone in the request must not crash: date-only falls back to UTC noon,
      // which still lands on the right calendar day for every zone within ±11h.
      const noTimezoneResult = await helpers.detectDuplicates({
        payload: {
          fileContent: `Date,Amount,Description,Category,Currency,Type,Account
2026-06-01,100.50,No tz row,Food,USD,expense,Main Account`,
          delimiter: ',',
          columnMapping: buildColumnMapping(),
          accountMapping: {
            'Main Account': { action: 'create-new', currentBalance: null },
          },
          categoryMapping: {},
        },
        raw: true,
      });

      expect(noTimezoneResult.validRows).toHaveLength(1);
      expect(noTimezoneResult.validRows[0]?.date).toBe('2026-06-01T12:00:00.000Z');
    }, 60_000);

    it('rejects date cells that are invalid under the confirmed order', async () => {
      // The confirmed dateFieldOrder is applied to the whole column: a cell that
      // is impossible under it (08/25 read day-first would be month 25) lands in
      // invalidRows while the rest of the column parses under the chosen order.
      const impossibleCsv = `Date,Amount,Description,Category,Currency,Type,Account
25/08/2026,100.50,Day first row,Food,USD,expense,Main Account
08/25/2026,50.00,Month first row,Food,USD,expense,Main Account`;

      const impossibleResult = await helpers.detectDuplicates({
        payload: {
          fileContent: impossibleCsv,
          delimiter: ',',
          columnMapping: buildColumnMapping({ dateFieldOrder: 'day-first' }),
          accountMapping: {
            'Main Account': { action: 'create-new', currentBalance: null },
          },
          categoryMapping: {},
          timezone: 'America/Montevideo',
        },
        raw: true,
      });

      // 25/08/2026 day-first is Aug 25; 08/25/2026 day-first would be month 25.
      expect(impossibleResult.validRows).toHaveLength(1);
      expect(impossibleResult.validRows[0]?.description).toBe('Day first row');
      expect(impossibleResult.validRows[0]?.date.split('T')[0]).toBe('2026-08-25');

      expect(impossibleResult.invalidRows).toHaveLength(1);
      expect(impossibleResult.invalidRows[0]?.rawData['Description']).toBe('Month first row');
      expect(impossibleResult.invalidRows[0]?.errors.some((e) => e.toLowerCase().includes('date'))).toBe(true);

      // Loud failure preserved: a value matching no known date shape still lands in
      // invalidRows with a date error, while well-formed rows around it import.
      const unparseableCsv = `Date,Amount,Description,Category,Currency,Type,Account
2026-06-01,100.50,Good row,Food,USD,expense,Main Account
not-a-date,50.00,Garbage date,Food,USD,expense,Main Account
,75.00,Empty date,Food,USD,expense,Main Account`;

      const unparseableResult = await helpers.detectDuplicates({
        payload: {
          fileContent: unparseableCsv,
          delimiter: ',',
          columnMapping: buildColumnMapping(),
          accountMapping: {
            'Main Account': { action: 'create-new', currentBalance: null },
          },
          categoryMapping: {},
          timezone: 'America/Montevideo',
        },
        raw: true,
      });

      expect(unparseableResult.validRows).toHaveLength(1);
      expect(unparseableResult.validRows[0]?.description).toBe('Good row');

      expect(unparseableResult.invalidRows).toHaveLength(2);
      unparseableResult.invalidRows.forEach((invalidRow) => {
        expect(invalidRow.errors.some((e) => e.toLowerCase().includes('date'))).toBe(true);
      });
    }, 60_000);

    // After anchoring, a same-day CSV row must still match an existing same-day
    // transaction even though `row.date` is now a full instant at local noon and
    // the stored tx sits at a different time of day.
    it('still detects a same-day duplicate after date anchoring', async () => {
      const account = await helpers.createAccount({ raw: true });

      // Existing tx stored at UTC midnight for the day.
      const txPayload = helpers.buildTransactionPayload({
        accountId: account.id,
        amount: 100.5,
        transactionType: TRANSACTION_TYPES.expense,
        time: new Date('2026-06-01T00:00:00.000Z').toISOString(),
      });
      await helpers.createTransaction({ payload: txPayload, raw: true });

      const csvContent = `Date,Amount,Description,Category,Currency,Type,Account
2026-06-01,100.50,Same day import,Food,USD,expense,Main Account`;

      const result = await helpers.detectDuplicates({
        payload: {
          fileContent: csvContent,
          delimiter: ',',
          columnMapping: buildColumnMapping(),
          accountMapping: {
            'Main Account': { action: 'link-existing', accountId: account.id },
          },
          categoryMapping: {},
          timezone: 'America/Montevideo',
        },
        raw: true,
      });

      // The CSV row (anchored to 2026-06-01T15:00Z) must match the existing
      // 2026-06-01T00:00Z tx on calendar day.
      expect(result.duplicates.length).toBeGreaterThanOrEqual(1);
      const duplicate = result.duplicates.find((d) => d.existingTransaction.accountId === account.id);
      expect(duplicate).toBeDefined();
    });
  });

  // ── unpriceableRows ──────────────────────────────────────────────────────────
  // The e2e environment seeds ExchangeRates with historical rates for the common
  // currency set (EUR, GBP, JPY, etc.) and never truncates that table between
  // tests. The user's base currency is AED (see setupIntegrationTests.ts).
  //
  // Pricing rules exercised here:
  //   • USD → always priceable (it is API_LAYER_BASE_CURRENCY_CODE)
  //   • AED → always priceable (it is the user's base currency)
  //   • EUR → priceable via stored ExchangeRates row (seeded)
  //   • SSP → not priceable: a real ISO-4217 code deliberately kept out of the
  //     seeded rate set, so it passes the currencyCode() request-schema check
  //     yet still has no stored rate — the genuine production shape. (A fake
  //     code like ZZZ can no longer reach this layer: the schema rejects it.)
  describe('unpriceableRows classification', () => {
    // Shared column mapping for all sub-tests: single fixed currency per test,
    // so we use the existingCurrency option to avoid a Currency column.
    function buildFixedCurrencyMapping(currencyCode: string): ColumnMappingConfig {
      return buildColumnMapping({
        currency: { option: CurrencyOptionValue.existingCurrency, currencyCode },
      });
    }

    const MINIMAL_CSV = `Date,Amount,Description,Category,Type,Account
2024-01-15,100.00,Test transaction,Food,expense,Main Account`;

    it('classifies unpriceable rows by currency', async () => {
      const baseCurrencyResult = await helpers.detectDuplicates({
        payload: {
          fileContent: MINIMAL_CSV,
          delimiter: ',',
          columnMapping: buildFixedCurrencyMapping('AED'),
          accountMapping: { 'Main Account': { action: 'create-new', currentBalance: null } },
          categoryMapping: {},
        },
        raw: true,
      });

      expect(baseCurrencyResult.unpriceableRows).toBeUndefined();

      const noRateResult = await helpers.detectDuplicates({
        payload: {
          fileContent: MINIMAL_CSV,
          delimiter: ',',
          columnMapping: buildFixedCurrencyMapping('SSP'),
          accountMapping: { 'Main Account': { action: 'create-new', currentBalance: null } },
          categoryMapping: {},
        },
        raw: true,
      });

      expect(noRateResult.unpriceableRows).toBeDefined();
      expect(noRateResult.unpriceableRows).toHaveLength(1);
      expect(noRateResult.unpriceableRows![0]).toMatchObject({ rowIndex: 2, currencyCode: 'SSP' });

      const mixedCsv = `Date,Amount,Description,Category,Currency,Type,Account
2024-01-15,100.00,EUR tx,Food,EUR,expense,Main Account
2024-01-16,50.00,SSP tx,Food,SSP,expense,Main Account
2024-01-17,75.00,USD tx,Food,USD,expense,Main Account`;

      const mixedResult = await helpers.detectDuplicates({
        payload: {
          fileContent: mixedCsv,
          delimiter: ',',
          columnMapping: buildColumnMapping(),
          accountMapping: { 'Main Account': { action: 'create-new', currentBalance: null } },
          categoryMapping: {},
        },
        raw: true,
      });

      expect(mixedResult.unpriceableRows).toBeDefined();
      expect(mixedResult.unpriceableRows).toHaveLength(1);
      expect(mixedResult.unpriceableRows![0]).toMatchObject({ rowIndex: 3, currencyCode: 'SSP' });

      const allInvalidCsv = `Date,Amount,Description,Category,Type,Account
not-a-date,not-an-amount,Test,Food,expense,Main Account`;

      const allInvalidResult = await helpers.detectDuplicates({
        payload: {
          fileContent: allInvalidCsv,
          delimiter: ',',
          // Currency is incidental here: every row is invalid, so findUnpriceableRows
          // receives an empty array regardless of which currency is mapped.
          columnMapping: buildFixedCurrencyMapping('USD'),
          accountMapping: { 'Main Account': { action: 'create-new', currentBalance: null } },
          categoryMapping: {},
        },
        raw: true,
      });

      // No valid rows → findUnpriceableRows gets an empty array → no property.
      expect(allInvalidResult.unpriceableRows).toBeUndefined();
      expect(allInvalidResult.invalidRows.length).toBeGreaterThan(0);
    }, 60_000);
  });

  describe('tag column parsing', () => {
    const csvWithTags = `Date,Amount,Description,Category,Currency,Type,Account,Labels
2024-01-15,100.50,Grocery shopping,Food,USD,expense,Main Account,"food, travel"
2024-01-16,50.00,Coffee,Food,USD,expense,Main Account,
2024-01-17,25.00,Gift,Other,USD,expense,Main Account,"  solo  "`;

    it('splits the mapped tag column into per-row tagNames, and leaves them undefined when unmapped', async () => {
      const mapped = await helpers.detectDuplicates({
        payload: {
          fileContent: csvWithTags,
          delimiter: ',',
          columnMapping: buildColumnMapping({
            tags: { option: TagOptionValue.mapDataSourceColumn, columnName: 'Labels' },
          }),
          accountMapping: { 'Main Account': { action: 'create-new', currentBalance: null } },
          categoryMapping: {},
        },
        raw: true,
      });

      expect(mapped.validRows).toHaveLength(3);
      expect(mapped.validRows[0]?.tagNames).toEqual(['food', 'travel']);
      expect(mapped.validRows[1]?.tagNames).toEqual([]);
      expect(mapped.validRows[2]?.tagNames).toEqual(['solo']);

      const unmapped = await helpers.detectDuplicates({
        payload: {
          fileContent: csvWithTags,
          delimiter: ',',
          columnMapping: buildColumnMapping(),
          accountMapping: { 'Main Account': { action: 'create-new', currentBalance: null } },
          categoryMapping: {},
        },
        raw: true,
      });

      expect(unmapped.validRows[0]?.tagNames).toBeUndefined();
    });
  });
});
