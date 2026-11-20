import { CATEGORIZATION_MODE, TRANSACTION_TRANSFER_NATURE } from '@bt/shared/types';
import { generateRandomRecordId } from '@common/lib/record-id-helpers';
import { describe, expect, it } from '@jest/globals';
import * as helpers from '@tests/helpers';
import { expectCompleted, waitForBudgetBakersWalletCompletion } from '@tests/helpers/import-export';

// Wallet (BudgetBakers) exports carry a fixed, required `payee` column read
// automatically (no column-mapping step). These tests drive auto-create-Payee
// through the Wallet import HTTP endpoints (execute + status poll) and assert on
// the response summary and transactions — never on logs, which Docker e2e swallows.

const WALLET_HEADER =
  'account;category;currency;amount;ref_currency_amount;type;payment_type;note;date;transfer;payee;labels';

/** Build a single Wallet CSV data row from field values, in the fixed column order. */
function walletRow({
  account,
  category = '',
  currency = 'UAH',
  amount,
  refAmount,
  type,
  paymentType = 'Cash',
  note = '',
  date,
  transfer = false,
  payee = '',
  labels = '',
}: {
  account: string;
  category?: string;
  currency?: string;
  amount: number;
  refAmount?: number;
  type: 'Expense' | 'Income';
  paymentType?: string;
  note?: string;
  date: string;
  transfer?: boolean;
  payee?: string;
  labels?: string;
}): string {
  const ref = refAmount ?? amount;
  return [
    account,
    category,
    currency,
    String(amount),
    String(ref),
    type,
    paymentType,
    note,
    date,
    transfer ? 'true' : 'false',
    payee,
    labels,
  ].join(';');
}

describe('Budget Bakers Wallet import — auto-create Payee', () => {
  /**
   * HAPPY / create-new: every non-empty `payee` with no existing match is
   * inserted on first occurrence. `payeesCreated` counts DISTINCT inserts (a
   * repeated name is created once), every ordinary transaction gets a non-null
   * `payeeId`, and two rows sharing a name resolve to the same id. Unique
   * generated names guarantee none pre-exist (so the count isn't a namespace hit).
   */
  it('create-new: inserts one Payee per distinct name and links every transaction', async () => {
    const payeeA = `Acme Store ${generateRandomRecordId()}`;
    const payeeB = `Beta Cafe ${generateRandomRecordId()}`;
    const payeeC = `Gamma Shop ${generateRandomRecordId()}`;

    const fileContent = [
      WALLET_HEADER,
      walletRow({
        account: 'PayeeAcc UAH',
        amount: 100,
        type: 'Expense',
        note: 'row-a',
        date: '2025-06-01T12:00:00.000Z',
        payee: payeeA,
      }),
      walletRow({
        account: 'PayeeAcc UAH',
        amount: 200,
        type: 'Expense',
        note: 'row-b',
        date: '2025-06-02T12:00:00.000Z',
        payee: payeeB,
      }),
      walletRow({
        account: 'PayeeAcc UAH',
        amount: 300,
        type: 'Income',
        note: 'row-c',
        date: '2025-06-03T12:00:00.000Z',
        payee: payeeC,
      }),
      // Repeat payeeA — distinct-name dedup means this must NOT create a 4th Payee.
      walletRow({
        account: 'PayeeAcc UAH',
        amount: 150,
        type: 'Expense',
        note: 'row-d',
        date: '2025-06-04T12:00:00.000Z',
        payee: payeeA,
      }),
    ].join('\n');

    const accountMapping = {
      'PayeeAcc UAH': { action: 'create-new' as const, currencyCode: 'UAH', currentBalance: null },
    };

    const { jobId } = await helpers.executeBudgetBakersWallet({
      payload: { fileContent, accountMapping, skipDuplicateIndices: [] },
      raw: true,
    });
    expect(jobId).toBeTruthy();

    const progress = await waitForBudgetBakersWalletCompletion({ jobId });
    expectCompleted(progress);
    expect(progress.summary.errors).toHaveLength(0);
    expect(progress.summary.transactionsImported).toBe(4);

    // Three distinct names → exactly three genuine inserts.
    expect(progress.summary.payeesCreated).toBe(3);

    const txs = await helpers.getTransactions({ raw: true });
    const rowA = txs.find((t) => t.note === 'row-a')!;
    const rowB = txs.find((t) => t.note === 'row-b')!;
    const rowC = txs.find((t) => t.note === 'row-c')!;
    const rowD = txs.find((t) => t.note === 'row-d')!;
    expect(rowA).toBeDefined();
    expect(rowB).toBeDefined();
    expect(rowC).toBeDefined();
    expect(rowD).toBeDefined();

    // Every transaction is linked to a Payee.
    expect(rowA.payeeId).toBeTruthy();
    expect(rowB.payeeId).toBeTruthy();
    expect(rowC.payeeId).toBeTruthy();
    expect(rowD.payeeId).toBeTruthy();

    // The two rows carrying the same payee name resolve to the same Payee id.
    expect(rowD.payeeId).toBe(rowA.payeeId);

    // The three distinct names produced three distinct ids.
    const distinctIds = new Set([rowA.payeeId, rowB.payeeId, rowC.payeeId]);
    expect(distinctIds.size).toBe(3);

    // The created Payees are visible via the payees endpoint under their names.
    const payees = await helpers.listPayees({ raw: true });
    const names = payees.map((p) => p.name);
    expect(names).toContain(payeeA);
    expect(names).toContain(payeeB);
    expect(names).toContain(payeeC);
  });

  /**
   * LINK-EXISTING via normalized match: a Payee pre-created through POST /payees
   * is reused when a Wallet row carries a case/punctuation/whitespace variant.
   * Matching goes through the Payee namespace (normalized, not a bare string
   * compare), so `payeesCreated` stays 0 and the transaction carries the existing id.
   */
  it('link-existing: a normalized-variant payee reuses the pre-created Payee and is not counted', async () => {
    const suffix = generateRandomRecordId();
    const canonicalName = `Coffee House ${suffix}`;
    // Same name with different case + trailing punctuation → normalizes equal.
    const variantInCsv = `COFFEE HOUSE! ${suffix}`;

    const existingPayee = await helpers.createPayee({ payload: { name: canonicalName }, raw: true });
    expect(existingPayee.id).toBeTruthy();

    const fileContent = [
      WALLET_HEADER,
      walletRow({
        account: 'LinkAcc UAH',
        amount: 500,
        type: 'Expense',
        note: 'link-row',
        date: '2025-06-05T10:00:00.000Z',
        payee: variantInCsv,
      }),
    ].join('\n');

    const accountMapping = {
      'LinkAcc UAH': { action: 'create-new' as const, currencyCode: 'UAH', currentBalance: null },
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

    // Existing Payee matched → nothing created.
    expect(progress.summary.payeesCreated).toBe(0);

    const txs = await helpers.getTransactions({ raw: true });
    const linkRow = txs.find((t) => t.note === 'link-row')!;
    expect(linkRow).toBeDefined();
    // The transaction links to the pre-existing Payee, not a fresh one.
    expect(linkRow.payeeId).toBe(existingPayee.id);

    // No duplicate Payee was inserted for the variant spelling.
    const payees = await helpers.listPayees({ raw: true });
    expect(payees.filter((p) => p.id === existingPayee.id)).toHaveLength(1);
    expect(payees).toHaveLength(1);
  });

  /**
   * Paired transfer legs are never scanned for a payee, and a blank `payee` cell
   * normalizes to nothing before the resolver runs.
   */
  it('transfer legs and blank payee cells import with a null payeeId and create no Payee', async () => {
    const transferPayee = `Transfer Payee ${generateRandomRecordId()}`;
    const transferDate = '2025-08-01T10:00:00.000Z';

    const fileContent = [
      WALLET_HEADER,
      walletRow({
        account: 'XferSrc USD',
        category: 'Transfer, withdraw',
        currency: 'USD',
        amount: 100,
        type: 'Expense',
        date: transferDate,
        transfer: true,
        payee: transferPayee,
      }),
      walletRow({
        account: 'XferDst USD',
        category: 'Transfer, withdraw',
        currency: 'USD',
        amount: 100,
        type: 'Income',
        date: transferDate,
        transfer: true,
        payee: transferPayee,
      }),
      walletRow({
        account: 'EmptyAcc UAH',
        amount: 100,
        type: 'Expense',
        note: 'empty-a',
        date: '2025-06-06T10:00:00.000Z',
        payee: '',
      }),
      walletRow({
        account: 'EmptyAcc UAH',
        amount: 200,
        type: 'Income',
        note: 'empty-b',
        date: '2025-06-07T10:00:00.000Z',
        payee: '',
      }),
    ].join('\n');

    const accountMapping = {
      'XferSrc USD': { action: 'create-new' as const, currencyCode: 'USD', currentBalance: null },
      'XferDst USD': { action: 'create-new' as const, currencyCode: 'USD', currentBalance: null },
      'EmptyAcc UAH': { action: 'create-new' as const, currencyCode: 'UAH', currentBalance: null },
    };

    const { jobId } = await helpers.executeBudgetBakersWallet({
      payload: { fileContent, accountMapping, skipDuplicateIndices: [] },
      raw: true,
    });
    expect(jobId).toBeTruthy();

    const progress = await waitForBudgetBakersWalletCompletion({ jobId });
    expectCompleted(progress);
    expect(progress.summary.errors).toHaveLength(0);
    // The two legs paired into a single transfer.
    expect(progress.summary.transfersImported).toBe(1);
    expect(progress.summary.transactionsImported).toBe(2);
    expect(progress.summary.payeesCreated).toBe(0);

    const txs = await helpers.getTransactions({ raw: true });
    const transferLegs = txs.filter((t) => t.transferNature === TRANSACTION_TRANSFER_NATURE.common_transfer);
    expect(transferLegs).toHaveLength(2);
    for (const leg of transferLegs) {
      expect(leg.payeeId).toBeNull();
    }

    const emptyA = txs.find((t) => t.note === 'empty-a')!;
    const emptyB = txs.find((t) => t.note === 'empty-b')!;
    expect(emptyA).toBeDefined();
    expect(emptyB).toBeDefined();
    expect(emptyA.payeeId).toBeNull();
    expect(emptyB.payeeId).toBeNull();

    const payees = await helpers.listPayees({ raw: true });
    expect(payees).toHaveLength(0);
  });

  /**
   * A mapped category column beats an `enforce` Payee's `defaultCategoryId`.
   * The Payee default only fills rows whose category cell is blank.
   */
  it('category precedence: a mapped category wins over the enforce Payee default, which fills an unmapped row', async () => {
    const suffix = generateRandomRecordId();

    // The category the mapped CSV row points at (the winner on that row).
    const mappedCategory = await helpers.addCustomCategory({
      name: `Mapped Cat ${suffix}`,
      color: '#3366AA',
      raw: true,
    });
    // The Payee's enforce default: loses on the mapped row, fills the blank one.
    const payeeDefaultCategory = await helpers.addCustomCategory({
      name: `Payee Default Cat ${suffix}`,
      color: '#AA3366',
      raw: true,
    });
    expect(mappedCategory.id).toBeTruthy();
    expect(payeeDefaultCategory.id).toBeTruthy();

    const payeeName = `Enforce Payee ${suffix}`;
    const enforcePayee = await helpers.createPayee({
      payload: {
        name: payeeName,
        categorizationMode: CATEGORIZATION_MODE.enforce,
        defaultCategoryId: payeeDefaultCategory.id,
      },
      raw: true,
    });
    expect(enforcePayee.id).toBeTruthy();

    const fileContent = [
      WALLET_HEADER,
      walletRow({
        account: 'PrecAcc UAH',
        category: `Mapped Cat ${suffix}`,
        amount: 400,
        type: 'Expense',
        note: 'prec-mapped',
        date: '2025-06-08T10:00:00.000Z',
        payee: payeeName,
      }),
      // Blank category cell → no mapped category for this row.
      walletRow({
        account: 'PrecAcc UAH',
        category: '',
        amount: 400,
        type: 'Expense',
        note: 'prec-default',
        date: '2025-06-09T10:00:00.000Z',
        payee: payeeName,
      }),
    ].join('\n');

    const accountMapping = {
      'PrecAcc UAH': { action: 'create-new' as const, currencyCode: 'UAH', currentBalance: null },
    };
    const categoryMapping = {
      [`Mapped Cat ${suffix}`]: { action: 'link-existing' as const, categoryId: mappedCategory.id },
    };

    const { jobId } = await helpers.executeBudgetBakersWallet({
      payload: { fileContent, accountMapping, categoryMapping, skipDuplicateIndices: [] },
      raw: true,
    });
    expect(jobId).toBeTruthy();

    const progress = await waitForBudgetBakersWalletCompletion({ jobId });
    expectCompleted(progress);
    expect(progress.summary.errors).toHaveLength(0);
    expect(progress.summary.transactionsImported).toBe(2);
    // Payee already existed (reused), category was link-existing.
    expect(progress.summary.payeesCreated).toBe(0);
    expect(progress.summary.categoriesCreated).toBe(0);

    const txs = await helpers.getTransactions({ raw: true });
    const mappedTx = txs.find((t) => t.note === 'prec-mapped')!;
    const defaultTx = txs.find((t) => t.note === 'prec-default')!;
    expect(mappedTx).toBeDefined();
    expect(defaultTx).toBeDefined();

    // Both rows link the Payee...
    expect(mappedTx.payeeId).toBe(enforcePayee.id);
    expect(defaultTx.payeeId).toBe(enforcePayee.id);
    // ...but the MAPPED category wins over the Payee's enforce default.
    expect(mappedTx.categoryId).toBe(mappedCategory.id);
    expect(mappedTx.categoryId).not.toBe(payeeDefaultCategory.id);
    // With no mapped category, the Payee's enforce default fills the category.
    expect(defaultTx.categoryId).toBe(payeeDefaultCategory.id);
  });

  /**
   * SKIP-DUPLICATE orphan guard: Phase 4b resolves payees from
   * `transactionsToWrite` (post-skip), so a payee confined to a skipped-duplicate
   * row never enters the resolver — no orphan Payee, no `payeesCreated` bump. A
   * payee on a written row is still created as usual.
   */
  it('skip-duplicate: a payee found only on a skipped row is not created and leaves no orphan', async () => {
    const writtenPayee = `Written Payee ${generateRandomRecordId()}`;
    const skippedPayee = `Skipped Payee ${generateRandomRecordId()}`;

    const fileContent = [
      WALLET_HEADER,
      // rowIndex 2 — written; its payee IS created.
      walletRow({
        account: 'SkipAcc UAH',
        amount: 100,
        type: 'Expense',
        note: 'written-row',
        date: '2025-06-10T10:00:00.000Z',
        payee: writtenPayee,
      }),
      // rowIndex 3 — skipped as a confirmed duplicate; its payee must NOT be created.
      walletRow({
        account: 'SkipAcc UAH',
        amount: 200,
        type: 'Expense',
        note: 'skipped-row',
        date: '2025-06-11T10:00:00.000Z',
        payee: skippedPayee,
      }),
    ].join('\n');

    const accountMapping = {
      'SkipAcc UAH': { action: 'create-new' as const, currencyCode: 'UAH', currentBalance: null },
    };

    // The parser numbers rows from the header (line 1); the first data row is
    // rowIndex 2, so the second data row — the one to skip — is rowIndex 3.
    const { jobId } = await helpers.executeBudgetBakersWallet({
      payload: { fileContent, accountMapping, skipDuplicateIndices: [3] },
      raw: true,
    });
    expect(jobId).toBeTruthy();

    const progress = await waitForBudgetBakersWalletCompletion({ jobId });
    expectCompleted(progress);
    expect(progress.summary.errors).toHaveLength(0);
    // Only the written row landed; the skipped row was counted, not written.
    expect(progress.summary.transactionsImported).toBe(1);
    expect(progress.summary.duplicatesSkipped).toBe(1);
    // Exactly one Payee created — the skipped-row payee never entered the resolver.
    expect(progress.summary.payeesCreated).toBe(1);

    const txs = await helpers.getTransactions({ raw: true });
    const writtenRow = txs.find((t) => t.note === 'written-row')!;
    expect(writtenRow).toBeDefined();
    expect(writtenRow.payeeId).toBeTruthy();
    // The skipped row produced no transaction at all.
    expect(txs.find((t) => t.note === 'skipped-row')).toBeUndefined();

    const payees = await helpers.listPayees({ raw: true });
    const names = payees.map((p) => p.name);
    // The written-row payee is created and linked to its transaction.
    expect(names).toContain(writtenPayee);
    expect(payees.find((p) => p.name === writtenPayee)!.id).toBe(writtenRow.payeeId);
    // The skipped-row payee is neither created nor left behind as an orphan.
    expect(names).not.toContain(skippedPayee);
    expect(payees).toHaveLength(1);
  });

  /**
   * PAYEE DEFAULT-TAGS union: a row matching a Payee with default tags AND adding
   * its own `labels` tag ends up with BOTH sets. The imported label is an explicit
   * tag list, which short-circuits createTransaction's payee-default step, so the
   * importer re-applies those defaults on top (add-only, like the CSV importer).
   */
  it('payee default tags: an imported label unions with the linked Payee default tags', async () => {
    const suffix = generateRandomRecordId();
    const defaultTagName = `payee-default-${suffix}`;
    const importedLabel = `imported-label-${suffix}`;

    // Pre-create the tag, then a Payee that carries it as a default tag.
    const defaultTag = await helpers.createTag({
      payload: { name: defaultTagName, color: '#5533AA' },
      raw: true,
    });
    expect(defaultTag.id).toBeTruthy();

    const payeeName = `Union Payee ${suffix}`;
    const payee = await helpers.createPayee({
      payload: { name: payeeName, defaultTagIds: [defaultTag.id] },
      raw: true,
    });
    expect(payee.id).toBeTruthy();

    const fileContent = [
      WALLET_HEADER,
      walletRow({
        account: 'UnionAcc UAH',
        amount: 400,
        type: 'Expense',
        note: 'union-row',
        date: '2025-06-12T10:00:00.000Z',
        payee: payeeName,
        labels: importedLabel,
      }),
    ].join('\n');

    const accountMapping = {
      'UnionAcc UAH': { action: 'create-new' as const, currencyCode: 'UAH', currentBalance: null },
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
    // Payee pre-existed (matched, not created); only the imported label is new.
    expect(progress.summary.payeesCreated).toBe(0);
    expect(progress.summary.tagsCreated).toBe(1);

    const txs = await helpers.getTransactions({ raw: true });
    const unionRow = txs.find((t) => t.note === 'union-row')!;
    expect(unionRow).toBeDefined();
    // The row linked to the pre-existing Payee, so its defaults are in play.
    expect(unionRow.payeeId).toBe(payee.id);

    const tagNames = (((unionRow as any).tags as Array<{ id: string; name: string }> | undefined) ?? []).map(
      (t) => t.name,
    );
    // Union: the imported label AND the Payee's default tag, nothing dropped.
    expect(tagNames).toEqual(expect.arrayContaining([importedLabel, defaultTagName]));
    expect(tagNames).toHaveLength(2);
  });
});
