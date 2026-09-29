import {
  AI_FEATURE,
  AI_PROVIDER,
  API_ERROR_CODES,
  BANK_PROVIDER_TYPE,
  DEACTIVATION_REASON,
  PLANS,
  RESOURCE_TYPES,
  type RecordId,
  SHARE_PERMISSIONS,
  SUBSCRIPTION_FREQUENCIES,
  TRANSACTION_TRANSFER_NATURE,
  TRANSACTION_TYPES,
  VEHICLE_CLASS,
} from '@bt/shared/types';
import { INVESTMENT_TRANSACTION_CATEGORY } from '@bt/shared/types/investments';
import { VENTURE_CASH_FLOW_MODE, VENTURE_EVENT_TYPE } from '@bt/shared/types/venture';
import { generateRandomRecordId } from '@common/lib/record-id-helpers';
import { beforeEach, describe, expect, it } from '@jest/globals';
import { RateLimitService } from '@services/common/rate-limit.service';
import * as helpers from '@tests/helpers';
import { VALID_ANTHROPIC_API_KEY } from '@tests/mocks/anthropic/mock-api';
import { VALID_MONOBANK_TOKEN } from '@tests/mocks/monobank/mock-api';
import { randomUUID } from 'node:crypto';

type Row = Record<string, unknown>;

const LEGACY_ENDPOINT_BASE_URL = 'http://ollama.home.test/v1';

// Tables whose restored copy legitimately differs from the dump: `user` and
// `user-settings` are re-created rather than bulk-inserted (fresh ids/timestamps,
// Zod-normalized settings).
const ROUNDTRIP_EXCLUDED = new Set(['user', 'user-settings']);

// --- Canonicalization: order-independent, key-sorted deep equality -----------

function deepSort(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(deepSort);
  if (value && typeof value === 'object') {
    const out: Row = {};
    for (const key of Object.keys(value as Row).sort()) out[key] = deepSort((value as Row)[key]);
    return out;
  }
  return value;
}

/** A stable, sorted list of canonical JSON strings for a row array. */
function canonicalRows(rows: unknown): string[] {
  const arr = Array.isArray(rows) ? rows : [];
  return arr.map((row) => JSON.stringify(deepSort(row))).sort();
}

// --- Archive read/write helpers (for building tampered uploads) --------------

function readArchiveJson({ files, path }: { files: Map<string, Buffer>; path: string }): unknown {
  const buf = files.get(path);
  return buf ? JSON.parse(buf.toString('utf8')) : null;
}

function writeArchiveJson({ files, path, value }: { files: Map<string, Buffer>; path: string; value: unknown }): void {
  files.set(path, Buffer.from(JSON.stringify(value)));
}

function archiveText({ buffer }: { buffer: Buffer }): string {
  const { files } = helpers.parseBackupArchive({ buffer });
  return [...files.values()].map((buf) => buf.toString('utf8')).join('\n');
}

async function getCurrentUserId(): Promise<number> {
  const user = await helpers.makeRequest({ method: 'get', url: '/user', raw: true });
  return (user as { id: number }).id;
}

/** Export the current user and return both the raw zip and its base64 upload form. */
async function exportArchive(): Promise<{ buffer: Buffer; base64: string }> {
  const res = await helpers.exportBackup();
  expect(res.statusCode).toBe(200);
  const buffer = res.body;
  return { buffer, base64: buffer.toString('base64') };
}

const summarizeHistory = async () =>
  (await helpers.getReconciliationHistory({ raw: true })).map((event) => ({
    type: event.type,
    survivorId: event.survivor?.id ?? null,
    transactionIds: event.transactions.map((tx) => tx.id).toSorted(),
  }));

// --- Seeders -----------------------------------------------------------------

/** A broad, cross-tier dataset exercising money, transfers, splits, refunds,
 *  self-ref categories, composite-PK tables, investments and venture. */
async function seedRichData() {
  await helpers.addUserCurrencies({ currencyCodes: ['USD'], raw: true });
  await helpers.updateUserSettings({ settings: { locale: 'uk' } });
  await helpers.editCurrencyExchangeRate({
    pairs: [{ baseCode: global.BASE_CURRENCY_CODE, quoteCode: 'USD', rate: 0.27 }],
    raw: true,
  });

  const checking = await helpers.createAccount({
    payload: helpers.buildAccountPayload({ name: 'Checking', initialBalance: 500000 }),
    raw: true,
  });
  const savings = await helpers.createAccount({
    payload: helpers.buildAccountPayload({ name: 'Savings', initialBalance: 1000000 }),
    raw: true,
  });

  const parentCategory = await helpers.addCustomCategory({ name: 'Living', color: '#112233', raw: true });
  const childCategory = await helpers.addCustomCategory({
    name: 'Groceries',
    color: '#445566',
    parentId: parentCategory.id,
    raw: true,
  });

  const tag = await helpers.createTag({ payload: helpers.buildTagPayload({ name: 'reimbursable' }), raw: true });

  const payee = await helpers.createPayee({ payload: helpers.buildPayeePayload({ name: 'Corner Shop' }), raw: true });
  await helpers.createPayeeAlias({ payeeId: payee.id, rawName: 'CORNER SHOP #12', raw: true });

  // Template pinned to an account, carrying every optional relation and two tags.
  const templateTag = await helpers.createTag({ payload: helpers.buildTagPayload({ name: 'weekly' }), raw: true });
  await helpers.createTransactionTemplate({
    payload: {
      name: 'Weekly groceries',
      transactionType: TRANSACTION_TYPES.expense,
      amount: 42.5,
      accountId: checking.id,
      categoryId: childCategory.id,
      payeeId: payee.id,
      tagIds: [tag.id, templateTag.id],
    },
    raw: true,
  });

  // Expense with a split + a tag.
  const [expense] = await helpers.createTransaction({
    payload: helpers.buildTransactionPayload({
      accountId: checking.id,
      amount: 3000,
      transactionType: TRANSACTION_TYPES.expense,
      categoryId: childCategory.id,
      splits: [{ categoryId: parentCategory.id, amount: 1200 }],
    }),
    raw: true,
  });
  await helpers.addTransactionsToTag({ tagId: tag.id, transactionIds: [expense!.id], raw: true });

  // Transfer pair between the two accounts.
  await helpers.createTransaction({
    payload: {
      ...helpers.buildTransactionPayload({
        accountId: checking.id,
        amount: 2500,
        transactionType: TRANSACTION_TYPES.expense,
        categoryId: childCategory.id,
      }),
      transferNature: TRANSACTION_TRANSFER_NATURE.common_transfer,
      destinationAmount: 2500,
      destinationAccountId: savings.id,
    },
    raw: true,
  });

  // Refund: an income transaction refunding the original expense.
  const [refundTx] = await helpers.createTransaction({
    payload: helpers.buildTransactionPayload({
      accountId: checking.id,
      amount: 1000,
      transactionType: TRANSACTION_TYPES.income,
      categoryId: childCategory.id,
    }),
    raw: true,
  });
  await helpers.createSingleRefund({ originalTxId: expense!.id, refundTxId: refundTx!.id }, true);

  // Budget over a category, with a linked transaction.
  const budget = await helpers.createCustomBudget({
    name: 'Monthly',
    limitAmount: 50000,
    categoryIds: [parentCategory.id],
    raw: true,
  });
  await helpers.addTransactionToCustomBudget({ id: budget.id, payload: { transactionIds: [expense!.id] }, raw: true });

  // Subscription (generates periods).
  await helpers.createSubscription({
    name: 'Streaming',
    expectedAmount: 1599,
    expectedCurrencyCode: global.BASE_CURRENCY_CODE,
    frequency: SUBSCRIPTION_FREQUENCIES.monthly,
    startDate: '2025-01-01',
    raw: true,
  });

  // Automation carrying owned ids in both its conditions and its actions.
  await helpers.createAutomation({
    payload: {
      name: 'Corner shop groceries',
      conditions: { match: 'all', items: [{ field: 'account', operator: 'in', value: [checking.id as RecordId] }] },
      actions: [
        { type: 'set_category', categoryId: childCategory.id as RecordId },
        { type: 'add_tags', tagIds: [tag.id as RecordId] },
      ],
    },
    raw: true,
  });

  // Loan + vehicle (each spins up its own backing account).
  await helpers.createLoan({ payload: helpers.buildCreateLoanPayload(), raw: true });
  await helpers.createVehicle({
    name: 'Daily Driver',
    currencyCode: global.BASE_CURRENCY.code,
    make: 'Toyota',
    model: 'Corolla',
    year: 2020,
    vehicleClass: VEHICLE_CLASS.sedan,
    purchasePrice: 2000000,
    purchaseDate: '2022-01-01',
    raw: true,
  });

  // Investments: portfolio + security + holding + a buy.
  const portfolio = await helpers.createPortfolio({ payload: { name: 'Brokerage' }, raw: true });
  const [security] = await helpers.seedSecurities([{ symbol: 'VOO', name: 'Vanguard S&P 500 ETF' }]);
  await helpers.createHolding({ payload: { portfolioId: portfolio.id, securityId: security!.id }, raw: true });
  await helpers.createInvestmentTransaction({
    payload: {
      portfolioId: portfolio.id,
      securityId: security!.id,
      category: INVESTMENT_TRANSACTION_CATEGORY.buy,
      quantity: '3',
      price: '410.55',
      date: '2025-02-01',
    },
    raw: true,
  });

  // Venture: platform -> deal -> event.
  const platform = await helpers.createVenturePlatform({ payload: { name: 'Acme Ventures' }, raw: true });
  const deal = await helpers.createVentureDeal({
    payload: { name: 'Seed deal', platformId: platform.id, currencyCode: 'USD' },
    raw: true,
  });
  await helpers.createVentureEvent({
    dealId: deal.id,
    payload: {
      type: VENTURE_EVENT_TYPE.nav_update,
      eventDate: '2026-06-24',
      cashFlowMode: VENTURE_CASH_FLOW_MODE.none,
      navAfter: '18500',
    },
    raw: true,
  });

  return { checking, savings, parentCategory, childCategory, portfolio, security: security! };
}

/** A lighter dataset: two accounts, a category tree, a tagged transaction. */
async function seedBasicData() {
  const accountA = await helpers.createAccount({
    payload: helpers.buildAccountPayload({ name: 'Account A', initialBalance: 300000 }),
    raw: true,
  });
  const accountB = await helpers.createAccount({
    payload: helpers.buildAccountPayload({ name: 'Account B', initialBalance: 150000 }),
    raw: true,
  });
  const category = await helpers.addCustomCategory({ name: 'Utilities', color: '#0a0b0c', raw: true });

  const [tx] = await helpers.createTransaction({
    payload: helpers.buildTransactionPayload({
      accountId: accountA.id,
      amount: 4200,
      transactionType: TRANSACTION_TYPES.expense,
      categoryId: category.id,
    }),
    raw: true,
  });

  return { accountA, accountB, category, tx: tx! };
}

describe('Data backup restore (POST /user/backup/restore)', () => {
  // Export and restore have their own per-user rate buckets (5 per 15 min each),
  // enforced in the test env. Reset both for the primary user before each case.
  beforeEach(async () => {
    const userId = await getCurrentUserId();
    await RateLimitService.resetRateLimit(`backup:user:${userId}`);
    await RateLimitService.resetRateLimit(`backup-restore:user:${userId}`);
  });

  describe('Round-trip', () => {
    it('restoring an export into the same user reproduces every table byte-for-byte, with no foreign-reference warnings', async () => {
      await seedRichData();

      const first = await exportArchive();
      const firstArchive = helpers.parseBackupArchive({ buffer: first.buffer });

      // Sanity: the dump is genuinely populated, so equality below is not vacuous.
      expect((firstArchive.readData({ name: 'transactions' }) as unknown[]).length).toBeGreaterThan(0);
      expect((firstArchive.readData({ name: 'holdings' }) as unknown[]).length).toBeGreaterThan(0);
      expect((firstArchive.readData({ name: 'transaction-splits' }) as unknown[]).length).toBeGreaterThan(0);
      expect((firstArchive.readData({ name: 'transaction-templates' }) as unknown[]).length).toBeGreaterThan(0);
      expect((firstArchive.readData({ name: 'transaction-template-tags' }) as unknown[]).length).toBeGreaterThan(0);

      const restore = await helpers.restoreBackup({ fileContent: first.base64 });
      expect(restore.statusCode).toBe(200);
      expect(restore.jobId).toBeTruthy();
      const status = await helpers.waitForRestore({ jobId: restore.jobId! });
      expect(status.status).toBe('completed');

      const warnings = status.summary?.warnings ?? [];
      expect(warnings.some((w) => w.code === 'foreign_reference_dropped')).toBe(false);
      expect(warnings.some((w) => w.code === 'foreign_reference_nulled')).toBe(false);

      const second = await exportArchive();
      const secondArchive = helpers.parseBackupArchive({ buffer: second.buffer });

      const dataNames = [...firstArchive.files.keys()]
        .filter((p) => p.startsWith('data/') && p.endsWith('.json'))
        .map((p) => p.slice('data/'.length, -'.json'.length));

      for (const name of dataNames) {
        if (ROUNDTRIP_EXCLUDED.has(name)) continue;
        const before = canonicalRows(firstArchive.readData({ name }));
        const after = canonicalRows(secondArchive.readData({ name }));
        expect({ name, rows: after }).toEqual({ name, rows: before });
      }

      // reference/securities.json must also round-trip (prices aren't part of a backup).
      const secBefore = canonicalRows(
        readArchiveJson({ files: firstArchive.files, path: 'reference/securities.json' }),
      );
      const secAfter = canonicalRows(
        readArchiveJson({ files: secondArchive.files, path: 'reference/securities.json' }),
      );
      expect(secAfter).toEqual(secBefore);
      expect(secBefore.length).toBeGreaterThan(0);

      // User-scoped fields the restore updates in place survive the round-trip.
      const userBefore = firstArchive.readData({ name: 'user' }) as Row;
      const userAfter = secondArchive.readData({ name: 'user' }) as Row;
      for (const field of ['defaultCategoryId', 'firstName', 'lastName', 'middleName', 'totalBalance', 'avatar']) {
        expect(userAfter[field]).toEqual(userBefore[field]);
      }

      // The non-default setting round-trips through the Zod re-parse.
      const settingsAfter = (secondArchive.readData({ name: 'user-settings' }) as Row[])[0]!;
      expect((settingsAfter.settings as { locale?: string }).locale).toBe('uk');
    });

    it('keeps merged and removed bank rows in reconciliation history', async () => {
      const { account, transactions } = await helpers.monobank.mockTransactions({
        transactions: [{ amount: -1000 }, { amount: -2000 }, { amount: -3000 }],
      });
      const [survivor, merged, removed] = transactions.filter((tx) => tx.accountId === account.id);
      await helpers.reconciliationMerge({
        transactionIds: [survivor!.id, merged!.id],
        survivorId: survivor!.id,
        raw: true,
      });
      await helpers.reconciliationRemove({ transactionIds: [removed!.id], raw: true });

      const before = await summarizeHistory();
      expect(before).toHaveLength(2);

      const { base64 } = await exportArchive();
      const restore = await helpers.restoreBackup({ fileContent: base64 });
      expect(restore.statusCode).toBe(200);
      expect((await helpers.waitForRestore({ jobId: restore.jobId! })).status).toBe('completed');

      expect(await summarizeHistory()).toEqual(before);
    }, 30000);
  });

  describe('Cross-user restore', () => {
    it('re-owns every restored row under the target user, leaving nothing under the source', async () => {
      const { accountA, accountB, tx } = await seedBasicData();
      const portfolio = await helpers.createPortfolio({ payload: { name: 'Source PF' }, raw: true });
      const [security] = await helpers.seedSecurities([{ symbol: 'VTI', name: 'Vanguard Total Market' }]);
      await helpers.createHolding({ payload: { portfolioId: portfolio.id, securityId: security!.id }, raw: true });

      const sourceUserId = await getCurrentUserId();
      const sourceAccountIds = new Set([accountA.id, accountB.id]);
      const { base64 } = await exportArchive();

      // Free the source UUIDs so restoring the same ids into another user on this
      // single instance can't collide (a real cross-instance restore wouldn't).
      const wipeRes = await helpers.wipeUserData();
      expect(wipeRes.statusCode).toBe(200);
      expect(await helpers.getAccounts()).toHaveLength(0);

      const target = await helpers.provisionSecondUserWithBaseCurrency();
      await helpers.asUser({
        cookies: target.cookies,
        fn: async () => {
          // Restoring another account's archive is a self-host/cross-instance move; the
          // cloud preflight rejects it on the manifest owner (see "Archive ownership").
          const restore = await helpers.withSelfHost(() => helpers.restoreBackup({ fileContent: base64 }));
          expect(restore.statusCode).toBe(200);
          const status = await helpers.waitForRestore({ jobId: restore.jobId! });
          expect(status.status).toBe('completed');

          // The target now sees the source's accounts, by their original UUIDs.
          const targetAccounts = await helpers.getAccounts();
          const targetAccountIds = new Set(targetAccounts.map((a) => a.id));
          for (const id of sourceAccountIds) expect(targetAccountIds.has(id)).toBe(true);

          // The tagged transaction is visible under the target user too.
          const targetTx = await helpers.getTransactionById({ id: tx.id, raw: true });
          expect(targetTx).not.toBeNull();

          // Holdings were remapped and are readable under the target.
          const holdings = await helpers.getHoldings({ portfolioId: portfolio.id, payload: {}, raw: true });
          expect(holdings.some((h) => h.securityId === security!.id)).toBe(true);
        },
      });

      // The source user stays empty — restore did not resurrect its rows.
      expect(await helpers.getAccounts()).toHaveLength(0);
      expect(sourceUserId).not.toBe(await helpers.findAppUserByEmail({ email: target.email }).then((u) => u.id));
    });
  });

  // The reported production bug: a user backed up their own account and restored it
  // onto a demo account on a SHARED preview DB, where the source rows are still live.
  // Verbatim-PK inserts then collided with the source's own rows (e.g.
  // `SequelizeUniqueConstraintError ... UsersCurrencies_pkey ... already exists`).
  // keep-if-free remap keeps a backup id only when no other row already holds it and
  // remints a fresh uuidv7 otherwise, so a live source no longer breaks the restore.
  // (The "Cross-user restore" case above deliberately WIPES the source first to free
  // the ids — this one is its inverse: the source stays live to force the collision.)
  describe('Cross-account restore without wiping source', () => {
    it('restores onto another user without colliding on the still-live source ids', async () => {
      const { checking, portfolio } = await seedRichData();

      // Snapshot the source as it exists BEFORE the restore: its live rows still hold
      // every backup UUID, so restoring the same file onto another user forces the
      // exact collision the fix guards against.
      const sourceUserId = await getCurrentUserId();
      const sourceAccounts = await helpers.getAccounts();
      const sourceAccountIds = new Set(sourceAccounts.map((a) => a.id));
      const sourcePortfolioId = portfolio.id;

      // Source UsersCurrencies (the colliding table from the bug report). Its PK is a
      // UUIDv7 `id`, so two users holding the same backup id would hit UsersCurrencies_pkey.
      const sourceCurrencyCodes = (await helpers.getUserCurrencies()).map((c) => c.currencyCode).toSorted();

      // Source transactions, incl. the transfer pair whose two legs share a `transferId`.
      const sourceTx = await helpers.getTransactions({ raw: true, limit: 500 });
      const sourceTransferLegs = sourceTx.filter(
        (t) => t.transferNature === TRANSACTION_TRANSFER_NATURE.common_transfer,
      );
      const sourceTransferId = sourceTransferLegs[0]?.transferId;

      // Sanity: the dataset genuinely exercises the colliding tables and the transfer pair.
      expect(sourceAccountIds.size).toBeGreaterThan(0);
      expect(sourceCurrencyCodes.length).toBeGreaterThan(0);
      expect(sourceTransferLegs).toHaveLength(2);
      expect(sourceTransferId).toBeTruthy();

      // Export, but crucially DO NOT wipe the source — its rows stay live to collide.
      const { base64 } = await exportArchive();

      const target = await helpers.provisionSecondUserWithBaseCurrency();
      await helpers.asUser({
        cookies: target.cookies,
        fn: async () => {
          // Core regression: this completed only after keep-if-free remap. Before the
          // fix the worker threw the UsersCurrencies_pkey collision and the job failed.
          // Self-host because the cloud preflight rejects another account's manifest.
          const restore = await helpers.withSelfHost(() => helpers.restoreBackup({ fileContent: base64 }));
          expect(restore.statusCode).toBe(200);
          const status = await helpers.waitForRestore({ jobId: restore.jobId! });
          expect(status.status).toBe('completed');

          // The target received the full account set from the backup.
          const targetAccounts = await helpers.getAccounts();
          expect(targetAccounts.length).toBe(sourceAccounts.length);
          const targetAccountIds = new Set(targetAccounts.map((a) => a.id));

          // Disjoint-ids proof: the source still owns every original account UUID, so
          // the target's accounts MUST have been reminted — not one target id may equal
          // a source id. Verbatim reuse (the pre-fix behaviour) would share ids here.
          for (const id of targetAccountIds) expect(sourceAccountIds.has(id)).toBe(false);

          const targetTagIds = new Set<string>((await helpers.getTags({ raw: true })).map((row) => row.id));

          // The template's account and tag links resolve to the target's own reminted
          // rows, proving both the FK column and the join table were rewritten.
          const targetTemplates = await helpers.getTransactionTemplates({ raw: true });
          expect(targetTemplates).toHaveLength(1);
          expect(targetTemplates[0]!.name).toBe('Weekly groceries');
          expect(targetAccountIds.has(targetTemplates[0]!.accountId!)).toBe(true);
          expect(targetTemplates[0]!.tagIds).toHaveLength(2);
          for (const tagId of targetTemplates[0]!.tagIds) expect(targetTagIds.has(tagId)).toBe(true);

          // UsersCurrencies restored: the exact source currency codes are readable under
          // the target, proving the colliding rows landed (with fresh ids) rather than
          // being dropped.
          const targetCurrencyCodes = (await helpers.getUserCurrencies()).map((c) => c.currencyCode).toSorted();
          expect(targetCurrencyCodes).toEqual(sourceCurrencyCodes);

          // Internal consistency: every restored transaction points at one of the
          // target's own (reminted) accounts — never a dangling source id. This is what
          // proves the FKs were rewritten through the per-table old→final id map, not
          // left pointing at the source rows.
          const targetTx = await helpers.getTransactions({ raw: true, limit: 500 });
          expect(targetTx.length).toBe(sourceTx.length);
          for (const t of targetTx) expect(targetAccountIds.has(t.accountId)).toBe(true);

          // The seeded transfer pair is visible under the target, queried by the SOURCE's
          // transferId: `transferId` is a shared token copied verbatim (no PK constraint,
          // so nothing to remap), so both legs still resolve under it and still agree.
          const targetLegs = await helpers.getTransactionsByTransferId({ transferId: sourceTransferId!, raw: true });
          expect(targetLegs).toHaveLength(2);
          for (const leg of targetLegs) expect(leg.transferId).toBe(sourceTransferId);

          // Holdings resolve under the target's own (reminted) portfolio. The source
          // portfolio id was taken, so it must not appear among the target's portfolios,
          // and the restored holding must hang off one that does.
          const targetPortfolios = (await helpers.listPortfolios({ raw: true })).data;
          // Set<string> so it accepts both the RecordId-branded portfolio ids and the
          // plain-string portfolioId the holdings helper returns.
          const targetPortfolioIds = new Set<string>(targetPortfolios.map((p) => p.id));
          expect(targetPortfolioIds.has(sourcePortfolioId)).toBe(false);

          let restoredHolding: { portfolioId: string } | undefined;
          for (const p of targetPortfolios) {
            const holdings = await helpers.getHoldings({ portfolioId: p.id, payload: {}, raw: true });
            if (holdings.length > 0) {
              restoredHolding = holdings[0];
              break;
            }
          }
          expect(restoredHolding).toBeDefined();
          expect(targetPortfolioIds.has(restoredHolding!.portfolioId)).toBe(true);

          // The automation's embedded ids point at the target's own rows, not the
          // source ids the backup carried.
          const automations = await helpers.listAutomations({ raw: true });
          expect(automations).toHaveLength(1);

          const ruleAccountIds = automations[0]!.conditions.items.flatMap((item) =>
            item.field === 'account' ? item.value : [],
          );
          expect(ruleAccountIds).toHaveLength(1);
          expect(targetAccountIds.has(ruleAccountIds[0]!)).toBe(true);

          const targetCategoryIds = new Set<string>((await helpers.getCategoriesList()).map((row) => row.id));
          expect(automations[0]!.actions).toHaveLength(2);
          for (const action of automations[0]!.actions) {
            if (action.type === 'set_category') expect(targetCategoryIds.has(action.categoryId)).toBe(true);
            if (action.type === 'add_tags') expect(targetTagIds.has(action.tagIds[0]!)).toBe(true);
          }
        },
      });

      // Source-intact proof: restoring onto the target must not have altered or deleted
      // a single source row. Back as the source user, its accounts are all still present
      // under the SAME original ids, and its UsersCurrencies are unchanged.
      expect(await getCurrentUserId()).toBe(sourceUserId);
      const sourceAccountsAfter = await helpers.getAccounts();
      expect(new Set(sourceAccountsAfter.map((a) => a.id))).toEqual(sourceAccountIds);
      expect(sourceAccountsAfter.some((a) => a.id === checking.id)).toBe(true);
      const sourceCurrencyCodesAfter = (await helpers.getUserCurrencies()).map((c) => c.currencyCode).toSorted();
      expect(sourceCurrencyCodesAfter).toEqual(sourceCurrencyCodes);
    });

    it('remaps the FIRE excluded categories and portfolio return source to the reminted ids', async () => {
      const category = await helpers.addCustomCategory({ name: 'Rent', color: '#445566', raw: true });
      const portfolio = await helpers.createPortfolio({ payload: { name: 'FIRE PF' }, raw: true });
      await helpers.setUserBilling({ plan: PLANS.plus });
      await helpers.patchUserSettings({
        raw: true,
        patch: {
          fire: { spendingExcludedCategoryIds: [category.id], returnIndicatorId: `portfolio:${portfolio.id}` },
        },
      });

      const { base64 } = await exportArchive();

      const target = await helpers.provisionSecondUserWithBaseCurrency();
      await helpers.asUser({
        cookies: target.cookies,
        fn: async () => {
          const restore = await helpers.withSelfHost(() => helpers.restoreBackup({ fileContent: base64 }));
          expect(restore.statusCode).toBe(200);
          const status = await helpers.waitForRestore({ jobId: restore.jobId! });
          expect(status.status).toBe('completed');

          const targetCategory = (await helpers.getCategoriesList()).find((c) => c.name === 'Rent');
          const targetPortfolio = (await helpers.listPortfolios({ raw: true })).data.find((p) => p.name === 'FIRE PF');
          expect(targetCategory!.id).not.toBe(category.id);
          expect(targetPortfolio!.id).not.toBe(portfolio.id);

          const { fire } = await helpers.getUserSettings({ raw: true });
          expect(fire?.spendingExcludedCategoryIds).toEqual([targetCategory!.id]);
          expect(fire?.returnIndicatorId).toBe(`portfolio:${targetPortfolio!.id}`);
        },
      });
    });
  });

  // Backup files are user-editable (checksums recompute), so a hand-edited archive
  // can aim a child row's FK at another user's row — the DB constraint accepts ANY
  // existing row. The restore only accepts ids it inserted this run: a required
  // column drops the row, a nullable column is nulled, and the victim's data is
  // never touched.
  describe('Cross-user reference forgery guard', () => {
    /** Provision a second user (the would-be victim) and seed a real account,
     *  category, payee and transaction whose ids a forged backup can point at. */
    async function seedVictimRow() {
      const victim = await helpers.provisionSecondUserWithBaseCurrency();
      const ids = await helpers.asUser({
        cookies: victim.cookies,
        fn: async () => {
          const account = await helpers.createAccount({
            payload: helpers.buildAccountPayload({ name: 'Victim Account', initialBalance: 111000 }),
            raw: true,
          });
          const category = await helpers.addCustomCategory({
            name: 'Victim Only Category',
            color: '#654321',
            raw: true,
          });
          const payee = await helpers.createPayee({
            payload: helpers.buildPayeePayload({ name: 'Victim Only Payee' }),
            raw: true,
          });
          const [tx] = await helpers.createTransaction({
            payload: helpers.buildTransactionPayload({
              accountId: account.id,
              amount: 777,
              transactionType: TRANSACTION_TYPES.expense,
              categoryId: category.id,
            }),
            raw: true,
          });
          return { accountId: account.id, categoryId: category.id, payeeId: payee.id, txId: tx!.id };
        },
      });
      return { victim, ids };
    }

    const hasWarning = ({ status, code, table }: { status: Row; code: string; table: string }): boolean =>
      ((status.summary as { warnings?: Array<{ code: string; table?: string }> } | undefined)?.warnings ?? []).some(
        (w) => w.code === code && w.table === table,
      );

    it('drops the required forged FK, nulls every nullable one, and leaves the victim untouched', async () => {
      const { accountA, category, tx } = await seedBasicData();
      const template = await helpers.createTransactionTemplate({
        payload: {
          name: 'Pinned template',
          transactionType: TRANSACTION_TYPES.expense,
          amount: 12.5,
          accountId: accountA.id,
        },
        raw: true,
      });
      const { victim, ids } = await seedVictimRow();

      const { buffer } = await exportArchive();
      const { files } = helpers.parseBackupArchive({ buffer });

      // Aim one Balances row's required accountId at the victim's account. The DB FK
      // would accept it (the account exists), so only the ownership guard stops it.
      const balances = readArchiveJson({ files, path: 'data/balances.json' }) as Row[];
      expect(balances.length).toBeGreaterThan(0);
      balances[0]!.accountId = ids.accountId;
      writeArchiveJson({ files, path: 'data/balances.json', value: balances });

      const transactions = readArchiveJson({ files, path: 'data/transactions.json' }) as Row[];
      (transactions.find((t) => t.id === tx.id) ?? transactions[0]!).categoryId = ids.categoryId;
      writeArchiveJson({ files, path: 'data/transactions.json', value: transactions });

      const templates = readArchiveJson({ files, path: 'data/transaction-templates.json' }) as Row[];
      templates.find((t) => t.id === template.id)!.accountId = ids.accountId;
      writeArchiveJson({ files, path: 'data/transaction-templates.json', value: templates });

      const categories = readArchiveJson({ files, path: 'data/categories.json' }) as Row[];
      categories.find((c) => c.id === category.id)!.parentId = ids.categoryId;
      writeArchiveJson({ files, path: 'data/categories.json', value: categories });

      const userJson = readArchiveJson({ files, path: 'data/user.json' }) as Row;
      userJson.defaultCategoryId = ids.categoryId;
      writeArchiveJson({ files, path: 'data/user.json', value: userJson });

      const base64 = await helpers.repackBackup({ files });

      const restore = await helpers.restoreBackup({ fileContent: base64 });
      expect(restore.statusCode).toBe(200);
      const status = await helpers.waitForRestore({ jobId: restore.jobId! });
      expect(status.status).toBe('completed');
      const statusRow = status as unknown as Row;

      // The forged Balances row was dropped, not attached to the victim's account;
      // every nullable forged FK was nulled and its row kept.
      expect(hasWarning({ status: statusRow, code: 'foreign_reference_dropped', table: 'balances' })).toBe(true);
      expect(hasWarning({ status: statusRow, code: 'foreign_reference_nulled', table: 'transactions' })).toBe(true);
      expect(hasWarning({ status: statusRow, code: 'foreign_reference_nulled', table: 'transaction-templates' })).toBe(
        true,
      );
      expect(hasWarning({ status: statusRow, code: 'foreign_reference_nulled', table: 'categories' })).toBe(true);
      expect(hasWarning({ status: statusRow, code: 'foreign_reference_nulled', table: 'user' })).toBe(true);

      // The restore still succeeded and re-owned the restorer's own accounts.
      expect((await helpers.getAccounts()).some((a) => a.id === accountA.id)).toBe(true);

      // The transaction was kept, but its foreign category link was cleared.
      const restoredTx = (await helpers.getTransactionById({ id: tx.id, raw: true })) as { categoryId: unknown } | null;
      expect(restoredTx).not.toBeNull();
      expect(restoredTx!.categoryId).toBeNull();

      // The category was kept, but its foreign parent link was cleared.
      const restoredCategory = (await helpers.getCategoriesList()).find((c) => c.id === category.id);
      expect(restoredCategory).toBeDefined();
      expect(restoredCategory!.parentId ?? null).toBeNull();

      // The template's account link is gone, so the amount it gave a currency to is no
      // longer served.
      const [restoredTemplate] = await helpers.getTransactionTemplates({ raw: true });
      expect(restoredTemplate!.name).toBe('Pinned template');
      expect(restoredTemplate!.accountId).toBeNull();
      expect(restoredTemplate!.amount).toBeNull();

      // Re-exporting shows the foreign default category was cleared, not persisted.
      const after = helpers.parseBackupArchive({ buffer: (await exportArchive()).buffer });
      const userAfter = after.readData({ name: 'user' }) as Row;
      expect(userAfter.defaultCategoryId ?? null).toBeNull();

      // The stored amount must not make every later edit fail consistency validation.
      const renamed = await helpers.updateTransactionTemplate({
        id: restoredTemplate!.id,
        payload: { name: 'Renamed' },
      });
      expect(renamed.statusCode).toBe(200);

      // The victim's own data is untouched.
      await helpers.asUser({
        cookies: victim.cookies,
        fn: async () => {
          expect((await helpers.getAccounts()).some((a) => a.id === ids.accountId)).toBe(true);
          expect((await helpers.getCategoriesList()).some((c) => c.id === ids.categoryId)).toBe(true);
        },
      });
    }, 30000);
  });

  describe('Securities resolve-or-create', () => {
    it('creates an absent security and remaps its holdings', async () => {
      const portfolio = await helpers.createPortfolio({ payload: { name: 'Resolve PF' }, raw: true });
      const [security] = await helpers.seedSecurities([{ symbol: 'AAA', name: 'Alpha Fund' }]);
      await helpers.createHolding({ payload: { portfolioId: portfolio.id, securityId: security!.id }, raw: true });

      const { buffer } = await exportArchive();
      const { files } = helpers.parseBackupArchive({ buffer });

      // Rewrite the backup so its security is unknown to the catalog on every
      // unique key: fresh UUID + a symbol/ISIN/CUSIP and a providerSymbol that
      // match nothing on the target. providerName+providerSymbol is a real DB
      // unique index, so a unique providerSymbol is required (a valid providerName
      // is kept) or resolve would correctly match the existing seeded row instead.
      const oldId = security!.id;
      const newId = generateRandomRecordId();
      const uniqueSymbol = `ZZ${generateRandomRecordId().slice(0, 6)}`;
      const uniqueProviderSymbol = `ZZP${generateRandomRecordId().slice(0, 6)}`;
      const securities = readArchiveJson({ files, path: 'reference/securities.json' }) as Row[];
      for (const sec of securities) {
        if (sec.id === oldId) {
          sec.id = newId;
          sec.symbol = uniqueSymbol;
          sec.providerSymbol = uniqueProviderSymbol;
          sec.isin = null;
          sec.cusip = null;
        }
      }
      writeArchiveJson({ files, path: 'reference/securities.json', value: securities });
      remapSecurityIdInArchive({ files, oldId, newId });

      const securitiesBefore = await helpers.getAllSecurities({ raw: true });
      const base64 = await helpers.repackBackup({ files });
      const restore = await helpers.restoreBackup({ fileContent: base64 });
      expect(restore.statusCode).toBe(200);
      const status = await helpers.waitForRestore({ jobId: restore.jobId! });
      expect(status.status).toBe('completed');

      // A new security row was created and the holding points at it.
      const securitiesAfter = await helpers.getAllSecurities({ raw: true });
      expect(securitiesAfter.length).toBe(securitiesBefore.length + 1);
      expect(securitiesAfter.some((s) => s.symbol === uniqueSymbol)).toBe(true);

      const holdings = await helpers.getHoldings({ portfolioId: portfolio.id, payload: {}, raw: true });
      expect(holdings.some((h) => h.securityId === newId)).toBe(true);
    });

    it('remaps to an existing security under a different UUID without creating a duplicate', async () => {
      const portfolio = await helpers.createPortfolio({ payload: { name: 'Remap PF' }, raw: true });
      const [security] = await helpers.seedSecurities([{ symbol: 'BBB', name: 'Beta Fund' }]);
      await helpers.createHolding({ payload: { portfolioId: portfolio.id, securityId: security!.id }, raw: true });

      const { buffer } = await exportArchive();
      const { files } = helpers.parseBackupArchive({ buffer });

      // Same natural key (symbol/currency/provider), different UUID → must resolve
      // to the catalog's existing row.
      const oldId = security!.id;
      const newId = generateRandomRecordId();
      const securities = readArchiveJson({ files, path: 'reference/securities.json' }) as Row[];
      for (const sec of securities) if (sec.id === oldId) sec.id = newId;
      writeArchiveJson({ files, path: 'reference/securities.json', value: securities });
      remapSecurityIdInArchive({ files, oldId, newId });

      const securitiesBefore = await helpers.getAllSecurities({ raw: true });
      const base64 = await helpers.repackBackup({ files });
      const restore = await helpers.restoreBackup({ fileContent: base64 });
      expect(restore.statusCode).toBe(200);
      const status = await helpers.waitForRestore({ jobId: restore.jobId! });
      expect(status.status).toBe('completed');

      // No duplicate security, and the holding points at the pre-existing catalog id.
      const securitiesAfter = await helpers.getAllSecurities({ raw: true });
      expect(securitiesAfter.length).toBe(securitiesBefore.length);

      const holdings = await helpers.getHoldings({ portfolioId: portfolio.id, payload: {}, raw: true });
      expect(holdings.some((h) => h.securityId === oldId)).toBe(true);
      expect(holdings.some((h) => h.securityId === newId)).toBe(false);
    });

    it('ignores a pricing file smuggled into the archive (never writes global SecurityPricing)', async () => {
      const portfolio = await helpers.createPortfolio({ payload: { name: 'Pricing PF' }, raw: true });
      const [security] = await helpers.seedSecurities([{ symbol: 'CCC', name: 'Gamma Fund' }]);
      await helpers.createHolding({ payload: { portfolioId: portfolio.id, securityId: security!.id }, raw: true });

      const { buffer } = await exportArchive();
      const { files } = helpers.parseBackupArchive({ buffer });

      // A tampered backup smuggles a pricing file back in — the vector an attacker
      // would use to gap-fill poisoned prices for a security other users hold.
      // repackBackup lists and checksums it, so it passes integrity; the restore
      // must still ignore it because prices are not a restorable resource.
      const poisoned: Row[] = [{ securityId: security!.id, date: '1990-01-01', priceClose: '999999' }];
      writeArchiveJson({ files, path: 'reference/security-pricing.json', value: poisoned });

      const base64 = await helpers.repackBackup({ files });
      const restore = await helpers.restoreBackup({ fileContent: base64 });
      expect(restore.statusCode).toBe(200);
      const status = await helpers.waitForRestore({ jobId: restore.jobId! });
      expect(status.status).toBe('completed');

      // The holding round-tripped (summary is populated), but the restore has no
      // pricing step at all, so the smuggled rows were never inserted.
      expect(status.summary?.insertedByTable.holdings).toBeGreaterThan(0);
      expect(status.summary?.insertedByTable).not.toHaveProperty('security-pricing');
    });
  });

  describe('Restored bank connection', () => {
    it('carries no plaintext secret, comes back needing reauth, and reactivates once credentials are re-supplied', async () => {
      const connect = await helpers.bankDataProviders.connectProvider({
        providerType: BANK_PROVIDER_TYPE.MONOBANK,
        credentials: { apiToken: VALID_MONOBANK_TOKEN },
        raw: true,
      });
      const connectionId = connect.connectionId;

      const { buffer, base64 } = await exportArchive();
      expect(archiveText({ buffer })).not.toContain(VALID_MONOBANK_TOKEN);

      const restore = await helpers.restoreBackup({ fileContent: base64 });
      expect(restore.statusCode).toBe(200);
      const status = await helpers.waitForRestore({ jobId: restore.jobId! });
      expect(status.status).toBe('completed');

      // The connection came back (same id) but is honestly marked "reconnect required".
      const deactivated = await helpers.bankDataProviders.getConnectionDetails({ connectionId, raw: true });
      expect(deactivated.connection.isActive).toBe(false);
      expect(deactivated.connection.deactivationReason).toBe(DEACTIVATION_REASON.RESTORED);

      // …so the sync-status endpoint must list it as needing reconnection.
      const reauthListed = (await helpers.makeRequest({
        method: 'get',
        url: '/bank-data-providers/sync/status',
        raw: true,
      })) as { connectionsNeedingReauth: Array<{ connectionId: string }> };
      expect(reauthListed.connectionsNeedingReauth.some((c) => c.connectionId === connectionId)).toBe(true);

      // Re-exporting still blanks the credentials — no secret survives a round-trip.
      const after = await exportArchive();
      const afterArchive = helpers.parseBackupArchive({ buffer: after.buffer });
      const connections = afterArchive.readData({ name: 'bank-data-provider-connections' }) as Row[];
      expect(connections.length).toBeGreaterThan(0);
      for (const conn of connections) expect(conn.credentials).toBeNull();

      // Re-supplying a valid token must clear the reauth state, not just store creds.
      await helpers.bankDataProviders.updateConnectionDetails({
        connectionId,
        credentials: { apiToken: VALID_MONOBANK_TOKEN },
        raw: true,
      });

      const reactivated = await helpers.bankDataProviders.getConnectionDetails({ connectionId, raw: true });
      expect(reactivated.connection.isActive).toBe(true);
      expect(reactivated.connection.deactivationReason).toBeNull();

      // And it must drop off the sync-status reauth list.
      const reauthCleared = (await helpers.makeRequest({
        method: 'get',
        url: '/bank-data-providers/sync/status',
        raw: true,
      })) as { connectionsNeedingReauth: Array<{ connectionId: string }> };
      expect(reauthCleared.connectionsNeedingReauth.some((c) => c.connectionId === connectionId)).toBe(false);
    }, 30000);
  });

  describe('Restored AI connections', () => {
    it('come back flagged invalid with no key material, asking for the key again', async () => {
      const created = await helpers.createAiConnection({
        provider: AI_PROVIDER.anthropic,
        name: 'Claude',
        model: 'claude-sonnet-5',
        apiKey: VALID_ANTHROPIC_API_KEY,
        raw: true,
      });

      const { buffer, base64 } = await exportArchive();
      const allText = archiveText({ buffer });
      expect(allText).not.toContain(VALID_ANTHROPIC_API_KEY);
      expect(allText).not.toMatch(/"keyEncrypted"/);

      const restore = await helpers.restoreBackup({ fileContent: base64 });
      expect(restore.statusCode).toBe(200);
      const status = await helpers.waitForRestore({ jobId: restore.jobId! });
      expect(status.status).toBe('completed');

      expect(await helpers.getAiConnections({ raw: true })).toEqual([
        expect.objectContaining({
          id: created.id,
          provider: AI_PROVIDER.anthropic,
          model: 'claude-sonnet-5',
          hasApiKey: false,
          status: 'invalid',
          lastError: expect.any(String),
          invalidatedAt: expect.any(String),
        }),
      ]);

      const fixed = await helpers.updateAiConnection({ id: created.id, apiKey: VALID_ANTHROPIC_API_KEY, raw: true });
      expect(fixed).toMatchObject({ hasApiKey: true, status: 'valid' });
      expect(fixed.lastError).toBeUndefined();
      expect(fixed.invalidatedAt).toBeUndefined();
    });

    it('converts a pre-connections archive (API keys, custom endpoints, old feature configs) without resetting settings', async () => {
      // The settings row is created lazily; a user with legacy AI keys always had one.
      await helpers.updateUserSettings({ settings: { locale: 'uk' } });
      const { buffer } = await exportArchive();
      const { files } = helpers.parseBackupArchive({ buffer });

      const endpointId = randomUUID();
      const endpointCiphertext = `legacy-endpoint-ciphertext-${Date.now()}`;
      const apiKeyCiphertext = `legacy-api-key-ciphertext-${Date.now()}`;
      const createdAt = new Date().toISOString();
      const settingsRows = readArchiveJson({ files, path: 'data/user-settings.json' }) as Row[];
      (settingsRows[0]!.settings as Row).ai = {
        apiKeys: [{ provider: 'anthropic', keyEncrypted: apiKeyCiphertext, createdAt }],
        defaultProvider: 'anthropic',
        customEndpoints: [
          {
            id: endpointId,
            name: 'Home Ollama',
            baseUrl: LEGACY_ENDPOINT_BASE_URL,
            defaultModel: 'llama3.2',
            keyEncrypted: endpointCiphertext,
            createdAt,
            status: 'valid',
            lastValidatedAt: createdAt,
          },
        ],
        featureConfigs: [
          // A model override on the endpoint becomes its own connection.
          { feature: AI_FEATURE.categorization, modelId: 'custom/qwen2.5', customEndpointId: endpointId },
          // The feature's server default with no Google key stays pinned to the server model.
          { feature: AI_FEATURE.statementParsing, modelId: 'google/gemini-3.6-flash' },
        ],
      };
      writeArchiveJson({ files, path: 'data/user-settings.json', value: settingsRows });
      const base64 = await helpers.repackBackup({ files });

      const restore = await helpers.restoreBackup({ fileContent: base64 });
      expect(restore.statusCode).toBe(200);
      const status = await helpers.waitForRestore({ jobId: restore.jobId! });
      expect(status.status).toBe('completed');
      expect(status.summary?.warnings.some((w) => w.code === 'settings_reset')).toBe(false);

      const connections = await helpers.getAiConnections({ raw: true });
      expect(connections).toHaveLength(3);
      for (const connection of connections) {
        expect(connection).toMatchObject({
          hasApiKey: false,
          status: 'invalid',
          lastError: expect.any(String),
          invalidatedAt: expect.any(String),
        });
      }

      const [endpoint, modelOverride, anthropicKey] = connections;
      expect(endpoint).toMatchObject({
        id: endpointId,
        provider: AI_PROVIDER.custom,
        baseUrl: LEGACY_ENDPOINT_BASE_URL,
        model: 'llama3.2',
      });
      expect(modelOverride).toMatchObject({
        provider: AI_PROVIDER.custom,
        baseUrl: LEGACY_ENDPOINT_BASE_URL,
        model: 'qwen2.5',
      });
      expect(anthropicKey!.provider).toBe(AI_PROVIDER.anthropic);

      const after = await exportArchive();
      const afterText = archiveText({ buffer: after.buffer });
      expect(afterText).not.toContain(endpointCiphertext);
      expect(afterText).not.toContain(apiKeyCiphertext);

      const [settingsAfter] = helpers
        .parseBackupArchive({ buffer: after.buffer })
        .readData({ name: 'user-settings' }) as Array<{ settings: { ai: Row; locale?: string } }>;
      expect(settingsAfter!.settings.locale).toBe('uk');
      expect(settingsAfter!.settings.ai).not.toHaveProperty('apiKeys');
      expect(settingsAfter!.settings.ai).not.toHaveProperty('customEndpoints');
      expect(settingsAfter!.settings.ai.featureConfigs).toEqual([
        { feature: AI_FEATURE.categorization, connectionId: modelOverride!.id },
        { feature: AI_FEATURE.statementParsing, connectionId: null },
      ]);
    });
  });

  describe('Atomicity', () => {
    it('rolls back a restore whose data violates a foreign key, leaving the original data intact', async () => {
      const { accountA, tx } = await seedBasicData();
      const accountsBefore = await helpers.getAccounts();
      const accountIdsBefore = accountsBefore.map((a) => a.id).sort();
      const txBefore = await helpers.getTransactions({ raw: true });
      const txIdsBefore = txBefore.map((t) => t.id).sort();

      const { buffer } = await exportArchive();
      const { files } = helpers.parseBackupArchive({ buffer });

      // Point a transaction at a currency the instance doesn't have — a real FK
      // violation (Currencies) the worker hits mid-insert. It must be a FK the
      // owned-reference guard does NOT cover: a foreign *owned* FK (e.g. accountId)
      // would be dropped-and-repaired and the restore would complete, so use a
      // global-catalog FK to exercise rollback on a genuine failure. Checksums are
      // refreshed so preflight passes.
      const transactions = readArchiveJson({ files, path: 'data/transactions.json' }) as Row[];
      const target = transactions.find((t) => t.id === tx.id) ?? transactions[0]!;
      target.currencyCode = 'ZZZ';
      writeArchiveJson({ files, path: 'data/transactions.json', value: transactions });
      const base64 = await helpers.repackBackup({ files });

      const restore = await helpers.restoreBackup({ fileContent: base64 });
      expect(restore.statusCode).toBe(200);
      const status = await helpers.waitForRestore({ jobId: restore.jobId! });
      expect(status.status).toBe('failed');

      // Nothing was wiped: the pre-restore accounts and transactions are all still there.
      const accountsAfter = await helpers.getAccounts();
      expect(accountsAfter.map((a) => a.id).sort()).toEqual(accountIdsBefore);
      expect(accountsAfter.some((a) => a.id === accountA.id)).toBe(true);
      const txAfter = await helpers.getTransactions({ raw: true });
      expect(txAfter.map((t) => t.id).sort()).toEqual(txIdsBefore);
    });
  });

  describe('Rejections', () => {
    it('rejects a backup whose format version is newer than supported (422)', async () => {
      await seedBasicData();
      const { buffer } = await exportArchive();
      const { files, manifest } = helpers.parseBackupArchive({ buffer });

      manifest.formatVersion = 2;
      writeArchiveJson({ files, path: 'manifest.json', value: manifest });
      const base64 = await helpers.repackBackup({ files });

      const restore = await helpers.restoreBackup({ fileContent: base64 });
      expect(restore.statusCode).toBe(422);
      expect(restore.message).toMatch(/version/i);
    });

    it('rejects a backup whose file checksum no longer matches the manifest (422)', async () => {
      await seedBasicData();
      const { buffer } = await exportArchive();
      const { files } = helpers.parseBackupArchive({ buffer });

      const categories = readArchiveJson({ files, path: 'data/categories.json' }) as Row[];
      categories.push({ ...categories[0], id: generateRandomRecordId(), name: 'Tampered' });
      writeArchiveJson({ files, path: 'data/categories.json', value: categories });
      // Leave the manifest stale so the recomputed hash won't match.
      const base64 = await helpers.repackBackup({ files, syncChecksums: false });

      const restore = await helpers.restoreBackup({ fileContent: base64 });
      expect(restore.statusCode).toBe(422);
      expect(restore.message).toMatch(/checksum|integrity/i);
    });

    it('rejects a backup missing a required column and names the column (422)', async () => {
      await seedBasicData();
      const { buffer } = await exportArchive();
      const { files } = helpers.parseBackupArchive({ buffer });

      const accounts = readArchiveJson({ files, path: 'data/accounts.json' }) as Row[];
      for (const account of accounts) delete account.name;
      writeArchiveJson({ files, path: 'data/accounts.json', value: accounts });
      const base64 = await helpers.repackBackup({ files });

      const restore = await helpers.restoreBackup({ fileContent: base64 });
      expect(restore.statusCode).toBe(422);
      expect(restore.message).toContain('name');
    });

    it('rejects an empty-manifest / missing-user archive without wiping existing data (422)', async () => {
      // Pre-existing data that MUST survive a rejected restore.
      const { accountA, tx } = await seedBasicData();
      const accountsBefore = await helpers.getAccounts();
      expect(accountsBefore.length).toBeGreaterThan(0);

      const { buffer } = await exportArchive();
      const { files } = helpers.parseBackupArchive({ buffer });

      // Keep only manifest.json and drop every data/reference file. Repacking syncs
      // checksums over the now-empty file set, yielding a structurally valid zip
      // whose manifest vouches for nothing and whose data/user.json is gone — the
      // corruption shape that previously wiped everything and reported success.
      const manifestOnly = new Map<string, Buffer>();
      manifestOnly.set('manifest.json', files.get('manifest.json')!);
      const base64 = await helpers.repackBackup({ files: manifestOnly });

      const restore = await helpers.restoreBackup({ fileContent: base64 });
      expect(restore.statusCode).toBe(422);
      expect(restore.message).toMatch(/no user record|no files|refusing to wipe/i);

      // The wipe never ran: the pre-restore account and transaction are still there.
      const accountsAfter = await helpers.getAccounts();
      expect(accountsAfter.some((a) => a.id === accountA.id)).toBe(true);
      const txAfter = await helpers.getTransactions({ raw: true });
      expect(txAfter.some((t) => t.id === tx.id)).toBe(true);
    });

    it('rejects a malformed manifest.json with 422 rather than a generic 500', async () => {
      await seedBasicData();
      const { buffer } = await exportArchive();
      const { files } = helpers.parseBackupArchive({ buffer });

      // A JSON array where an object is expected. Dereferencing manifest fields on
      // it throws a raw TypeError (mapped to 500) without the shape guard.
      files.set('manifest.json', Buffer.from(JSON.stringify([])));
      const base64 = await helpers.repackBackup({ files, syncChecksums: false });

      const restore = await helpers.restoreBackup({ fileContent: base64 });
      expect(restore.statusCode).toBe(422);
      expect(restore.message).toMatch(/malformed manifest/i);
    });

    it('requires a sharing acknowledgement when the user owns shared resources (409)', async () => {
      const account = await helpers.createAccount({ raw: true });
      const { base64 } = await exportArchive();

      const recipient = await helpers.provisionSecondUserWithBaseCurrency();
      const invitation = await helpers.createShareInvitation({
        inviteeEmail: recipient.email,
        resourceType: RESOURCE_TYPES.account,
        resourceId: account.id,
        permission: SHARE_PERMISSIONS.read,
        raw: true,
      });
      await helpers.asUser({
        cookies: recipient.cookies,
        fn: () => helpers.acceptShareInvitation({ token: invitation.token, raw: true }),
      });

      const withoutAck = await helpers.restoreBackup({ fileContent: base64 });
      expect(withoutAck.statusCode).toBe(409);
      expect(withoutAck.code).toBe(API_ERROR_CODES.wipeDataSharingAcknowledgementRequired);
      expect(withoutAck.details?.sharedResources).toBeDefined();

      // The account still exists — the 409 path did not touch any data.
      expect(await helpers.getAccounts()).toHaveLength(1);

      // With the acknowledgement the same upload proceeds.
      const withAck = await helpers.restoreBackup({ fileContent: base64, acknowledgeSharing: true });
      expect(withAck.statusCode).toBe(200);
      const status = await helpers.waitForRestore({ jobId: withAck.jobId! });
      expect(status.status).toBe('completed');
    });
  });

  describe('Archive ownership', () => {
    /** Repack the current user's export with a manifest attributed to somebody else. */
    async function foreignArchive(): Promise<string> {
      const { buffer } = await exportArchive();
      const { files, manifest } = helpers.parseBackupArchive({ buffer });
      manifest.user = {
        username: 'someone-else',
        email: 'someone-else@test.local',
      };
      writeArchiveJson({ files, path: 'manifest.json', value: manifest });
      return helpers.repackBackup({ files });
    }

    it('rejects an archive exported by a different account on cloud (422)', async () => {
      await seedBasicData();
      const base64 = await foreignArchive();

      const restore = await helpers.restoreBackup({ fileContent: base64 });
      expect(restore.statusCode).toBe(422);
      expect(restore.message).toMatch(/different account/i);
    });

    it('accepts the same archive on a self-hosted instance', async () => {
      await seedBasicData();
      const base64 = await foreignArchive();

      const restore = await helpers.withSelfHost(() => helpers.restoreBackup({ fileContent: base64 }));
      expect(restore.statusCode).toBe(200);
      const status = await helpers.waitForRestore({ jobId: restore.jobId! });
      expect(status.status).toBe('completed');
    });
  });

  describe('Empty state', () => {
    it('restoring an empty backup wipes a previously-seeded user back to empty', async () => {
      // Capture the fresh (empty) user's backup before seeding anything.
      const { base64 } = await exportArchive();

      await seedBasicData();
      await helpers.createAutomation({ payload: helpers.buildAutomationPayload(), raw: true });
      expect((await helpers.getAccounts()).length).toBeGreaterThan(0);
      expect((await helpers.getTransactions({ raw: true })).length).toBeGreaterThan(0);
      expect((await helpers.listAutomations({ raw: true })).length).toBeGreaterThan(0);

      const restore = await helpers.restoreBackup({ fileContent: base64 });
      expect(restore.statusCode).toBe(200);
      const status = await helpers.waitForRestore({ jobId: restore.jobId! });
      expect(status.status).toBe('completed');

      // The transactional tables are empty again — down to the backup's empty state.
      expect(await helpers.getAccounts()).toHaveLength(0);
      expect(await helpers.getTransactions({ raw: true })).toHaveLength(0);
      expect(await helpers.listAutomations({ raw: true })).toHaveLength(0);
    });
  });

  describe('Settings schema drift', () => {
    it('restores with a settings_reset warning when the backup settings no longer validate', async () => {
      await helpers.updateUserSettings({ settings: { locale: 'uk' } });
      const { buffer } = await exportArchive();
      const { files } = helpers.parseBackupArchive({ buffer });

      // Corrupt the settings blob with a value the current schema rejects (an
      // unknown locale). A backup taken across a schema change would look like this.
      const settingsRows = readArchiveJson({ files, path: 'data/user-settings.json' }) as Row[];
      (settingsRows[0]!.settings as Row).locale = 'not-a-real-locale';
      writeArchiveJson({ files, path: 'data/user-settings.json', value: settingsRows });
      const base64 = await helpers.repackBackup({ files });

      const restore = await helpers.restoreBackup({ fileContent: base64 });
      expect(restore.statusCode).toBe(200);
      const status = await helpers.waitForRestore({ jobId: restore.jobId! });

      // The restore completes instead of hard-failing, and warns that settings reset.
      expect(status.status).toBe('completed');
      expect(status.summary?.warnings.some((w) => w.code === 'settings_reset')).toBe(true);
    });

    it('drops only an out-of-range fire slice with a fire_settings_reset warning and keeps the other settings', async () => {
      await helpers.updateUserSettings({ settings: { locale: 'uk' } });
      const { buffer } = await exportArchive();
      const { files } = helpers.parseBackupArchive({ buffer });

      const settingsRows = readArchiveJson({ files, path: 'data/user-settings.json' }) as Row[];
      (settingsRows[0]!.settings as Row).fire = { withdrawalRatePct: 99, birthYear: 1990 };
      writeArchiveJson({ files, path: 'data/user-settings.json', value: settingsRows });
      const base64 = await helpers.repackBackup({ files });

      const restore = await helpers.restoreBackup({ fileContent: base64 });
      expect(restore.statusCode).toBe(200);
      const status = await helpers.waitForRestore({ jobId: restore.jobId! });

      expect(status.status).toBe('completed');
      const codes = status.summary?.warnings.map((w) => w.code);
      expect(codes).toContain('fire_settings_reset');
      expect(codes).not.toContain('settings_reset');

      const fetched = await helpers.getUserSettings({ raw: true });
      expect(fetched.locale).toBe('uk');
      expect(fetched.fire).toBeUndefined();
    });

    it('drops FIRE ids that point at nothing restored and falls back to the default return indicator', async () => {
      await helpers.updateUserSettings({ settings: { locale: 'uk' } });
      const { buffer } = await exportArchive();
      const { files } = helpers.parseBackupArchive({ buffer });

      const settingsRows = readArchiveJson({ files, path: 'data/user-settings.json' }) as Row[];
      (settingsRows[0]!.settings as Row).fire = {
        spendingExcludedCategoryIds: [randomUUID()],
        returnIndicatorId: `portfolio:${randomUUID()}`,
        withdrawalRatePct: 3.5,
      };
      writeArchiveJson({ files, path: 'data/user-settings.json', value: settingsRows });
      const base64 = await helpers.repackBackup({ files });

      const restore = await helpers.restoreBackup({ fileContent: base64 });
      expect(restore.statusCode).toBe(200);
      expect((await helpers.waitForRestore({ jobId: restore.jobId! })).status).toBe('completed');

      expect((await helpers.getUserSettings({ raw: true })).fire).toStrictEqual({
        spendingExcludedCategoryIds: [],
        withdrawalRatePct: 3.5,
      });
    });
  });

  // A second restore while one is in flight returns 423 (enqueue guard, then the
  // worker's base-currency lock). Not asserted: the in-process worker finishes a
  // small test dataset before a second request could observe the in-flight job,
  // making a real concurrency assertion timing-dependent and flaky here.
  it.skip('rejects a concurrent restore for the same user (423)', () => {});

  // The user-scoped status endpoint (no job id) any device polls on boot to learn a
  // restore is in flight and, after it lands, to wipe caches + reload once.
  describe('User-scoped status (GET /user/backup/restore/status)', () => {
    it('reports idle for a user who has never restored', async () => {
      const status = await helpers.getActiveRestoreStatus({ raw: true });
      expect(status.state).toBe('idle');
    });

    it('reports completed with the summary once a restore lands, and stays idle for a second user who never restored', async () => {
      await seedBasicData();
      const { base64 } = await exportArchive();

      const restore = await helpers.restoreBackup({ fileContent: base64 });
      expect(restore.statusCode).toBe(200);
      const terminal = await helpers.waitForRestore({ jobId: restore.jobId! });
      expect(terminal.status).toBe('completed');

      const status = await helpers.getActiveRestoreStatus({ raw: true });
      expect(status.state).toBe('completed');
      if (status.state !== 'completed') throw new Error('unreachable');
      expect(status.jobId).toBe(restore.jobId);
      expect(status.summary.insertedByTable).toBeDefined();

      const target = await helpers.provisionSecondUserWithBaseCurrency();
      await helpers.asUser({
        cookies: target.cookies,
        fn: async () => {
          const targetStatus = await helpers.getActiveRestoreStatus({ raw: true });
          expect(targetStatus.state).toBe('idle');
        },
      });
    });
  });
});

/** Rewrite every `securityId` reference in the archive from `oldId` to `newId`,
 *  across the only files that carry one (holdings, investment transactions). */
function remapSecurityIdInArchive({
  files,
  oldId,
  newId,
}: {
  files: Map<string, Buffer>;
  oldId: string;
  newId: string;
}): void {
  const paths = ['data/holdings.json', 'data/investment-transactions.json'];
  for (const path of paths) {
    const rows = readArchiveJson({ files, path });
    if (!Array.isArray(rows)) continue;
    let changed = false;
    for (const row of rows as Row[]) {
      if (row.securityId === oldId) {
        row.securityId = newId;
        changed = true;
      }
    }
    if (changed) writeArchiveJson({ files, path, value: rows });
  }
}
