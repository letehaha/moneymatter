import { VEHICLE_CLASS } from '@bt/shared/types';
import { describe, expect, it } from '@jest/globals';
import { ERROR_CODES } from '@js/errors';
import * as helpers from '@tests/helpers';
import { expectCompleted, waitForBudgetBakersWalletCompletion } from '@tests/helpers/import-export';

/** Ordinary (non-transfer) Wallet row in the given account/currency. */
const walletRow = ({
  account,
  currency,
  amount,
  type,
  date,
  note,
}: {
  account: string;
  currency: string;
  amount: string;
  type: 'Expense' | 'Income';
  date: string;
  note: string;
}) => `${account};Misc;${currency};${amount};${amount};${type};Credit card;${note};${date};false;;`;

const runImport = async (payload: Parameters<typeof helpers.executeBudgetBakersWallet>[0]['payload']) => {
  const { jobId } = await helpers.executeBudgetBakersWallet({ payload, raw: true });
  // Fail-fast: a broken enqueue must surface immediately, not as a poll timeout.
  expect(jobId).toBeTruthy();
  expect(jobId).toMatch(/^budget-bakers-wallet-import-/);
  return waitForBudgetBakersWalletCompletion({ jobId });
};

/** Creates a UAH account with one seeded transaction (its boundary). */
const createLinkedAccountWithBoundaryTx = async ({ boundaryTime }: { boundaryTime: string }) => {
  const account = await helpers.createAccount({
    payload: helpers.buildAccountPayload({ currencyCode: 'UAH' }),
    raw: true,
  });
  // 300 cents expense → currentBalance −3.00 before the import.
  await helpers.createTransaction({
    payload: helpers.buildTransactionPayload({ accountId: account.id, amount: 300, time: boundaryTime }),
    raw: true,
  });
  const before = await helpers.getAccount({ id: account.id, raw: true });
  return {
    account,
    balanceBefore: Number(before.currentBalance),
    initialBalanceBefore: Number(before.initialBalance),
  };
};

describe('Budget Bakers Wallet import balance recalculation', () => {
  const CSV_HEADER =
    'account;category;currency;amount;ref_currency_amount;type;payment_type;note;date;transfer;payee;labels';

  it('recalc ON: mixed import moves the linked balance by the boundary-newer subset only', async () => {
    const { account, balanceBefore, initialBalanceBefore } = await createLinkedAccountWithBoundaryTx({
      boundaryTime: '2025-06-10T12:00:00Z',
    });

    const fileContent = [
      CSV_HEADER,
      // Older than the boundary → backfill, absorbed into initialBalance.
      walletRow({
        account: 'Mono UAH',
        currency: 'UAH',
        amount: '1200',
        type: 'Expense',
        date: '2025-06-01T12:00:00.000Z',
        note: 'Old groceries',
      }),
      // Newer than the boundary → moves the balance.
      walletRow({
        account: 'Mono UAH',
        currency: 'UAH',
        amount: '50000',
        type: 'Income',
        date: '2025-06-15T10:00:00.000Z',
        note: 'June salary',
      }),
    ].join('\n');

    const progress = await runImport({
      fileContent,
      accountMapping: { 'Mono UAH': { action: 'link-existing', accountId: account.id } },
      recalculateBalance: true,
    });
    expectCompleted(progress);
    expect(progress.summary.transactionsImported).toBe(2);
    expect(progress.summary.errors).toHaveLength(0);

    const after = await helpers.getAccount({ id: account.id, raw: true });
    expect(Number(after.currentBalance)).toBe(balanceBefore + 50000);
    // Absorption mechanism: only the backfilled −1200 expense moves
    // initialBalance (up, cancelling it out of currentBalance); the new income
    // row leaves it alone.
    expect(Number(after.initialBalance)).toBe(initialBalanceBefore + 1200);

    expect(progress.summary.accountBalanceChanges).toHaveLength(1);
    expect(progress.summary.accountBalanceChanges?.[0]).toEqual({
      accountId: account.id,
      accountName: account.name,
      balanceBefore,
      balanceAfter: balanceBefore + 50000,
      delta: 50000,
      movedCount: 1,
      historicalCount: 1,
      isNewAccount: false,
    });
  });

  it('recalc ON: pure backfill leaves the linked balance unchanged', async () => {
    const { account, balanceBefore, initialBalanceBefore } = await createLinkedAccountWithBoundaryTx({
      boundaryTime: '2025-12-31T12:00:00Z',
    });

    const fileContent = [
      CSV_HEADER,
      walletRow({
        account: 'Mono UAH',
        currency: 'UAH',
        amount: '1200',
        type: 'Expense',
        date: '2025-06-01T12:00:00.000Z',
        note: 'Old expense',
      }),
      walletRow({
        account: 'Mono UAH',
        currency: 'UAH',
        amount: '700',
        type: 'Income',
        date: '2025-07-01T12:00:00.000Z',
        note: 'Old income',
      }),
    ].join('\n');

    const progress = await runImport({
      fileContent,
      accountMapping: { 'Mono UAH': { action: 'link-existing', accountId: account.id } },
      recalculateBalance: true,
    });
    expectCompleted(progress);
    expect(progress.summary.errors).toHaveLength(0);

    const after = await helpers.getAccount({ id: account.id, raw: true });
    expect(Number(after.currentBalance)).toBe(balanceBefore);
    // Absorption mechanism: the backfilled net (−1200 + 700 = −500) is added
    // back to initialBalance so the written rows leave currentBalance untouched.
    expect(Number(after.initialBalance)).toBe(initialBalanceBefore + 500);

    expect(progress.summary.accountBalanceChanges?.[0]).toMatchObject({
      delta: 0,
      movedCount: 0,
      historicalCount: 2,
      isNewAccount: false,
    });
  });

  it('recalc explicit false: linked balance is preserved for boundary-newer rows, and undo restores the account in both currencies', async () => {
    const { account, balanceBefore } = await createLinkedAccountWithBoundaryTx({
      boundaryTime: '2025-01-10T12:00:00Z',
    });
    const before = await helpers.getAccount({ id: account.id, raw: true });

    const fileContent = [
      CSV_HEADER,
      walletRow({
        account: 'Mono UAH',
        currency: 'UAH',
        amount: '50000',
        type: 'Income',
        date: '2025-06-15T10:00:00.000Z',
        note: 'Newer income',
      }),
    ].join('\n');

    const progress = await runImport({
      fileContent,
      accountMapping: { 'Mono UAH': { action: 'link-existing', accountId: account.id } },
      recalculateBalance: false,
    });
    expectCompleted(progress);
    expect(progress.summary.errors).toHaveLength(0);

    const after = await helpers.getAccount({ id: account.id, raw: true });
    expect(Number(after.currentBalance)).toBe(balanceBefore);

    expect(progress.summary.accountBalanceChanges?.[0]).toMatchObject({
      delta: 0,
      balanceBefore,
      balanceAfter: balanceBefore,
      movedCount: 1,
      historicalCount: 0,
    });

    expect(after.initialBalance).not.toBe(before.initialBalance);

    const { items } = await helpers.getBatchesHistory({ raw: true });
    expect(items).toHaveLength(1);
    const { batchId } = items[0]!;

    const result = await helpers.deleteImportBatch({ batchId, raw: true });
    expect(result.deletedCount).toBe(1);
    expect(await helpers.getTransactions({ batchId, raw: true })).toHaveLength(0);

    expect(await helpers.getAccount({ id: account.id, raw: true })).toMatchObject({
      id: account.id,
      currentBalance: before.currentBalance,
      initialBalance: before.initialBalance,
      refCurrentBalance: before.refCurrentBalance,
      refInitialBalance: before.refInitialBalance,
    });
  });

  it("recalc ON: transfer legs are classified per account against each leg's own boundary", async () => {
    // Source account: boundary AFTER the transfer date → its leg is backfill.
    const source = await createLinkedAccountWithBoundaryTx({ boundaryTime: '2025-08-01T12:00:00Z' });
    // Destination account: no transactions → no boundary → its leg is new.
    const destination = await helpers.createAccount({
      payload: helpers.buildAccountPayload({ currencyCode: 'UAH', name: 'Wallet dest' }),
      raw: true,
    });
    const destinationBefore = Number((await helpers.getAccount({ id: destination.id, raw: true })).currentBalance);

    // Paired transfer: Expense leg on Source + Income leg on Dest, identical
    // timestamp and ref amount (the parser's pairing key).
    const fileContent = [
      CSV_HEADER,
      'Source UAH;Transfer, withdraw;UAH;2100;2100;Expense;Cash;;2025-07-31T13:45:00.000Z;true;;',
      'Dest UAH;Transfer, withdraw;UAH;2100;2100;Income;Cash;;2025-07-31T13:45:00.000Z;true;;',
    ].join('\n');

    const progress = await runImport({
      fileContent,
      accountMapping: {
        'Source UAH': { action: 'link-existing', accountId: source.account.id },
        'Dest UAH': { action: 'link-existing', accountId: destination.id },
      },
      recalculateBalance: true,
    });
    expectCompleted(progress);
    expect(progress.summary.transfersImported).toBe(1);
    expect(progress.summary.errors).toHaveLength(0);

    // Source leg is historical → absorbed; destination leg is new → moves.
    const sourceAfter = await helpers.getAccount({ id: source.account.id, raw: true });
    expect(Number(sourceAfter.currentBalance)).toBe(source.balanceBefore);
    const destinationAfter = await helpers.getAccount({ id: destination.id, raw: true });
    expect(Number(destinationAfter.currentBalance)).toBe(destinationBefore + 2100);

    const changeFor = (accountId: string) =>
      progress.summary.accountBalanceChanges?.find((c) => c.accountId === accountId);
    expect(changeFor(source.account.id)).toMatchObject({ delta: 0, movedCount: 0, historicalCount: 1 });
    expect(changeFor(destination.id)).toMatchObject({ delta: 2100, movedCount: 1, historicalCount: 0 });
  });

  it('recalc ON: a cross-currency transfer moves each leg by its own amount (source ≠ destination)', async () => {
    // A cross-currency transfer records a distinct amount on each side. Both
    // accounts are fresh (no boundary), so both legs are new and move their
    // balance: the source loses its own source amount, the destination gains its
    // own — larger — destination amount. Asserting the exact per-account move
    // catches any regression that swapped the two legs.
    const sourceUsd = await helpers.createAccount({
      payload: helpers.buildAccountPayload({ currencyCode: 'USD', name: 'Wallet src USD' }),
      raw: true,
    });
    const destUah = await helpers.createAccount({
      payload: helpers.buildAccountPayload({ currencyCode: 'UAH', name: 'Wallet dest UAH' }),
      raw: true,
    });
    const sourceBefore = Number((await helpers.getAccount({ id: sourceUsd.id, raw: true })).currentBalance);
    const destBefore = Number((await helpers.getAccount({ id: destUah.id, raw: true })).currentBalance);

    // Paired transfer: Expense leg (USD 410.9) on the source + Income leg
    // (UAH 15000) on the destination, identical timestamp and ref amount (410.9,
    // the pairing key — the two legs share one base-currency value).
    const fileContent = [
      CSV_HEADER,
      'Src USD;Transfer, withdraw;USD;410.9;410.9;Expense;Cash;;2025-07-15T10:00:00.000Z;true;;',
      'Dst UAH;Transfer, withdraw;UAH;15000;410.9;Income;Cash;;2025-07-15T10:00:00.000Z;true;;',
    ].join('\n');

    const progress = await runImport({
      fileContent,
      accountMapping: {
        'Src USD': { action: 'link-existing', accountId: sourceUsd.id },
        'Dst UAH': { action: 'link-existing', accountId: destUah.id },
      },
      recalculateBalance: true,
    });
    expectCompleted(progress);
    expect(progress.summary.transfersImported).toBe(1);
    expect(progress.summary.errors).toHaveLength(0);

    // Source moved by exactly −410.9 (USD); destination by exactly +15000 (UAH).
    const sourceAfter = await helpers.getAccount({ id: sourceUsd.id, raw: true });
    expect(Number(sourceAfter.currentBalance)).toBe(sourceBefore - 410.9);
    const destAfter = await helpers.getAccount({ id: destUah.id, raw: true });
    expect(Number(destAfter.currentBalance)).toBe(destBefore + 15000);

    const changeFor = (accountId: string) =>
      progress.summary.accountBalanceChanges?.find((c) => c.accountId === accountId);
    expect(changeFor(sourceUsd.id)).toMatchObject({ delta: -410.9, movedCount: 1, historicalCount: 0 });
    expect(changeFor(destUah.id)).toMatchObject({ delta: 15000, movedCount: 1, historicalCount: 0 });
  });

  it('recalc ON: an out-of-wallet leg newer than the boundary moves the linked balance by its signed amount', async () => {
    const { account, balanceBefore } = await createLinkedAccountWithBoundaryTx({
      boundaryTime: '2025-06-01T12:00:00Z',
    });

    // A lone transfer leg with no counterpart imports as an out-of-wallet
    // transaction; dated after the boundary it is `new`, so recalc ON moves the
    // balance by its signed amount (Expense → negative).
    const fileContent = [
      CSV_HEADER,
      'Mono UAH;Transfer, withdraw;UAH;800;800;Expense;Cash;;2025-06-15T10:00:00.000Z;true;;',
    ].join('\n');

    const progress = await runImport({
      fileContent,
      accountMapping: { 'Mono UAH': { action: 'link-existing', accountId: account.id } },
      recalculateBalance: true,
    });
    expectCompleted(progress);
    expect(progress.summary.outOfWalletImported).toBe(1);
    expect(progress.summary.errors).toHaveLength(0);

    const after = await helpers.getAccount({ id: account.id, raw: true });
    expect(Number(after.currentBalance)).toBe(balanceBefore - 800);

    expect(progress.summary.accountBalanceChanges?.[0]).toMatchObject({
      delta: -800,
      movedCount: 1,
      historicalCount: 0,
      isNewAccount: false,
    });
  });

  it('recalc OFF: an out-of-wallet leg preserves the linked balance', async () => {
    const { account, balanceBefore } = await createLinkedAccountWithBoundaryTx({
      boundaryTime: '2025-06-01T12:00:00Z',
    });

    const fileContent = [
      CSV_HEADER,
      'Mono UAH;Transfer, withdraw;UAH;800;800;Expense;Cash;;2025-06-15T10:00:00.000Z;true;;',
    ].join('\n');

    const progress = await runImport({
      fileContent,
      accountMapping: { 'Mono UAH': { action: 'link-existing', accountId: account.id } },
      recalculateBalance: false,
    });
    expectCompleted(progress);
    expect(progress.summary.outOfWalletImported).toBe(1);
    expect(progress.summary.errors).toHaveLength(0);

    const after = await helpers.getAccount({ id: account.id, raw: true });
    expect(Number(after.currentBalance)).toBe(balanceBefore);

    expect(progress.summary.accountBalanceChanges?.[0]).toMatchObject({
      delta: 0,
      movedCount: 1,
      historicalCount: 0,
    });
  });

  it('created accounts appear in accountBalanceChanges with their final balance', async () => {
    const fileContent = [
      CSV_HEADER,
      walletRow({
        account: 'Targeted UAH',
        currency: 'UAH',
        amount: '1200',
        type: 'Expense',
        date: '2025-06-01T12:00:00.000Z',
        note: 'Lunch',
      }),
      walletRow({
        account: 'Untargeted UAH',
        currency: 'UAH',
        amount: '700',
        type: 'Income',
        date: '2025-06-02T12:00:00.000Z',
        note: 'Refund',
      }),
    ].join('\n');

    const progress = await runImport({
      fileContent,
      accountMapping: {
        // Entered current balance forces the final value (imported rows are
        // absorbed into initialBalance).
        'Targeted UAH': { action: 'create-new', currencyCode: 'UAH', currentBalance: 5000.5 },
        // Null target leaves the balance at Σ(imported rows).
        'Untargeted UAH': { action: 'create-new', currencyCode: 'UAH', currentBalance: null },
      },
      recalculateBalance: true,
    });
    expectCompleted(progress);
    expect(progress.summary.accountsCreated).toBe(2);
    expect(progress.summary.errors).toHaveLength(0);

    const accounts = await helpers.getAccounts();
    const targeted = accounts.find((a) => a.name === 'Targeted UAH')!;
    const untargeted = accounts.find((a) => a.name === 'Untargeted UAH')!;

    // Created accounts carry no balanceBefore/delta — there is no pre-import
    // balance to compare against, so each entry is the final balance + counts.
    const changeFor = (accountId: string) =>
      progress.summary.accountBalanceChanges?.find((c) => c.accountId === accountId);
    expect(changeFor(targeted.id)).toEqual({
      accountId: targeted.id,
      accountName: 'Targeted UAH',
      balanceAfter: 5000.5,
      movedCount: 1,
      historicalCount: 0,
      isNewAccount: true,
    });
    expect(changeFor(untargeted.id)).toEqual({
      accountId: untargeted.id,
      accountName: 'Untargeted UAH',
      balanceAfter: 700,
      movedCount: 1,
      historicalCount: 0,
      isNewAccount: true,
    });
  });

  it('recalc ON: skipped duplicate rows contribute nothing to the recalculated balance', async () => {
    const { account } = await createLinkedAccountWithBoundaryTx({ boundaryTime: '2025-06-01T12:00:00Z' });
    const accountMapping = { 'Mono UAH': { action: 'link-existing' as const, accountId: account.id } };

    const dupRow = walletRow({
      account: 'Mono UAH',
      currency: 'UAH',
      amount: '1200',
      type: 'Expense',
      date: '2025-06-05T12:00:00.000Z',
      note: 'Duplicated lunch',
    });

    // Import only the duplicate-to-be, then let duplicate detection flag it
    // against the full file — the genuine skip flow the wizard drives.
    const first = await runImport({
      fileContent: [CSV_HEADER, dupRow].join('\n'),
      accountMapping,
      recalculateBalance: true,
    });
    expectCompleted(first);
    expect(first.summary.transactionsImported).toBe(1);
    const balanceAfterFirst = Number((await helpers.getAccount({ id: account.id, raw: true })).currentBalance);

    const fullFile = [
      CSV_HEADER,
      dupRow,
      walletRow({
        account: 'Mono UAH',
        currency: 'UAH',
        amount: '700',
        type: 'Income',
        date: '2025-06-15T10:00:00.000Z',
        note: 'Fresh income',
      }),
    ].join('\n');

    const { duplicates } = await helpers.detectBudgetBakersWalletDuplicates({
      payload: { fileContent: fullFile, accountMapping },
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
    expectCompleted(progress);
    expect(progress.summary.transactionsImported).toBe(1);
    expect(progress.summary.duplicatesSkipped).toBe(1);
    expect(progress.summary.errors).toHaveLength(0);

    // Only the non-skipped income row moves the balance.
    const after = await helpers.getAccount({ id: account.id, raw: true });
    expect(Number(after.currentBalance)).toBe(balanceAfterFirst + 700);

    expect(progress.summary.accountBalanceChanges).toHaveLength(1);
    expect(progress.summary.accountBalanceChanges?.[0]).toMatchObject({
      balanceBefore: balanceAfterFirst,
      balanceAfter: balanceAfterFirst + 700,
      delta: 700,
      movedCount: 1,
      historicalCount: 0,
      isNewAccount: false,
    });
  });

  it('rejects a create-new currentBalance beyond the integer-cents cap with 422 on both signs', async () => {
    // The bound is symmetric: a target past ±20,000,000 fails Zod validation
    // synchronously with 422 and never enqueues a job.
    const fileContent = [
      CSV_HEADER,
      walletRow({
        account: 'Big UAH',
        currency: 'UAH',
        amount: '100',
        type: 'Income',
        date: '2025-06-01T12:00:00.000Z',
        note: 'Salary',
      }),
    ].join('\n');

    for (const currentBalance of [20_000_001, -20_000_001]) {
      const response = await helpers.executeBudgetBakersWallet({
        payload: {
          fileContent,
          accountMapping: {
            'Big UAH': { action: 'create-new', currencyCode: 'UAH', currentBalance },
          },
        },
        raw: false,
      });

      expect(response.statusCode).toBe(ERROR_CODES.ValidationError);
    }
  });

  it('accepts a create-new currentBalance exactly on the integer-cents cap (both signs)', async () => {
    // The cap is inclusive: ±20,000,000 is the last accepted value, so the
    // import must run to completion and leave each account on its exact
    // boundary balance.
    const positiveName = 'Boundary UAH 20000000';
    const negativeName = 'Boundary UAH -20000000';
    const fileContent = [
      CSV_HEADER,
      walletRow({
        account: positiveName,
        currency: 'UAH',
        amount: '100',
        type: 'Income',
        date: '2025-06-01T12:00:00.000Z',
        note: 'Salary',
      }),
      walletRow({
        account: negativeName,
        currency: 'UAH',
        amount: '100',
        type: 'Income',
        date: '2025-06-01T12:00:00.000Z',
        note: 'Salary',
      }),
    ].join('\n');

    const progress = await runImport({
      fileContent,
      accountMapping: {
        [positiveName]: { action: 'create-new', currencyCode: 'UAH', currentBalance: 20_000_000 },
        [negativeName]: { action: 'create-new', currencyCode: 'UAH', currentBalance: -20_000_000 },
      },
      recalculateBalance: true,
    });
    expectCompleted(progress);
    expect(progress.summary.accountsCreated).toBe(2);
    expect(progress.summary.errors).toHaveLength(0);

    const accounts = await helpers.getAccounts();
    // The imported +100 income is absorbed into initialBalance so currentBalance
    // lands exactly on the entered boundary value.
    for (const [name, currentBalance] of [
      [positiveName, 20_000_000],
      [negativeName, -20_000_000],
    ] as const) {
      const created = accounts.find((a) => a.name === name)!;
      expect(created).toBeDefined();
      expect(Number(created.currentBalance)).toBe(currentBalance);
    }
  });

  it('recalc ON: a row that fails at the database layer is excluded from the balance and reported in errors', async () => {
    const { account, balanceBefore } = await createLinkedAccountWithBoundaryTx({
      boundaryTime: '2025-06-01T12:00:00Z',
    });

    // The middle row's amount overflows the BIGINT cents column (1e17 currency
    // units → 1e19 cents, past the BIGINT max of 9,223,372,036,854,775,807), so
    // its insert fails at the database layer and rolls back only itself — the
    // surrounding rows on the same account still commit. All three rows are
    // newer than the boundary, so the two survivors move the balance.
    const fileContent = [
      CSV_HEADER,
      walletRow({
        account: 'Mono UAH',
        currency: 'UAH',
        amount: '100',
        type: 'Expense',
        date: '2025-06-15T10:00:00.000Z',
        note: 'Good row before',
      }),
      walletRow({
        account: 'Mono UAH',
        currency: 'UAH',
        amount: '100000000000000000',
        type: 'Income',
        date: '2025-06-16T10:00:00.000Z',
        note: 'Overflow row',
      }),
      walletRow({
        account: 'Mono UAH',
        currency: 'UAH',
        amount: '300',
        type: 'Income',
        date: '2025-06-17T10:00:00.000Z',
        note: 'Good row after',
      }),
    ].join('\n');

    const progress = await runImport({
      fileContent,
      accountMapping: { 'Mono UAH': { action: 'link-existing', accountId: account.id } },
      recalculateBalance: true,
    });
    expectCompleted(progress);

    expect(progress.summary.transactionsImported).toBe(2);
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

  it('fails the import when link-existing targets a vehicle or a loan account', async () => {
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
    // LoanApiResponse extends the account response — `loan.id` IS the account id.
    const loan = await helpers.createLoan({ payload: helpers.buildCreateLoanPayload(), raw: true });

    const buildFile = ({ account }: { account: string }) =>
      [
        CSV_HEADER,
        walletRow({
          account,
          currency: 'USD',
          amount: '100',
          type: 'Income',
          date: '2025-06-01T12:00:00.000Z',
          note: 'Payment',
        }),
      ].join('\n');

    const vehicleProgress = await runImport({
      fileContent: buildFile({ account: 'Car USD' }),
      accountMapping: { 'Car USD': { action: 'link-existing', accountId: vehicle.accountId } },
      recalculateBalance: true,
    });

    expect(vehicleProgress.status).toBe('failed');
    if (vehicleProgress.status === 'failed') {
      expect(vehicleProgress.error).toContain('cannot be an import target');
    }

    // The vehicle's managed balance must be untouched.
    const after = await helpers.getAccount({ id: vehicle.accountId, raw: true });
    expect(Number(after.currentBalance)).toBe(balanceBefore);

    const loanProgress = await runImport({
      fileContent: buildFile({ account: 'Loan USD' }),
      accountMapping: { 'Loan USD': { action: 'link-existing', accountId: loan.id } },
      recalculateBalance: true,
    });

    expect(loanProgress.status).toBe('failed');
    if (loanProgress.status === 'failed') {
      expect(loanProgress.error).toContain('cannot be an import target');
    }
  }, 30_000);
});
