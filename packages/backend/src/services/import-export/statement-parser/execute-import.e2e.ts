import type { ExtractedTransaction, TransactionImportDetails } from '@bt/shared/types';
import { ACCOUNT_TYPES, ImportSource, TRANSACTION_TYPES } from '@bt/shared/types';
import { NONEXISTENT_ID } from '@common/lib/record-id-helpers';
import { describe, expect, it } from '@jest/globals';
import { ERROR_CODES } from '@js/errors';
import Transactions from '@models/transactions.model';
import * as helpers from '@tests/helpers';

const buildRows = ({ count }: { count: number }): ExtractedTransaction[] =>
  Array.from({ length: count }, (_, index) => ({
    date: `2024-04-${String((index % 28) + 1).padStart(2, '0')} 10:00:00`,
    description: `Row ${index}`,
    amount: index + 1,
    type: 'expense' as const,
  }));

describe('Statement Parser - Execute Import endpoint', () => {
  /**
   * Helper to create extracted transactions in decimal format (as AI outputs them).
   */
  const createExtractedTransactions = (overrides: Partial<ExtractedTransaction>[] = []): ExtractedTransaction[] => {
    const defaults: ExtractedTransaction[] = [
      {
        date: '2024-01-15 10:30:00',
        description: 'Grocery shopping',
        amount: 100.5, // AI outputs decimal format
        type: 'expense',
      },
      {
        date: '2024-01-16 14:20:00',
        description: 'Coffee shop',
        amount: 50, // AI outputs decimal format
        type: 'expense',
      },
      {
        date: '2024-01-17 09:00:00',
        description: 'Salary deposit',
        amount: 2500, // AI outputs decimal format
        type: 'income',
      },
    ];

    return defaults.map((tx, i) => ({
      ...tx,
      ...overrides[i],
    }));
  };

  describe('successful import', () => {
    it('imports every row into the target account with the right amounts, notes and importDetails', async () => {
      const account1 = await helpers.createAccount({ raw: true });
      const account2 = await helpers.createAccount({ raw: true });

      const txBefore = await helpers.getTransactions({ raw: true });
      const countBefore = txBefore.length;

      const transactions: ExtractedTransaction[] = [
        ...createExtractedTransactions(),
        {
          date: '2024-01-15 10:00:00',
          description: 'Test description with special chars: $100 @ store #123',
          amount: 1000,
          type: 'expense',
        },
        {
          date: '2024-01-15 10:00:00',
          description: 'Transaction with balance',
          amount: 5000,
          type: 'expense',
          // The statement's own running balance is informational and must not break the import.
          balance: 100000,
        },
      ];

      const result = await helpers.statementExecuteImportAndWait({
        payload: {
          accountId: account1.id,
          transactions,
          skipIndices: [],
        },
      });

      expect(result.imported).toBe(5);
      expect(result.skipped).toBe(0);
      expect(result.errors).toHaveLength(0);
      expect(result.newTransactionIds).toHaveLength(5);
      expect(result.batchId).toBeDefined();

      const allTransactions = await helpers.getTransactions({ raw: true });
      const importedTxs = allTransactions.filter((tx) => result.newTransactionIds.includes(tx.id));
      expect(importedTxs).toHaveLength(5);

      const groceryTx = importedTxs.find((tx) => tx.note === 'Grocery shopping');
      const coffeeTx = importedTxs.find((tx) => tx.note === 'Coffee shop');
      const salaryTx = importedTxs.find((tx) => tx.note === 'Salary deposit');
      const specialCharsTx = importedTxs.find((tx) => tx.note?.startsWith('Test description'));
      const balanceFieldTx = importedTxs.find((tx) => tx.note === 'Transaction with balance');

      expect(groceryTx?.amount).toBe(100.5);
      expect(groceryTx?.transactionType).toBe(TRANSACTION_TYPES.expense);
      expect(coffeeTx?.amount).toBe(50.0);
      expect(coffeeTx?.transactionType).toBe(TRANSACTION_TYPES.expense);
      expect(salaryTx?.amount).toBe(2500.0);
      expect(salaryTx?.transactionType).toBe(TRANSACTION_TYPES.income);
      expect(specialCharsTx?.note).toBe('Test description with special chars: $100 @ store #123');
      expect(balanceFieldTx?.amount).toBe(5000);

      importedTxs.forEach((tx) => {
        expect(tx.accountId).toBe(account1.id);
        expect(tx.accountId).not.toBe(account2.id);
      });

      expect(allTransactions.length).toBe(countBefore + 5);

      const persisted = await Transactions.findAll({ where: { id: result.newTransactionIds } });
      expect(persisted).toHaveLength(5);
      persisted.forEach((tx) => {
        const importDetails = tx.externalData?.importDetails as TransactionImportDetails | undefined;

        expect(importDetails).toBeDefined();
        expect(importDetails?.batchId).toBe(result.batchId);
        expect(importDetails?.source).toBe(ImportSource.statementParser);
        expect(new Date(importDetails!.importedAt).toISOString()).toBe(importDetails!.importedAt);
      });
    }, 60_000);

    it('should have different batchIds for separate imports', async () => {
      const account = await helpers.createAccount({ raw: true });
      const transactions = createExtractedTransactions();

      const result1 = await helpers.statementExecuteImportAndWait({
        payload: {
          accountId: account.id,
          transactions,
          skipIndices: [],
        },
      });

      const result2 = await helpers.statementExecuteImportAndWait({
        payload: {
          accountId: account.id,
          transactions,
          skipIndices: [],
        },
      });

      // Verify batchIds are different between imports
      const tx1 = await Transactions.findByPk(result1.newTransactionIds[0]);
      const tx2 = await Transactions.findByPk(result2.newTransactionIds[0]);

      const batchId1 = (tx1?.externalData?.importDetails as TransactionImportDetails)?.batchId;
      const batchId2 = (tx2?.externalData?.importDetails as TransactionImportDetails)?.batchId;

      expect(batchId1).toBe(result1.batchId);
      expect(batchId2).toBe(result2.batchId);
      expect(batchId1).not.toBe(batchId2);
    });

    it('honours skipIndices, and all-skipped and empty payloads leave the balance untouched', async () => {
      const initialBalance = 1000; // $1000.00 (API uses decimals)
      const account = await helpers.createAccount({
        payload: helpers.buildAccountPayload({ initialBalance }),
        raw: true,
      });

      const transactions: ExtractedTransaction[] = [
        { date: '2025-12-01', description: 'Expense 1', amount: 100, type: 'expense' }, // index 0 - skip
        { date: '2025-12-02', description: 'Expense 2', amount: 200, type: 'expense' }, // index 1 - import
        { date: '2025-12-03', description: 'Income 1', amount: 500, type: 'income' }, // index 2 - skip
        { date: '2025-12-04', description: 'Expense 3', amount: 150, type: 'expense' }, // index 3 - import
      ];

      const result = await helpers.statementExecuteImportAndWait({
        payload: {
          accountId: account.id,
          transactions,
          skipIndices: [0, 2],
        },
      });

      expect(result.imported).toBe(2);
      expect(result.skipped).toBe(2);
      expect(result.errors).toHaveLength(0);
      expect(result.newTransactionIds).toHaveLength(2);

      const allTransactions = await helpers.getTransactions({ raw: true });
      const importedTxs = allTransactions.filter((tx) => result.newTransactionIds.includes(tx.id));

      expect(importedTxs.find((tx) => tx.note === 'Expense 2')?.amount).toBe(200);
      expect(importedTxs.find((tx) => tx.note === 'Expense 3')?.amount).toBe(150);
      expect(importedTxs.find((tx) => tx.note === 'Expense 1')).toBeUndefined();
      expect(importedTxs.find((tx) => tx.note === 'Income 1')).toBeUndefined();

      // Only Expense 2 ($200) and Expense 3 ($150) affect the balance: $1000 - $350 = $650.
      const accountAfterSkip = await helpers.getAccount({ id: account.id, raw: true });
      expect(accountAfterSkip.currentBalance).toBe(650);

      const allSkipped = await helpers.statementExecuteImportAndWait({
        payload: {
          accountId: account.id,
          transactions,
          skipIndices: [0, 1, 2, 3],
        },
      });

      expect(allSkipped.imported).toBe(0);
      expect(allSkipped.skipped).toBe(4);
      expect(allSkipped.errors).toHaveLength(0);
      expect(allSkipped.newTransactionIds).toHaveLength(0);
      expect(allSkipped.batchId).toBeDefined();

      const accountAfterAllSkipped = await helpers.getAccount({ id: account.id, raw: true });
      expect(accountAfterAllSkipped.currentBalance).toBe(650);

      const emptyImport = await helpers.statementExecuteImportAndWait({
        payload: {
          accountId: account.id,
          transactions: [],
          skipIndices: [],
        },
      });

      expect(emptyImport.imported).toBe(0);
      expect(emptyImport.skipped).toBe(0);
      expect(emptyImport.errors).toHaveLength(0);
      expect(emptyImport.newTransactionIds).toHaveLength(0);

      const accountAfterEmpty = await helpers.getAccount({ id: account.id, raw: true });
      expect(accountAfterEmpty.currentBalance).toBe(650);
    }, 60_000);
  });

  describe('date handling', () => {
    it('accepts dates with time, without time, and across a month boundary', async () => {
      const account = await helpers.createAccount({ raw: true });
      const transactions: ExtractedTransaction[] = [
        { date: '2024-06-15 14:30:45', description: 'Date with time', amount: 1000, type: 'expense' },
        { date: '2024-06-15', description: 'Date without time', amount: 1000, type: 'expense' },
        { date: '2024-01-31 23:59:00', description: 'End of January', amount: 1000, type: 'expense' },
        { date: '2024-02-01 00:01:00', description: 'Start of February', amount: 2000, type: 'expense' },
      ];

      const result = await helpers.statementExecuteImportAndWait({
        payload: {
          accountId: account.id,
          transactions,
          skipIndices: [],
        },
      });

      expect(result.imported).toBe(4);
      expect(result.errors).toHaveLength(0);

      const allTransactions = await helpers.getTransactions({ raw: true });
      const importedNotes = allTransactions
        .filter((tx) => result.newTransactionIds.includes(tx.id))
        .map((tx) => tx.note)
        .toSorted();

      expect(importedNotes).toEqual(
        ['Date with time', 'Date without time', 'End of January', 'Start of February'].toSorted(),
      );
    });
  });

  describe('error handling', () => {
    it('rejects an unknown account, an invalid type and a negative amount', async () => {
      const account = await helpers.createAccount({ raw: true });

      const unknownAccount = await helpers.statementExecuteImport({
        payload: {
          accountId: NONEXISTENT_ID,
          transactions: createExtractedTransactions(),
          skipIndices: [],
        },
        raw: false,
      });

      expect(unknownAccount.statusCode).toBe(ERROR_CODES.ValidationError);

      const invalidType = await helpers.statementExecuteImport({
        payload: {
          accountId: account.id,
          transactions: [
            {
              date: '2024-01-15',
              description: 'Invalid type',
              amount: 1000,
              type: 'invalid' as 'expense',
            },
          ],
          skipIndices: [],
        },
        raw: false,
      });

      expect(invalidType.statusCode).toBe(ERROR_CODES.ValidationError);

      const negativeAmount = await helpers.statementExecuteImport({
        payload: {
          accountId: account.id,
          transactions: [
            {
              date: '2024-01-15',
              description: 'Negative amount',
              amount: -1000,
              type: 'expense',
            },
          ],
          skipIndices: [],
        },
        raw: false,
      });

      expect(negativeAmount.statusCode).toBe(ERROR_CODES.ValidationError);
    });

    it('fails the job for a bank-linked target account, naming it and writing no row', async () => {
      const account = await helpers.createAccount({
        payload: helpers.buildAccountPayload({ name: 'Monobank card', type: ACCOUNT_TYPES.monobank }),
        raw: true,
      });

      const { jobId } = await helpers.statementExecuteImport({
        payload: { accountId: account.id, transactions: createExtractedTransactions(), skipIndices: [] },
        raw: true,
      });
      const progress = await helpers.waitForStatementImportCompletion({ jobId });

      expect(progress.status).toBe('failed');
      if (progress.status !== 'failed') throw new Error('unreachable');
      expect(progress.error).toContain(account.name);

      expect(await helpers.getTransactions({ raw: true })).toHaveLength(0);
    });

    it('reports per-row date and amount violations while importing the rows around them', async () => {
      const account = await helpers.createAccount({ raw: true });

      const futureDate = new Date();
      futureDate.setFullYear(futureDate.getFullYear() + 1);
      const futureDateStr = futureDate.toISOString().split('T')[0];

      const todayStr = new Date().toISOString().split('T')[0];

      const result = await helpers.statementExecuteImportAndWait({
        payload: {
          accountId: account.id,
          transactions: [
            {
              date: '2024-01-15',
              description: 'Valid transaction 1',
              amount: 5000,
              type: 'expense',
            },
            {
              date: futureDateStr!, // Invalid - future date
              description: 'Future date transaction',
              amount: 1000,
              type: 'expense',
            },
            {
              date: '2024-01-16',
              description: 'Valid transaction 2',
              amount: 3000,
              type: 'income',
            },
            {
              date: '2024-01-17',
              description: 'Extreme amount transaction',
              amount: 2_000_000_000, // Invalid - exceeds the 1 billion threshold
              type: 'expense',
            },
            {
              date: todayStr!, // Boundary - today is not "in the future"
              description: 'Today transaction',
              amount: 1000,
              type: 'expense',
            },
            {
              date: '2024-01-18',
              description: 'Large but valid amount',
              amount: 9_999_999, // Boundary - just under the threshold
              type: 'income',
            },
          ],
          skipIndices: [],
        },
      });

      expect(result.imported).toBe(4);
      expect(result.errors).toHaveLength(2);

      const errorByIndex = new Map(result.errors.map((e) => [e.transactionIndex, e.error]));
      expect(errorByIndex.get(1)).toContain('is in the future');
      expect(errorByIndex.get(3)).toContain('exceeds maximum allowed value');
      expect(errorByIndex.has(4)).toBe(false);
      expect(errorByIndex.has(5)).toBe(false);
    });
  });

  describe('import with existing transactions in account', () => {
    it('imports a period batch alongside a pre-existing row and keeps the balance right', async () => {
      const initialBalance = 1000; // $1000.00 (API uses decimals)
      const account = await helpers.createAccount({
        payload: helpers.buildAccountPayload({ initialBalance }),
        raw: true,
      });

      const existingTxPayload = helpers.buildTransactionPayload({
        accountId: account.id,
        amount: 300, // $300.00
        transactionType: TRANSACTION_TYPES.expense,
        time: new Date('2025-12-10').toISOString(),
        note: 'Existing mid-period transaction',
      });
      await helpers.createTransaction({ payload: existingTxPayload, raw: true });

      const accountMid = await helpers.getAccount({ id: account.id, raw: true });
      expect(accountMid.currentBalance).toBe(700); // $1000 - $300

      const transactions: ExtractedTransaction[] = [
        { date: '2025-12-01 10:00:00', description: 'Start of period', amount: 100, type: 'expense' },
        { date: '2025-12-15 14:00:00', description: 'New expense', amount: 200, type: 'expense' },
        { date: '2025-12-18 09:00:00', description: 'After existing transaction', amount: 150, type: 'expense' },
        { date: '2025-12-20 16:00:00', description: 'New income', amount: 500, type: 'income' },
      ];

      const result = await helpers.statementExecuteImportAndWait({
        payload: {
          accountId: account.id,
          transactions,
          skipIndices: [],
        },
      });

      expect(result.imported).toBe(4);
      expect(result.errors).toHaveLength(0);

      const allTransactions = await helpers.getTransactions({ accountIds: [account.id], raw: true });
      expect(allTransactions.filter((tx) => tx.accountId === account.id)).toHaveLength(5);

      // $700 - $100 - $200 - $150 + $500 = $750
      const accountAfter = await helpers.getAccount({ id: account.id, raw: true });
      expect(accountAfter.currentBalance).toBe(750);
    });
  });

  /**
   * Tests verifying that AI-extracted decimal amounts are correctly converted to cents.
   * AI outputs amounts in human-readable decimal format (e.g., 35 for UAH 35.00).
   */
  describe('AI extraction decimal amount handling', () => {
    it('should correctly store amounts as AI outputs them (decimal format)', async () => {
      const account = await helpers.createAccount({ raw: true });

      // AI outputs amounts in decimal format (human-readable currency values)
      const transactions: ExtractedTransaction[] = [
        {
          date: '2024-01-15 10:00:00',
          description: 'Small purchase',
          amount: 35,
          type: 'expense',
        },
        {
          date: '2024-01-16 14:00:00',
          description: 'Large transfer',
          amount: 66495.56,
          type: 'income',
        },
        {
          date: '2024-01-17 09:30:00',
          description: 'Coffee',
          amount: 85.5,
          type: 'expense',
        },
        {
          date: '2024-01-18 11:00:00',
          description: 'Large round income',
          amount: 50000,
          type: 'income',
        },
      ];

      const result = await helpers.statementExecuteImportAndWait({
        payload: {
          accountId: account.id,
          transactions,
          skipIndices: [],
        },
      });

      expect(result.imported).toBe(4);
      expect(result.errors).toHaveLength(0);

      const allTransactions = await helpers.getTransactions({ raw: true });
      const importedTxs = allTransactions.filter((tx) => result.newTransactionIds.includes(tx.id));

      const smallPurchase = importedTxs.find((tx) => tx.note === 'Small purchase');
      const largeTransfer = importedTxs.find((tx) => tx.note === 'Large transfer');
      const coffee = importedTxs.find((tx) => tx.note === 'Coffee');
      const largeRound = importedTxs.find((tx) => tx.note === 'Large round income');

      expect(smallPurchase?.amount).toBe(35.0);
      expect(largeTransfer?.amount).toBe(66495.56);
      expect(coffee?.amount).toBe(85.5);
      expect(largeRound?.amount).toBe(50000);
    });
  });

  describe('account balance updates', () => {
    it('should correctly update account balance with mixed income and expenses', async () => {
      const initialBalance = 1000; // $1000.00 (API uses decimals)
      const account = await helpers.createAccount({
        payload: helpers.buildAccountPayload({ initialBalance }),
        raw: true,
      });

      // Import mixed transactions (amounts in decimal format as AI outputs)
      const transactions: ExtractedTransaction[] = [
        { date: '2025-12-01', description: 'Salary', amount: 3000, type: 'income' },
        { date: '2025-12-05', description: 'Rent', amount: 1500.5, type: 'expense' },
        { date: '2025-12-10', description: 'Freelance', amount: 500, type: 'income' },
        { date: '2025-12-15', description: 'Groceries', amount: 300, type: 'expense' },
        { date: '2025-12-20', description: 'Utilities', amount: 200, type: 'expense' },
      ];

      const result = await helpers.statementExecuteImportAndWait({
        payload: {
          accountId: account.id,
          transactions,
          skipIndices: [],
        },
      });

      expect(result.imported).toBe(5);

      // Initial: $1000.00
      // Income: $3000 + $500 = $3500.00
      // Expenses: $1500.50 + $300 + $200 = $2000.50
      // Expected: $1000.00 + $3500.00 - $2000.50 = $2499.50
      const accountAfter = await helpers.getAccount({ id: account.id, raw: true });
      expect(accountAfter.currentBalance).toBe(2499.5);
    });

    it('should handle balance going negative', async () => {
      const initialBalance = 100; // $100.00 (API uses decimals)
      const account = await helpers.createAccount({
        payload: helpers.buildAccountPayload({ initialBalance }),
        raw: true,
      });

      // Import expense larger than balance (amount in decimal format)
      const transactions: ExtractedTransaction[] = [
        { date: '2025-12-01', description: 'Big expense', amount: 500, type: 'expense' },
      ];

      const result = await helpers.statementExecuteImportAndWait({
        payload: {
          accountId: account.id,
          transactions,
          skipIndices: [],
        },
      });

      expect(result.imported).toBe(1);

      // Expected: $100.00 - $500.00 = -$400.00
      const accountAfter = await helpers.getAccount({ id: account.id, raw: true });
      expect(accountAfter.currentBalance).toBe(-400);
    });
  });

  describe('partial failure — best-effort import', () => {
    // The importer is best-effort: each transaction is written in its own
    // database transaction, so a row that fails validation is reported in
    // `summary.errors` without losing the rows around it. A row whose `date`
    // can't be parsed is rejected per-row, leaving the good rows on either side
    // to persist. `imported` must always equal the number of rows actually
    // written to the database.
    it('imports the good rows, reports only the bad row, and persists exactly what it claims', async () => {
      const account = await helpers.createAccount({ raw: true });

      const transactions: ExtractedTransaction[] = [
        { date: '2024-03-01', description: 'Good row before', amount: 100, type: 'expense' },
        { date: 'definitely-not-a-date', description: 'Row with unparseable date', amount: 200, type: 'expense' },
        { date: '2024-03-03', description: 'Good row after', amount: 300, type: 'income' },
      ];

      const result = await helpers.statementExecuteImportAndWait({
        payload: {
          accountId: account.id,
          transactions,
          skipIndices: [],
        },
      });

      // Two good rows imported; only the middle (index 1) row is reported as an error.
      expect(result.imported).toBe(2);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]!.transactionIndex).toBe(1);
      expect(result.newTransactionIds).toHaveLength(2);

      // Honesty assertion: the rows reported as imported are actually in the
      // database, and the persisted count matches the claimed `imported` count.
      const allTransactions = await helpers.getTransactions({ raw: true });
      const persisted = allTransactions.filter((tx) => result.newTransactionIds.includes(tx.id));
      expect(persisted).toHaveLength(2);
      expect(persisted.length).toBe(result.imported);
    });
  });

  describe('detect-duplicates endpoint', () => {
    it('should return correct StatementDuplicateMatch structure', async () => {
      const account = await helpers.createAccount({ raw: true });

      // Create existing transaction
      const txPayload = helpers.buildTransactionPayload({
        accountId: account.id,
        amount: 100.5, // API expects decimal amount
        transactionType: TRANSACTION_TYPES.expense,
        time: new Date('2024-01-15').toISOString(),
        note: 'Existing note',
      });
      await helpers.createTransaction({ payload: txPayload, raw: true });

      // Only the middle row duplicates, so a wrong index-to-row mapping surfaces here.
      const transactions: ExtractedTransaction[] = [
        { date: '2024-01-14', description: 'Coffee', amount: 4.2, type: 'expense' },
        {
          date: '2024-01-15 10:30:00',
          description: 'Grocery shopping',
          amount: 100.5, // same decimal format the extraction returns and execute-import accepts
          type: 'expense',
        },
        { date: '2024-01-16', description: 'Salary', amount: 100.5, type: 'income' },
      ];

      const result = await helpers.statementDetectDuplicates({
        payload: {
          accountId: account.id,
          transactions,
        },
        raw: true,
      });

      expect(result.duplicates).toHaveLength(1);

      const duplicate = result.duplicates[0]!;

      // Verify StatementDuplicateMatch structure
      expect(duplicate.transactionIndex).toBe(1);

      // extractedTransaction should preserve the input
      expect(duplicate.extractedTransaction.date).toBe('2024-01-15 10:30:00');
      expect(duplicate.extractedTransaction.description).toBe('Grocery shopping');
      expect(duplicate.extractedTransaction.amount).toBe(100.5);
      expect(duplicate.extractedTransaction.type).toBe('expense');

      // existingTransaction should have DB transaction data
      expect(typeof duplicate.existingTransaction.id).toBe('string');
      expect(duplicate.existingTransaction.date).toBe('2024-01-15');
      expect(duplicate.existingTransaction.amount).toBe(100.5);
      expect(duplicate.existingTransaction.note).toBe('Existing note');
    });

    it('rejects a negative amount and an unknown transaction type', async () => {
      const account = await helpers.createAccount({ raw: true });

      const negativeAmount = await helpers.statementDetectDuplicates({
        payload: {
          accountId: account.id,
          transactions: [
            {
              date: '2024-01-15',
              description: 'Test',
              amount: -100,
              type: 'expense',
            },
          ],
        },
        raw: false,
      });

      expect(negativeAmount.statusCode).toBe(ERROR_CODES.ValidationError);

      const invalidType = await helpers.statementDetectDuplicates({
        payload: {
          accountId: account.id,
          transactions: [
            {
              date: '2024-01-15',
              description: 'Test',
              amount: 100,
              type: 'invalid' as 'expense',
            },
          ],
        },
        raw: false,
      });

      expect(invalidType.statusCode).toBe(ERROR_CODES.ValidationError);
    });
  });

  /**
   * The default `express.json()` limit is 100KB. A real statement import sends the
   * full extracted array on every step, so the request body must be allowed to grow
   * well past that ceiling.
   */
  describe('request body size limit', () => {
    const MIN_BODY_BYTES = 100 * 1024;
    const TRANSACTION_COUNT = 600;

    // 200 chars keeps each description under the `note` column's VARCHAR(255) while
    // pushing the serialized array past the 100KB default limit.
    const DESCRIPTION_LENGTH = 200;
    const DESCRIPTION_PADDING = 'CARD PAYMENT MERCHANT REFERENCE '.repeat(8);

    function buildOversizedTransactions({ count }: { count: number }): ExtractedTransaction[] {
      return Array.from({ length: count }, (_, index) => ({
        date: `2024-03-${String((index % 28) + 1).padStart(2, '0')} 10:00:00`,
        description: `Statement row ${index} ${DESCRIPTION_PADDING}`.slice(0, DESCRIPTION_LENGTH),
        amount: (index % 500) + 1,
        type: index % 3 === 0 ? ('income' as const) : ('expense' as const),
      }));
    }

    it('POST /import/text-source/detect-duplicates accepts a body larger than the default 100KB limit', async () => {
      const account = await helpers.createAccount({ raw: true });
      const transactions = buildOversizedTransactions({ count: TRANSACTION_COUNT });

      const payload = { accountId: account.id, transactions };
      expect(Buffer.byteLength(JSON.stringify(payload))).toBeGreaterThan(MIN_BODY_BYTES);

      const response = await helpers.statementDetectDuplicates({ payload });

      expect(response.statusCode).toBe(200);
      expect(response.body.response.duplicates).toEqual([]);
    });

    it('POST /import/text-source/execute accepts a body larger than the default 100KB limit', async () => {
      const account = await helpers.createAccount({ raw: true });
      const transactions = buildOversizedTransactions({ count: TRANSACTION_COUNT });

      // The frontend sends every extracted row regardless of selection, so the
      // body stays oversized while only a slice is actually imported.
      const importedCount = 25;
      const skipIndices = Array.from({ length: TRANSACTION_COUNT - importedCount }, (_, index) => index);

      const payload = { accountId: account.id, transactions, skipIndices };
      expect(Buffer.byteLength(JSON.stringify(payload))).toBeGreaterThan(MIN_BODY_BYTES);

      const response = await helpers.statementExecuteImport({ payload });

      expect(response.statusCode).toBe(200);

      const progress = await helpers.waitForStatementImportCompletion({ jobId: response.body.response.jobId });
      helpers.expectStatementImportCompleted(progress);

      const { imported, skipped, errors, newTransactionIds } = progress.summary;
      expect(imported).toBe(importedCount);
      expect(skipped).toBe(TRANSACTION_COUNT - importedCount);
      expect(errors).toHaveLength(0);
      expect(newTransactionIds).toHaveLength(importedCount);

      const allTransactions = await helpers.getTransactions({
        accountIds: [account.id],
        limit: 100,
        raw: true,
      });
      const persisted = allTransactions.filter((tx) => newTransactionIds.includes(tx.id));
      expect(persisted).toHaveLength(importedCount);
    }, 60_000);
  });

  describe('background job contract', () => {
    it('answers the execute call with a job id instead of the summary', async () => {
      const account = await helpers.createAccount({ raw: true });

      const response = await helpers.statementExecuteImport({
        payload: { accountId: account.id, transactions: buildRows({ count: 2 }), skipIndices: [] },
        raw: true,
      });

      expect(typeof response.jobId).toBe('string');

      const progress = await helpers.waitForStatementImportCompletion({ jobId: response.jobId });
      helpers.expectStatementImportCompleted(progress);
      expect(progress.summary.imported).toBe(2);
      expect(progress.totalCount).toBe(2);
      expect(progress.processedCount).toBe(2);
    });

    it('404s the status endpoint for an unknown job id', async () => {
      const response = await helpers.getStatementImportStatus({ jobId: 'statement-import-unknown' });

      expect(response.statusCode).toBe(ERROR_CODES.NotFoundError);
    });

    it("404s the status endpoint for another user's job id", async () => {
      const account = await helpers.createAccount({ raw: true });
      const { jobId } = await helpers.statementExecuteImport({
        payload: { accountId: account.id, transactions: buildRows({ count: 2 }), skipIndices: [] },
        raw: true,
      });

      const secondUser = await helpers.signUpSecondUser();
      const response = await helpers.asUser({
        cookies: secondUser.cookies,
        fn: () => helpers.getStatementImportStatus({ jobId }),
      });

      expect(response.statusCode).toBe(ERROR_CODES.NotFoundError);
    });

    it('refuses a second import while one is still in flight, importing the rows exactly once', async () => {
      const account = await helpers.createAccount({ raw: true });
      // Enough rows that the first job is still writing when the second request
      // lands, without the wait below outliving this test's timeout.
      const transactions = buildRows({ count: 150 });
      const payload = { accountId: account.id, transactions, skipIndices: [] };

      const { jobId } = await helpers.statementExecuteImport({ payload, raw: true });
      const conflict = await helpers.statementExecuteImport({ payload, raw: false });

      expect(conflict.statusCode).toBe(ERROR_CODES.ConflictError);
      const errorBody = conflict.body.response as unknown as { details?: { jobId?: string } };
      expect(errorBody.details?.jobId).toBe(jobId);

      const progress = await helpers.waitForStatementImportCompletion({ jobId, timeoutMs: 60_000 });
      helpers.expectStatementImportCompleted(progress);
      expect(progress.summary.imported).toBe(transactions.length);

      const allTransactions = await helpers.getTransactions({ accountIds: [account.id], limit: 200, raw: true });
      expect(allTransactions).toHaveLength(transactions.length);
    }, 90_000);

    it('allows a new import once the previous one finished', async () => {
      const account = await helpers.createAccount({ raw: true });

      const first = await helpers.statementExecuteImportAndWait({
        payload: { accountId: account.id, transactions: buildRows({ count: 2 }), skipIndices: [] },
      });
      const second = await helpers.statementExecuteImportAndWait({
        payload: { accountId: account.id, transactions: buildRows({ count: 2 }), skipIndices: [] },
      });

      expect(first.imported).toBe(2);
      expect(second.imported).toBe(2);
      expect(second.batchId).not.toBe(first.batchId);
    });
  });
});
