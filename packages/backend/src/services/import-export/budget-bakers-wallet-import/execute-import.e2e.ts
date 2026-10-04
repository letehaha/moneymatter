import { type BudgetBakersWalletAccountMapping, TRANSACTION_TRANSFER_NATURE } from '@bt/shared/types';
import { generateRandomRecordId } from '@common/lib/record-id-helpers';
import { describe, expect, it } from '@jest/globals';
import { ERROR_CODES } from '@js/errors';
import * as helpers from '@tests/helpers';
import { expectCompleted, waitForBudgetBakersWalletCompletion } from '@tests/helpers/import-export';
import { asUser, provisionSecondUserWithBaseCurrency, signUpSecondUser } from '@tests/helpers/share';

// ---------------------------------------------------------------------------
// Helpers for building account mappings
// ---------------------------------------------------------------------------

/**
 * Parse the fixture and build a `create-new` mapping for every account in it,
 * using the currency detected by the parser. This is the "all new accounts"
 * default used by most tests.
 */
async function buildCreateNewMappingFromFixture({ fileContent }: { fileContent: string }) {
  const { result } = await helpers.parseBudgetBakersWallet({ payload: { fileContent }, raw: true });
  const accountMapping = Object.fromEntries(
    result.accounts.map((a) => [
      a.originalName,
      { action: 'create-new' as const, currencyCode: a.currency, currentBalance: null },
    ]),
  );
  return { parsed: result, accountMapping };
}

async function buildMappingWithSkippedAccounts({
  fileContent,
  skippedAccountNames,
}: {
  fileContent: string;
  skippedAccountNames: string[];
}) {
  const { parsed, accountMapping } = await buildCreateNewMappingFromFixture({ fileContent });
  const skipped = new Set(skippedAccountNames);
  const mapping: BudgetBakersWalletAccountMapping = Object.fromEntries(
    Object.entries(accountMapping).map(([name, value]) => [name, skipped.has(name) ? { action: 'skip' } : value]),
  );
  return { parsed, accountMapping: mapping };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Execute Budget Bakers Wallet import endpoint', () => {
  /**
   * Happy path: import the multi-currency fixture with all accounts as
   * `create-new`. Verifies summary counts, transfer linking, out-of-wallet
   * nature, ordinary transaction sign/datetime preservation.
   *
   * Fixture breakdown (multi-currency.csv):
   *   Ordinary transactions (transfer=false): 4 rows
   *     - Monobank UAH: -1200 (expense, "Weekly shop")
   *     - Monobank UAH: +50000 (income, "December salary")
   *     - PKO USD: +500 (income, "Project payment")
   *     - PKO USD: -4.5 (expense, "Morning coffee")
   *   Transfer legs (transfer=true): 5 rows → 2 matched pairs + 1 lone leg
   *     - Pair 1: Crypto USD → Wise USD (same ccy, same ref, same timestamp)
   *     - Pair 2: PKO USD → PKO PLN (cross-ccy, same ref amount)
   *     - Lone: Monobank UAH expense (no matching income counterpart)
   *   Tags: "Travel" (2 rows), "Refund" (1 row) → 2 distinct tags. These are
   *     deliberately NOT the seeded default tag names (Want/Need/Must), so the
   *     import genuinely creates them and `tagsCreated` is 2 rather than 0
   *     (find-or-create reuses any same-named existing tag).
   *   Accounts: Monobank UAH, PKO USD, Crypto USD, Wise USD, PKO PLN → 5
   */
  it('imports the multi-currency fixture end-to-end: counts, transfer link, out-of-wallet, datetime', async () => {
    const fileContent = helpers.loadBudgetBakersWalletFixture('multi-currency.csv');
    const { accountMapping } = await buildCreateNewMappingFromFixture({ fileContent });

    const { jobId } = await helpers.executeBudgetBakersWallet({
      payload: { fileContent, accountMapping, skipDuplicateIndices: [] },
      raw: true,
    });
    expect(jobId).toBeTruthy();

    const progress = await waitForBudgetBakersWalletCompletion({ jobId });
    expectCompleted(progress);
    const { summary } = progress;

    expect(summary.accountsCreated).toBe(5);
    expect(summary.accountsLinked).toBe(0);
    expect(summary.transactionsImported).toBe(4);
    expect(summary.transfersImported).toBe(2);
    expect(summary.outOfWalletImported).toBe(1);
    expect(summary.tagsCreated).toBe(2);
    expect(summary.duplicatesSkipped).toBe(0);
    expect(summary.errors).toHaveLength(0);

    // --- Transfer pair linked via shared transferId ---
    const transactionsAfter = await helpers.getTransactions({ raw: true });

    // Both fixture transfer pairs (Crypto→Wise same-currency, PKO USD→PKO PLN
    // cross-currency) carry empty notes and land as common_transfer, so 2 pairs
    // must produce exactly 4 note-free common_transfer legs. The lone unpaired
    // Monobank leg is transfer_out_wallet, so it is excluded by this filter.
    const commonTransferLegs = transactionsAfter.filter(
      (t) => t.transferNature === TRANSACTION_TRANSFER_NATURE.common_transfer && t.note === '',
    );
    expect(commonTransferLegs).toHaveLength(4);

    // Isolate the Crypto→Wise pair by account name to assert the shared transferId.
    const accountsAfter = await helpers.getAccounts();
    const cryptoAccount = accountsAfter.find((a) => a.name === 'Crypto USD')!;
    const wiseAccount = accountsAfter.find((a) => a.name === 'Wise USD')!;

    const cryptoLeg = transactionsAfter.find(
      (t) => t.accountId === cryptoAccount.id && t.transferNature === TRANSACTION_TRANSFER_NATURE.common_transfer,
    );
    const wiseLeg = transactionsAfter.find(
      (t) => t.accountId === wiseAccount.id && t.transferNature === TRANSACTION_TRANSFER_NATURE.common_transfer,
    );
    expect(cryptoLeg).toBeDefined();
    expect(wiseLeg).toBeDefined();
    expect(cryptoLeg!.transferId).toBeTruthy();
    // Both legs of the same transfer must share one transferId.
    expect(cryptoLeg!.transferId).toBe(wiseLeg!.transferId);
    expect(cryptoLeg!.accountId).not.toBe(wiseLeg!.accountId);

    // Verify the transferId endpoint returns exactly these two legs.
    const linkedPair = await helpers.getTransactionsByTransferId({
      transferId: cryptoLeg!.transferId!,
      raw: true,
    });
    expect(linkedPair).toHaveLength(2);

    // --- Cross-currency pair keeps a distinct amount per leg ---
    const pkoUsd = accountsAfter.find((a) => a.name === 'PKO USD')!;
    const pkoPln = accountsAfter.find((a) => a.name === 'PKO PLN')!;
    const pkoUsdLeg = transactionsAfter.find(
      (t) => t.accountId === pkoUsd.id && t.transferNature === TRANSACTION_TRANSFER_NATURE.common_transfer,
    );
    const pkoPlnLeg = transactionsAfter.find(
      (t) => t.accountId === pkoPln.id && t.transferNature === TRANSACTION_TRANSFER_NATURE.common_transfer,
    );
    expect(pkoUsdLeg).toBeDefined();
    expect(pkoPlnLeg).toBeDefined();
    expect(Number(pkoUsdLeg!.amount)).toBe(410.9);
    expect(Number(pkoPlnLeg!.amount)).toBe(1484.2);
    expect(pkoUsdLeg!.transferId).toBeTruthy();
    expect(pkoUsdLeg!.transferId).toBe(pkoPlnLeg!.transferId);

    // --- Lone transfer leg imported as out-of-wallet ---
    const outOfWalletLegs = transactionsAfter.filter(
      (t) => t.transferNature === TRANSACTION_TRANSFER_NATURE.transfer_out_wallet,
    );
    expect(outOfWalletLegs).toHaveLength(1);
    // The lone leg is the Monobank UAH expense with no counterpart income.
    const monobankAccount = accountsAfter.find((a) => a.name === 'Monobank UAH')!;
    expect(outOfWalletLegs[0]!.accountId).toBe(monobankAccount.id);

    // --- Ordinary income transaction: sign + full datetime preserved ---
    // "December salary" is Income → positive amount; time must preserve
    // the full ISO instant (10:00 UTC), not be truncated to midnight.
    const salary = transactionsAfter.find((t) => t.note === 'December salary');
    expect(salary).toBeDefined();
    expect(salary!.transactionType).toBe('income');
    expect(Number(salary!.amount)).toBe(50000);
    // The time stored by createTransaction is the exact ISO instant passed in.
    // Wallet exports ISO-8601 with ms — the executor must pass it through as-is.
    const salaryDate = new Date(salary!.time);
    expect(salaryDate.getUTCHours()).toBe(10);
    expect(salaryDate.getUTCMinutes()).toBe(0);

    // --- Ordinary expense transaction: negative sign ---
    const coffee = transactionsAfter.find((t) => t.note === 'Morning coffee');
    expect(coffee).toBeDefined();
    expect(coffee!.transactionType).toBe('expense');
    // API returns decimals; amount stored as absolute value on the record
    // (transactionType carries the sign semantics).
    expect(Number(coffee!.amount)).toBe(4.5);
  });

  /**
   * New-account balance plug: when the user supplies a `currentBalance` on a
   * `create-new` mapping, the imported account's balance must equal exactly
   * that value after the job completes — regardless of what the imported
   * transactions sum to.
   *
   * The execute service achieves this by calling `updateAccount` with the
   * target `currentBalance` after all transactions are written, which
   * back-adjusts `initialBalance` so the app invariant holds.
   */
  it('sets the new-account currentBalance to the user-supplied value after import', async () => {
    // Use a minimal, single-account fixture so the setup is simple.
    const fileContent = helpers.loadBudgetBakersWalletFixture('basic.csv');
    const { result } = await helpers.parseBudgetBakersWallet({ payload: { fileContent }, raw: true });

    // Find the first account (Monobank Black UAH) and supply an explicit target.
    const firstAccount = result.accounts[0]!;
    const targetBalance = 99999.99;

    const accountMapping = Object.fromEntries(
      result.accounts.map((a) => [
        a.originalName,
        {
          action: 'create-new' as const,
          currencyCode: a.currency,
          // Only the first account gets a non-null balance target.
          currentBalance: a.originalName === firstAccount.originalName ? targetBalance : null,
        },
      ]),
    );

    const { jobId } = await helpers.executeBudgetBakersWallet({
      payload: { fileContent, accountMapping, skipDuplicateIndices: [] },
      raw: true,
    });
    expect(jobId).toBeTruthy();
    const progress = await waitForBudgetBakersWalletCompletion({ jobId });
    expectCompleted(progress);
    expect(progress.summary.errors).toHaveLength(0);

    // Fetch the newly created account and confirm its balance is the target.
    const accountsAfter = await helpers.getAccounts();
    const importedAccount = accountsAfter.find((a) => a.name === firstAccount.originalName)!;
    expect(importedAccount).toBeDefined();
    // API returns decimals; Money.toJSON() emits the decimal string.
    expect(Number(importedAccount.currentBalance)).toBe(targetBalance);
  });

  /**
   * New-account blank balance: when `currentBalance` is `null` in the mapping,
   * the account's balance after import must equal the net sum of its imported
   * transactions (no back-adjustment is applied).
   *
   * We use a tiny inline fixture with a single expense row so the arithmetic is
   * trivial to verify: one expense of 1200 → net = -1200 (negative balance).
   */
  it('leaves the new-account currentBalance at the transaction net sum when currentBalance is null', async () => {
    // Single-account single-expense CSV: after import, balance = -1200 UAH.
    const fileContent = [
      'account;category;currency;amount;ref_currency_amount;type;payment_type;note;date;transfer;payee;labels',
      'TestAccount UAH;Food;UAH;1200;1200;Expense;Credit card;Lunch;2025-06-01T12:00:00.000Z;false;;',
    ].join('\n');

    const accountMapping = {
      'TestAccount UAH': { action: 'create-new' as const, currencyCode: 'UAH', currentBalance: null },
    };

    const { jobId } = await helpers.executeBudgetBakersWallet({
      payload: { fileContent, accountMapping, skipDuplicateIndices: [] },
      raw: true,
    });
    expect(jobId).toBeTruthy();
    const progress = await waitForBudgetBakersWalletCompletion({ jobId });
    expectCompleted(progress);
    expect(progress.summary.errors).toHaveLength(0);
    expect(progress.summary.transactionsImported).toBe(1);

    const accountsAfter = await helpers.getAccounts();
    const account = accountsAfter.find((a) => a.name === 'TestAccount UAH')!;
    expect(account).toBeDefined();
    // initialBalance starts at 0; one -1200 expense makes currentBalance -1200.
    expect(Number(account.currentBalance)).toBe(-1200);

    const { items } = await helpers.getBatchesHistory({ raw: true });
    expect(items).toEqual([expect.objectContaining({ createdAccountCount: 1 })]);

    await helpers.deleteImportBatch({ batchId: items[0]!.batchId, raw: true });
    expect((await helpers.getAccounts()).some((a) => a.id === account.id)).toBe(false);
  });

  /**
   * Link-existing keeps balance: when a Wallet account maps to `link-existing`,
   * the execute step must preserve the pre-import `currentBalance` of that
   * account regardless of what rows are imported.
   *
   * Mechanism: the executor captures the existing account's balance before
   * writing any rows, then calls `updateAccount` with that value afterwards,
   * which back-adjusts `initialBalance` so the final `currentBalance` is
   * unchanged.
   */
  it('preserves the linked account currentBalance after back-filling imported transactions', async () => {
    // Create an account via the API so it has a known balance and a couple of
    // pre-existing transactions that must stay intact.
    const existing = await helpers.createAccount({
      payload: helpers.buildAccountPayload({ currencyCode: 'UAH', initialBalance: 10000 }),
      raw: true,
    });
    // Add two pre-existing transactions so the account has a real history.
    await helpers.createTransaction({
      payload: helpers.buildTransactionPayload({ accountId: existing.id, amount: 500 }),
      raw: true,
    });
    await helpers.createTransaction({
      payload: helpers.buildTransactionPayload({ accountId: existing.id, amount: 300 }),
      raw: true,
    });

    // Record the account's currentBalance now; the import must not change it.
    const accountBefore = await helpers.getAccount({ id: existing.id, raw: true });
    const balanceBefore = Number(accountBefore.currentBalance);

    const fileContent = [
      'account;category;currency;amount;ref_currency_amount;type;payment_type;note;date;transfer;payee;labels',
      'Monobank UAH;Groceries;UAH;1200;1200;Expense;Credit card;Linked import;2025-06-01T12:00:00.000Z;false;;',
      'Monobank UAH;Salary;UAH;50000;50000;Income;Cash;Linked income;2025-06-02T10:00:00.000Z;false;;',
    ].join('\n');

    const accountMapping = {
      'Monobank UAH': { action: 'link-existing' as const, accountId: existing.id },
    };

    const { jobId } = await helpers.executeBudgetBakersWallet({
      payload: { fileContent, accountMapping, skipDuplicateIndices: [] },
      raw: true,
    });
    expect(jobId).toBeTruthy();
    const progress = await waitForBudgetBakersWalletCompletion({ jobId });
    expectCompleted(progress);
    expect(progress.summary.accountsCreated).toBe(0);
    expect(progress.summary.accountsLinked).toBe(1);
    expect(progress.summary.errors).toHaveLength(0);

    // The linked account's balance must be exactly what it was before the import.
    const accountAfter = await helpers.getAccount({ id: existing.id, raw: true });
    expect(Number(accountAfter.currentBalance)).toBe(balanceBefore);

    // The imported transactions must now exist on the account (history back-fill).
    const txs = await helpers.getTransactions({ raw: true });
    const importedTxNotes = txs.map((t) => t.note);
    expect(importedTxNotes).toContain('Linked import');
    expect(importedTxNotes).toContain('Linked income');
  });

  /**
   * Duplicate detection + skip on re-import into a linked account: after
   * importing once, a second call to POST /detect-duplicates must surface the
   * already-imported rows as duplicates. Re-running execute with those indices
   * in `skipDuplicateIndices` must not create the transactions a second time.
   *
   * `summary.duplicatesSkipped` must equal the number of rows skipped.
   */
  it('detects and skips duplicates on a second import into a linked account', async () => {
    // Create the target account.
    const existing = await helpers.createAccount({
      payload: helpers.buildAccountPayload({ currencyCode: 'UAH', initialBalance: 0 }),
      raw: true,
    });

    const fileContent = [
      'account;category;currency;amount;ref_currency_amount;type;payment_type;note;date;transfer;payee;labels',
      'My UAH;Food;UAH;1200;1200;Expense;Credit card;First import;2025-06-01T12:00:00.000Z;false;;',
      'My UAH;Salary;UAH;50000;50000;Income;Cash;Second import;2025-06-02T10:00:00.000Z;false;;',
    ].join('\n');

    const accountMapping = {
      'My UAH': { action: 'link-existing' as const, accountId: existing.id },
    };

    // First import: no known duplicates yet.
    const { jobId: firstJobId } = await helpers.executeBudgetBakersWallet({
      payload: { fileContent, accountMapping, skipDuplicateIndices: [] },
      raw: true,
    });
    expect(firstJobId).toBeTruthy();
    const firstProgress = await waitForBudgetBakersWalletCompletion({ jobId: firstJobId });
    expectCompleted(firstProgress);
    expect(firstProgress.summary.transactionsImported).toBe(2);

    // Now detect duplicates against the linked account — both rows must match.
    const { duplicates } = await helpers.detectBudgetBakersWalletDuplicates({
      payload: { fileContent, accountMapping },
      raw: true,
    });
    // The fixture has exactly 2 rows, both were imported, so both must be detected.
    expect(duplicates.length).toBe(2);

    // Collect the row indices to skip.
    const skipDuplicateIndices = duplicates.map((d) => d.rowIndex);

    // Second import: skip all detected duplicates.
    const { jobId: secondJobId } = await helpers.executeBudgetBakersWallet({
      payload: { fileContent, accountMapping, skipDuplicateIndices },
      raw: true,
    });
    expect(secondJobId).toBeTruthy();
    const secondProgress = await waitForBudgetBakersWalletCompletion({ jobId: secondJobId });
    expectCompleted(secondProgress);

    // None of the skipped rows should have been imported again.
    expect(secondProgress.summary.transactionsImported).toBe(0);
    expect(secondProgress.summary.duplicatesSkipped).toBe(skipDuplicateIndices.length);

    // Total transaction count on the account must still be 2, not 4.
    const txs = await helpers.getTransactions({ raw: true });
    const accountTxs = txs.filter((t) => t.accountId === existing.id);
    expect(accountTxs).toHaveLength(2);
  });

  /**
   * Missing account mapping causes the worker job to fail. The execute
   * controller enqueues immediately (returns `{ jobId }`), but the worker
   * validates the mapping before writing any rows. When an account in the CSV
   * has no entry in `accountMapping`, the job must end in `failed` status with
   * an informative error string.
   */
  it('fails the worker job when accountMapping omits an account the parser found', async () => {
    const fileContent = helpers.loadBudgetBakersWalletFixture('basic.csv');
    const { result } = await helpers.parseBudgetBakersWallet({ payload: { fileContent }, raw: true });

    // Drop the last account from the mapping so one is orphaned.
    const incomplete = Object.fromEntries(
      result.accounts
        .slice(0, result.accounts.length - 1)
        .map((a) => [
          a.originalName,
          { action: 'create-new' as const, currencyCode: a.currency, currentBalance: null },
        ]),
    );

    const { jobId } = await helpers.executeBudgetBakersWallet({
      payload: { fileContent, accountMapping: incomplete, skipDuplicateIndices: [] },
      raw: true,
    });
    const progress = await waitForBudgetBakersWalletCompletion({ jobId });
    expect(progress.status).toBe('failed');
    if (progress.status !== 'failed') throw new Error('unreachable');
    expect(progress.error).toMatch(/Missing account mapping/i);
  });

  /**
   * AuthZ: a different user must not be able to read another user's job status.
   * The status controller returns 404 (not 200 with someone else's data) when
   * the requesting user does not own the job.
   */
  it("refuses to leak another user's job status (cross-user authZ)", async () => {
    const fileContent = helpers.loadBudgetBakersWalletFixture('basic.csv');
    const { accountMapping } = await buildCreateNewMappingFromFixture({ fileContent });

    // User A enqueues a job — we do not wait for it to finish because the status
    // row is visible in the queue the moment the job is enqueued.
    const { jobId } = await helpers.executeBudgetBakersWallet({
      payload: { fileContent, accountMapping, skipDuplicateIndices: [] },
      raw: true,
    });

    // User B signs up and tries to poll the same jobId.
    const otherUser = await signUpSecondUser();
    const statusAsOther = await asUser({
      cookies: otherUser.cookies,
      fn: () => helpers.getBudgetBakersWalletImportStatus({ jobId }),
    });
    expect(statusAsOther.statusCode).toBe(ERROR_CODES.NotFoundError);
  });

  /**
   * GET /status/:jobId with an unknown jobId returns 404.
   */
  it('returns 404 for an unknown job id', async () => {
    const response = await helpers.getBudgetBakersWalletImportStatus({ jobId: 'no-such-wallet-job' });
    expect(response.statusCode).toBe(404);
  });

  // ---------------------------------------------------------------------------
  // Category-mapping tests
  // ---------------------------------------------------------------------------

  /**
   * category create-new: a category present in the CSV and mapped to
   * `{ action: 'create-new' }` must be created by the worker, increment
   * `summary.categoriesCreated`, and the created category must be visible via
   * the categories endpoint.
   *
   * Fixture: a single ordinary expense row with a unique generated category
   * name that is guaranteed not to collide with any seeded default category
   * (the shared resolver does a case-insensitive find-or-create, so using a
   * seeded default name like "Groceries" would reuse the existing category and
   * never increment categoriesCreated).
   */
  it('category create-new: creates the category and increments categoriesCreated', async () => {
    const newCatName = `Wallet Cat ${generateRandomRecordId()}`;

    const fileContent = [
      'account;category;currency;amount;ref_currency_amount;type;payment_type;note;date;transfer;payee;labels',
      `TestAcc UAH;${newCatName};UAH;500;500;Expense;Credit card;Cat create test;2025-06-01T12:00:00.000Z;false;;`,
    ].join('\n');

    const accountMapping = {
      'TestAcc UAH': { action: 'create-new' as const, currencyCode: 'UAH', currentBalance: null },
    };
    const categoryMapping = {
      [newCatName]: { action: 'create-new' as const },
    };

    const categoriesBefore = await helpers.getCategoriesList();

    const { jobId } = await helpers.executeBudgetBakersWallet({
      payload: { fileContent, accountMapping, categoryMapping, skipDuplicateIndices: [] },
      raw: true,
    });
    const progress = await waitForBudgetBakersWalletCompletion({ jobId });
    expectCompleted(progress);

    expect(progress.summary.categoriesCreated).toBe(1);
    expect(progress.summary.transactionsImported).toBe(1);
    expect(progress.summary.errors).toHaveLength(0);

    // The category must now exist via the categories endpoint.
    const categoriesAfter = await helpers.getCategoriesList();
    expect(categoriesAfter.length).toBe(categoriesBefore.length + 1);
    const created = categoriesAfter.find((c) => c.name === newCatName);
    expect(created).toBeDefined();

    // The imported transaction must carry the newly created category.
    const txs = await helpers.getTransactions({ raw: true });
    const imported = txs.find((t) => t.note === 'Cat create test');
    expect(imported).toBeDefined();
    expect(imported!.categoryId).toBe(created!.id);
  });

  /**
   * category link-existing: pre-create a category via the API, map the CSV
   * category name to `{ action: 'link-existing', categoryId }`. The worker
   * must NOT create a new category (`categoriesCreated` stays 0), and the
   * imported transaction must carry the pre-existing category id.
   *
   * A unique generated name is used to avoid colliding with seeded defaults
   * (the resolver's case-insensitive find-or-create would silently reuse an
   * existing category if "Salary" or another default name were used, and the
   * returned id might differ from the one we expect).
   */
  it('category link-existing: reuses the pre-existing category without creating a new one', async () => {
    const existingCatName = `Wallet Link Cat ${generateRandomRecordId()}`;

    // Pre-create the category the CSV will reference. color is required for the
    // POST /categories endpoint to return a valid CategoryModel with an id.
    const existingCategory = await helpers.addCustomCategory({
      name: existingCatName,
      color: '#AA3366',
      raw: true,
    });
    expect(existingCategory.id).toBeTruthy();

    const fileContent = [
      'account;category;currency;amount;ref_currency_amount;type;payment_type;note;date;transfer;payee;labels',
      `TestAcc USD;${existingCatName};USD;3000;3000;Income;Cash;Cat link test;2025-06-05T09:00:00.000Z;false;;`,
    ].join('\n');

    const accountMapping = {
      'TestAcc USD': { action: 'create-new' as const, currencyCode: 'USD', currentBalance: null },
    };
    const categoryMapping = {
      [existingCatName]: { action: 'link-existing' as const, categoryId: existingCategory.id },
    };

    const categoriesBefore = await helpers.getCategoriesList();

    const { jobId } = await helpers.executeBudgetBakersWallet({
      payload: { fileContent, accountMapping, categoryMapping, skipDuplicateIndices: [] },
      raw: true,
    });
    expect(jobId).toBeTruthy();

    const progress = await waitForBudgetBakersWalletCompletion({ jobId });
    expectCompleted(progress);

    // No new category should have been created.
    expect(progress.summary.categoriesCreated).toBe(0);
    expect(progress.summary.transactionsImported).toBe(1);
    expect(progress.summary.errors).toHaveLength(0);

    const categoriesAfter = await helpers.getCategoriesList();
    expect(categoriesAfter.length).toBe(categoriesBefore.length);

    // The imported transaction must use the pre-existing category id.
    const txs = await helpers.getTransactions({ raw: true });
    const imported = txs.find((t) => t.note === 'Cat link test');
    expect(imported).toBeDefined();
    expect(imported!.categoryId).toBe(existingCategory.id);
  });

  /**
   * Unmapped categories and the transfer-marker category are tolerated:
   *   - A parsed ordinary-transaction category absent from `categoryMapping`
   *     imports with no category — no error, no stray category created.
   *   - Transfer legs whose category is the Wallet transfer marker
   *     (`Transfer, withdraw`) are never sent to `createCategoriesIfNeeded`
   *     and thus never create a category, even when the transfer-marker
   *     name appears in the CSV.
   *
   * Fixture rows:
   *   1. Ordinary expense with category "Food" — NOT in categoryMapping
   *   2. Transfer pair with category "Transfer, withdraw" — transfer marker
   *
   * Expected: import completes, categoriesCreated = 0, the ordinary
   * transaction has null categoryId, no stray categories appear.
   */
  it('unmapped category and transfer-marker category import without error and create no categories', async () => {
    const fileContent = [
      'account;category;currency;amount;ref_currency_amount;type;payment_type;note;date;transfer;payee;labels',
      // Ordinary row — category "Food" is intentionally absent from categoryMapping.
      'AccA UAH;Food;UAH;200;200;Expense;Credit card;Unmapped cat row;2025-06-10T10:00:00.000Z;false;;',
      // Transfer pair — category is the transfer marker; must never create a category.
      'AccA UAH;Transfer, withdraw;UAH;1000;1000;Expense;Cash;;2025-06-11T10:00:00.000Z;true;;',
      'AccB UAH;Transfer, withdraw;UAH;1000;1000;Income;Cash;;2025-06-11T10:00:00.000Z;true;;',
    ].join('\n');

    const accountMapping = {
      'AccA UAH': { action: 'create-new' as const, currencyCode: 'UAH', currentBalance: null },
      'AccB UAH': { action: 'create-new' as const, currencyCode: 'UAH', currentBalance: null },
    };
    // categoryMapping intentionally omits "Food" and never includes the transfer marker.
    const categoryMapping = {};

    const categoriesBefore = await helpers.getCategoriesList();

    const { jobId } = await helpers.executeBudgetBakersWallet({
      payload: { fileContent, accountMapping, categoryMapping, skipDuplicateIndices: [] },
      raw: true,
    });
    const progress = await waitForBudgetBakersWalletCompletion({ jobId });
    expectCompleted(progress);

    expect(progress.summary.categoriesCreated).toBe(0);
    expect(progress.summary.transactionsImported).toBe(1); // ordinary row
    expect(progress.summary.transfersImported).toBe(1); // the transfer pair
    expect(progress.summary.errors).toHaveLength(0);

    // No stray category must have been created.
    const categoriesAfter = await helpers.getCategoriesList();
    expect(categoriesAfter.length).toBe(categoriesBefore.length);

    // The ordinary transaction must have no category.
    const txs = await helpers.getTransactions({ raw: true });
    const unmappedTx = txs.find((t) => t.note === 'Unmapped cat row');
    expect(unmappedTx).toBeDefined();
    expect(unmappedTx!.categoryId).toBeNull();
  });

  /**
   * Cross-user ownership boundary: linking a Wallet account to another user's
   * account id must cause the worker job to fail. The execute controller always
   * enqueues successfully (returns `{ jobId }`), so the rejection is async —
   * `getAccountById({ userId: userA, id: userB_accountId })` returns null in
   * Phase 2, which throws a ValidationError that the BullMQ worker surfaces as
   * `status: 'failed'`. No transactions must land on the target account.
   */
  it('fails the worker job when the link-existing accountId belongs to another user', async () => {
    // Provision user B with their base currency (AED) so account creation
    // succeeds without a separate addUserCurrencies call. The cross-user
    // ownership check in getAccountById fires before any currency comparison,
    // so user B's account currency does not need to match the CSV.
    const userB = await provisionSecondUserWithBaseCurrency();
    const userBAccount = await asUser({
      cookies: userB.cookies,
      fn: () =>
        helpers.createAccount({
          payload: helpers.buildAccountPayload({ initialBalance: 0 }),
          raw: true,
        }),
    });
    expect(userBAccount.id).toBeTruthy();

    // User A (the default test user) submits an import that tries to link to
    // user B's account. The controller enqueues without error — the ownership
    // check runs inside the worker.
    const fileContent = [
      'account;category;currency;amount;ref_currency_amount;type;payment_type;note;date;transfer;payee;labels',
      'WalletAcc AED;Food;AED;500;500;Expense;Credit card;Cross-user row;2025-06-01T12:00:00.000Z;false;;',
    ].join('\n');

    const accountMapping = {
      'WalletAcc AED': { action: 'link-existing' as const, accountId: userBAccount.id },
    };

    const { jobId } = await helpers.executeBudgetBakersWallet({
      payload: { fileContent, accountMapping, skipDuplicateIndices: [] },
      raw: true,
    });
    expect(jobId).toBeTruthy();

    const progress = await waitForBudgetBakersWalletCompletion({ jobId });
    expect(progress.status).toBe('failed');
    if (progress.status !== 'failed') throw new Error('unreachable');
    // The service error names the problem explicitly.
    expect(progress.error).toMatch(/does not exist or is not yours/i);

    // No transactions must have been created on user B's account.
    const userBTxs = await asUser({
      cookies: userB.cookies,
      fn: () => helpers.getTransactions({ raw: true }),
    });
    expect(userBTxs.filter((t) => t.accountId === userBAccount.id)).toHaveLength(0);
  });

  /**
   * Currency mismatch on link-existing: mapping a Wallet account whose CSV rows
   * carry currency X to a pre-existing account with currency Y must fail the
   * worker job. Phase 2 of the executor compares `existing.currencyCode` against
   * `account.currency` from the parser and throws a ValidationError when they
   * differ, which the BullMQ worker surfaces as `status: 'failed'`.
   */
  it('fails the worker job when the link-existing account currency does not match the CSV currency', async () => {
    // Create an account in AED (the test suite's base currency — always
    // available without a separate addUserCurrencies call). The CSV rows below
    // carry UAH, producing a deliberate currency mismatch.
    const aedAccount = await helpers.createAccount({
      payload: helpers.buildAccountPayload({ currencyCode: 'AED', initialBalance: 0 }),
      raw: true,
    });
    expect(aedAccount.id).toBeTruthy();

    const fileContent = [
      'account;category;currency;amount;ref_currency_amount;type;payment_type;note;date;transfer;payee;labels',
      'MyUAH;Food;UAH;300;300;Expense;Cash;Mismatch row;2025-06-01T12:00:00.000Z;false;;',
    ].join('\n');

    // Map the UAH Wallet account to the AED app account — a deliberate mismatch.
    const accountMapping = {
      MyUAH: { action: 'link-existing' as const, accountId: aedAccount.id },
    };

    const { jobId } = await helpers.executeBudgetBakersWallet({
      payload: { fileContent, accountMapping, skipDuplicateIndices: [] },
      raw: true,
    });
    expect(jobId).toBeTruthy();

    const progress = await waitForBudgetBakersWalletCompletion({ jobId });
    expect(progress.status).toBe('failed');
    if (progress.status !== 'failed') throw new Error('unreachable');
    // The service error calls out the currency conflict explicitly.
    expect(progress.error).toMatch(/currencies must match/i);

    // The AED account must be completely untouched.
    const txs = await helpers.getTransactions({ raw: true });
    expect(txs.filter((t) => t.accountId === aedAccount.id)).toHaveLength(0);
  });

  // ---------------------------------------------------------------------------
  // Tag tests (T7, T8)
  // ---------------------------------------------------------------------------

  /**
   * T7 — After a successful import the imported transaction must actually carry
   * the created tag, not just increment `tagsCreated`.  We verify this by
   * fetching the transaction with `includeTags: true` and asserting that the
   * tag id appears in the returned `tags` array.
   */
  it('imported transaction carries the tag created during import (not just tagsCreated count)', async () => {
    const tagLabel = `import-tag-${generateRandomRecordId()}`;

    const fileContent = [
      'account;category;currency;amount;ref_currency_amount;type;payment_type;note;date;transfer;payee;labels',
      `TagAcc UAH;Food;UAH;800;800;Expense;Credit card;Tagged tx;2025-06-01T12:00:00.000Z;false;;${tagLabel}`,
    ].join('\n');

    const accountMapping = {
      'TagAcc UAH': { action: 'create-new' as const, currencyCode: 'UAH', currentBalance: null },
    };

    const { jobId } = await helpers.executeBudgetBakersWallet({
      payload: { fileContent, accountMapping, skipDuplicateIndices: [] },
      raw: true,
    });
    expect(jobId).toBeTruthy();
    const progress = await waitForBudgetBakersWalletCompletion({ jobId });
    expectCompleted(progress);
    expect(progress.summary.tagsCreated).toBe(1);
    expect(progress.summary.transactionsImported).toBe(1);
    expect(progress.summary.errors).toHaveLength(0);

    // Find the created tag by name via the tags endpoint.
    const allTags = await helpers.getTags({ raw: true });
    const createdTag = allTags.find((t) => t.name === tagLabel);
    expect(createdTag).toBeDefined();

    // Fetch transactions with tags included; the imported transaction must carry the tag.
    const txs = await helpers.getTransactions({ includeTags: true, raw: true });
    const imported = txs.find((t) => t.note === 'Tagged tx');
    expect(imported).toBeDefined();
    // The tags array is populated when includeTags is true.
    const importedTags = (imported as any).tags as Array<{ id: string }> | undefined;
    expect(importedTags).toBeDefined();
    expect(importedTags!.some((tag) => tag.id === createdTag!.id)).toBe(true);
  });

  /**
   * T8 — Tag find-or-create reuse: pre-create a tag with the exact label that
   * a CSV row carries, then import that row.  The worker must NOT create a
   * second tag (`tagsCreated === 0`) and the transaction must still carry the
   * pre-existing tag id.
   */
  it('reuses an existing tag (tagsCreated === 0) when importing a row whose label matches a pre-existing tag', async () => {
    const sharedLabel = `shared-tag-${generateRandomRecordId()}`;

    // Pre-create the tag via the API.
    const existingTag = await helpers.createTag({
      payload: { name: sharedLabel, color: '#336699' },
      raw: true,
    });
    expect(existingTag.id).toBeTruthy();

    const fileContent = [
      'account;category;currency;amount;ref_currency_amount;type;payment_type;note;date;transfer;payee;labels',
      `ReuseAcc UAH;Food;UAH;300;300;Expense;Cash;Reuse tag tx;2025-06-05T09:00:00.000Z;false;;${sharedLabel}`,
    ].join('\n');

    const accountMapping = {
      'ReuseAcc UAH': { action: 'create-new' as const, currencyCode: 'UAH', currentBalance: null },
    };

    const { jobId } = await helpers.executeBudgetBakersWallet({
      payload: { fileContent, accountMapping, skipDuplicateIndices: [] },
      raw: true,
    });
    expect(jobId).toBeTruthy();
    const progress = await waitForBudgetBakersWalletCompletion({ jobId });
    expectCompleted(progress);

    // The tag already existed — no new tag should be created.
    expect(progress.summary.tagsCreated).toBe(0);
    expect(progress.summary.transactionsImported).toBe(1);
    expect(progress.summary.errors).toHaveLength(0);

    // The transaction must still carry the pre-existing tag.
    const txs = await helpers.getTransactions({ includeTags: true, raw: true });
    const imported = txs.find((t) => t.note === 'Reuse tag tx');
    expect(imported).toBeDefined();
    const importedTags = (imported as any).tags as Array<{ id: string }> | undefined;
    expect(importedTags).toBeDefined();
    expect(importedTags!.some((tag) => tag.id === existingTag.id)).toBe(true);
  });

  /**
   * T8b — Wallet joins several labels on one row with ", " in the `labels` cell.
   * The importer must split them into distinct tags (two created here) and attach
   * BOTH to the imported transaction, rather than creating a single combined
   * "labelA, labelB" tag.
   */
  it('splits a comma-separated labels cell into multiple tags, all attached to the transaction', async () => {
    const labelA = `multi-a-${generateRandomRecordId()}`;
    const labelB = `multi-b-${generateRandomRecordId()}`;

    const fileContent = [
      'account;category;currency;amount;ref_currency_amount;type;payment_type;note;date;transfer;payee;labels',
      `MultiTagAcc UAH;Food;UAH;500;500;Expense;Cash;Multi tag tx;2025-06-07T10:00:00.000Z;false;;${labelA}, ${labelB}`,
    ].join('\n');

    const accountMapping = {
      'MultiTagAcc UAH': { action: 'create-new' as const, currencyCode: 'UAH', currentBalance: null },
    };

    const { jobId } = await helpers.executeBudgetBakersWallet({
      payload: { fileContent, accountMapping, skipDuplicateIndices: [] },
      raw: true,
    });
    expect(jobId).toBeTruthy();
    const progress = await waitForBudgetBakersWalletCompletion({ jobId });
    expectCompleted(progress);

    // Two distinct labels → two created tags, not one combined tag.
    expect(progress.summary.tagsCreated).toBe(2);
    expect(progress.summary.transactionsImported).toBe(1);
    expect(progress.summary.errors).toHaveLength(0);

    const allTags = await helpers.getTags({ raw: true });
    const tagA = allTags.find((t) => t.name === labelA);
    const tagB = allTags.find((t) => t.name === labelB);
    expect(tagA).toBeDefined();
    expect(tagB).toBeDefined();
    // The combined string must never become a tag of its own.
    expect(allTags.some((t) => t.name === `${labelA}, ${labelB}`)).toBe(false);

    const txs = await helpers.getTransactions({ includeTags: true, raw: true });
    const imported = txs.find((t) => t.note === 'Multi tag tx');
    expect(imported).toBeDefined();
    const importedTags = (imported as any).tags as Array<{ id: string }> | undefined;
    expect(importedTags).toBeDefined();
    expect(importedTags!.some((tag) => tag.id === tagA!.id)).toBe(true);
    expect(importedTags!.some((tag) => tag.id === tagB!.id)).toBe(true);
  });

  describe('skipped accounts', () => {
    it('leaves out a skipped account: its account, its rows and its out-of-wallet leg', async () => {
      const accountsBefore = await helpers.getAccounts();
      const fileContent = helpers.loadBudgetBakersWalletFixture('multi-currency.csv');
      const { accountMapping } = await buildMappingWithSkippedAccounts({
        fileContent,
        skippedAccountNames: ['Monobank UAH'],
      });

      const { jobId } = await helpers.executeBudgetBakersWallet({
        payload: { fileContent, accountMapping, skipDuplicateIndices: [] },
        raw: true,
      });
      const progress = await waitForBudgetBakersWalletCompletion({ jobId });
      expectCompleted(progress);
      const { summary } = progress;

      expect(summary.accountsSkipped).toBe(1);
      expect(summary.accountsCreated).toBe(4);
      // Monobank UAH owned 2 ordinary rows and the lone (out-of-wallet) leg.
      expect(summary.transactionsImported).toBe(2);
      expect(summary.outOfWalletImported).toBe(0);
      // Neither transfer pair touches Monobank UAH, so both still land.
      expect(summary.transfersImported).toBe(2);
      // "Refund" only ever labelled a Monobank row; "Travel" also labels a PKO row.
      expect(summary.tagsCreated).toBe(1);
      expect(summary.errors).toHaveLength(0);
      // 2 transactions + 2 transfers.
      expect(progress.totalCount).toBe(4);

      const accountsAfter = await helpers.getAccounts();
      expect(accountsAfter.length).toBe(accountsBefore.length + 4);
      expect(accountsAfter.find((a) => a.name === 'Monobank UAH')).toBeUndefined();

      const transactionsAfter = await helpers.getTransactions({ raw: true });
      const notes = transactionsAfter.map((t) => t.note);
      expect(notes).toContain('Project payment');
      expect(notes).toContain('Morning coffee');
      expect(notes).not.toContain('Weekly shop');
      expect(notes).not.toContain('December salary');
      expect(
        transactionsAfter.filter((t) => t.transferNature === TRANSACTION_TRANSFER_NATURE.transfer_out_wallet),
      ).toHaveLength(0);
    });

    it('drops a transfer whole when one of its legs belongs to a skipped account', async () => {
      const fileContent = helpers.loadBudgetBakersWalletFixture('multi-currency.csv');
      const { accountMapping } = await buildMappingWithSkippedAccounts({
        fileContent,
        skippedAccountNames: ['Wise USD'],
      });

      const { jobId } = await helpers.executeBudgetBakersWallet({
        payload: { fileContent, accountMapping, skipDuplicateIndices: [] },
        raw: true,
      });
      const progress = await waitForBudgetBakersWalletCompletion({ jobId });
      expectCompleted(progress);
      const { summary } = progress;

      expect(summary.accountsSkipped).toBe(1);
      expect(summary.accountsCreated).toBe(4);
      // Wise USD owns no ordinary rows, so every non-transfer row still lands.
      expect(summary.transactionsImported).toBe(4);
      expect(summary.outOfWalletImported).toBe(1);
      // Only PKO USD -> PKO PLN survives; Crypto USD -> Wise USD is dropped whole.
      expect(summary.transfersImported).toBe(1);
      expect(summary.errors).toHaveLength(0);
      // 4 ordinary rows + 1 out-of-wallet leg + 1 transfer.
      expect(progress.totalCount).toBe(6);

      const accountsAfter = await helpers.getAccounts();
      expect(accountsAfter.find((a) => a.name === 'Wise USD')).toBeUndefined();

      // The surviving leg of the dropped transfer must not be written on its
      // own: Crypto USD is created but stays empty.
      const cryptoAccount = accountsAfter.find((a) => a.name === 'Crypto USD')!;
      const transactionsAfter = await helpers.getTransactions({ raw: true });
      expect(transactionsAfter.filter((t) => t.accountId === cryptoAccount.id)).toHaveLength(0);
      expect(
        transactionsAfter.filter((t) => t.transferNature === TRANSACTION_TRANSFER_NATURE.common_transfer),
      ).toHaveLength(2);
    });

    it('completes with zeroed counts when every account is mapped to skip', async () => {
      const accountsBefore = await helpers.getAccounts();
      const fileContent = helpers.loadBudgetBakersWalletFixture('multi-currency.csv');
      const { parsed } = await buildCreateNewMappingFromFixture({ fileContent });
      const accountMapping: BudgetBakersWalletAccountMapping = Object.fromEntries(
        parsed.accounts.map((account) => [account.originalName, { action: 'skip' }]),
      );

      const { jobId } = await helpers.executeBudgetBakersWallet({
        payload: { fileContent, accountMapping, skipDuplicateIndices: [] },
        raw: true,
      });
      const progress = await waitForBudgetBakersWalletCompletion({ jobId });
      expectCompleted(progress);

      expect(progress.processedCount).toBe(0);
      expect(progress.totalCount).toBe(0);
      expect(progress.summary).toMatchObject({
        accountsSkipped: parsed.accounts.length,
        accountsCreated: 0,
        accountsLinked: 0,
        categoriesCreated: 0,
        tagsCreated: 0,
        payeesCreated: 0,
        transactionsImported: 0,
        transfersImported: 0,
        outOfWalletImported: 0,
        duplicatesSkipped: 0,
        errors: [],
      });

      expect((await helpers.getAccounts()).length).toBe(accountsBefore.length);
      expect(await helpers.getTransactions({ raw: true })).toHaveLength(0);
    });
  });

  describe('POST /import/budget-bakers-wallet/detect-duplicates', () => {
    /**
     * Empty state: when every account in the mapping uses `create-new`, the
     * service short-circuits before touching the DB (no linked account can
     * have prior transactions) and returns an empty duplicates array.
     */
    it('returns empty duplicates when all accounts are create-new (no linked accounts)', async () => {
      const fileContent = [
        'account;category;currency;amount;ref_currency_amount;type;payment_type;note;date;transfer;payee;labels',
        `NewAcc UAH;Food;UAH;500;500;Expense;Credit card;Test row;2025-06-01T12:00:00.000Z;false;;`,
      ].join('\n');

      const accountMapping = {
        'NewAcc UAH': { action: 'create-new' as const, currencyCode: 'UAH', currentBalance: null },
      };

      const { duplicates } = await helpers.detectBudgetBakersWalletDuplicates({
        payload: { fileContent, accountMapping },
        raw: true,
      });

      expect(duplicates).toEqual([]);
    });

    /**
     * Error case: empty fileContent violates the Zod min(1) constraint on the
     * controller. The request must be rejected with a 422 validation error
     * before any service logic runs.
     */
    it('returns 422 for an empty fileContent string', async () => {
      const response = await helpers.detectBudgetBakersWalletDuplicates({
        payload: {
          fileContent: '',
          accountMapping: {},
        },
      });

      expect(response.statusCode).toBe(ERROR_CODES.ValidationError);
    });

    /**
     * Mixed mapping: when the CSV has some accounts mapped to `link-existing`
     * and some to `create-new`, only the linked accounts' transactions are
     * candidates for duplicate detection. Transactions belonging to the
     * create-new account must NOT appear in the duplicates array.
     *
     * Seeding is done via executeBudgetBakersWallet (the only route that writes
     * transactions) to stay strictly HTTP-only — no direct service calls.
     */
    it('only considers link-existing accounts when detecting duplicates (create-new accounts are excluded)', async () => {
      const existingAccount = await helpers.createAccount({
        payload: helpers.buildAccountPayload({ currencyCode: 'UAH', initialBalance: 0 }),
        raw: true,
      });

      // Unique notes avoid collisions with transactions seeded by other tests.
      const noteLinked1 = `mixed-linked-a-${generateRandomRecordId()}`;
      const noteLinked2 = `mixed-linked-b-${generateRandomRecordId()}`;

      // Two rows for the linked account; one row for a create-new account.
      const fileContent = [
        'account;category;currency;amount;ref_currency_amount;type;payment_type;note;date;transfer;payee;labels',
        `Linked UAH;Food;UAH;500;500;Expense;Credit card;${noteLinked1};2025-06-01T12:00:00.000Z;false;;`,
        `Linked UAH;Salary;UAH;30000;30000;Income;Cash;${noteLinked2};2025-06-02T10:00:00.000Z;false;;`,
        `New UAH;Groceries;UAH;200;200;Expense;Cash;new-acct-row;2025-06-03T08:00:00.000Z;false;;`,
      ].join('\n');

      const seedMapping = {
        'Linked UAH': { action: 'link-existing' as const, accountId: existingAccount.id },
        'New UAH': { action: 'create-new' as const, currencyCode: 'UAH', currentBalance: null },
      };

      const { jobId } = await helpers.executeBudgetBakersWallet({
        payload: { fileContent, accountMapping: seedMapping, skipDuplicateIndices: [] },
        raw: true,
      });
      expect(jobId).toBeTruthy();
      const progress = await waitForBudgetBakersWalletCompletion({ jobId });
      expectCompleted(progress);
      // 2 linked + 1 create-new = 3 ordinary transactions seeded.
      expect(progress.summary.transactionsImported).toBe(3);
      expect(progress.summary.errors).toHaveLength(0);

      const { duplicates } = await helpers.detectBudgetBakersWalletDuplicates({
        payload: { fileContent, accountMapping: seedMapping },
        raw: true,
      });

      // rowIndex counts file lines: the header is line 1, so the first data row
      // is 2.
      expect(duplicates.length).toBe(2);
      const rowIndices = duplicates.map((d) => d.rowIndex);
      expect(rowIndices).toContain(2);
      expect(rowIndices).toContain(3);
      expect(rowIndices).not.toContain(4);
    });
  });
});
