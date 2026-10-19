import {
  AccountOptionValue,
  CategoryOptionValue,
  type ColumnMappingConfig,
  CurrencyOptionValue,
  TagOptionValue,
  TransactionTypeOptionValue,
} from '@bt/shared/types';
import { generateRandomRecordId } from '@common/lib/record-id-helpers';
import { t } from '@i18n/index';
import { describe, expect, it } from '@jest/globals';
import { ERROR_CODES } from '@js/errors';
import * as helpers from '@tests/helpers';
import { ErrorResponse } from '@tests/helpers/common';

describe('Extract Unique Values endpoint', () => {
  describe('successful extraction with data source columns', () => {
    it('should extract unique accounts and categories from CSV', async () => {
      const fileContent = helpers.loadCsvFixture('valid-comma.csv');

      const result = await helpers.extractUniqueValues({
        payload: {
          fileContent,
          delimiter: ',',
          columnMapping: {
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
          },
        },
        raw: true,
      });

      expect(result.sourceAccounts).toHaveLength(1);
      expect(result.sourceAccounts[0]).toEqual({ name: 'Main Account', currency: 'USD' });
      expect(result.sourceCategories).toContain('Food');
      expect(result.sourceCategories).toContain('Income');
      expect(result.sourceCategories).toContain('Entertainment');
      expect(result.sourceCategories).toContain('Transport');
    });
  });

  describe('using existing entities', () => {
    it('should return currency mismatch warning when account has different currency than CSV', async () => {
      // Create account with EUR currency
      await helpers.addUserCurrencies({ currencyCodes: ['EUR'] });
      const account = await helpers.createAccount({
        payload: {
          ...helpers.buildAccountPayload(),
          currencyCode: 'EUR',
        },
        raw: true,
      });

      // CSV has USD currency
      const fileContent = helpers.loadCsvFixture('valid-comma.csv');

      const result = await helpers.extractUniqueValues({
        payload: {
          fileContent,
          delimiter: ',',
          columnMapping: {
            date: 'Date',
            dateFieldOrder: 'month-first',
            amount: 'Amount',
            description: 'Description',
            category: { option: CategoryOptionValue.mapDataSourceColumn, columnName: 'Category' },
            currency: { option: CurrencyOptionValue.dataSourceColumn, columnName: 'Currency' },
            transactionType: { option: TransactionTypeOptionValue.amountSign },
            account: { option: AccountOptionValue.existingAccount, accountId: account.id },
          },
        },
        raw: true,
      });

      expect(result.currencyMismatchWarning).toBeDefined();
      expect(result.currencyMismatchWarning).toContain('USD');
      expect(result.currencyMismatchWarning).toContain('EUR');
    });
  });

  describe('comprehensive option combinations', () => {
    it('should handle all existing options together (maximum entity reuse)', async () => {
      // Create existing entities
      const categories = await helpers.getCategoriesList();
      const existingCategory = categories[0]!;
      const account = await helpers.createAccount({ raw: true });
      const fileContent = helpers.loadCsvFixture('valid-comma.csv');

      const result = await helpers.extractUniqueValues({
        payload: {
          fileContent,
          delimiter: ',',
          columnMapping: {
            date: 'Date',
            dateFieldOrder: 'month-first',
            amount: 'Amount',
            description: 'Description',
            category: { option: CategoryOptionValue.existingCategory, categoryId: existingCategory.id },
            currency: { option: CurrencyOptionValue.existingCurrency, currencyCode: 'USD' },
            transactionType: { option: TransactionTypeOptionValue.amountSign },
            account: { option: AccountOptionValue.existingAccount, accountId: account.id },
          },
        },
        raw: true,
      });

      // No extraction should happen - everything links to existing entities
      expect(result.sourceAccounts).toHaveLength(0);
      expect(result.sourceCategories).toHaveLength(0);
      expect(result.currencyMismatchWarning).toBeUndefined();
    });

    it('extracts only the side that is not linked to an existing entity', async () => {
      const account = await helpers.createAccount({ raw: true });
      const categories = await helpers.getCategoriesList();
      const existingCategory = categories[0]!;

      const existingAccountResult = await helpers.extractUniqueValues({
        payload: {
          fileContent: helpers.loadCsvFixture('valid-comma.csv'),
          delimiter: ',',
          columnMapping: {
            date: 'Date',
            dateFieldOrder: 'month-first',
            amount: 'Amount',
            description: 'Description',
            category: { option: CategoryOptionValue.mapDataSourceColumn, columnName: 'Category' },
            currency: { option: CurrencyOptionValue.existingCurrency, currencyCode: 'USD' },
            transactionType: { option: TransactionTypeOptionValue.amountSign },
            account: { option: AccountOptionValue.existingAccount, accountId: account.id },
          },
        },
        raw: true,
      });

      expect(existingAccountResult.sourceAccounts).toHaveLength(0);
      expect(existingAccountResult.sourceCategories.length).toBeGreaterThan(0);
      expect(existingAccountResult.sourceCategories).toContain('Food');
      expect(existingAccountResult.sourceCategories).toContain('Income');

      const existingCategoryResult = await helpers.extractUniqueValues({
        payload: {
          fileContent: helpers.loadCsvFixture('multiple-accounts.csv'),
          delimiter: ',',
          columnMapping: {
            date: 'Date',
            dateFieldOrder: 'month-first',
            amount: 'Amount',
            description: 'Description',
            category: { option: CategoryOptionValue.existingCategory, categoryId: existingCategory.id },
            currency: { option: CurrencyOptionValue.dataSourceColumn, columnName: 'Currency' },
            transactionType: { option: TransactionTypeOptionValue.amountSign },
            account: { option: AccountOptionValue.dataSourceColumn, columnName: 'Account' },
          },
        },
        raw: true,
      });

      expect(existingCategoryResult.sourceAccounts.length).toBeGreaterThanOrEqual(3);
      expect(existingCategoryResult.sourceCategories).toHaveLength(0);
    });

    it('should handle mapDataSourceColumn with dataSourceColumn for all options', async () => {
      const fileContent = helpers.loadCsvFixture('multiple-accounts.csv');

      const result = await helpers.extractUniqueValues({
        payload: {
          fileContent,
          delimiter: ',',
          columnMapping: {
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
          },
        },
        raw: true,
      });

      // Should extract everything from CSV
      expect(result.sourceAccounts.length).toBeGreaterThanOrEqual(3);
      expect(result.sourceCategories.length).toBeGreaterThan(0);

      // Verify account-currency pairing is correct
      const accountNames = result.sourceAccounts.map((a) => a.name);
      expect(accountNames).toContain('Checking Account');
      expect(accountNames).toContain('Savings Account');
      expect(accountNames).toContain('Credit Card');

      const currencies = result.sourceAccounts.map((a) => a.currency);
      expect(currencies).toContain('USD');
      expect(currencies).toContain('EUR');
    });

    it('should handle createNewCategories with dataSourceColumn transaction type and account', async () => {
      const fileContent = helpers.loadCsvFixture('valid-comma.csv');

      const result = await helpers.extractUniqueValues({
        payload: {
          fileContent,
          delimiter: ',',
          columnMapping: {
            date: 'Date',
            dateFieldOrder: 'month-first',
            amount: 'Amount',
            description: 'Description',
            category: { option: CategoryOptionValue.createNewCategories, columnName: 'Category' },
            currency: { option: CurrencyOptionValue.dataSourceColumn, columnName: 'Currency' },
            transactionType: {
              option: TransactionTypeOptionValue.dataSourceColumn,
              columnName: 'Type',
              incomeValues: ['income'],
              expenseValues: ['expense'],
            },
            account: { option: AccountOptionValue.dataSourceColumn, columnName: 'Account' },
          },
        },
        raw: true,
      });

      expect(result.sourceAccounts).toHaveLength(1);
      expect(result.sourceCategories.length).toBeGreaterThan(0);
      expect(result.sourceCategories).toContain('Food');
    });

    it('should override CSV currencies when using existingCurrency with multiple accounts', async () => {
      const fileContent = helpers.loadCsvFixture('multiple-accounts.csv');

      const result = await helpers.extractUniqueValues({
        payload: {
          fileContent,
          delimiter: ',',
          columnMapping: {
            date: 'Date',
            dateFieldOrder: 'month-first',
            amount: 'Amount',
            description: 'Description',
            category: { option: CategoryOptionValue.mapDataSourceColumn, columnName: 'Category' },
            currency: { option: CurrencyOptionValue.existingCurrency, currencyCode: 'GBP' },
            transactionType: { option: TransactionTypeOptionValue.amountSign },
            account: { option: AccountOptionValue.dataSourceColumn, columnName: 'Account' },
          },
        },
        raw: true,
      });

      expect(result.sourceAccounts.length).toBeGreaterThanOrEqual(3);
      // All accounts should have GBP currency, overriding CSV's USD/EUR
      result.sourceAccounts.forEach((acc) => {
        expect(acc.currency).toBe('GBP');
      });
    });

    it('should handle mapDataSourceColumn with mixed transaction type options', async () => {
      const fileContent = helpers.loadCsvFixture('valid-comma.csv');

      // First with dataSourceColumn
      const result1 = await helpers.extractUniqueValues({
        payload: {
          fileContent,
          delimiter: ',',
          columnMapping: {
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
          },
        },
        raw: true,
      });

      // Then with amountSign
      const result2 = await helpers.extractUniqueValues({
        payload: {
          fileContent,
          delimiter: ',',
          columnMapping: {
            date: 'Date',
            dateFieldOrder: 'month-first',
            amount: 'Amount',
            description: 'Description',
            category: { option: CategoryOptionValue.mapDataSourceColumn, columnName: 'Category' },
            currency: { option: CurrencyOptionValue.dataSourceColumn, columnName: 'Currency' },
            transactionType: { option: TransactionTypeOptionValue.amountSign },
            account: { option: AccountOptionValue.dataSourceColumn, columnName: 'Account' },
          },
        },
        raw: true,
      });

      // Both should extract the same accounts and categories
      expect(result1.sourceAccounts).toEqual(result2.sourceAccounts);
      expect(result1.sourceCategories.toSorted()).toEqual(result2.sourceCategories.toSorted());
    });
  });

  describe('validation errors', () => {
    const baseMapping: ColumnMappingConfig = {
      date: 'Date',
      dateFieldOrder: 'month-first',
      amount: 'Amount',
      category: { option: CategoryOptionValue.mapDataSourceColumn, columnName: 'Category' },
      currency: { option: CurrencyOptionValue.dataSourceColumn, columnName: 'Currency' },
      transactionType: { option: TransactionTypeOptionValue.amountSign },
      account: { option: AccountOptionValue.dataSourceColumn, columnName: 'Account' },
    };

    const cases: { name: string; columnMapping: ColumnMappingConfig; statusCode: ERROR_CODES }[] = [
      {
        name: 'non-existent date column',
        columnMapping: { ...baseMapping, date: 'NonExistentColumn' },
        statusCode: ERROR_CODES.ValidationError,
      },
      {
        name: 'non-existent amount column',
        columnMapping: { ...baseMapping, amount: 'NonExistentColumn' },
        statusCode: ERROR_CODES.ValidationError,
      },
      {
        name: 'non-existent currency column',
        columnMapping: {
          ...baseMapping,
          currency: { option: CurrencyOptionValue.dataSourceColumn, columnName: 'NonExistentColumn' },
        },
        statusCode: ERROR_CODES.ValidationError,
      },
      {
        name: 'non-existent account column',
        columnMapping: {
          ...baseMapping,
          account: { option: AccountOptionValue.dataSourceColumn, columnName: 'NonExistentColumn' },
        },
        statusCode: ERROR_CODES.ValidationError,
      },
      {
        name: 'non-existent category column',
        columnMapping: {
          ...baseMapping,
          category: { option: CategoryOptionValue.mapDataSourceColumn, columnName: 'NonExistentColumn' },
        },
        statusCode: ERROR_CODES.ValidationError,
      },
      {
        name: 'non-existent transaction type column',
        columnMapping: {
          ...baseMapping,
          transactionType: {
            option: TransactionTypeOptionValue.dataSourceColumn,
            columnName: 'NonExistentColumn',
            incomeValues: ['income'],
            expenseValues: ['expense'],
          },
        },
        statusCode: ERROR_CODES.ValidationError,
      },
      {
        name: 'invalid currency code',
        columnMapping: {
          ...baseMapping,
          currency: { option: CurrencyOptionValue.existingCurrency, currencyCode: 'INVALID' },
        },
        statusCode: ERROR_CODES.ValidationError,
      },
      {
        name: 'existing account that does not belong to user',
        columnMapping: {
          ...baseMapping,
          account: { option: AccountOptionValue.existingAccount, accountId: generateRandomRecordId() },
        },
        statusCode: ERROR_CODES.NotFoundError,
      },
      {
        name: 'existing category that does not belong to user',
        columnMapping: {
          ...baseMapping,
          category: { option: CategoryOptionValue.existingCategory, categoryId: generateRandomRecordId() },
        },
        statusCode: ERROR_CODES.NotFoundError,
      },
    ];

    it('rejects every invalid column mapping permutation', async () => {
      const fileContent = helpers.loadCsvFixture('valid-comma.csv');

      for (const { name, columnMapping, statusCode } of cases) {
        const result = await helpers.extractUniqueValues({
          payload: { fileContent, delimiter: ',', columnMapping },
          raw: false,
        });

        expect(`${name}: ${result.statusCode}`).toBe(`${name}: ${statusCode}`);
      }

      const emptyCurrencyResult = await helpers.extractUniqueValues({
        payload: {
          fileContent,
          delimiter: ',',
          columnMapping: {
            ...baseMapping,
            currency: { option: CurrencyOptionValue.existingCurrency, currencyCode: '' },
          },
        },
        raw: false,
      });

      expect(emptyCurrencyResult.statusCode).toBe(ERROR_CODES.ValidationError);
      expect((emptyCurrencyResult.body.response as unknown as ErrorResponse).message).toContain(
        'currency.currencyCode',
      );
    }, 60_000);

    it("reports an account with mixed currencies in the request's locale", async () => {
      const fileContent = `Date,Amount,Category,Currency,Account
01/15/2024,10.00,Food,USD,Main
01/16/2024,20.00,Food,EUR,Main`;

      const result = await helpers.makeRequest({
        method: 'post',
        url: '/import/csv/extract-unique-values',
        payload: { fileContent, delimiter: ',', columnMapping: baseMapping },
        headers: { 'Accept-Language': 'uk' },
      });

      const variables = { accountName: 'Main', currencies: 'USD, EUR' };
      const expected = t({ key: 'csvImport.accountMultipleCurrencies', variables, locale: 'uk' });
      expect(result.statusCode).toBe(ERROR_CODES.ValidationError);
      expect((result.body.response as unknown as ErrorResponse).message).toBe(expected);
      expect(expected).not.toBe(t({ key: 'csvImport.accountMultipleCurrencies', variables, locale: 'en' }));
    });
  });

  describe('sourceTags', () => {
    const csvWithTags = `Date,Amount,Description,Category,Currency,Type,Account,Labels
2024-01-15,100.50,Grocery shopping,Food,USD,expense,Main Account,"travel, food"
2024-01-16,50.00,Coffee,Food,USD,expense,Main Account,"food, gift"
2024-01-17,25.00,Lunch,Food,USD,expense,Main Account,`;

    const baseMapping = {
      date: 'Date',
      dateFieldOrder: 'month-first' as const,
      amount: 'Amount',
      description: 'Description',
      category: { option: CategoryOptionValue.mapDataSourceColumn as const, columnName: 'Category' },
      currency: { option: CurrencyOptionValue.dataSourceColumn as const, columnName: 'Currency' },
      transactionType: {
        option: TransactionTypeOptionValue.dataSourceColumn as const,
        columnName: 'Type',
        incomeValues: ['income'],
        expenseValues: ['expense'],
      },
      account: { option: AccountOptionValue.dataSourceColumn as const, columnName: 'Account' },
    };

    it('returns distinct, sorted tag strings split from the mapped column', async () => {
      const result = await helpers.extractUniqueValues({
        payload: {
          fileContent: csvWithTags,
          delimiter: ',',
          columnMapping: {
            ...baseMapping,
            tags: { option: TagOptionValue.mapDataSourceColumn, columnName: 'Labels' },
          },
        },
        raw: true,
      });

      expect(result.sourceTags).toEqual(['food', 'gift', 'travel']);
    });

    it('returns an empty array when no tag column is mapped', async () => {
      const result = await helpers.extractUniqueValues({
        payload: {
          fileContent: csvWithTags,
          delimiter: ',',
          columnMapping: baseMapping,
        },
        raw: true,
      });

      expect(result.sourceTags).toEqual([]);
    });

    it('fails when the mapped tag column is absent from the headers', async () => {
      const result = await helpers.extractUniqueValues({
        payload: {
          fileContent: csvWithTags,
          delimiter: ',',
          columnMapping: {
            ...baseMapping,
            tags: { option: TagOptionValue.mapDataSourceColumn, columnName: 'Nonexistent' },
          },
        },
        raw: false,
      });

      expect(result.statusCode).toBe(ERROR_CODES.ValidationError);
    });
  });
});

describe('Parse CSV endpoint', () => {
  const expectedHeaders = ['Date', 'Amount', 'Description', 'Category', 'Account', 'Currency', 'Type'];

  it('detects and honors delimiters', async () => {
    const comma = await helpers.parseCsv({
      payload: { fileContent: helpers.loadCsvFixture('valid-comma.csv') },
      raw: true,
    });
    expect(comma.headers).toEqual(expectedHeaders);
    expect(comma.detectedDelimiter).toBe(',');
    expect(comma.totalRows).toBe(5);
    expect(comma.preview).toHaveLength(5);
    expect(comma.preview[0]).toEqual({
      Date: '2024-01-15',
      Amount: '100.50',
      Description: 'Grocery shopping',
      Category: 'Food',
      Account: 'Main Account',
      Currency: 'USD',
      Type: 'expense',
    });

    const semicolon = await helpers.parseCsv({
      payload: { fileContent: helpers.loadCsvFixture('valid-semicolon.csv') },
      raw: true,
    });
    expect(semicolon.headers).toEqual(expectedHeaders);
    expect(semicolon.detectedDelimiter).toBe(';');
    expect(semicolon.totalRows).toBe(3);
    expect(semicolon.preview).toHaveLength(3);

    const tab = await helpers.parseCsv({
      payload: { fileContent: helpers.loadCsvFixture('valid-tab.csv') },
      raw: true,
    });
    expect(tab.headers).toEqual(expectedHeaders);
    expect(tab.detectedDelimiter).toBe('\t');
    expect(tab.totalRows).toBe(2);

    const explicitDelimiter = await helpers.parseCsv({
      payload: { fileContent: helpers.loadCsvFixture('valid-semicolon.csv'), delimiter: ';' },
      raw: true,
    });
    expect(explicitDelimiter.detectedDelimiter).toBe(';');
    expect(explicitDelimiter.headers).toEqual(expectedHeaders);

    const european = await helpers.parseCsv({
      payload: { fileContent: helpers.loadCsvFixture('european-format.csv') },
      raw: true,
    });
    expect(european.detectedDelimiter).toBe(';');
    expect(european.preview[0]?.Date).toBe('15.01.2024');
    expect(european.preview[0]?.Amount).toBe('100,50');
  }, 60_000);

  it('returns headers, preview and totalRows for varied content shapes', async () => {
    const large = await helpers.parseCsv({
      payload: { fileContent: helpers.loadCsvFixture('large-file.csv') },
      raw: true,
    });
    expect(large.totalRows).toBe(25);
    expect(large.preview).toHaveLength(25);

    const special = await helpers.parseCsv({
      payload: { fileContent: helpers.loadCsvFixture('special-characters.csv') },
      raw: true,
    });
    expect(special.headers).toEqual(expectedHeaders);
    expect(special.preview[0]?.Description).toBe('Grocery, shopping & more');
    expect(special.preview[1]?.Description).toBe('Coffee "Best" shop');
    expect(special.preview[2]?.Description).toBe('Salary (monthly)');

    const minimal = await helpers.parseCsv({
      payload: { fileContent: helpers.loadCsvFixture('minimal-columns.csv') },
      raw: true,
    });
    expect(minimal.headers).toEqual(['Date', 'Amount']);
    expect(minimal.totalRows).toBe(3);
    expect(minimal.preview[0]).toEqual({ Date: '2024-01-15', Amount: '100.50' });

    const multipleAccounts = await helpers.parseCsv({
      payload: { fileContent: helpers.loadCsvFixture('multiple-accounts.csv') },
      raw: true,
    });
    expect(multipleAccounts.totalRows).toBe(5);
    const accounts = multipleAccounts.preview.map((row) => row.Account);
    expect(accounts).toContain('Checking Account');
    expect(accounts).toContain('Savings Account');
    expect(accounts).toContain('Credit Card');
    const currencies = multipleAccounts.preview.map((row) => row.Currency);
    expect(currencies).toContain('USD');
    expect(currencies).toContain('EUR');

    const headersOnly = await helpers.parseCsv({
      payload: { fileContent: helpers.loadCsvFixture('headers-only.csv') },
      raw: true,
    });
    expect(headersOnly.headers).toEqual(expectedHeaders);
    expect(headersOnly.totalRows).toBe(0);
    expect(headersOnly.preview).toHaveLength(0);
  }, 60_000);

  it('rejects empty input', async () => {
    const emptyString = await helpers.parseCsv({ payload: { fileContent: '' }, raw: false });
    expect(emptyString.statusCode).toBe(ERROR_CODES.ValidationError);

    const emptyFile = await helpers.parseCsv({
      payload: { fileContent: helpers.loadCsvFixture('empty.csv') },
      raw: false,
    });
    expect(emptyFile.statusCode).toBe(ERROR_CODES.ValidationError);
  });
});
