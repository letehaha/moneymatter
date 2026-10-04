import type {
  AccountMappingConfig,
  AccountMappingValue,
  CategoryMappingConfig,
  ColumnMappingConfig,
} from '@bt/shared/types';
import {
  ACCOUNT_TYPES,
  AccountOptionValue,
  CategoryOptionValue,
  CurrencyOptionValue,
  TransactionTypeOptionValue,
  VEHICLE_CLASS,
} from '@bt/shared/types';
import { describe, expect, it } from '@jest/globals';
import { ERROR_CODES } from '@js/errors';
import * as helpers from '@tests/helpers';
import { expectCsvImportCompleted, waitForCsvImportCompletion } from '@tests/helpers/import-export';

describe('CSV import balance recalculation', () => {
  // ---------------------------------------------------------------------------
  // CSV-content builders (mirroring execute-import.e2e.ts): tests drive the
  // endpoint exactly as the UI does — raw fileContent + column mapping.
  // ---------------------------------------------------------------------------

  interface CsvRow {
    date: string;
    amount: string;
    description?: string;
    account?: string;
    currency?: string;
    type: 'income' | 'expense';
  }

  const CSV_HEADERS = ['Date', 'Amount', 'Description', 'Category', 'Account', 'Currency', 'Type'];

  const buildCsv = (rows: CsvRow[]): string => {
    const cell = (value: string | undefined) => value ?? '';
    return [
      CSV_HEADERS.join(','),
      // The Category cell is always empty — rows import uncategorized, keeping
      // these tests focused on balance behavior.
      ...rows.map((row) =>
        [row.date, row.amount, cell(row.description), '', cell(row.account), cell(row.currency), row.type].join(','),
      ),
    ].join('\n');
  };

  const buildColumnMapping = (): ColumnMappingConfig => ({
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
  });

  const runImport = async (payload: {
    fileContent: string;
    accountMapping: AccountMappingConfig;
    categoryMapping?: CategoryMappingConfig;
    skipDuplicateIndices?: number[];
    recalculateBalance?: boolean;
  }) => {
    const { jobId } = await helpers.executeImport({
      payload: {
        fileContent: payload.fileContent,
        delimiter: ',',
        columnMapping: buildColumnMapping(),
        accountMapping: payload.accountMapping,
        categoryMapping: payload.categoryMapping ?? {},
        skipDuplicateIndices: payload.skipDuplicateIndices ?? [],
        recalculateBalance: payload.recalculateBalance,
      },
      raw: true,
    });

    // Fail-fast: a broken enqueue must surface immediately, not as a poll timeout.
    expect(jobId).toBeTruthy();
    expect(jobId).toMatch(/^csv-import-/);

    return waitForCsvImportCompletion({ jobId });
  };

  /**
   * Three rows on the linked account, in that account's currency:
   * -100.50 (Jan 15) − 50.00 (Jan 16) + 2500.00 (Jan 17) = net +2349.50.
   */
  const threeRows = ({ account, currency }: { account: string; currency: string }): CsvRow[] => [
    { date: '2024-01-15', amount: '100.50', description: 'Groceries', account, currency, type: 'expense' },
    { date: '2024-01-16', amount: '50.00', description: 'Coffee', account, currency, type: 'expense' },
    { date: '2024-01-17', amount: '2500.00', description: 'Salary', account, currency, type: 'income' },
  ];

  /** Creates a base-currency account with one seeded transaction (its boundary). */
  const createAccountWithBoundaryTx = async ({ boundaryTime }: { boundaryTime: string }) => {
    const account = await helpers.createAccount({ raw: true });
    // 500 cents expense → currentBalance −5.00 before the import.
    await helpers.createTransaction({
      payload: helpers.buildTransactionPayload({ accountId: account.id, amount: 500, time: boundaryTime }),
      raw: true,
    });
    const before = await helpers.getAccount({ id: account.id, raw: true });
    return {
      account,
      balanceBefore: Number(before.currentBalance),
      initialBalanceBefore: Number(before.initialBalance),
    };
  };

  describe('linked accounts', () => {
    it('recalc ON: all rows newer than the boundary move the balance by their net sum', async () => {
      const { account, balanceBefore } = await createAccountWithBoundaryTx({
        boundaryTime: '2024-01-10T12:00:00Z',
      });

      const progress = await runImport({
        fileContent: buildCsv(threeRows({ account: 'CSV Acc', currency: account.currencyCode })),
        accountMapping: { 'CSV Acc': { action: 'link-existing', accountId: account.id } },
        recalculateBalance: true,
      });
      expectCsvImportCompleted(progress);
      expect(progress.summary.imported).toBe(3);
      expect(progress.summary.errors).toHaveLength(0);

      const after = await helpers.getAccount({ id: account.id, raw: true });
      expect(Number(after.currentBalance)).toBe(balanceBefore + 2349.5);

      expect(progress.summary.accountBalanceChanges).toHaveLength(1);
      expect(progress.summary.accountBalanceChanges?.[0]).toEqual({
        accountId: account.id,
        accountName: account.name,
        balanceBefore,
        balanceAfter: balanceBefore + 2349.5,
        delta: 2349.5,
        movedCount: 3,
        historicalCount: 0,
        isNewAccount: false,
      });
    });

    it('recalc ON: rows all older than the boundary are pure backfill — balance unchanged', async () => {
      const { account, balanceBefore, initialBalanceBefore } = await createAccountWithBoundaryTx({
        boundaryTime: '2024-06-10T12:00:00Z',
      });

      const progress = await runImport({
        fileContent: buildCsv(threeRows({ account: 'CSV Acc', currency: account.currencyCode })),
        accountMapping: { 'CSV Acc': { action: 'link-existing', accountId: account.id } },
        recalculateBalance: true,
      });
      expectCsvImportCompleted(progress);
      expect(progress.summary.imported).toBe(3);
      expect(progress.summary.errors).toHaveLength(0);

      const after = await helpers.getAccount({ id: account.id, raw: true });
      expect(Number(after.currentBalance)).toBe(balanceBefore);
      // Absorption mechanism: the backfilled net (+2349.50) is subtracted from
      // initialBalance so the written rows leave currentBalance untouched.
      expect(Number(after.initialBalance)).toBe(initialBalanceBefore - 2349.5);

      expect(progress.summary.accountBalanceChanges).toHaveLength(1);
      expect(progress.summary.accountBalanceChanges?.[0]).toMatchObject({
        accountId: account.id,
        delta: 0,
        movedCount: 0,
        historicalCount: 3,
        isNewAccount: false,
      });
    });

    it('recalc ON: mixed import moves the balance by the new subset only; boundary-day rows count as new', async () => {
      // Boundary day 2024-01-16: the Jan 15 row is backfill; the Jan 16 row
      // (same day as the boundary) and the Jan 17 row are new.
      const { account, balanceBefore, initialBalanceBefore } = await createAccountWithBoundaryTx({
        boundaryTime: '2024-01-16T10:00:00Z',
      });

      const progress = await runImport({
        fileContent: buildCsv(threeRows({ account: 'CSV Acc', currency: account.currencyCode })),
        accountMapping: { 'CSV Acc': { action: 'link-existing', accountId: account.id } },
        recalculateBalance: true,
      });
      expectCsvImportCompleted(progress);
      expect(progress.summary.errors).toHaveLength(0);

      // New subset: −50.00 + 2500.00 = +2450.00 (the −100.50 backfill is absorbed).
      const after = await helpers.getAccount({ id: account.id, raw: true });
      expect(Number(after.currentBalance)).toBe(balanceBefore + 2450);
      // Absorption mechanism: only the backfilled −100.50 expense moves
      // initialBalance (up, so the absorbed expense leaves currentBalance to
      // the new subset); the new rows leave it alone.
      expect(Number(after.initialBalance)).toBe(initialBalanceBefore + 100.5);

      expect(progress.summary.accountBalanceChanges?.[0]).toMatchObject({
        delta: 2450,
        movedCount: 2,
        historicalCount: 1,
      });
    });

    it('recalc OFF (explicit and omitted): linked balance is fully preserved', async () => {
      const explicitOff = await createAccountWithBoundaryTx({ boundaryTime: '2024-01-10T12:00:00Z' });
      const omitted = await createAccountWithBoundaryTx({ boundaryTime: '2024-01-10T12:00:00Z' });

      const offProgress = await runImport({
        fileContent: buildCsv(threeRows({ account: 'Off Acc', currency: explicitOff.account.currencyCode })),
        accountMapping: { 'Off Acc': { action: 'link-existing', accountId: explicitOff.account.id } },
        recalculateBalance: false,
      });
      expectCsvImportCompleted(offProgress);
      expect(offProgress.summary.errors).toHaveLength(0);

      const omittedProgress = await runImport({
        fileContent: buildCsv(threeRows({ account: 'Omitted Acc', currency: omitted.account.currencyCode })),
        accountMapping: { 'Omitted Acc': { action: 'link-existing', accountId: omitted.account.id } },
      });
      expectCsvImportCompleted(omittedProgress);
      expect(omittedProgress.summary.errors).toHaveLength(0);

      const afterOff = await helpers.getAccount({ id: explicitOff.account.id, raw: true });
      expect(Number(afterOff.currentBalance)).toBe(explicitOff.balanceBefore);
      const afterOmitted = await helpers.getAccount({ id: omitted.account.id, raw: true });
      expect(Number(afterOmitted.currentBalance)).toBe(omitted.balanceBefore);

      // The summary still reports the classification even though nothing moved.
      expect(offProgress.summary.accountBalanceChanges?.[0]).toMatchObject({
        delta: 0,
        balanceBefore: explicitOff.balanceBefore,
        balanceAfter: explicitOff.balanceBefore,
        movedCount: 3,
        historicalCount: 0,
      });
    });

    it('recalc ON: skipped duplicate rows contribute nothing to the recalculated balance', async () => {
      const { account } = await createAccountWithBoundaryTx({ boundaryTime: '2024-01-10T12:00:00Z' });
      const accountMapping: AccountMappingConfig = {
        'CSV Acc': { action: 'link-existing', accountId: account.id },
      };
      const fullFile = buildCsv(threeRows({ account: 'CSV Acc', currency: account.currencyCode }));

      // Import only the first row, then let duplicate detection flag it against
      // the full file — the genuine skip flow the wizard drives.
      const firstRowOnly = buildCsv(threeRows({ account: 'CSV Acc', currency: account.currencyCode }).slice(0, 1));
      const first = await runImport({ fileContent: firstRowOnly, accountMapping, recalculateBalance: true });
      expectCsvImportCompleted(first);
      expect(first.summary.imported).toBe(1);
      const balanceAfterFirst = Number((await helpers.getAccount({ id: account.id, raw: true })).currentBalance);

      const { duplicates } = await helpers.detectDuplicates({
        payload: {
          fileContent: fullFile,
          delimiter: ',',
          columnMapping: buildColumnMapping(),
          accountMapping,
          categoryMapping: {},
        },
        raw: true,
      });
      // Only the already-imported first data row (CSV line 2) matches.
      const skipDuplicateIndices = duplicates.map((d) => d.rowIndex);
      expect(skipDuplicateIndices).toEqual([2]);

      const progress = await runImport({
        fileContent: fullFile,
        accountMapping,
        skipDuplicateIndices,
        recalculateBalance: true,
      });
      expectCsvImportCompleted(progress);
      expect(progress.summary.imported).toBe(2);
      expect(progress.summary.skipped).toBe(1);
      expect(progress.summary.errors).toHaveLength(0);

      // Only the two non-skipped rows move the balance: −50 + 2500 = +2450.
      const after = await helpers.getAccount({ id: account.id, raw: true });
      expect(Number(after.currentBalance)).toBe(balanceAfterFirst + 2450);

      expect(progress.summary.accountBalanceChanges).toHaveLength(1);
      expect(progress.summary.accountBalanceChanges?.[0]).toMatchObject({
        balanceBefore: balanceAfterFirst,
        balanceAfter: balanceAfterFirst + 2450,
        delta: 2450,
        movedCount: 2,
        historicalCount: 0,
        isNewAccount: false,
      });
    });

    it('recalc ON: one import touching two linked accounts classifies against each boundary independently', async () => {
      // Boundary newer than every imported row → all its rows are backfill.
      const backfilled = await createAccountWithBoundaryTx({ boundaryTime: '2024-06-10T12:00:00Z' });
      // No transactions → no boundary → all its rows are new.
      const fresh = await helpers.createAccount({ raw: true });
      const freshBefore = Number((await helpers.getAccount({ id: fresh.id, raw: true })).currentBalance);

      const rows: CsvRow[] = [
        {
          date: '2024-01-15',
          amount: '100.50',
          description: 'Old expense',
          account: 'Hist Acc',
          currency: backfilled.account.currencyCode,
          type: 'expense',
        },
        {
          date: '2024-01-16',
          amount: '40.00',
          description: 'Old income',
          account: 'Hist Acc',
          currency: backfilled.account.currencyCode,
          type: 'income',
        },
        {
          date: '2024-01-15',
          amount: '200.00',
          description: 'Fresh income',
          account: 'Fresh Acc',
          currency: fresh.currencyCode,
          type: 'income',
        },
        {
          date: '2024-01-17',
          amount: '25.00',
          description: 'Fresh expense',
          account: 'Fresh Acc',
          currency: fresh.currencyCode,
          type: 'expense',
        },
      ];

      const progress = await runImport({
        fileContent: buildCsv(rows),
        accountMapping: {
          'Hist Acc': { action: 'link-existing', accountId: backfilled.account.id },
          'Fresh Acc': { action: 'link-existing', accountId: fresh.id },
        },
        recalculateBalance: true,
      });
      expectCsvImportCompleted(progress);
      expect(progress.summary.imported).toBe(4);
      expect(progress.summary.errors).toHaveLength(0);

      // Backfilled account: both rows are older than its boundary → unchanged.
      const backfilledAfter = await helpers.getAccount({ id: backfilled.account.id, raw: true });
      expect(Number(backfilledAfter.currentBalance)).toBe(backfilled.balanceBefore);
      // Fresh account: both rows are new → +200 − 25 = +175.
      const freshAfter = await helpers.getAccount({ id: fresh.id, raw: true });
      expect(Number(freshAfter.currentBalance)).toBe(freshBefore + 175);

      expect(progress.summary.accountBalanceChanges).toHaveLength(2);
      const changeFor = (accountId: string) =>
        progress.summary.accountBalanceChanges?.find((c) => c.accountId === accountId);
      expect(changeFor(backfilled.account.id)).toMatchObject({
        delta: 0,
        movedCount: 0,
        historicalCount: 2,
        isNewAccount: false,
      });
      expect(changeFor(fresh.id)).toMatchObject({
        delta: 175,
        movedCount: 2,
        historicalCount: 0,
        isNewAccount: false,
      });
    });

    it('recalc ON: a row that fails at the database layer is excluded from the balance and reported in errors', async () => {
      const { account, balanceBefore } = await createAccountWithBoundaryTx({ boundaryTime: '2024-01-10T12:00:00Z' });

      // The middle row's amount parses fine (`parseAmount` has no magnitude
      // bound and 1e19 is an exact integer float, so `Money.fromCents` accepts
      // it too) but overflows the BIGINT cents column
      // (100,000,000,000,000,000.00 → 1e19 cents > the BIGINT max of
      // 9,223,372,036,854,775,807), so its insert fails at the database layer
      // and rolls back only itself — the surrounding rows still commit.
      const rows: CsvRow[] = [
        {
          date: '2024-01-15',
          amount: '100.00',
          description: 'Good row before',
          account: 'CSV Acc',
          currency: account.currencyCode,
          type: 'expense',
        },
        {
          date: '2024-01-16',
          amount: '100000000000000000.00',
          description: 'Overflow row',
          account: 'CSV Acc',
          currency: account.currencyCode,
          type: 'income',
        },
        {
          date: '2024-01-17',
          amount: '300.00',
          description: 'Good row after',
          account: 'CSV Acc',
          currency: account.currencyCode,
          type: 'income',
        },
      ];

      const progress = await runImport({
        fileContent: buildCsv(rows),
        accountMapping: { 'CSV Acc': { action: 'link-existing', accountId: account.id } },
        recalculateBalance: true,
      });
      expectCsvImportCompleted(progress);

      expect(progress.summary.imported).toBe(2);
      expect(progress.summary.errors).toHaveLength(1);
      // The failed row is the second data row → CSV line 3.
      expect(progress.summary.errors[0]).toMatchObject({ rowIndex: 3 });

      // Only the two committed rows move the balance: −100 + 300 = +200.
      const after = await helpers.getAccount({ id: account.id, raw: true });
      expect(Number(after.currentBalance)).toBe(balanceBefore + 200);

      expect(progress.summary.accountBalanceChanges?.[0]).toMatchObject({
        balanceBefore,
        balanceAfter: balanceBefore + 200,
        delta: 200,
        movedCount: 2,
        historicalCount: 0,
      });
    });

    it('recalc ON: all rows skipped returns imported=0 with empty balance changes and leaves the linked balance untouched', async () => {
      // Every data row is skipped, so `executeImport` short-circuits BEFORE the
      // balance-reconciliation session even opens: no account is captured, the
      // summary carries an empty `accountBalanceChanges`, and the linked balance
      // is exactly what it was before the import.
      const { account, balanceBefore } = await createAccountWithBoundaryTx({
        boundaryTime: '2024-01-10T12:00:00Z',
      });

      const progress = await runImport({
        fileContent: buildCsv(threeRows({ account: 'CSV Acc', currency: account.currencyCode })),
        accountMapping: { 'CSV Acc': { action: 'link-existing', accountId: account.id } },
        // The three data rows occupy CSV lines 2–4.
        skipDuplicateIndices: [2, 3, 4],
        recalculateBalance: true,
      });
      expectCsvImportCompleted(progress);

      expect(progress.summary.imported).toBe(0);
      expect(progress.summary.skipped).toBe(3);
      expect(progress.summary.errors).toHaveLength(0);
      expect(progress.summary.accountBalanceChanges).toEqual([]);

      const after = await helpers.getAccount({ id: account.id, raw: true });
      expect(Number(after.currentBalance)).toBe(balanceBefore);
    });

    it('recalc ON: a captured account whose only row fails to write still gets a zero-delta summary entry with no balance write', async () => {
      // Account A takes a good row; account B is captured too (its row is not
      // skipped, so it lands in the resolved set) but its only row overflows the
      // BIGINT cents column and rolls back, leaving B's tally empty. `finalize`
      // must still emit B's summary entry off its empty tally — movedCount 0,
      // delta 0, no absorb write — while B's stored balance stays put.
      const accountA = await createAccountWithBoundaryTx({ boundaryTime: '2024-01-10T12:00:00Z' });
      const accountB = await createAccountWithBoundaryTx({ boundaryTime: '2024-01-10T12:00:00Z' });

      const rows: CsvRow[] = [
        {
          date: '2024-01-15',
          amount: '100.00',
          description: 'A income',
          account: 'A Acc',
          currency: accountA.account.currencyCode,
          type: 'income',
        },
        {
          // 1e17 currency units → 1e19 cents, past the BIGINT max: the insert
          // fails at the database layer and rolls back only itself.
          date: '2024-01-16',
          amount: '100000000000000000.00',
          description: 'B overflow',
          account: 'B Acc',
          currency: accountB.account.currencyCode,
          type: 'income',
        },
      ];

      const progress = await runImport({
        fileContent: buildCsv(rows),
        accountMapping: {
          'A Acc': { action: 'link-existing', accountId: accountA.account.id },
          'B Acc': { action: 'link-existing', accountId: accountB.account.id },
        },
        recalculateBalance: true,
      });
      expectCsvImportCompleted(progress);

      expect(progress.summary.imported).toBe(1);
      // The only failure is B's overflow row (2nd data row → CSV line 3).
      expect(progress.summary.errors).toHaveLength(1);
      expect(progress.summary.errors[0]).toMatchObject({ rowIndex: 3 });

      // A moved by its single new row; B never moved.
      const afterA = await helpers.getAccount({ id: accountA.account.id, raw: true });
      expect(Number(afterA.currentBalance)).toBe(accountA.balanceBefore + 100);
      const afterB = await helpers.getAccount({ id: accountB.account.id, raw: true });
      expect(Number(afterB.currentBalance)).toBe(accountB.balanceBefore);

      const changeFor = (accountId: string) =>
        progress.summary.accountBalanceChanges?.find((c) => c.accountId === accountId);
      expect(changeFor(accountB.account.id)).toEqual({
        accountId: accountB.account.id,
        accountName: accountB.account.name,
        balanceBefore: accountB.balanceBefore,
        balanceAfter: accountB.balanceBefore,
        delta: 0,
        movedCount: 0,
        historicalCount: 0,
        isNewAccount: false,
      });
    });
  });

  describe('created accounts', () => {
    // The entered `currentBalance` is the FINAL balance the account holds after
    // the import: the rows' net (+2349.50) is absorbed into `initialBalance`
    // (1000 − 2349.50 = −1349.50) so `currentBalance` lands exactly on the
    // entered value. The recalculate checkbox applies only to linked accounts,
    // so both flag states must produce the identical result for created ones.
    it('forces the entered currentBalance as the final balance, whatever recalculateBalance says', async () => {
      for (const recalculateBalance of [true, false]) {
        const accountName = `Fresh USD recalc ${recalculateBalance}`;
        const progress = await runImport({
          fileContent: buildCsv(threeRows({ account: accountName, currency: 'USD' })),
          accountMapping: { [accountName]: { action: 'create-new', currentBalance: 1000 } },
          recalculateBalance,
        });
        expectCsvImportCompleted(progress);
        expect(progress.summary.imported).toBe(3);
        expect(progress.summary.accountsCreated).toBe(1);
        expect(progress.summary.errors).toHaveLength(0);

        const accounts = await helpers.getAccounts();
        const created = accounts.find((a) => a.name === accountName)!;
        expect(created).toBeDefined();
        expect(Number(created.currentBalance)).toBe(1000);
        expect(Number(created.initialBalance)).toBe(1000 - 2349.5);

        expect(progress.summary.accountBalanceChanges).toHaveLength(1);
        // Created accounts carry no balanceBefore/delta — there is no pre-import
        // balance to compare against, so the entry is the final balance + counts.
        expect(progress.summary.accountBalanceChanges?.[0]).toEqual({
          accountId: created.id,
          accountName,
          balanceAfter: 1000,
          movedCount: 3,
          historicalCount: 0,
          isNewAccount: true,
        });
      }
    }, 60_000);

    // The wire schema defaults an omitted `currentBalance` to null, while the
    // shared type requires the key — so the omission needs the cast to be
    // expressible at all.
    it('leaves the balance at the imported rows net sum when currentBalance is absent', async () => {
      const progress = await runImport({
        fileContent: buildCsv(threeRows({ account: 'Fresh Blank USD', currency: 'USD' })),
        accountMapping: { 'Fresh Blank USD': { action: 'create-new' } as AccountMappingValue },
        recalculateBalance: true,
      });
      expectCsvImportCompleted(progress);
      expect(progress.summary.errors).toHaveLength(0);

      const accounts = await helpers.getAccounts();
      const created = accounts.find((a) => a.name === 'Fresh Blank USD')!;
      expect(Number(created.currentBalance)).toBe(2349.5);
      expect(Number(created.initialBalance)).toBe(0);

      expect(progress.summary.accountBalanceChanges?.[0]).toMatchObject({
        balanceAfter: 2349.5,
        isNewAccount: true,
      });
    });

    it('shifts the whole balance-history staircase so it ends at the entered currentBalance', async () => {
      // Each imported row moves the daily balance history for its own day and
      // cascades into every later record; the finalize target-write then moves
      // `initialBalance` by the diff (1500 − (−1500) = +3000), which shifts
      // EVERY historical record by that same diff. Balance-history amounts are
      // stored in the user's base currency, so the account is created in the
      // base currency to keep the asserted numbers exact.
      const currency = global.BASE_CURRENCY_CODE;
      const accountName = 'Staircase Acc';
      const rows: CsvRow[] = [
        { date: '2024-01-10', amount: '500.00', description: 'Rent', account: accountName, currency, type: 'expense' },
        { date: '2024-01-15', amount: '500.00', description: 'Food', account: accountName, currency, type: 'expense' },
        { date: '2024-01-20', amount: '500.00', description: 'Fuel', account: accountName, currency, type: 'expense' },
      ];

      const progress = await runImport({
        fileContent: buildCsv(rows),
        accountMapping: { [accountName]: { action: 'create-new', currentBalance: 1500 } },
        recalculateBalance: false,
      });
      expectCsvImportCompleted(progress);
      expect(progress.summary.imported).toBe(3);
      expect(progress.summary.errors).toHaveLength(0);

      const accounts = await helpers.getAccounts();
      const created = accounts.find((a) => a.name === accountName)!;
      expect(Number(created.currentBalance)).toBe(1500);
      expect(Number(created.initialBalance)).toBe(3000);

      // The staircase walks 3000 → 1500 forward: one record per day with
      // activity, each holding that day's end-of-day balance. The pre-history
      // anchor is MATERIALIZED: when a transaction lands earlier than every
      // existing balance record, `Balances.handleTransactionChange` seeds a
      // day-before record carrying the account's initial balance, so the chart
      // has an explicit starting point (2024-01-09 = 3000 after the finalize
      // shift). The account-creation-day record (import day, dynamic date)
      // closes the series at the same final value.
      const history = await helpers.getBalanceHistory({ accountId: created.id, raw: true });
      expect(history.map((record) => ({ date: record.date, amount: record.amount }))).toEqual([
        { date: '2024-01-09', amount: 3000 },
        { date: '2024-01-10', amount: 2500 },
        { date: '2024-01-15', amount: 2000 },
        { date: '2024-01-20', amount: 1500 },
        { date: expect.any(String), amount: 1500 },
      ]);
    });

    it('rejects a create-new currentBalance beyond the integer-cents cap with 422', async () => {
      // Balances persist as INTEGER cents, so a create-new target past the
      // ±20,000,000 bound must fail Zod validation synchronously (422) instead of
      // surfacing as a raw integer-overflow deep inside the async job. The bound
      // is symmetric, so both signs must be rejected the same way.
      for (const [accountName, currentBalance] of [
        ['Big USD', 20_000_001],
        ['Big Negative USD', -20_000_001],
      ] as const) {
        const response = await helpers.executeImport({
          payload: {
            fileContent: buildCsv(threeRows({ account: accountName, currency: 'USD' })),
            delimiter: ',',
            columnMapping: buildColumnMapping(),
            accountMapping: { [accountName]: { action: 'create-new', currentBalance } },
            categoryMapping: {},
            skipDuplicateIndices: [],
          },
          raw: false,
        });

        expect(response.statusCode).toBe(ERROR_CODES.ValidationError);
      }
    });

    it('accepts a create-new currentBalance exactly on the integer-cents cap', async () => {
      // The cap is inclusive: ±20,000,000 is the last accepted value, so the
      // import must run to completion and leave the account on that exact
      // boundary balance. The account is created in the base currency so the
      // forced `refCurrentBalance` equals the entered value (no FX
      // multiplication that could push the ref side past the cap).
      for (const currentBalance of [20_000_000, -20_000_000]) {
        const accountName = `Boundary ${currentBalance}`;
        const progress = await runImport({
          fileContent: buildCsv(threeRows({ account: accountName, currency: global.BASE_CURRENCY_CODE })),
          accountMapping: { [accountName]: { action: 'create-new', currentBalance } },
          recalculateBalance: true,
        });
        expectCsvImportCompleted(progress);
        expect(progress.summary.imported).toBe(3);
        expect(progress.summary.accountsCreated).toBe(1);
        expect(progress.summary.errors).toHaveLength(0);

        const accounts = await helpers.getAccounts();
        const created = accounts.find((a) => a.name === accountName)!;
        expect(created).toBeDefined();
        expect(Number(created.currentBalance)).toBe(currentBalance);
        // The imported rows' net (+2349.50) is absorbed into initialBalance so
        // currentBalance lands exactly on the entered boundary value.
        expect(Number(created.initialBalance)).toBe(currentBalance - 2349.5);
      }
    }, 60_000);
  });

  describe('vehicle/loan exclusion', () => {
    it('fails the import for every way of resolving a vehicle account as the target', async () => {
      const vehicle = await helpers.createVehicle({
        name: 'Toyota Camry 2020',
        currencyCode: 'USD',
        make: 'Toyota',
        model: 'Camry',
        year: 2020,
        vehicleClass: VEHICLE_CLASS.sedan,
        purchasePrice: 25000,
        purchaseDate: '2022-01-15',
        raw: true,
      });
      // The depreciation model sets the vehicle account's value, so only
      // before/after equality is stable to assert — not an absolute number.
      const balanceBefore = Number((await helpers.getAccount({ id: vehicle.accountId, raw: true })).currentBalance);

      const linkExistingProgress = await runImport({
        fileContent: buildCsv(threeRows({ account: 'Car CSV', currency: 'USD' })),
        accountMapping: { 'Car CSV': { action: 'link-existing', accountId: vehicle.accountId } },
        recalculateBalance: true,
      });

      expect(linkExistingProgress.status).toBe('failed');
      if (linkExistingProgress.status === 'failed') {
        expect(linkExistingProgress.error).toContain('cannot be an import target');
      }

      // "Single existing account" flow: no Account/Currency columns — the account
      // option carries the target id directly and every row's account name is
      // empty, so resolution falls through to the defaultAccountId branch of
      // `createAccountsIfNeeded`, which must reject the vehicle target.
      const rows: CsvRow[] = [
        { date: '2024-01-15', amount: '100.50', description: 'Groceries', type: 'expense' },
        { date: '2024-01-17', amount: '2500.00', description: 'Salary', type: 'income' },
      ];

      const { jobId } = await helpers.executeImport({
        payload: {
          fileContent: buildCsv(rows),
          delimiter: ',',
          columnMapping: {
            ...buildColumnMapping(),
            account: { option: AccountOptionValue.existingAccount, accountId: vehicle.accountId },
            currency: { option: CurrencyOptionValue.existingCurrency, currencyCode: 'USD' },
          },
          accountMapping: {},
          categoryMapping: {},
          skipDuplicateIndices: [],
          recalculateBalance: true,
        },
        raw: true,
      });
      // Fail-fast: a broken enqueue must surface immediately, not as a poll timeout.
      expect(jobId).toBeTruthy();
      expect(jobId).toMatch(/^csv-import-/);

      const fallbackProgress = await waitForCsvImportCompletion({ jobId });
      expect(fallbackProgress.status).toBe('failed');
      if (fallbackProgress.status === 'failed') {
        expect(fallbackProgress.error).toContain('cannot be an import target');
      }

      // The vehicle's managed balance must be untouched by either attempt.
      const after = await helpers.getAccount({ id: vehicle.accountId, raw: true });
      expect(Number(after.currentBalance)).toBe(balanceBefore);
    }, 60_000);
  });

  describe('non-base currency (FX)', () => {
    it('recalc OFF: a non-base-currency linked account keeps its base-currency balance exactly', async () => {
      // The account is in EUR while the user's base currency is not, so every
      // imported row carries its own row-date `refAmount`. With recalc OFF,
      // `finalize` undoes Σ(all rows) on BOTH sides using each row's stored
      // refAmount — never a today-rate reconversion — so the base-currency
      // balance (`refCurrentBalance`) must return to exactly its pre-import value.
      const account = await helpers.createAccount({
        payload: helpers.buildAccountPayload({ currencyCode: 'EUR' }),
        raw: true,
      });
      // Seed one past-dated transaction so the account starts non-zero in both
      // its own and the base currency.
      await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({ accountId: account.id, amount: 500, time: '2024-06-10T12:00:00Z' }),
        raw: true,
      });
      const before = await helpers.getAccount({ id: account.id, raw: true });
      const currentBefore = Number(before.currentBalance);
      const refBefore = Number(before.refCurrentBalance);

      const progress = await runImport({
        fileContent: buildCsv(threeRows({ account: 'EUR Acc', currency: 'EUR' })),
        accountMapping: { 'EUR Acc': { action: 'link-existing', accountId: account.id } },
        recalculateBalance: false,
      });
      expectCsvImportCompleted(progress);
      expect(progress.summary.imported).toBe(3);
      expect(progress.summary.errors).toHaveLength(0);

      const after = await helpers.getAccount({ id: account.id, raw: true });
      // Own-currency balance and base-currency balance both fully preserved.
      expect(Number(after.currentBalance)).toBe(currentBefore);
      expect(Number(after.refCurrentBalance)).toBe(refBefore);

      expect(progress.summary.accountBalanceChanges?.[0]).toMatchObject({
        delta: 0,
        balanceBefore: currentBefore,
        balanceAfter: currentBefore,
      });
    });

    it('recalc ON: a non-base-currency linked account moves both balances by the new subset, absorbing the historical refAmount', async () => {
      // EUR account while the user's base currency is not EUR, so every imported
      // row carries its own row-date `refAmount`. Boundary day 2024-01-16: the
      // Jan 15 row is backfill (historical), the Jan 16 and Jan 17 rows are new.
      // With recalc ON, `finalize` absorbs ONLY the historical row's contribution
      // on BOTH sides — the account-currency balance moves by Σ(new EUR) and the
      // base-currency balance moves by Σ(new refAmount), each new row kept at its
      // own row-date rate rather than reconverted at today's rate.
      const account = await helpers.createAccount({
        payload: helpers.buildAccountPayload({ currencyCode: 'EUR' }),
        raw: true,
      });
      // Seed a boundary transaction (day 2024-01-16) so the account starts
      // non-zero in both currencies and the Jan 15 import row lands as backfill.
      await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({ accountId: account.id, amount: 500, time: '2024-01-16T10:00:00Z' }),
        raw: true,
      });
      const before = await helpers.getAccount({ id: account.id, raw: true });
      const currentBefore = Number(before.currentBalance);
      const refBefore = Number(before.refCurrentBalance);

      const progress = await runImport({
        fileContent: buildCsv(threeRows({ account: 'EUR Acc', currency: 'EUR' })),
        accountMapping: { 'EUR Acc': { action: 'link-existing', accountId: account.id } },
        recalculateBalance: true,
      });
      expectCsvImportCompleted(progress);
      expect(progress.summary.imported).toBe(3);
      expect(progress.summary.errors).toHaveLength(0);

      const after = await helpers.getAccount({ id: account.id, raw: true });
      // Account-currency side: new subset only, −50.00 + 2500.00 = +2450.00 EUR
      // (the −100.50 Jan 15 backfill is absorbed).
      expect(Number(after.currentBalance)).toBe(currentBefore + 2450);

      // Base-currency side: sum the two NEW rows' actual written refAmounts (each
      // computed at its own row-date FX rate) straight from the created
      // transactions. The Jan 15 backfill row's refAmount must NOT stay applied —
      // proving the historical portion was absorbed on the ref side too, not
      // undone at a today rate.
      const txns = await helpers.getTransactions({ raw: true });
      const signedRef = (note: string) => {
        const tx = txns.find((t) => t.note === note)!;
        expect(tx).toBeDefined();
        const refAmount = Number(tx.refAmount);
        return String(tx.transactionType) === 'income' ? refAmount : -refAmount;
      };
      const newRefDelta = signedRef('Coffee') + signedRef('Salary');
      expect(Number(after.refCurrentBalance)).toBeCloseTo(refBefore + newRefDelta, 2);

      expect(progress.summary.accountBalanceChanges?.[0]).toMatchObject({
        delta: 2450,
        movedCount: 2,
        historicalCount: 1,
        isNewAccount: false,
      });
    });
  });

  describe('non-system (bank-connected) linked account', () => {
    it('rejects the import and writes no row', async () => {
      // POST /accounts permits a non-system `type` outside production.
      const account = await helpers.createAccount({
        payload: helpers.buildAccountPayload({
          name: 'Monobank Black',
          type: ACCOUNT_TYPES.monobank,
          currencyCode: global.BASE_CURRENCY_CODE,
          initialBalance: 1000,
        }),
        raw: true,
      });

      const progress = await runImport({
        fileContent: buildCsv(threeRows({ account: 'Bank Acc', currency: account.currencyCode })),
        accountMapping: { 'Bank Acc': { action: 'link-existing', accountId: account.id } },
        recalculateBalance: true,
      });
      expect(progress.status).toBe('failed');
      if (progress.status === 'failed') {
        expect(progress.error).toContain(account.name);
      }

      const after = await helpers.getAccount({ id: account.id, raw: true });
      expect(Number(after.currentBalance)).toBe(Number(account.currentBalance));
      expect(Number(after.initialBalance)).toBe(Number(account.initialBalance));
      expect(await helpers.getTransactions({ raw: true })).toHaveLength(0);
    });

    it('creates no account when another source account of the same import links to a bank-connected one', async () => {
      const bankAccount = await helpers.createAccount({
        payload: helpers.buildAccountPayload({ type: ACCOUNT_TYPES.monobank }),
        raw: true,
      });
      const currency = bankAccount.currencyCode;

      const progress = await runImport({
        fileContent: buildCsv([
          ...threeRows({ account: 'Fresh Acc', currency }),
          ...threeRows({ account: 'Bank Acc', currency }),
        ]),
        accountMapping: {
          'Fresh Acc': { action: 'create-new', currentBalance: null },
          'Bank Acc': { action: 'link-existing', accountId: bankAccount.id },
        },
      });
      expect(progress.status).toBe('failed');

      const accounts = await helpers.getAccounts();
      expect(accounts.find((a) => a.name === 'Fresh Acc')).toBeUndefined();
    });
  });
});
