import {
  MS_MONEY_UPLOAD_IDLE_TTL_MS,
  MS_MONEY_UPLOAD_MAX_LIFETIME_MS,
  MS_MONEY_VOID_TAG,
  ResourceLeaseType,
  TRANSACTION_TRANSFER_NATURE,
} from '@bt/shared/types';
import type { CategoryMappingConfig, MsMoneyAccountMapping } from '@bt/shared/types';
import { generateRandomRecordId } from '@common/lib/record-id-helpers';
import { describe, expect, it } from '@jest/globals';
import { ERROR_CODES } from '@js/errors';
import {
  MS_MONEY_FIXTURES_MISSING_MESSAGE,
  MS_MONEY_SAMPLE,
  msMoneyFixturesAvailable,
  readMsMoneyFixture,
} from '@tests/fixtures/ms-money-fixtures';
import * as helpers from '@tests/helpers';
import { expectMsMoneyCompleted, expectMsMoneyFailed, waitForMsMoneyCompletion } from '@tests/helpers/import-export';
import { asUser, provisionSecondUserWithBaseCurrency } from '@tests/helpers/share';

/**
 * End-to-end import of a real Microsoft Money database.
 *
 * `.mny` fixtures are Microsoft's own sample files — they are downloaded into
 * `src/tests/fixtures/ms-money-import/` rather than committed, so this suite
 * skips itself when they are absent.
 *
 * What `money2005-pwd.mny` holds, and where every expected number below comes
 * from:
 *   Accounts (all AUD, base currency AUD):
 *     - "Woodgrove Bank Current"     67 ordinary rows + the 7 transfer source legs
 *     - "Woodgrove Bank Credit Card" the 7 transfer destination legs, no ordinary rows
 *     - "Stocks and Shares (Cash)"   1 row, a transfer leg whose counterpart is an
 *                                    investment account the importer does not touch,
 *                                    so it imports as out-of-wallet (−178 AUD, 2003-08-02)
 *   Transfers: 7 × 100 AUD, Current → Credit Card, monthly through 2004
 *   Categories: 11 leaves across 6 groups (e.g. "Bills:Council Tax")
 *   Payees: 11 (one of them is named only by voided rows)
 *   Two investment/loan accounts are reported as warnings and skipped. Voided
 *   rows are parsed but left out unless `includeVoidedTransactions` is set.
 */
const { file: FIXTURE, password: FIXTURE_PASSWORD, currency: FIXTURE_CURRENCY } = MS_MONEY_SAMPLE;
const { current: ACCOUNT_CURRENT, creditCard: ACCOUNT_CREDIT_CARD, stocks: ACCOUNT_STOCKS } = MS_MONEY_SAMPLE.accounts;

/** Amount of the out-of-wallet row on "Stocks and Shares (Cash)", dated 2003-08-02. */
const OUT_OF_WALLET_AMOUNT = 178;

/**
 * Two of the file's 11 categories, picked because their rows are identifiable by
 * amount alone — 578 and 55 appear on no other row and on no transfer. One is
 * pointed at a category the user already owns, the other is left out of the
 * mapping, so the full-import test covers all three mapping branches at once.
 */
const CATEGORY_LINKED = 'Household:Mortgage';
const CATEGORY_LINKED_AMOUNT = 578;
const CATEGORY_LINKED_ROWS = 6;
const CATEGORY_OMITTED = 'Leisure & Entertainment:Health Club';
const CATEGORY_OMITTED_AMOUNT = 55;
const CATEGORY_OMITTED_ROWS = 6;
const CATEGORY_OMITTED_LEAF_NAME = 'Health Club';

const fixturesAvailable = msMoneyFixturesAvailable();
if (!fixturesAvailable) {
  console.warn(`[ms-money] Skipping the execute-import suite. ${MS_MONEY_FIXTURES_MISSING_MESSAGE}`);
}
const describeWithFixture = fixturesAvailable ? describe : describe.skip;

/** Map every category the file uses to `create-new`. */
const createNewCategoryMapping = ({ categories }: { categories: { fullName: string }[] }): CategoryMappingConfig =>
  Object.fromEntries(categories.map((category) => [category.fullName, { action: 'create-new' as const }]));

/**
 * Import only the single out-of-wallet row: the two Woodgrove accounts are
 * skipped, which also drops all 7 transfers. Keeps the balance and duplicate
 * tests down to one written row.
 */
const onlyStocksMapping = ({ accountId }: { accountId: string }): MsMoneyAccountMapping => ({
  [ACCOUNT_STOCKS]: { action: 'link-existing', accountId },
  [ACCOUNT_CURRENT]: { action: 'skip' },
  [ACCOUNT_CREDIT_CARD]: { action: 'skip' },
});

/** Creates an AUD account, optionally with one transaction to act as its boundary. */
const createAudAccount = async ({ name, boundaryTime }: { name: string; boundaryTime?: string }) => {
  const account = await helpers.createAccount({
    payload: helpers.buildAccountPayload({ currencyCode: FIXTURE_CURRENCY, name }),
    raw: true,
  });
  if (boundaryTime) {
    await helpers.createTransaction({
      payload: helpers.buildTransactionPayload({ accountId: account.id, amount: 300, time: boundaryTime }),
      raw: true,
    });
  }
  const before = await helpers.getAccount({ id: account.id, raw: true });
  return { account, balanceBefore: Number(before.currentBalance) };
};

const at = ({ instant }: { instant: string }) => new Date(instant).getTime();

/** Lease instants are whole milliseconds, so a refresh landing in the same
 *  millisecond as the upload would return an identical instant and prove nothing. */
const tick = () => new Promise((resolve) => setTimeout(resolve, 20));

const refreshLease = <R extends boolean | undefined = false>({ uploadId, raw }: { uploadId: string; raw?: R }) =>
  helpers.refreshResourceLease<R>({ payload: { type: ResourceLeaseType.msMoneyUpload, id: uploadId }, raw });

const runImport = async (payload: Parameters<typeof helpers.executeMsMoney>[0]['payload']) => {
  const { jobId } = await helpers.executeMsMoney({ payload, raw: true });
  // Fail-fast: a broken enqueue must surface here, not as a poll timeout.
  expect(jobId).toBeTruthy();
  expect(jobId).toMatch(/^ms-money-import-/);
  return waitForMsMoneyCompletion({ jobId });
};

describeWithFixture('Microsoft Money import execution', () => {
  /**
   * Full import: one existing account linked, the other two created. Covers the
   * summary counts, the created accounts, the landed transactions with their
   * category and payee, the three category-mapping branches, and the linked
   * transfer pairs.
   *
   * Gets a longer timeout than the 15s default: it writes 82 rows through the
   * real transaction service, which lands near that limit on a busy machine.
   */
  it('imports the whole file: counts, created accounts, landed rows, linked transfers', async () => {
    const { account: linked } = await createAudAccount({ name: 'Existing AUD current' });
    const existingCategory = await helpers.addCustomCategory({
      name: 'Existing mortgage category',
      color: '#123456',
      raw: true,
    });
    const upload = await helpers.uploadMsMoneyFixture({ file: FIXTURE, password: FIXTURE_PASSWORD });

    expect(upload.result.accounts).toHaveLength(3);
    expect(upload.result.baseCurrency).toBe(FIXTURE_CURRENCY);
    // Fail fast if the fixture stops carrying voided rows — the opt-in test
    // below would otherwise pass by asserting nothing.
    expect(upload.result.transactions.filter((tx) => tx.isVoid).length).toBeGreaterThan(0);

    const categoryMapping = createNewCategoryMapping({ categories: upload.result.categories });
    // Fail fast if the fixture stops carrying these two: a silent no-op here
    // would leave the two branches below untested.
    expect(Object.keys(categoryMapping)).toEqual(expect.arrayContaining([CATEGORY_LINKED, CATEGORY_OMITTED]));
    categoryMapping[CATEGORY_LINKED] = { action: 'link-existing', categoryId: existingCategory.id };
    delete categoryMapping[CATEGORY_OMITTED];

    const progress = await runImport({
      uploadId: upload.uploadId,
      accountMapping: {
        [ACCOUNT_CURRENT]: { action: 'link-existing', accountId: linked.id },
        [ACCOUNT_CREDIT_CARD]: { action: 'create-new', currencyCode: FIXTURE_CURRENCY, currentBalance: null },
        [ACCOUNT_STOCKS]: { action: 'create-new', currencyCode: FIXTURE_CURRENCY, currentBalance: null },
      },
      categoryMapping,
    });
    expectMsMoneyCompleted(progress);
    const { summary } = progress;

    expect(summary.errors).toHaveLength(0);
    expect(summary.accountsCreated).toBe(2);
    expect(summary.accountsLinked).toBe(1);
    expect(summary.accountsSkipped).toBe(0);
    expect(summary.transactionsImported).toBe(67);
    expect(summary.outOfWalletImported).toBe(1);
    expect(summary.transfersImported).toBe(7);
    expect(summary.duplicatesSkipped).toBe(0);
    expect(summary.voidedImported).toBe(0);
    expect(summary.payeesCreated).toBe(10);
    // 9 of the 11 leaves are created under their group — one is linked to an
    // existing category, one is left out of the mapping — plus the groups those
    // leaves need, unless a same-named seeded default is reused.
    expect(summary.categoriesCreated).toBeGreaterThanOrEqual(9);

    // --- The two mapped accounts were created, the linked one was not duplicated ---
    const accounts = await helpers.getAccounts();
    const creditCard = accounts.find((a) => a.name === ACCOUNT_CREDIT_CARD);
    const stocks = accounts.find((a) => a.name === ACCOUNT_STOCKS);
    expect(creditCard).toBeDefined();
    expect(stocks).toBeDefined();
    expect(accounts.filter((a) => a.name === ACCOUNT_CURRENT)).toHaveLength(0);

    const transactions = await helpers.getTransactions({ limit: 500, raw: true });
    // 67 ordinary + 1 out-of-wallet + 7 transfers × 2 legs.
    expect(transactions).toHaveLength(82);
    // Voided rows are the only ones written at amount 0.
    expect(transactions.filter((tx) => Number(tx.amount) === 0)).toHaveLength(0);

    // --- Ordinary row keeps its account, direction, amount and payee ---
    const insuranceRow = transactions.find(
      (t) => t.accountId === linked.id && Number(t.amount) === 38.75 && t.transactionType === 'expense',
    );
    expect(insuranceRow).toBeDefined();
    expect(insuranceRow!.transferNature).toBe(TRANSACTION_TRANSFER_NATURE.not_transfer);
    expect(insuranceRow!.categoryId).toBeTruthy();

    // --- Money's two-level category is rebuilt as a leaf under its group ---
    const categories = await helpers.getCategoriesList();
    const councilTax = categories.find((c) => c.name === 'Council Tax');
    expect(councilTax).toBeDefined();
    const bills = categories.find((c) => c.id === councilTax!.parentId);
    expect(bills?.name).toBe('Bills');

    // --- A linked category is reused, not duplicated ---
    const linkedCategoryRows = transactions.filter((t) => Number(t.amount) === CATEGORY_LINKED_AMOUNT);
    expect(linkedCategoryRows).toHaveLength(CATEGORY_LINKED_ROWS);
    expect(linkedCategoryRows.every((t) => t.categoryId === existingCategory.id)).toBe(true);
    expect(categories.filter((c) => c.name === existingCategory.name)).toHaveLength(1);

    // --- A category left out of the mapping imports its rows bare ---
    const unmappedCategoryRows = transactions.filter((t) => Number(t.amount) === CATEGORY_OMITTED_AMOUNT);
    expect(unmappedCategoryRows).toHaveLength(CATEGORY_OMITTED_ROWS);
    expect(unmappedCategoryRows.filter((t) => t.categoryId != null)).toEqual([]);
    expect(categories.filter((c) => c.name === CATEGORY_OMITTED_LEAF_NAME)).toHaveLength(0);

    // --- The out-of-wallet leg has no counterpart account ---
    const outOfWalletLegs = transactions.filter(
      (t) => t.transferNature === TRANSACTION_TRANSFER_NATURE.transfer_out_wallet,
    );
    expect(outOfWalletLegs).toHaveLength(1);
    expect(outOfWalletLegs[0]!.accountId).toBe(stocks!.id);
    expect(Number(outOfWalletLegs[0]!.amount)).toBe(OUT_OF_WALLET_AMOUNT);
    expect(outOfWalletLegs[0]!.transactionType).toBe('expense');

    // --- Each transfer is one linked pair, not two loose rows ---
    const transferLegs = transactions.filter((t) => t.transferNature === TRANSACTION_TRANSFER_NATURE.common_transfer);
    expect(transferLegs).toHaveLength(14);
    expect(transferLegs.every((t) => Number(t.amount) === 100)).toBe(true);

    const sourceLegs = transferLegs.filter((t) => t.accountId === linked.id);
    const destinationLegs = transferLegs.filter((t) => t.accountId === creditCard!.id);
    expect(sourceLegs).toHaveLength(7);
    expect(destinationLegs).toHaveLength(7);
    expect(sourceLegs.every((t) => t.transactionType === 'expense')).toBe(true);
    expect(destinationLegs.every((t) => t.transactionType === 'income')).toBe(true);

    // Both legs of one transfer must carry the same transferId, and the
    // transfer endpoint must return exactly those two.
    const someSourceLeg = sourceLegs[0]!;
    expect(someSourceLeg.transferId).toBeTruthy();
    const pair = await helpers.getTransactionsByTransferId({ transferId: someSourceLeg.transferId!, raw: true });
    expect(pair).toHaveLength(2);
    expect(new Set(pair.map((t) => t.accountId))).toEqual(new Set([linked.id, creditCard!.id]));
  }, 60_000);

  /**
   * A `skip` account leaves the import completely: no app account, none of its
   * rows, and no transfer that touches it. Skipping both Woodgrove accounts
   * therefore drops all 7 transfers and all 67 ordinary rows, leaving only the
   * out-of-wallet leg on the third account.
   */
  it('skips a mapped-out account, its rows, and every transfer touching it', async () => {
    const upload = await helpers.uploadMsMoneyFixture({ file: FIXTURE, password: FIXTURE_PASSWORD });

    const progress = await runImport({
      uploadId: upload.uploadId,
      accountMapping: {
        [ACCOUNT_CURRENT]: { action: 'skip' },
        [ACCOUNT_CREDIT_CARD]: { action: 'skip' },
        [ACCOUNT_STOCKS]: { action: 'create-new', currencyCode: FIXTURE_CURRENCY, currentBalance: null },
      },
    });
    expectMsMoneyCompleted(progress);
    const { summary } = progress;

    expect(summary.errors).toHaveLength(0);
    expect(summary.accountsSkipped).toBe(2);
    expect(summary.accountsCreated).toBe(1);
    expect(summary.accountsLinked).toBe(0);
    expect(summary.transactionsImported).toBe(0);
    expect(summary.transfersImported).toBe(0);
    expect(summary.outOfWalletImported).toBe(1);

    const accounts = await helpers.getAccounts();
    expect(accounts.filter((a) => a.name === ACCOUNT_CURRENT)).toHaveLength(0);
    expect(accounts.filter((a) => a.name === ACCOUNT_CREDIT_CARD)).toHaveLength(0);
    const stocks = accounts.find((a) => a.name === ACCOUNT_STOCKS);
    expect(stocks).toBeDefined();

    const transactions = await helpers.getTransactions({ limit: 500, raw: true });
    expect(transactions).toHaveLength(1);
    expect(transactions[0]!.accountId).toBe(stocks!.id);
  });

  /**
   * Skipping every account is a legitimate decision, and it leaves the job with
   * nothing to write. It must still settle as `completed` with a whole,
   * zeroed-out summary — a run with no rows is the one that can report a total
   * it never counted, or never report progress at all.
   */
  it('completes with zeroed counts when every account is mapped to skip', async () => {
    const upload = await helpers.uploadMsMoneyFixture({ file: FIXTURE, password: FIXTURE_PASSWORD });

    const progress = await runImport({
      uploadId: upload.uploadId,
      accountMapping: {
        [ACCOUNT_CURRENT]: { action: 'skip' },
        [ACCOUNT_CREDIT_CARD]: { action: 'skip' },
        [ACCOUNT_STOCKS]: { action: 'skip' },
      },
    });
    expectMsMoneyCompleted(progress);

    expect(progress.processedCount).toBe(0);
    expect(progress.totalCount).toBe(0);
    expect(progress.summary).toMatchObject({
      accountsSkipped: 3,
      accountsCreated: 0,
      accountsLinked: 0,
      categoriesCreated: 0,
      payeesCreated: 0,
      transactionsImported: 0,
      transfersImported: 0,
      outOfWalletImported: 0,
      voidedImported: 0,
      duplicatesSkipped: 0,
      errors: [],
    });
    expect(progress.summary.accountBalanceChanges).toEqual([]);

    const accountNames = (await helpers.getAccounts()).map((account) => account.name);
    expect(accountNames).not.toContain(ACCOUNT_CURRENT);
    expect(accountNames).not.toContain(ACCOUNT_CREDIT_CARD);
    expect(accountNames).not.toContain(ACCOUNT_STOCKS);

    const transactions = await helpers.getTransactions({ limit: 500, raw: true });
    expect(transactions).toHaveLength(0);
  });

  /**
   * Voided rows. Money keeps a voided entry in the register — payee, date, cheque
   * number, the amount it was written for — but never applies it to the balance.
   * They stay out of the import by default; opting in writes them at zero with
   * the "Void" tag, so account balances are the same either way.
   */
  describe('voided rows', () => {
    const allCreateNew = (): MsMoneyAccountMapping => ({
      [ACCOUNT_CURRENT]: { action: 'create-new', currencyCode: FIXTURE_CURRENCY, currentBalance: null },
      [ACCOUNT_CREDIT_CARD]: { action: 'create-new', currencyCode: FIXTURE_CURRENCY, currentBalance: null },
      [ACCOUNT_STOCKS]: { action: 'create-new', currencyCode: FIXTURE_CURRENCY, currentBalance: null },
    });

    it('imports them at zero with the Void tag when opted in', async () => {
      const upload = await helpers.uploadMsMoneyFixture({ file: FIXTURE, password: FIXTURE_PASSWORD });
      const voidedRows = upload.result.transactions.filter((tx) => tx.isVoid);

      const progress = await runImport({
        uploadId: upload.uploadId,
        accountMapping: allCreateNew(),
        includeVoidedTransactions: true,
      });
      expectMsMoneyCompleted(progress);

      expect(progress.summary.errors).toHaveLength(0);
      expect(progress.summary.voidedImported).toBe(voidedRows.length);
      // The rows that do move money are untouched by the opt-in, so the balances
      // this import produces are the same as without it.
      expect(progress.summary.transactionsImported).toBe(67);
      expect(progress.summary.transfersImported).toBe(7);
      expect(progress.summary.outOfWalletImported).toBe(1);

      const allTags = await helpers.getTags({ raw: true });
      const voidTag = allTags.find((tag) => tag.name === MS_MONEY_VOID_TAG.name);
      expect(voidTag).toBeDefined();

      const transactions = await helpers.getTransactions({ limit: 500, includeTags: true, raw: true });
      const zeroRows = transactions.filter((tx) => Number(tx.amount) === 0);
      expect(zeroRows).toHaveLength(voidedRows.length);
      for (const row of zeroRows) {
        const tags = (row as unknown as { tags?: { id: string }[] }).tags;
        expect(tags?.some((tag) => tag.id === voidTag!.id)).toBe(true);
      }

      // The amount Money kept on a voided row survives in the note, which is the
      // only place it can live once the row itself is zeroed.
      const withOriginalAmount = zeroRows.filter((tx) => /\(voided: \d+\.\d{2}\)/.test(tx.note ?? ''));
      expect(withOriginalAmount.length).toBeGreaterThan(0);
    }, 30000);
  });

  /**
   * Re-importing the same file into a linked account: the second upload's rows
   * are reported as duplicates, and confirming them keeps the rows out on the
   * second run. Only the linked account can produce duplicates, so the two
   * Woodgrove accounts are skipped to keep the run to a single row.
   */
  it('detects the already-imported row on a second upload and skips it on request', async () => {
    const { account } = await createAudAccount({ name: 'Dedup AUD' });

    const firstUpload = await helpers.uploadMsMoneyFixture({ file: FIXTURE, password: FIXTURE_PASSWORD });
    const accountMapping = onlyStocksMapping({ accountId: account.id });

    const firstRun = await runImport({ uploadId: firstUpload.uploadId, accountMapping });
    expectMsMoneyCompleted(firstRun);
    expect(firstRun.summary.outOfWalletImported).toBe(1);

    // The executor drops its cached upload once it finishes, so the second pass
    // starts from a fresh upload — exactly what the wizard does.
    const secondUpload = await helpers.uploadMsMoneyFixture({ file: FIXTURE, password: FIXTURE_PASSWORD });

    const { duplicates } = await helpers.detectMsMoneyDuplicates({
      payload: { uploadId: secondUpload.uploadId, accountMapping },
      raw: true,
    });
    expect(duplicates).toHaveLength(1);

    const secondRun = await runImport({
      uploadId: secondUpload.uploadId,
      accountMapping,
      skipDuplicateIndices: duplicates.map((d) => d.rowIndex),
    });
    expectMsMoneyCompleted(secondRun);
    expect(secondRun.summary.duplicatesSkipped).toBe(1);
    expect(secondRun.summary.outOfWalletImported).toBe(0);
    expect(secondRun.summary.transactionsImported).toBe(0);

    // The row must exist once, not twice.
    const transactions = await helpers.getTransactions({ limit: 500, raw: true });
    expect(transactions.filter((t) => t.accountId === account.id)).toHaveLength(1);
  });

  describe('balance recalculation', () => {
    /**
     * Recalc OFF is the default contract for a linked account: its balance is
     * what the user last reconciled, so back-filled history must not move it.
     */
    it('recalc false preserves the linked account balance, and undo restores the account in both currencies', async () => {
      const { account, balanceBefore } = await createAudAccount({
        name: 'Recalc off AUD',
        boundaryTime: '2003-01-01T12:00:00Z',
      });
      const before = await helpers.getAccount({ id: account.id, raw: true });
      const upload = await helpers.uploadMsMoneyFixture({ file: FIXTURE, password: FIXTURE_PASSWORD });

      const progress = await runImport({
        uploadId: upload.uploadId,
        accountMapping: onlyStocksMapping({ accountId: account.id }),
        recalculateBalance: false,
      });
      expectMsMoneyCompleted(progress);
      expect(progress.summary.outOfWalletImported).toBe(1);
      expect(progress.summary.errors).toHaveLength(0);

      const after = await helpers.getAccount({ id: account.id, raw: true });
      expect(Number(after.currentBalance)).toBe(balanceBefore);

      expect(progress.summary.accountBalanceChanges).toHaveLength(1);
      expect(progress.summary.accountBalanceChanges?.[0]).toMatchObject({
        accountId: account.id,
        balanceBefore,
        balanceAfter: balanceBefore,
        delta: 0,
        // The row is newer than the boundary, so it counts as moved even though
        // recalc OFF cancels its effect on the balance.
        movedCount: 1,
        historicalCount: 0,
        isNewAccount: false,
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

    /**
     * Recalc ON moves the balance by the rows dated on or after the account's
     * boundary — here the single out-of-wallet expense, which post-dates it.
     */
    it('recalc true moves the linked account balance by the imported row', async () => {
      const { account, balanceBefore } = await createAudAccount({
        name: 'Recalc on AUD',
        boundaryTime: '2003-01-01T12:00:00Z',
      });
      const upload = await helpers.uploadMsMoneyFixture({ file: FIXTURE, password: FIXTURE_PASSWORD });

      const progress = await runImport({
        uploadId: upload.uploadId,
        accountMapping: onlyStocksMapping({ accountId: account.id }),
        recalculateBalance: true,
      });
      expectMsMoneyCompleted(progress);
      expect(progress.summary.outOfWalletImported).toBe(1);
      expect(progress.summary.errors).toHaveLength(0);

      const after = await helpers.getAccount({ id: account.id, raw: true });
      expect(Number(after.currentBalance)).toBe(balanceBefore - OUT_OF_WALLET_AMOUNT);

      expect(progress.summary.accountBalanceChanges?.[0]).toMatchObject({
        accountId: account.id,
        balanceBefore,
        balanceAfter: balanceBefore - OUT_OF_WALLET_AMOUNT,
        delta: -OUT_OF_WALLET_AMOUNT,
        movedCount: 1,
        historicalCount: 0,
        isNewAccount: false,
      });
    });

    /**
     * Recalc ON with a boundary after every imported row: the whole import is
     * back-fill, so the balance stays put and only `initialBalance` absorbs it.
     */
    it('recalc true leaves the balance alone when the import is pure back-fill', async () => {
      const { account, balanceBefore } = await createAudAccount({
        name: 'Backfill AUD',
        boundaryTime: '2020-01-01T12:00:00Z',
      });
      const upload = await helpers.uploadMsMoneyFixture({ file: FIXTURE, password: FIXTURE_PASSWORD });

      const progress = await runImport({
        uploadId: upload.uploadId,
        accountMapping: onlyStocksMapping({ accountId: account.id }),
        recalculateBalance: true,
      });
      expectMsMoneyCompleted(progress);
      expect(progress.summary.errors).toHaveLength(0);

      const after = await helpers.getAccount({ id: account.id, raw: true });
      expect(Number(after.currentBalance)).toBe(balanceBefore);

      expect(progress.summary.accountBalanceChanges?.[0]).toMatchObject({
        delta: 0,
        movedCount: 0,
        historicalCount: 1,
        isNewAccount: false,
      });
    });

    /**
     * A created account ends on the balance the user entered, not on the net of
     * the rows that landed on it — the difference is absorbed into
     * `initialBalance` without an adjustment transaction. Both Woodgrove
     * accounts are skipped so the created account gets the single
     * out-of-wallet expense and nothing else.
     */
    it('forces the entered target balance on an account it creates', async () => {
      const targetBalance = 1234.56;
      const upload = await helpers.uploadMsMoneyFixture({ file: FIXTURE, password: FIXTURE_PASSWORD });

      const progress = await runImport({
        uploadId: upload.uploadId,
        accountMapping: {
          [ACCOUNT_CURRENT]: { action: 'skip' },
          [ACCOUNT_CREDIT_CARD]: { action: 'skip' },
          [ACCOUNT_STOCKS]: {
            action: 'create-new',
            currencyCode: FIXTURE_CURRENCY,
            currentBalance: targetBalance,
          },
        },
      });
      expectMsMoneyCompleted(progress);
      expect(progress.summary.errors).toHaveLength(0);
      expect(progress.summary.accountsCreated).toBe(1);
      expect(progress.summary.outOfWalletImported).toBe(1);

      const accounts = await helpers.getAccounts();
      const stocks = accounts.find((a) => a.name === ACCOUNT_STOCKS)!;
      expect(Number(stocks.currentBalance)).toBe(targetBalance);

      // A created account carries no balanceBefore/delta — there is no
      // pre-import balance to compare against.
      expect(progress.summary.accountBalanceChanges).toEqual([
        {
          accountId: stocks.id,
          accountName: ACCOUNT_STOCKS,
          balanceAfter: targetBalance,
          movedCount: 1,
          historicalCount: 0,
          isNewAccount: true,
        },
      ]);

      const { items } = await helpers.getBatchesHistory({ raw: true });
      expect(items).toEqual([expect.objectContaining({ createdAccountCount: 1 })]);

      await helpers.deleteImportBatch({ batchId: items[0]!.batchId, raw: true });
      expect((await helpers.getAccounts()).some((a) => a.id === stocks.id)).toBe(false);
    });
  });

  describe('upload errors', () => {
    it('rejects a password-protected file when the password is wrong', async () => {
      const result = await helpers.uploadMsMoney({
        file: readMsMoneyFixture({ file: FIXTURE }),
        password: 'definitely-not-the-password',
      });

      expect(result.statusCode).toBe(ERROR_CODES.ValidationError);
      expect(result.errorMessage).toMatch(/incorrect password/i);
    });

    it('rejects a password-protected file when no password is supplied', async () => {
      const result = await helpers.uploadMsMoney({
        file: readMsMoneyFixture({ file: FIXTURE }),
      });

      expect(result.statusCode).toBe(ERROR_CODES.ValidationError);
      expect(result.errorMessage).toMatch(/password-protected/i);
    });
  });

  /**
   * The cached parse result is scoped to the user who uploaded it. A second user
   * holding the id gets the same 404 as an id that never existed — the mapping
   * steps must never expose another user's accounts, payees or transactions.
   */
  it("refuses another user's upload id on both mapping steps", async () => {
    const upload = await helpers.uploadMsMoneyFixture({ file: FIXTURE, password: FIXTURE_PASSWORD });
    const otherUser = await provisionSecondUserWithBaseCurrency();

    await asUser({
      cookies: otherUser.cookies,
      fn: async () => {
        const detect = await helpers.detectMsMoneyDuplicates({
          payload: { uploadId: upload.uploadId, accountMapping: { [ACCOUNT_STOCKS]: { action: 'skip' } } },
        });
        expect(detect.statusCode).toBe(ERROR_CODES.NotFoundError);

        const execute = await helpers.executeMsMoney({
          payload: { uploadId: upload.uploadId, accountMapping: { [ACCOUNT_STOCKS]: { action: 'skip' } } },
        });
        expect(execute.statusCode).toBe(ERROR_CODES.NotFoundError);
      },
    });

    // The owner can still use the upload — the failed reads must not have
    // deleted or otherwise disturbed it.
    const stillMine = await helpers.detectMsMoneyDuplicates({
      payload: { uploadId: upload.uploadId, accountMapping: { [ACCOUNT_STOCKS]: { action: 'skip' } } },
      raw: false,
    });
    expect(stillMine.statusCode).toBe(200);
  });

  /**
   * A `link-existing` mapping names an account id the client chose, so the
   * worker resolves it against the importing user before writing anything. An id
   * that is unknown or belongs to somebody else is the same refusal: the job
   * fails and the message never says which of the two it was.
   */
  describe('link-existing ownership', () => {
    /**
     * The other user's account carries the file's own currency, so ownership is
     * the only thing left that can refuse it — a pass here would mean one user's
     * import writing rows into another user's ledger. A failed job releases its
     * claim on the upload, so both refusals run off the one upload.
     */
    it('fails the job when the linked account is unknown or belongs to another user', async () => {
      const otherUser = await provisionSecondUserWithBaseCurrency();
      const foreignAccount = await asUser({
        cookies: otherUser.cookies,
        fn: () =>
          helpers.createAccount({
            payload: helpers.buildAccountPayload({ currencyCode: FIXTURE_CURRENCY, name: 'Someone else AUD' }),
            raw: true,
          }),
      });
      const upload = await helpers.uploadMsMoneyFixture({ file: FIXTURE, password: FIXTURE_PASSWORD });

      const unknown = await runImport({
        uploadId: upload.uploadId,
        accountMapping: onlyStocksMapping({ accountId: generateRandomRecordId() }),
      });

      expectMsMoneyFailed(unknown);
      expect(unknown.error).toMatch(/does not exist or is not yours/i);
      expect(unknown.error).toContain(ACCOUNT_STOCKS);
      expect(await helpers.getTransactions({ limit: 500, raw: true })).toHaveLength(0);

      const foreign = await runImport({
        uploadId: upload.uploadId,
        accountMapping: onlyStocksMapping({ accountId: foreignAccount.id }),
      });

      expectMsMoneyFailed(foreign);
      expect(foreign.error).toMatch(/does not exist or is not yours/i);

      // Nothing landed on either side of the boundary: not in the importing
      // user's ledger, and not in the account the mapping pointed at.
      const transactions = await helpers.getTransactions({ limit: 500, raw: true });
      expect(transactions).toHaveLength(0);

      await asUser({
        cookies: otherUser.cookies,
        fn: async () => {
          const theirs = await helpers.getTransactions({ limit: 500, raw: true });
          expect(theirs).toHaveLength(0);
        },
      });
    }, 30_000);
  });

  /**
   * A linked account must carry the same currency as the Money account posting
   * into it, otherwise every imported amount would land in the wrong unit.
   */
  it('fails the job when the linked account currency differs from the file', async () => {
    const wrongCurrency = await helpers.createAccount({
      payload: helpers.buildAccountPayload({ currencyCode: global.BASE_CURRENCY_CODE, name: 'Wrong currency' }),
      raw: true,
    });
    const upload = await helpers.uploadMsMoneyFixture({ file: FIXTURE, password: FIXTURE_PASSWORD });

    const progress = await runImport({
      uploadId: upload.uploadId,
      accountMapping: onlyStocksMapping({ accountId: wrongCurrency.id }),
    });

    expectMsMoneyFailed(progress);
    expect(progress.error).toMatch(/currencies must match/i);

    const transactions = await helpers.getTransactions({ limit: 500, raw: true });
    expect(transactions.filter((t) => t.accountId === wrongCurrency.id)).toHaveLength(0);
  });

  /**
   * The client sends the new account's currency back in the mapping, so it is
   * not authoritative. A value disagreeing with the file would post every
   * imported amount in the wrong unit, so the job refuses before creating it.
   */
  it('fails the job when a create-new mapping states a currency the file does not', async () => {
    const upload = await helpers.uploadMsMoneyFixture({ file: FIXTURE, password: FIXTURE_PASSWORD });

    const progress = await runImport({
      uploadId: upload.uploadId,
      accountMapping: {
        [ACCOUNT_CURRENT]: { action: 'skip' },
        [ACCOUNT_CREDIT_CARD]: { action: 'skip' },
        [ACCOUNT_STOCKS]: { action: 'create-new', currencyCode: 'USD', currentBalance: null },
      },
    });

    expectMsMoneyFailed(progress);
    expect(progress.error).toMatch(/must use the currency from the file/i);

    const accounts = await helpers.getAccounts();
    expect(accounts.filter((a) => a.name === ACCOUNT_STOCKS)).toHaveLength(0);
    const transactions = await helpers.getTransactions({ limit: 500, raw: true });
    expect(transactions).toHaveLength(0);
  });

  /**
   * Queueing an import claims the upload exclusively, so a user who submits the
   * wizard twice cannot import the same ledger into their accounts twice. The
   * second submit is refused while the first job still owns the upload.
   */
  it('refuses a second execute while the first import still holds the upload', async () => {
    const { account } = await createAudAccount({ name: 'Exclusive AUD' });
    const upload = await helpers.uploadMsMoneyFixture({ file: FIXTURE, password: FIXTURE_PASSWORD });
    const accountMapping = onlyStocksMapping({ accountId: account.id });

    const { jobId } = await helpers.executeMsMoney({
      payload: { uploadId: upload.uploadId, accountMapping },
      raw: true,
    });

    const second = await helpers.executeMsMoney({ payload: { uploadId: upload.uploadId, accountMapping } });
    expect(second.statusCode).toBe(ERROR_CODES.ConflictError);

    const progress = await waitForMsMoneyCompletion({ jobId });
    expectMsMoneyCompleted(progress);
    expect(progress.summary.outOfWalletImported).toBe(1);

    // The refused submit wrote nothing of its own: the row exists once.
    const transactions = await helpers.getTransactions({ limit: 500, raw: true });
    expect(transactions.filter((t) => t.accountId === account.id)).toHaveLength(1);
  });

  /**
   * The claim an import takes on its upload is exclusive but not permanent: a job
   * that already failed is dead, so the user can correct the mapping in the
   * wizard and submit the same upload again without re-uploading the file.
   */
  it('lets a corrected mapping retake the upload after the first import failed', async () => {
    const { account } = await createAudAccount({ name: 'Retry AUD' });
    const upload = await helpers.uploadMsMoneyFixture({ file: FIXTURE, password: FIXTURE_PASSWORD });

    // A missing mapping entry is a bug, not an implied skip: the worker refuses
    // the whole job before writing anything.
    const failed = await runImport({
      uploadId: upload.uploadId,
      accountMapping: {
        [ACCOUNT_CURRENT]: { action: 'skip' },
        [ACCOUNT_CREDIT_CARD]: { action: 'skip' },
      },
    });
    expectMsMoneyFailed(failed);
    expect(failed.error).toMatch(/Missing account mapping/i);
    expect(await helpers.getTransactions({ limit: 500, raw: true })).toHaveLength(0);

    const retry = await helpers.executeMsMoney({
      payload: { uploadId: upload.uploadId, accountMapping: onlyStocksMapping({ accountId: account.id }) },
      raw: true,
    });
    expect(retry.jobId).toBeTruthy();
    expect(retry.jobId).not.toBe(failed.jobId);

    const progress = await waitForMsMoneyCompletion({ jobId: retry.jobId });
    expectMsMoneyCompleted(progress);
    expect(progress.summary.errors).toHaveLength(0);
    expect(progress.summary.outOfWalletImported).toBe(1);
    expect(progress.summary.accountsLinked).toBe(1);
    expect(progress.summary.accountsSkipped).toBe(2);
    expect(progress.processedCount).toBe(progress.totalCount);
    expect(progress.totalCount).toBe(1);

    // The retry wrote the row once — the failed attempt left nothing behind for
    // it to duplicate.
    const transactions = await helpers.getTransactions({ limit: 500, raw: true });
    expect(transactions.filter((t) => t.accountId === account.id)).toHaveLength(1);

    // The upload is consumed by the run that succeeded, so a third submit has
    // nothing left to claim.
    const third = await helpers.executeMsMoney({
      payload: { uploadId: upload.uploadId, accountMapping: onlyStocksMapping({ accountId: account.id }) },
    });
    expect(third.statusCode).toBe(ERROR_CODES.NotFoundError);
  });

  /**
   * The wizard refreshes this lease while the user maps accounts, so a slow
   * mapping step does not lose the cached `.mny` parse result.
   */
  describe('upload lease', () => {
    it('pushes the expiry out on every refresh and leaves the absolute ceiling where it was', async () => {
      const upload = await helpers.uploadMsMoneyFixture({ file: FIXTURE, password: FIXTURE_PASSWORD });

      const issued = at({ instant: upload.lease.expiresAt });
      expect(at({ instant: upload.lease.maxExpiresAt })).toBeGreaterThan(issued);

      await tick();
      const first = await refreshLease({ uploadId: upload.uploadId, raw: true });

      expect(at({ instant: first.expiresAt })).toBeGreaterThan(issued);
      // The ceiling is fixed when the upload is stored. Refreshing must not move
      // it, or a wizard left open would hold the parse result forever.
      expect(first.maxExpiresAt).toBe(upload.lease.maxExpiresAt);
      expect(at({ instant: first.expiresAt })).toBeLessThanOrEqual(at({ instant: first.maxExpiresAt }));

      await tick();
      const second = await refreshLease({ uploadId: upload.uploadId, raw: true });

      expect(at({ instant: second.expiresAt })).toBeGreaterThan(at({ instant: first.expiresAt }));
      expect(second.maxExpiresAt).toBe(first.maxExpiresAt);

      // A refresh is worth the whole idle TTL measured from now, not a top-up of
      // whatever was left of the previous one. The slack absorbs the round trip.
      const granted = at({ instant: second.expiresAt }) - Date.now();
      expect(granted).toBeGreaterThan(MS_MONEY_UPLOAD_IDLE_TTL_MS - 60_000);
      expect(granted).toBeLessThanOrEqual(MS_MONEY_UPLOAD_IDLE_TTL_MS);
      expect(at({ instant: second.maxExpiresAt }) - Date.now()).toBeLessThanOrEqual(MS_MONEY_UPLOAD_MAX_LIFETIME_MS);
    });

    /**
     * A refresh rewrites only the lease, so the parse result behind it has to
     * come back whole: the same duplicate detection, and an import that still
     * lands its row.
     */
    it('leaves the cached parse result intact for the following wizard steps', async () => {
      const { account } = await createAudAccount({ name: 'Lease AUD' });
      const upload = await helpers.uploadMsMoneyFixture({ file: FIXTURE, password: FIXTURE_PASSWORD });
      const accountMapping = onlyStocksMapping({ accountId: account.id });

      const before = await helpers.detectMsMoneyDuplicates({
        payload: { uploadId: upload.uploadId, accountMapping },
        raw: true,
      });
      // The linked account was created for this test and holds no transactions,
      // so nothing can match. Pinning the value keeps the equality check below
      // from passing on a stably-wrong result.
      expect(before.duplicates).toEqual([]);

      await refreshLease({ uploadId: upload.uploadId, raw: true });

      const after = await helpers.detectMsMoneyDuplicates({
        payload: { uploadId: upload.uploadId, accountMapping },
        raw: true,
      });
      expect(after).toEqual(before);

      const progress = await runImport({ uploadId: upload.uploadId, accountMapping });
      expectMsMoneyCompleted(progress);
      expect(progress.summary.errors).toHaveLength(0);
      expect(progress.summary.outOfWalletImported).toBe(1);
    });

    /**
     * The lease is scoped to the uploader. A second user holding the id gets the
     * same 404 as an id that never existed, and their attempt must leave the
     * entry usable by its owner.
     */
    it("refuses another user's upload id without disturbing it", async () => {
      const upload = await helpers.uploadMsMoneyFixture({ file: FIXTURE, password: FIXTURE_PASSWORD });
      const otherUser = await provisionSecondUserWithBaseCurrency();

      await asUser({
        cookies: otherUser.cookies,
        fn: async () => {
          const response = await refreshLease({ uploadId: upload.uploadId });
          expect(response.statusCode).toBe(ERROR_CODES.NotFoundError);
        },
      });

      const stillMine = await refreshLease({ uploadId: upload.uploadId });
      expect(stillMine.statusCode).toBe(200);
    });

    it('refuses an upload the import has already consumed', async () => {
      const { account } = await createAudAccount({ name: 'Consumed AUD' });
      const upload = await helpers.uploadMsMoneyFixture({ file: FIXTURE, password: FIXTURE_PASSWORD });

      const progress = await runImport({
        uploadId: upload.uploadId,
        accountMapping: onlyStocksMapping({ accountId: account.id }),
      });
      expectMsMoneyCompleted(progress);

      const response = await refreshLease({ uploadId: upload.uploadId });
      expect(response.statusCode).toBe(ERROR_CODES.NotFoundError);
    });
  });
});
