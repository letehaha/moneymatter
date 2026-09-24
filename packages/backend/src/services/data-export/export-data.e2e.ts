import {
  API_ERROR_CODES,
  BANK_PROVIDER_TYPE,
  PAYMENT_TYPES,
  TRANSACTION_TRANSFER_NATURE,
  TRANSACTION_TYPES,
  VEHICLE_CLASS,
} from '@bt/shared/types';
import { beforeEach, describe, expect, it } from '@jest/globals';
import { RateLimitService } from '@services/common/rate-limit.service';
import { EXPORT_SCHEMA_VERSION } from '@services/data-export/types';
import * as helpers from '@tests/helpers';
import { VALID_MONOBANK_TOKEN } from '@tests/mocks/monobank/mock-api';
import ExcelJS from 'exceljs';
import { createHash } from 'node:crypto';

describe('Data export (POST /user/data-export)', () => {
  // The route is rate-limited (5 exports per 15 min per user) and the limiter
  // runs in the test env. Reset Redis state before each test so the per-suite
  // accumulation of calls doesn't poison unrelated cases.
  beforeEach(async () => {
    const userRes = await helpers.makeRequest({ method: 'get', url: '/user', raw: true });
    const userId = (userRes as { id: number }).id;
    await RateLimitService.resetRateLimit(`data-export:user:${userId}`);
  });
  describe('JSON format – happy path', () => {
    it('returns a zip with data-export.json + manifest.json that includes the seeded transaction', async () => {
      const account = await helpers.createAccount({ raw: true });
      const category = await helpers.addCustomCategory({ name: 'Export coffee', color: '#FFAA00', raw: true });
      await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account.id,
          amount: 15.5,
          transactionType: TRANSACTION_TYPES.expense,
          categoryId: category.id,
          note: 'Latte',
        }),
        raw: true,
      });

      const response = await helpers.exportData({ format: 'json' });

      expect(response.statusCode).toBe(200);
      expect(response.contentType).toBe('application/zip');
      expect(response.filename).toMatch(/^moneymatter-export-\d{4}-\d{2}-\d{2}\.zip$/);
      expect(response.body.length).toBeGreaterThan(0);

      const archive = helpers.parseExportArchive({ buffer: response.body });
      expect([...archive.files.keys()].toSorted()).toEqual(['data-export.json', 'manifest.json']);
      expect(archive.manifest.schemaVersion).toBe(EXPORT_SCHEMA_VERSION);
      expect(archive.manifest.format).toBe('json');
      expect(archive.manifest.files).toHaveLength(1);
      expect(archive.manifest.files[0]?.filename).toBe('data-export.json');

      expect(archive.json).not.toBeNull();
      const data = archive.json as { transactions: Array<Record<string, unknown>> };
      expect(Array.isArray(data.transactions)).toBe(true);
      const seeded = data.transactions.find((t) => t.note === 'Latte');
      expect(seeded).toBeDefined();
      expect(seeded?.account).toBe(account.name);
      expect(seeded?.category).toBe('Export coffee');
      expect(seeded?.type).toBe('expense');
      // Money must surface as a decimal number (15.50) – NOT cents (1550) and
      // NOT a Money instance toJSON'd at an unexpected level.
      expect(seeded?.amount).toBe(15.5);
    });

    it('denormalizes FK columns: account/category/tag are names, not IDs', async () => {
      const account = await helpers.createAccount({ raw: true });
      const category = await helpers.addCustomCategory({ name: 'Denorm Cat', color: '#AABBCC', raw: true });
      const tag = await helpers.createTag({ payload: { name: 'denorm-tag', color: '#111111' }, raw: true });
      const tx = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account.id,
          categoryId: category.id,
          amount: 5000,
          transactionType: TRANSACTION_TYPES.expense,
        }),
        raw: true,
      });
      const baseTx = Array.isArray(tx) ? tx[0] : tx;
      await helpers.addTransactionsToTag({ tagId: tag.id, transactionIds: [baseTx!.id], raw: true });

      const response = await helpers.exportData({ format: 'json' });
      const archive = helpers.parseExportArchive({ buffer: response.body });
      const data = archive.json as { transactions: Array<Record<string, unknown>> };
      const exported = data.transactions.find((t) => t.account === account.name && t.category === 'Denorm Cat');
      expect(exported).toBeDefined();
      // No raw UUIDs should appear in any column.
      const stringified = JSON.stringify(exported);
      expect(stringified).not.toMatch(account.id);
      expect(stringified).not.toMatch(category.id);
      expect(exported?.tags).toEqual(['denorm-tag']);
    });

    it('does NOT leak bank-provider credentials when a real provider connection exists', async () => {
      // Seed a bank-provider connection through the public API so the real
      // encryption/storage path runs. The export must not round-trip the
      // credentials column anywhere in the output.
      await helpers.bankDataProviders.connectProvider({
        providerType: BANK_PROVIDER_TYPE.MONOBANK,
        credentials: { apiToken: VALID_MONOBANK_TOKEN },
        raw: true,
      });

      const response = await helpers.exportData({ format: 'json' });
      expect(response.statusCode).toBe(200);
      const archive = helpers.parseExportArchive({ buffer: response.body });
      const stringified = JSON.stringify(archive.json);

      // Neither the raw token nor the sensitive column names should appear
      // anywhere in the export. The connection's API token (or any encrypted
      // form of it) must stay out.
      expect(stringified).not.toContain(VALID_MONOBANK_TOKEN);
      expect(stringified).not.toMatch(/"credentials"/);
      expect(stringified).not.toMatch(/"keyEncrypted"/);
      expect(stringified).not.toMatch(/"secretKey"/);
    });
  });

  describe('Authentication', () => {
    it('rejects an unauthenticated request with 401', async () => {
      const response = await helpers.exportData({ withoutAuth: true });
      expect(response.statusCode).toBe(401);
    });
  });

  describe('CSV format', () => {
    it('emits one CSV per logical file, header rows match the documented columns', async () => {
      const account = await helpers.createAccount({ raw: true });
      const category = await helpers.addCustomCategory({ name: 'CSV cat', color: '#AABBCC', raw: true });
      await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account.id,
          categoryId: category.id,
          amount: 12.34,
          transactionType: TRANSACTION_TYPES.expense,
          note: 'CSV row',
        }),
        raw: true,
      });

      const response = await helpers.exportData({ format: 'csv' });
      expect(response.statusCode).toBe(200);
      const archive = helpers.parseExportArchive({ buffer: response.body });

      expect(archive.files.has('manifest.json')).toBe(true);
      expect(archive.files.has('transactions.csv')).toBe(true);
      expect(archive.files.has('accounts.csv')).toBe(true);
      expect(archive.files.has('categories.csv')).toBe(true);

      const transactionsCsv = archive.files.get('transactions.csv')!;
      const rows = helpers.parseExportCsv({ buffer: transactionsCsv });
      // First row should have header columns visible as keys.
      expect(rows.length).toBeGreaterThan(0);
      const sample = rows[0]!;
      expect(Object.keys(sample)).toEqual(
        expect.arrayContaining(['Date', 'Time', 'Account', 'Type', 'Category', 'Amount', 'Currency', 'Note']),
      );

      const seeded = rows.find((r) => r.Note === 'CSV row');
      expect(seeded).toBeDefined();
      expect(seeded?.Account).toBe(account.name);
      expect(seeded?.Category).toBe('CSV cat');
      // Money displayed as the decimal number (12.34), not the cents integer.
      expect(seeded?.Amount).toBe('12.34');
    });
  });

  describe('XLSX format', () => {
    it('emits a workbook whose sheets and data round-trip the seeded values', async () => {
      const account = await helpers.createAccount({ raw: true });
      const category = await helpers.addCustomCategory({ name: 'XLSX cat', color: '#AABBCC', raw: true });
      await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account.id,
          categoryId: category.id,
          amount: 42.5,
          transactionType: TRANSACTION_TYPES.expense,
          note: 'XLSX row',
        }),
        raw: true,
      });

      const response = await helpers.exportData({ format: 'xlsx' });
      expect(response.statusCode).toBe(200);
      const archive = helpers.parseExportArchive({ buffer: response.body });

      expect(archive.files.has('data-export.xlsx')).toBe(true);
      expect(archive.files.has('manifest.json')).toBe(true);
      const xlsxBuf = archive.files.get('data-export.xlsx')!;
      // XLSX is itself a zip starting with the local file header signature PK\003\004.
      expect(xlsxBuf[0]).toBe(0x50);
      expect(xlsxBuf[1]).toBe(0x4b);
      expect(xlsxBuf[2]).toBe(0x03);
      expect(xlsxBuf[3]).toBe(0x04);

      // Parse the workbook and verify content, not just the magic bytes – a
      // regression in xlsx-writer (e.g. wrong column mapping) would not be
      // caught by a magic-byte check alone.
      const workbook = new ExcelJS.Workbook();
      // ExcelJS's type asks for an ArrayBuffer; pass the Buffer's underlying
      // bytes so the load works without a runtime copy and the type matches.
      const ab = xlsxBuf.buffer.slice(xlsxBuf.byteOffset, xlsxBuf.byteOffset + xlsxBuf.byteLength);
      await workbook.xlsx.load(ab as ArrayBuffer);
      const sheetNames = workbook.worksheets.map((s) => s.name);
      expect(sheetNames).toContain('transactions');
      expect(sheetNames).toContain('accounts');

      const txSheet = workbook.getWorksheet('transactions')!;
      const headerRow = txSheet.getRow(1).values as Array<string | undefined>;
      const headers = headerRow.filter((v): v is string => typeof v === 'string');
      expect(headers).toEqual(
        expect.arrayContaining(['Date', 'Account', 'Type', 'Category', 'Amount', 'Currency', 'Note']),
      );

      let foundSeeded = false;
      txSheet.eachRow((row, rowIndex) => {
        if (rowIndex === 1) return;
        const values = row.values as Array<unknown>;
        // values[0] is the ExcelJS row index; cells are 1-based.
        if (values.includes('XLSX row')) {
          foundSeeded = true;
          // Amount cell should be a NUMBER (sortable in Excel), not a string.
          const amountIndex = headers.indexOf('Amount') + 1;
          expect(typeof values[amountIndex]).toBe('number');
          expect(values[amountIndex]).toBe(42.5);
        }
      });
      expect(foundSeeded).toBe(true);
    });
  });

  describe('Selective groups', () => {
    it('emits only the files belonging to the requested group(s)', async () => {
      const account = await helpers.createAccount({ raw: true });
      await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account.id,
          amount: 1000,
          transactionType: TRANSACTION_TYPES.expense,
        }),
        raw: true,
      });
      // Seed a portfolio so the "investments" group has something – if we DIDN'T
      // request investments, the absence of those files is meaningful.
      await helpers.createPortfolio({ payload: { name: 'Selective portfolio' }, raw: true });

      const response = await helpers.exportData({ format: 'csv', groups: ['transactions'] });
      const archive = helpers.parseExportArchive({ buffer: response.body });

      expect(archive.files.has('transactions.csv')).toBe(true);
      expect(archive.files.has('transaction_templates.csv')).toBe(true);
      expect(archive.files.has('accounts.csv')).toBe(true);
      expect(archive.files.has('categories.csv')).toBe(true);
      // Investments group not requested → its files MUST NOT be present.
      expect(archive.files.has('portfolios.csv')).toBe(false);
      expect(archive.files.has('holdings.csv')).toBe(false);
      expect(archive.files.has('investment_transactions.csv')).toBe(false);
    });

    it('emits only investments-group files when only investments is requested', async () => {
      await helpers.createPortfolio({ payload: { name: 'Investments-only portfolio' }, raw: true });
      const response = await helpers.exportData({ format: 'csv', groups: ['investments'] });
      const archive = helpers.parseExportArchive({ buffer: response.body });

      expect(archive.files.has('portfolios.csv')).toBe(true);
      expect(archive.files.has('holdings.csv')).toBe(true);
      expect(archive.files.has('investment_transactions.csv')).toBe(true);
      expect(archive.files.has('portfolio_transfers.csv')).toBe(true);
      expect(archive.files.has('transactions.csv')).toBe(false);
      expect(archive.files.has('accounts.csv')).toBe(false);
    });
  });

  describe('Request validation', () => {
    it('rejects an unknown group with 4xx, an inverted range with 422, and a malformed date with 422', async () => {
      // The schema's `.default([...ALL_EXPORT_GROUPS])` makes an empty array
      // unreachable past Zod, so the negative test we CAN exercise is "garbage
      // group name → 4xx rejection". Confirms the controller enforces the
      // closed set of group names.
      const unknownGroup = await helpers.exportData({
        format: 'json',
        // @ts-expect-error – invalid group exercised on purpose
        groups: ['nonsense-group'],
      });
      expect(unknownGroup.statusCode).toBeGreaterThanOrEqual(400);
      expect(unknownGroup.statusCode).toBeLessThan(500);

      const invertedRange = await helpers.exportData({
        format: 'json',
        dateRange: { from: '2024-12-31', to: '2024-01-01' },
      });
      expect(invertedRange.statusCode).toBe(422);

      const malformedDate = await helpers.exportData({
        format: 'json',
        // Datetime instead of date – we accept calendar-day boundaries only.
        dateRange: { from: '2024-01-01T00:00:00Z' },
      });
      expect(malformedDate.statusCode).toBe(422);
    });

    it('rejects an empty accountIds array and a non-id accountIds entry with 422', async () => {
      const emptyAccountIds = await helpers.exportData({ format: 'json', accountIds: [] });
      expect(emptyAccountIds.statusCode).toBe(422);

      const malformedAccountId = await helpers.exportData({ format: 'json', accountIds: ['not-an-id'] });
      expect(malformedAccountId.statusCode).toBe(422);
    });
  });

  describe('Splits, refunds, and transfers', () => {
    it('renders split transactions with SplitDetails column and nested splits array', async () => {
      const account = await helpers.createAccount({ raw: true });
      const food = await helpers.addCustomCategory({ name: 'Food', color: '#AABBCC', raw: true });
      const drinks = await helpers.addCustomCategory({ name: 'Drinks', color: '#AABBDD', raw: true });
      const tx = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account.id,
          categoryId: food.id,
          amount: 25,
          transactionType: TRANSACTION_TYPES.expense,
        }),
        raw: true,
      });
      const baseTx = Array.isArray(tx) ? tx[0] : tx;
      await helpers.updateTransaction({
        id: baseTx!.id,
        payload: {
          splits: [
            { categoryId: food.id, amount: 20 },
            { categoryId: drinks.id, amount: 5 },
          ],
        },
        raw: true,
      });

      // JSON form keeps the rich nested array.
      const jsonResponse = await helpers.exportData({ format: 'json' });
      const jsonArchive = helpers.parseExportArchive({ buffer: jsonResponse.body });
      const jsonData = jsonArchive.json as { transactions: Array<Record<string, unknown>> };
      const jsonRow = jsonData.transactions.find((t) => t.account === account.name);
      expect(jsonRow).toBeDefined();
      expect(Array.isArray(jsonRow?.splits)).toBe(true);
      expect(jsonRow?.splits).toHaveLength(2);

      // CSV form collapses to a single SplitDetails string column.
      const csvResponse = await helpers.exportData({ format: 'csv' });
      const csvArchive = helpers.parseExportArchive({ buffer: csvResponse.body });
      const rows = helpers.parseExportCsv({ buffer: csvArchive.files.get('transactions.csv')! });
      const csvRow = rows.find((r) => r.Account === account.name);
      expect(csvRow).toBeDefined();
      expect(csvRow?.SplitDetails).toContain('Food: 20.00');
      expect(csvRow?.SplitDetails).toContain('Drinks: 5.00');
    });

    it('renders refund linkage as a human-readable string in RefundOf column', async () => {
      const account = await helpers.createAccount({ raw: true });
      const purchase = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account.id,
          amount: 5000,
          transactionType: TRANSACTION_TYPES.expense,
          note: 'Original purchase',
        }),
        raw: true,
      });
      const refund = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account.id,
          amount: 2000,
          transactionType: TRANSACTION_TYPES.income,
          note: 'Partial refund',
        }),
        raw: true,
      });
      const originalTx = Array.isArray(purchase) ? purchase[0] : purchase;
      const refundTx = Array.isArray(refund) ? refund[0] : refund;
      await helpers.createSingleRefund({ originalTxId: originalTx!.id, refundTxId: refundTx!.id }, true);

      const response = await helpers.exportData({ format: 'csv' });
      const archive = helpers.parseExportArchive({ buffer: response.body });
      const rows = helpers.parseExportCsv({ buffer: archive.files.get('transactions.csv')! });
      const refundRow = rows.find((r) => r.Note === 'Partial refund');
      expect(refundRow).toBeDefined();
      // The RefundOf column should describe the original (date + account + amount),
      // not a UUID.
      expect(refundRow?.RefundOf).toContain(account.name);
      expect(refundRow?.RefundOf).not.toContain(originalTx!.id);
    });

    it('classifies transfer-nature transactions as transfer_in/transfer_out in the Type column', async () => {
      const source = await helpers.createAccount({ raw: true });
      const destPayload = helpers.buildAccountPayload({ name: 'Transfer dest' });
      const dest = await helpers.createAccount({ payload: destPayload, raw: true });
      const transfer = await helpers.createTransaction({
        payload: {
          ...helpers.buildTransactionPayload({
            accountId: source.id,
            amount: 7500,
            transactionType: TRANSACTION_TYPES.expense,
            transferNature: TRANSACTION_TRANSFER_NATURE.common_transfer,
          }),
          destinationAmount: 7500,
          destinationAccountId: dest.id,
        } as unknown as ReturnType<typeof helpers.buildTransactionPayload>,
        raw: true,
      });
      const [outLeg, inLeg] = Array.isArray(transfer) ? transfer : [transfer, undefined];
      expect(outLeg).toBeDefined();
      expect(inLeg).toBeDefined();

      const response = await helpers.exportData({ format: 'csv' });
      const archive = helpers.parseExportArchive({ buffer: response.body });
      const rows = helpers.parseExportCsv({ buffer: archive.files.get('transactions.csv')! });
      const outRow = rows.find((r) => r.Account === source.name && r.Type === 'transfer_out');
      const inRow = rows.find((r) => r.Account === dest.name && r.Type === 'transfer_in');
      expect(outRow).toBeDefined();
      expect(inRow).toBeDefined();
      // LinkedTransfer should reference the OTHER leg's account name.
      expect(outRow?.LinkedTransfer).toContain(dest.name);
      expect(inRow?.LinkedTransfer).toContain(source.name);
    });
  });

  describe('Archive envelope and integrity manifest', () => {
    it('returns a well-formed JSON archive for a user with zero data: user header, manifest metadata, ISO filename, row-count header', async () => {
      // Empty-state contract: even when every transformer returns [], the
      // archive should still be a well-formed zip with a manifest. Regressions
      // in archive-writer or manifest-builder edge cases would surface here.
      const response = await helpers.exportData({ format: 'json' });
      expect(response.statusCode).toBe(200);
      expect(response.filename).toMatch(/^moneymatter-export-\d{4}-\d{2}-\d{2}\.zip$/);
      expect(response.totalRows).toBeGreaterThanOrEqual(0);
      expect(Number.isFinite(response.totalRows)).toBe(true);

      const archive = helpers.parseExportArchive({ buffer: response.body });
      expect(archive.manifest.files.length).toBeGreaterThan(0);
      expect(archive.manifest.schemaVersion).toBe(EXPORT_SCHEMA_VERSION);
      // manifest.json can't hash itself, so it's never listed among its own files.
      expect(archive.manifest.files.map((f) => f.filename)).not.toContain('manifest.json');
      expect(archive.manifest.dateRange).toBeUndefined();

      const json = archive.json as { user: { username: string; baseCurrency: string; email: string | null } };
      expect(json.user).toBeDefined();
      expect(json.user.username).toEqual(expect.any(String));
      expect(json.user.username.length).toBeGreaterThan(0);
      expect(json.user.baseCurrency).toBe(global.BASE_CURRENCY_CODE);
      expect(json.user.email).toBe('test1@test.local');
    });

    it('writes a UTF-8 BOM at the start of every CSV file and manifest SHA-256/sizeBytes matching each archived file', async () => {
      const response = await helpers.exportData({ format: 'csv' });
      const archive = helpers.parseExportArchive({ buffer: response.body });

      for (const [name, buf] of archive.files.entries()) {
        if (!name.endsWith('.csv')) continue;
        expect(buf[0]).toBe(0xef);
        expect(buf[1]).toBe(0xbb);
        expect(buf[2]).toBe(0xbf);
      }

      for (const entry of archive.manifest.files) {
        const onDisk = archive.files.get(entry.filename);
        expect(onDisk).toBeDefined();
        const computed = createHash('sha256').update(onDisk!).digest('hex');
        expect(computed).toBe(entry.sha256);
        expect(entry.sizeBytes).toBe(onDisk!.length);
      }
    });
  });

  describe('Multiple domain coverage', () => {
    it('exports budgets, subscriptions, portfolios, and vehicles when their groups are enabled', async () => {
      const account = await helpers.createAccount({ raw: true });
      const category = await helpers.addCustomCategory({ name: 'MultiCat', color: '#AABBCC', raw: true });
      await helpers.createCustomBudget({
        name: 'Export budget',
        limitAmount: 100000,
        categoryIds: [category.id],
        raw: true,
      });
      await helpers.createPortfolio({ payload: { name: 'Multi portfolio' }, raw: true });

      // Seed a subscription and vehicle so their transformers see real data –
      // the test name promises these domains are covered, so do not leave them
      // as no-op transformers.
      await helpers.createSubscription({
        name: 'Multi subscription',
        frequency: 'monthly' as never,
        startDate: '2026-01-01',
        expectedAmount: 10,
        expectedCurrencyCode: account.currencyCode,
        raw: true,
      });
      await helpers.createVehicle({
        name: 'Multi vehicle',
        currencyCode: account.currencyCode,
        make: 'Toyota',
        model: 'Corolla',
        year: 2022,
        vehicleClass: VEHICLE_CLASS.sedan,
        purchasePrice: 25000,
        purchaseDate: '2026-01-01',
        raw: true,
      });

      const response = await helpers.exportData({ format: 'json' });
      const archive = helpers.parseExportArchive({ buffer: response.body });
      const json = archive.json as Record<string, unknown[]>;

      expect(Array.isArray(json.budgets)).toBe(true);
      expect((json.budgets as Array<Record<string, unknown>>).some((b) => b.name === 'Export budget')).toBe(true);

      expect(Array.isArray(json.subscriptions)).toBe(true);
      expect((json.subscriptions as Array<Record<string, unknown>>).some((s) => s.name === 'Multi subscription')).toBe(
        true,
      );

      expect(Array.isArray(json.vehicles)).toBe(true);
      expect(
        (json.vehicles as Array<Record<string, unknown>>).some((v) => v.makeModel?.toString().includes('Toyota')),
      ).toBe(true);

      expect(Array.isArray(json.portfolios)).toBe(true);
      expect((json.portfolios as Array<Record<string, unknown>>).some((p) => p.name === 'Multi portfolio')).toBe(true);
    });

    it('exports transaction templates, resolving relations and leaving unset ones blank', async () => {
      const account = await helpers.createAccount({ raw: true });
      const category = await helpers.addCustomCategory({ name: 'TemplateCat', color: '#AABBCC', raw: true });
      const payee = await helpers.createPayee({
        payload: helpers.buildPayeePayload({ name: 'Template Payee' }),
        raw: true,
      });
      const tagA = await helpers.createTag({ payload: { name: 'tpl-a', color: '#111111' }, raw: true });
      const tagB = await helpers.createTag({ payload: { name: 'tpl-b', color: '#222222' }, raw: true });

      await helpers.createTransactionTemplate({
        payload: {
          name: 'Pinned template',
          transactionType: TRANSACTION_TYPES.expense,
          amount: 42.5,
          accountId: account.id,
          categoryId: category.id,
          payeeId: payee.id,
          tagIds: [tagA.id, tagB.id],
          note: 'weekly run',
        },
        raw: true,
      });
      await helpers.createTransactionTemplate({
        payload: { name: 'Unpinned template', transactionType: TRANSACTION_TYPES.income },
        raw: true,
      });

      const response = await helpers.exportData({ format: 'csv' });
      expect(response.statusCode).toBe(200);
      const archive = helpers.parseExportArchive({ buffer: response.body });
      const csv = archive.files.get('transaction_templates.csv');
      expect(csv).toBeDefined();
      const rows = helpers.parseExportCsv({ buffer: csv! });

      const pinned = rows.find((r) => r.Name === 'Pinned template');
      expect(pinned).toBeDefined();
      expect(pinned!.Type).toBe(TRANSACTION_TYPES.expense);
      expect(pinned!.Amount).toBe('42.5');
      expect(pinned!.Currency).toBe(account.currencyCode);
      expect(pinned!.Account).toBe(account.name);
      expect(pinned!.Category).toBe(category.name);
      expect(pinned!.Payee).toBe(payee.name);
      expect(pinned!.Tags!.split('; ').toSorted()).toEqual([tagA.name, tagB.name].toSorted());
      expect(pinned!.Note).toBe('weekly run');

      // A relation that was never set reads as an empty cell, never the unresolved-FK sentinel.
      const unpinned = rows.find((r) => r.Name === 'Unpinned template');
      expect(unpinned).toBeDefined();
      expect(unpinned!.Type).toBe(TRANSACTION_TYPES.income);
      expect(unpinned!.Amount).toBe('');
      expect(unpinned!.Currency).toBe('');
      expect(unpinned!.Account).toBe('');
      expect(unpinned!.Category).toBe('');
      expect(unpinned!.Payee).toBe('');
      expect(unpinned!.Tags).toBe('');
    });

    it('handles budgets with NULL limitAmount without crashing', async () => {
      // Budget.limitAmount is nullable; the transformer must guard the
      // `.toNumber()` call so a budget without a cap exports as an empty cell
      // rather than 500'ing the whole request.
      const category = await helpers.addCustomCategory({ name: 'NoLimitCat', color: '#AABBCC', raw: true });
      await helpers.createCustomBudget({
        name: 'Open-ended budget',
        categoryIds: [category.id],
        // limitAmount intentionally omitted – should be allowed by the budgets API.
        raw: true,
      });

      const response = await helpers.exportData({ format: 'csv' });
      expect(response.statusCode).toBe(200);
      const archive = helpers.parseExportArchive({ buffer: response.body });
      const budgetsCsv = archive.files.get('budgets.csv');
      expect(budgetsCsv).toBeDefined();
      const rows = helpers.parseExportCsv({ buffer: budgetsCsv! });
      const seeded = rows.find((r) => r.Name === 'Open-ended budget');
      expect(seeded).toBeDefined();
      expect(seeded?.LimitAmount).toBe('');
    });
  });

  describe('Portfolio transfers referencing a trashed portfolio', () => {
    it('resolves the trashed portfolio name instead of emitting the unresolved sentinel', async () => {
      const account = await helpers.createAccount({ raw: true });
      const portfolio = await helpers.createPortfolio({ payload: { name: 'Trashed portfolio' }, raw: true });
      await helpers.accountToPortfolioTransfer({
        portfolioId: portfolio.id,
        payload: {
          accountId: account.id,
          amount: '100',
          date: new Date().toISOString().slice(0, 10),
        },
        raw: true,
      });
      // Soft delete: portfolio goes to the 30-day trash but the transfer row survives.
      await helpers.deletePortfolio({ portfolioId: portfolio.id, raw: true });

      const response = await helpers.exportData({ format: 'csv', groups: ['investments'] });
      expect(response.statusCode).toBe(200);
      const archive = helpers.parseExportArchive({ buffer: response.body });

      const transferRows = helpers.parseExportCsv({ buffer: archive.files.get('portfolio_transfers.csv')! });
      expect(transferRows).toHaveLength(1);
      expect(transferRows[0]?.FromAccount).toBe(account.name);
      expect(transferRows[0]?.ToAccount).toBe('Trashed portfolio');

      // portfolios.csv stays live-only: the trash is transient, so a trashed
      // portfolio is named by historical rows but not listed as a portfolio.
      const portfolioRows = helpers.parseExportCsv({ buffer: archive.files.get('portfolios.csv')! });
      expect(portfolioRows.some((r) => r.Name === 'Trashed portfolio')).toBe(false);
    });
  });

  describe('Portfolios cash balances (per-currency)', () => {
    it('emits the packed CashBalances cell for CSV and a structured cashBalances array for JSON', async () => {
      // Portfolio is seeded via the public API; the export pipeline reads
      // whatever PortfolioBalances rows the create endpoint produces. The
      // test asserts the shape of the export cell, not how the cash got
      // there – so it stays valid even if portfolio-creation behaviour
      // changes how the initial PortfolioBalance row is seeded.
      const portfolio = await helpers.createPortfolio({ payload: { name: 'Multi-CCY portfolio' }, raw: true });
      expect(portfolio.id).toBeDefined();

      const jsonResponse = await helpers.exportData({ format: 'json', groups: ['investments'] });
      const jsonArchive = helpers.parseExportArchive({ buffer: jsonResponse.body });
      const jsonData = jsonArchive.json as { portfolios: Array<Record<string, unknown>> };
      const jsonRow = jsonData.portfolios.find((p) => p.name === 'Multi-CCY portfolio');
      expect(jsonRow).toBeDefined();
      // Either a structured per-currency array OR explicit null when no
      // balance rows exist – never an absent key, never a single scalar.
      const cashBalances = jsonRow?.cashBalances as Array<{ currency: string; balance: number }> | null;
      expect(cashBalances === null || Array.isArray(cashBalances)).toBe(true);
      if (Array.isArray(cashBalances)) {
        for (const entry of cashBalances) {
          expect(typeof entry.currency).toBe('string');
          expect(typeof entry.balance).toBe('number');
        }
      }

      const csvResponse = await helpers.exportData({ format: 'csv', groups: ['investments'] });
      const csvArchive = helpers.parseExportArchive({ buffer: csvResponse.body });
      const rows = helpers.parseExportCsv({ buffer: csvArchive.files.get('portfolios.csv')! });
      const csvRow = rows.find((r) => r.Name === 'Multi-CCY portfolio');
      expect(csvRow).toBeDefined();
      // Column header is `CashBalances` (packed string), NOT the old single
      // `CashBalance` numeric column. A regression that re-introduces the
      // single-currency column would lose multi-currency information.
      expect(Object.keys(csvRow!)).toContain('CashBalances');
      expect(Object.keys(csvRow!)).not.toContain('CashBalance');
    });
  });

  describe('CSV cell escaping', () => {
    it('round-trips commas, quotes, and newlines inside notes through csv-stringify', async () => {
      const account = await helpers.createAccount({ raw: true });
      const note = 'She said "hi", then left\nNext line';
      await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account.id,
          amount: 1,
          transactionType: TRANSACTION_TYPES.expense,
          note,
        }),
        raw: true,
      });

      const response = await helpers.exportData({ format: 'csv' });
      expect(response.statusCode).toBe(200);
      const archive = helpers.parseExportArchive({ buffer: response.body });
      const txCsv = archive.files.get('transactions.csv')!;
      // Reading the raw bytes (not parseExportCsv, which is intentionally
      // newline-unaware) – the escape sequences for `"` and `,` must be the
      // canonical csv-stringify form: `""` for quotes, fully-quoted cell
      // when the value contains commas/newlines.
      const text = txCsv.toString('utf8');
      expect(text).toContain('"She said ""hi"", then left');
    });
  });

  describe('Tag join contract', () => {
    it('joins multiple tags into the Tags cell with the documented "; " delimiter', async () => {
      const account = await helpers.createAccount({ raw: true });
      const tagA = await helpers.createTag({ payload: { name: 'alpha', color: '#111111' }, raw: true });
      const tagB = await helpers.createTag({ payload: { name: 'beta', color: '#222222' }, raw: true });
      const tx = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account.id,
          amount: 1,
          transactionType: TRANSACTION_TYPES.expense,
          note: 'TagJoin',
        }),
        raw: true,
      });
      const baseTx = Array.isArray(tx) ? tx[0] : tx;
      await helpers.addTransactionsToTag({ tagId: tagA.id, transactionIds: [baseTx!.id], raw: true });
      await helpers.addTransactionsToTag({ tagId: tagB.id, transactionIds: [baseTx!.id], raw: true });

      const response = await helpers.exportData({ format: 'csv' });
      const archive = helpers.parseExportArchive({ buffer: response.body });
      const rows = helpers.parseExportCsv({ buffer: archive.files.get('transactions.csv')! });
      const row = rows.find((r) => r.Note === 'TagJoin');
      expect(row).toBeDefined();
      // Tags written in insertion order with explicit '; ' separator. A
      // delimiter regression to ',' would shift CSV columns silently for any
      // tag-bearing row.
      expect([row!.Tags === 'alpha; beta', row!.Tags === 'beta; alpha']).toContain(true);
    });
  });

  describe('Subscriptions transformer', () => {
    it('exports the subscription.endDate as the EndDate column (not relabelled as next-due)', async () => {
      const account = await helpers.createAccount({ raw: true });
      await helpers.createSubscription({
        name: 'EndDate sub',
        frequency: 'monthly' as never,
        startDate: '2026-01-01',
        endDate: '2026-12-31',
        expectedAmount: 10,
        expectedCurrencyCode: account.currencyCode,
        raw: true,
      });
      const response = await helpers.exportData({ format: 'csv', groups: ['subscriptions'] });
      const archive = helpers.parseExportArchive({ buffer: response.body });
      const rows = helpers.parseExportCsv({ buffer: archive.files.get('subscriptions.csv')! });
      const row = rows.find((r) => r.Name === 'EndDate sub');
      expect(row).toBeDefined();
      expect(row!.EndDate).toBe('2026-12-31');
      // Defends against a regression that re-renames the column.
      expect(Object.keys(row!)).not.toContain('NextDue');
    });
  });

  describe('Cross-user isolation', () => {
    it("does NOT leak another user's account, category, tag, or transaction note into the primary user's export", async () => {
      // Sign up a separate user and seed identifiable data (account, category,
      // tag, transaction note) so any unguarded FK lookup in a transformer
      // would pull the foreign rows into the primary user's export.
      // Cross-user guards live on every transformer that joins to a
      // user-scoped relation; this test fails fast if a future transformer
      // forgets the `userId` clause on one of those queries.
      const foreignNeedle = {
        account: `Foreign account ${Date.now()}`,
        category: `Foreign category ${Date.now()}`,
        tag: `foreign-tag-${Date.now()}`,
        note: `Foreign note ${Date.now()}`,
        payee: `Foreign payee ${Date.now()}`,
        payeeAlias: `FOREIGN PAYEE ALIAS ${Date.now()}`,
      };

      const secondUser = await helpers.signUpSecondUser();
      await helpers.asUser({
        cookies: secondUser.cookies,
        fn: async () => {
          await helpers.setBaseCurrencyForActiveUser({ currencyCode: global.BASE_CURRENCY.code });
          const foreignAccount = await helpers.createAccount({
            payload: helpers.buildAccountPayload({ name: foreignNeedle.account }),
            raw: true,
          });
          const foreignCategory = await helpers.addCustomCategory({
            name: foreignNeedle.category,
            color: '#FF00FF',
            raw: true,
          });
          await helpers.createTag({ payload: { name: foreignNeedle.tag, color: '#FF00FF' }, raw: true });
          const foreignPayee = await helpers.createPayee({
            payload: helpers.buildPayeePayload({ name: foreignNeedle.payee }),
            raw: true,
          });
          await helpers.createPayeeAlias({
            payeeId: foreignPayee.id,
            rawName: foreignNeedle.payeeAlias,
            raw: true,
          });
          await helpers.createTransaction({
            payload: helpers.buildTransactionPayload({
              accountId: foreignAccount.id,
              categoryId: foreignCategory.id,
              amount: 999,
              transactionType: TRANSACTION_TYPES.expense,
              note: foreignNeedle.note,
            }),
            raw: true,
          });
        },
      });

      // Seed a single primary-user transaction so the export has real rows.
      const myAccount = await helpers.createAccount({ raw: true });
      await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: myAccount.id,
          amount: 1,
          transactionType: TRANSACTION_TYPES.expense,
          note: 'Primary user row',
        }),
        raw: true,
      });

      const response = await helpers.exportData({ format: 'json' });
      expect(response.statusCode).toBe(200);
      const archive = helpers.parseExportArchive({ buffer: response.body });
      const stringified = JSON.stringify(archive.json);

      // None of the second user's identifiable strings should appear anywhere
      // in the archive – not in transactions, not in joined names, not in
      // tag arrays, not in account currency columns, etc.
      expect(stringified).not.toContain(foreignNeedle.account);
      expect(stringified).not.toContain(foreignNeedle.category);
      expect(stringified).not.toContain(foreignNeedle.tag);
      expect(stringified).not.toContain(foreignNeedle.note);
      expect(stringified).not.toContain(foreignNeedle.payee);
      expect(stringified).not.toContain(foreignNeedle.payeeAlias);
    });
  });

  describe('Rate limit', () => {
    it('allows 5 exports in a 15-minute window per user, rejects the 6th with 429, and re-opens after a window reset', async () => {
      // Don't rely on the suite-wide beforeEach reset — make this case self-contained
      // so it stays meaningful if the surrounding setup ever changes.
      const userRes = await helpers.makeRequest({ method: 'get', url: '/user', raw: true });
      const userId = (userRes as { id: number }).id;
      const key = `data-export:user:${userId}`;
      await RateLimitService.resetRateLimit(key);

      for (let attempt = 1; attempt <= 5; attempt++) {
        const response = await helpers.exportData({ format: 'json' });
        expect(response.statusCode).toBe(200);
      }

      const blocked = await helpers.exportData({ format: 'json' });
      expect(blocked.statusCode).toBe(429);
      const body = blocked.errorBody as { response?: { code?: string } } | null;
      expect(body?.response?.code).toBe(API_ERROR_CODES.tooManyRequests);

      await RateLimitService.resetRateLimit(key);

      const afterReset = await helpers.exportData({ format: 'json' });
      expect(afterReset.statusCode).toBe(200);
    }, 30000);
  });

  describe('Date range', () => {
    it('filters transactions to the requested range, records the range on the manifest, and leaves reference tables untouched', async () => {
      const account = await helpers.createAccount({ raw: true });
      const category = await helpers.addCustomCategory({ name: 'Range cat', color: '#AABBCC', raw: true });

      // Three transactions: one before, one inside, one after the window we'll
      // request. The export must drop the bookends and keep only the middle row.
      await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account.id,
          categoryId: category.id,
          amount: 11,
          transactionType: TRANSACTION_TYPES.expense,
          note: 'Before window',
          time: '2023-12-31T12:00:00.000Z',
        }),
        raw: true,
      });
      await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account.id,
          categoryId: category.id,
          amount: 22,
          transactionType: TRANSACTION_TYPES.expense,
          note: 'Inside window',
          time: '2024-06-15T12:00:00.000Z',
        }),
        raw: true,
      });
      await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account.id,
          categoryId: category.id,
          amount: 33,
          transactionType: TRANSACTION_TYPES.expense,
          note: 'After window',
          time: '2025-02-01T12:00:00.000Z',
        }),
        raw: true,
      });

      const response = await helpers.exportData({
        format: 'json',
        dateRange: { from: '2024-01-01', to: '2024-12-31' },
      });
      expect(response.statusCode).toBe(200);

      const archive = helpers.parseExportArchive({ buffer: response.body });
      expect(archive.manifest.dateRange).toEqual({ from: '2024-01-01', to: '2024-12-31' });

      const data = archive.json as {
        transactions: Array<Record<string, unknown>>;
        accounts: Array<Record<string, unknown>>;
        categories: Array<Record<string, unknown>>;
      };

      const notes = data.transactions.map((t) => t.note);
      expect(notes).toContain('Inside window');
      expect(notes).not.toContain('Before window');
      expect(notes).not.toContain('After window');

      // Reference tables still emit everything – the inside-window row must
      // still resolve to the account/category by name.
      const accountNames = data.accounts.map((a) => a.name);
      const categoryNames = data.categories.map((c) => c.name);
      expect(accountNames).toContain(account.name);
      expect(categoryNames).toContain('Range cat');
    });

    it('inclusive on both endpoints (rows exactly on `from` or `to` are kept)', async () => {
      const account = await helpers.createAccount({ raw: true });

      await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account.id,
          amount: 1,
          transactionType: TRANSACTION_TYPES.expense,
          note: 'Lower boundary',
          time: '2024-01-01T00:00:00.000Z',
        }),
        raw: true,
      });
      await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account.id,
          amount: 2,
          transactionType: TRANSACTION_TYPES.expense,
          note: 'Upper boundary',
          time: '2024-12-31T23:59:00.000Z',
        }),
        raw: true,
      });

      const response = await helpers.exportData({
        format: 'json',
        dateRange: { from: '2024-01-01', to: '2024-12-31' },
      });
      const archive = helpers.parseExportArchive({ buffer: response.body });
      const data = archive.json as { transactions: Array<Record<string, unknown>> };
      const notes = data.transactions.map((t) => t.note);
      expect(notes).toEqual(expect.arrayContaining(['Lower boundary', 'Upper boundary']));
    });
  });

  describe('Transaction detail columns', () => {
    it('exports payee, payment type, external links, and location when the transaction carries them', async () => {
      const account = await helpers.createAccount({ raw: true });
      const payee = await helpers.createPayee({
        payload: helpers.buildPayeePayload({ name: 'Detail Payee' }),
        raw: true,
      });

      await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account.id,
          amount: 10,
          transactionType: TRANSACTION_TYPES.expense,
          paymentType: PAYMENT_TYPES.cash,
          payeeId: payee.id,
          note: 'Detailed row',
          externalUrl: 'https://example.com/receipt/1',
          externalReference: 'REF-001',
          location: { latitude: 50.45, longitude: 30.523 },
        }),
        raw: true,
      });

      const response = await helpers.exportData({ format: 'csv' });
      expect(response.statusCode).toBe(200);
      const archive = helpers.parseExportArchive({ buffer: response.body });
      const rows = helpers.parseExportCsv({ buffer: archive.files.get('transactions.csv')! });

      const row = rows.find((r) => r.Note === 'Detailed row');
      expect(row).toBeDefined();
      expect(row!.Payee).toBe(payee.name);
      expect(row!.PaymentType).toBe(PAYMENT_TYPES.cash);
      expect(row!.ExternalUrl).toBe('https://example.com/receipt/1');
      expect(row!.ExternalReference).toBe('REF-001');
      expect(row!.Location).toBe('50.45,30.523');
    });

    it('emits empty cells for payee, external links, and location when the transaction has none', async () => {
      const account = await helpers.createAccount({ raw: true });
      await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account.id,
          amount: 5,
          transactionType: TRANSACTION_TYPES.expense,
          note: 'Bare row',
        }),
        raw: true,
      });

      const response = await helpers.exportData({ format: 'json' });
      const archive = helpers.parseExportArchive({ buffer: response.body });
      const data = archive.json as { transactions: Array<Record<string, unknown>> };

      const row = data.transactions.find((t) => t.note === 'Bare row');
      expect(row).toBeDefined();
      expect(row?.payee).toBe('');
      expect(row?.externalUrl).toBe('');
      expect(row?.externalReference).toBe('');
      expect(row?.location).toBe('');
    });
  });

  describe('Payees file', () => {
    it('exports payees with their default category, aliases, and default tags', async () => {
      const category = await helpers.addCustomCategory({ name: 'PayeeCat', color: '#AABBCC', raw: true });
      const tagAlpha = await helpers.createTag({ payload: { name: 'payee-alpha', color: '#111111' }, raw: true });
      const tagBeta = await helpers.createTag({ payload: { name: 'payee-beta', color: '#222222' }, raw: true });
      const payee = await helpers.createPayee({
        payload: helpers.buildPayeePayload({
          name: 'Exported Payee',
          defaultCategoryId: category.id,
          defaultTagIds: [tagAlpha.id, tagBeta.id],
        }),
        raw: true,
      });
      await helpers.createPayeeAlias({ payeeId: payee.id, rawName: 'EXPORTED PAYEE LLC', raw: true });
      await helpers.createPayeeAlias({ payeeId: payee.id, rawName: 'EXPORTED PAYEE INC', raw: true });

      const response = await helpers.exportData({ format: 'csv' });
      expect(response.statusCode).toBe(200);
      const archive = helpers.parseExportArchive({ buffer: response.body });
      const csv = archive.files.get('payees.csv');
      expect(csv).toBeDefined();
      const rows = helpers.parseExportCsv({ buffer: csv! });

      const row = rows.find((r) => r.Name === payee.name);
      expect(row).toBeDefined();
      expect(row!.DefaultCategory).toBe('PayeeCat');
      expect(row!.Aliases!.split('; ').toSorted()).toEqual(['EXPORTED PAYEE INC', 'EXPORTED PAYEE LLC']);
      expect(row!.DefaultTags!.split('; ').toSorted()).toEqual(['payee-alpha', 'payee-beta']);

      const jsonResponse = await helpers.exportData({ format: 'json' });
      const jsonArchive = helpers.parseExportArchive({ buffer: jsonResponse.body });
      const jsonPayee = (jsonArchive.json as { payees: Array<Record<string, unknown>> }).payees.find(
        (p) => p.name === payee.name,
      );
      expect(jsonPayee).toBeDefined();
      expect((jsonPayee!.aliases as string[]).toSorted()).toEqual(['EXPORTED PAYEE INC', 'EXPORTED PAYEE LLC']);
      expect((jsonPayee!.defaultTags as string[]).toSorted()).toEqual(['payee-alpha', 'payee-beta']);
    });

    it('emits the payees file with zero rows for a user without payees', async () => {
      const response = await helpers.exportData({ format: 'csv' });
      expect(response.statusCode).toBe(200);
      const archive = helpers.parseExportArchive({ buffer: response.body });
      const csv = archive.files.get('payees.csv');
      expect(csv).toBeDefined();
      expect(helpers.parseExportCsv({ buffer: csv! })).toHaveLength(0);
    });
  });

  describe('Account filter', () => {
    it('limits transactions, balance history and the accounts file to the requested accounts', async () => {
      const accountA = await helpers.createAccount({
        payload: helpers.buildAccountPayload({ name: 'Filter account A' }),
        raw: true,
      });
      const accountB = await helpers.createAccount({
        payload: helpers.buildAccountPayload({ name: 'Filter account B' }),
        raw: true,
      });

      await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: accountA.id,
          amount: 11,
          transactionType: TRANSACTION_TYPES.expense,
          note: 'Account A row',
        }),
        raw: true,
      });
      await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: accountB.id,
          amount: 22,
          transactionType: TRANSACTION_TYPES.expense,
          note: 'Account B row',
        }),
        raw: true,
      });

      const response = await helpers.exportData({ format: 'json', accountIds: [accountA.id] });
      expect(response.statusCode).toBe(200);

      const archive = helpers.parseExportArchive({ buffer: response.body });
      const data = archive.json as {
        transactions: Array<Record<string, unknown>>;
        accounts: Array<Record<string, unknown>>;
        balances_history: Array<Record<string, unknown>>;
      };

      const notes = data.transactions.map((t) => t.note);
      expect(notes).toContain('Account A row');
      expect(notes).not.toContain('Account B row');

      expect(data.balances_history.length).toBeGreaterThan(0);
      expect([...new Set(data.balances_history.map((b) => b.account))]).toEqual([accountA.name]);

      const accountNames = data.accounts.map((a) => a.name);
      expect(accountNames).toContain(accountA.name);
      expect(accountNames).not.toContain(accountB.name);
      expect(archive.manifest.accountIds).toEqual([accountA.id]);

      const unfiltered = await helpers.exportData({ format: 'json' });
      expect(unfiltered.statusCode).toBe(200);
      const unfilteredArchive = helpers.parseExportArchive({ buffer: unfiltered.body });
      const unfilteredAccounts = (
        unfilteredArchive.json as {
          accounts: Array<Record<string, unknown>>;
        }
      ).accounts.map((a) => a.name);
      expect(unfilteredAccounts).toEqual(expect.arrayContaining([accountA.name, accountB.name]));
      expect(unfilteredArchive.manifest).not.toHaveProperty('accountIds');
    });

    it('ignores an account id that belongs to another user', async () => {
      const foreignNeedle = {
        account: `Foreign filtered account ${Date.now()}`,
        note: `Foreign filtered note ${Date.now()}`,
      };
      let foreignAccountId = '';

      const secondUser = await helpers.signUpSecondUser();
      await helpers.asUser({
        cookies: secondUser.cookies,
        fn: async () => {
          await helpers.setBaseCurrencyForActiveUser({ currencyCode: global.BASE_CURRENCY.code });
          const foreignAccount = await helpers.createAccount({
            payload: helpers.buildAccountPayload({ name: foreignNeedle.account }),
            raw: true,
          });
          foreignAccountId = foreignAccount.id;
          await helpers.createTransaction({
            payload: helpers.buildTransactionPayload({
              accountId: foreignAccount.id,
              amount: 999,
              transactionType: TRANSACTION_TYPES.expense,
              note: foreignNeedle.note,
            }),
            raw: true,
          });
        },
      });

      const myAccount = await helpers.createAccount({
        payload: helpers.buildAccountPayload({ name: 'Own filtered account' }),
        raw: true,
      });
      await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: myAccount.id,
          amount: 5,
          transactionType: TRANSACTION_TYPES.expense,
          note: 'Own filtered row',
        }),
        raw: true,
      });

      const response = await helpers.exportData({ format: 'json', accountIds: [myAccount.id, foreignAccountId] });
      expect(response.statusCode).toBe(200);

      const archive = helpers.parseExportArchive({ buffer: response.body });
      const data = archive.json as {
        transactions: Array<Record<string, unknown>>;
        accounts: Array<Record<string, unknown>>;
        balances_history: Array<Record<string, unknown>>;
      };

      expect(data.transactions.map((t) => t.note)).toContain('Own filtered row');
      expect(data.accounts.map((a) => a.name)).toContain(myAccount.name);

      const filteredFiles = JSON.stringify({
        transactions: data.transactions,
        accounts: data.accounts,
        balances_history: data.balances_history,
      });
      expect(filteredFiles).not.toContain(foreignNeedle.account);
      expect(filteredFiles).not.toContain(foreignNeedle.note);
    });

    it('applies the account filter and the date range together', async () => {
      const accountA = await helpers.createAccount({
        payload: helpers.buildAccountPayload({ name: 'Combo account A' }),
        raw: true,
      });
      const accountB = await helpers.createAccount({
        payload: helpers.buildAccountPayload({ name: 'Combo account B' }),
        raw: true,
      });

      for (const [account, label] of [
        [accountA, 'A'],
        [accountB, 'B'],
      ] as const) {
        await helpers.createTransaction({
          payload: helpers.buildTransactionPayload({
            accountId: account.id,
            amount: 10,
            transactionType: TRANSACTION_TYPES.expense,
            note: `${label} inside`,
            time: '2024-06-15T12:00:00.000Z',
          }),
          raw: true,
        });
        await helpers.createTransaction({
          payload: helpers.buildTransactionPayload({
            accountId: account.id,
            amount: 20,
            transactionType: TRANSACTION_TYPES.expense,
            note: `${label} outside`,
            time: '2025-06-15T12:00:00.000Z',
          }),
          raw: true,
        });
      }

      const response = await helpers.exportData({
        format: 'json',
        accountIds: [accountA.id],
        dateRange: { from: '2024-01-01', to: '2024-12-31' },
      });
      expect(response.statusCode).toBe(200);

      const archive = helpers.parseExportArchive({ buffer: response.body });
      const data = archive.json as { transactions: Array<Record<string, unknown>> };
      expect(data.transactions.map((t) => t.note)).toEqual(['A inside']);
    });

    it('still names the counterpart account in LinkedTransfer when the other leg is filtered out', async () => {
      const source = await helpers.createAccount({
        payload: helpers.buildAccountPayload({ name: 'Straddle source' }),
        raw: true,
      });
      const dest = await helpers.createAccount({
        payload: helpers.buildAccountPayload({ name: 'Straddle dest' }),
        raw: true,
      });
      await helpers.createTransaction({
        payload: {
          ...helpers.buildTransactionPayload({
            accountId: source.id,
            amount: 7500,
            transactionType: TRANSACTION_TYPES.expense,
            transferNature: TRANSACTION_TRANSFER_NATURE.common_transfer,
          }),
          destinationAmount: 7500,
          destinationAccountId: dest.id,
        } as unknown as ReturnType<typeof helpers.buildTransactionPayload>,
        raw: true,
      });

      const unfiltered = await helpers.exportData({ format: 'csv' });
      const unfilteredRows = helpers.parseExportCsv({
        buffer: helpers.parseExportArchive({ buffer: unfiltered.body }).files.get('transactions.csv')!,
      });
      const unfilteredOutLeg = unfilteredRows.find((r) => r.Account === source.name && r.Type === 'transfer_out');
      expect(unfilteredOutLeg).toBeDefined();

      const filtered = await helpers.exportData({ format: 'csv', accountIds: [source.id] });
      expect(filtered.statusCode).toBe(200);
      const filteredRows = helpers.parseExportCsv({
        buffer: helpers.parseExportArchive({ buffer: filtered.body }).files.get('transactions.csv')!,
      });

      const transferRows = filteredRows.filter((r) => r.Type === 'transfer_out' || r.Type === 'transfer_in');
      expect(transferRows).toHaveLength(1);
      expect(transferRows[0]!.Account).toBe(source.name);
      expect(transferRows[0]!.LinkedTransfer).toContain(dest.name);
      expect(transferRows[0]!.LinkedTransfer).toBe(unfilteredOutLeg!.LinkedTransfer);
    });
  });

  describe('Budget plans', () => {
    type Period = { id: string; startDate: string; endDate: string };
    type BudgetPlanFiles = {
      budget_lines: Array<Record<string, unknown>>;
      budget_periods: Array<Record<string, unknown>>;
    };

    const exportBudgets = async ({ dateRange }: { dateRange?: { from?: string; to?: string } } = {}) => {
      const response = await helpers.exportData({ format: 'json', groups: ['budgets'], dateRange });
      expect(response.statusCode).toBe(200);
      return helpers.parseExportArchive({ buffer: response.body }).json as BudgetPlanFiles;
    };

    const dayBefore = ({ date }: { date: string }) =>
      new Date(Date.parse(`${date}T00:00:00.000Z`) - 86_400_000).toISOString().slice(0, 10);

    it('exports plan lines and per-period numbers that match the period view', async () => {
      const account = await helpers.createAccount({ raw: true });
      const [groceries, household, transport, fun] = await Promise.all([
        helpers.addCustomCategory({ name: 'Plan groceries', color: '#111111', raw: true }),
        helpers.addCustomCategory({ name: 'Plan household', color: '#222222', raw: true }),
        helpers.addCustomCategory({ name: 'Plan transport', color: '#333333', raw: true }),
        helpers.addCustomCategory({ name: 'Plan fun', color: '#444444', raw: true }),
      ]);

      const { plan } = await helpers.createBudgetPlan({
        payload: {
          name: 'Export plan',
          accountIds: [account.id],
          epochDate: helpers.budgetPeriodStart({ monthsAgo: 1 }),
        },
        raw: true,
      });
      const periods = await helpers.listBudgetPlanPeriods({ planId: plan.id, raw: true });
      const [previous, current, next] = [periods[0]!, periods[1]!, periods[2]!];

      const essentials = await helpers.createBudgetLineGroup({ planId: plan.id, name: 'Essentials', raw: true });
      const transportLine = await helpers.createBudgetPlanLine({
        planId: plan.id,
        payload: { name: 'Transport', categoryIds: [transport.id], activeFrom: previous.startDate },
        raw: true,
      });
      const oldLine = await helpers.createBudgetPlanLine({
        planId: plan.id,
        payload: { name: 'Old line', categoryIds: [fun.id], activeFrom: previous.startDate },
        raw: true,
      });
      const groceriesLine = await helpers.createBudgetPlanLine({
        planId: plan.id,
        payload: {
          name: 'Groceries',
          categoryIds: [household.id, groceries.id],
          groupId: essentials.id,
          activeFrom: previous.startDate,
        },
        raw: true,
      });
      await helpers.archiveBudgetPlanLine({ planId: plan.id, lineId: oldLine.id, raw: true });
      await helpers.setBudgetLineGoal({
        planId: plan.id,
        lineId: groceriesLine.id,
        payload: { frequency: 'every_period', behavior: 'budget_another', amount: 100 },
        raw: true,
      });

      const assign = ({ period, lineId, amount }: { period: Period; lineId: string; amount: number }) =>
        helpers.setBudgetAssignment({
          planId: plan.id,
          periodId: period.id,
          lineId,
          payload: { scope: 'this_period', amount },
          raw: true,
        });
      await assign({ period: previous, lineId: groceriesLine.id, amount: 200.5 });
      await assign({ period: current, lineId: groceriesLine.id, amount: 150 });
      await assign({ period: next, lineId: transportLine.id, amount: 50 });

      await helpers.createTransaction({
        payload: {
          ...helpers.buildTransactionPayload({
            accountId: account.id,
            categoryId: groceries.id,
            amount: 30.25,
            transactionType: TRANSACTION_TYPES.expense,
          }),
          time: `${previous.startDate}T12:00:00.000Z`,
        },
        raw: true,
      });

      const data = await exportBudgets();
      const currency = global.BASE_CURRENCY_CODE;

      expect(data.budget_lines).toEqual([
        {
          plan: 'Export plan',
          group: '',
          line: 'Transport',
          categories: ['Plan transport'],
          archived: false,
          goal: '',
          currency,
        },
        {
          plan: 'Export plan',
          group: '',
          line: 'Old line',
          categories: ['Plan fun'],
          archived: true,
          goal: '',
          currency,
        },
        {
          plan: 'Export plan',
          group: 'Essentials',
          line: 'Groceries',
          categories: ['Plan groceries', 'Plan household'],
          archived: false,
          goal: 'Budget another 100.00 every period',
          currency,
        },
      ]);

      const rowsFromView = async ({ period, lines }: { period: Period; lines: string[] }) => {
        const view = await helpers.getBudgetPlanPeriodView({ planId: plan.id, periodId: period.id, raw: true });
        return lines.map((name) => {
          const line = view.lines.find((entry) => entry.name === name)!;
          return {
            plan: 'Export plan',
            periodStart: period.startDate,
            periodEndInclusive: dayBefore({ date: period.endDate }),
            line: name,
            assigned: line.assigned,
            spent: 0 - line.activity,
            available: line.available,
            currency,
          };
        });
      };

      // The archived line only lived in the previous period; periods after `next` carry no assignment.
      expect(data.budget_periods).toEqual([
        ...(await rowsFromView({ period: previous, lines: ['Transport', 'Old line', 'Groceries'] })),
        ...(await rowsFromView({ period: current, lines: ['Transport', 'Groceries'] })),
        ...(await rowsFromView({ period: next, lines: ['Transport', 'Groceries'] })),
      ]);
      expect(data.budget_periods[2]).toMatchObject({
        line: 'Groceries',
        periodEndInclusive: dayBefore({ date: current.startDate }),
        assigned: 200.5,
        spent: 30.25,
        available: 170.25,
      });

      const ranged = await exportBudgets({ dateRange: { from: current.startDate, to: current.startDate } });
      expect(ranged.budget_periods.map((row) => [row.periodStart, row.line])).toEqual([
        [current.startDate, 'Transport'],
        [current.startDate, 'Groceries'],
      ]);
      expect(ranged.budget_lines).toHaveLength(3);
    });

    it('keeps every period through the last future one holding an assignment', async () => {
      const category = await helpers.addCustomCategory({ name: 'Plan ahead', color: '#666666', raw: true });
      const { plan } = await helpers.createBudgetPlan({ payload: { name: 'Ahead plan' }, raw: true });
      const line = await helpers.createBudgetPlanLine({
        planId: plan.id,
        payload: { name: 'Ahead line', categoryIds: [category.id] },
        raw: true,
      });
      const periods = await helpers.listBudgetPlanPeriods({ planId: plan.id, raw: true });
      await helpers.setBudgetAssignment({
        planId: plan.id,
        periodId: periods[3]!.id,
        lineId: line.id,
        payload: { scope: 'this_period', amount: 40 },
        raw: true,
      });

      const data = await exportBudgets();

      expect(data.budget_periods.map((row) => row.periodStart)).toEqual(
        periods.slice(0, 4).map((period) => period.startDate),
      );
    });

    it('emits empty budget plan files for a user without plans', async () => {
      const data = await exportBudgets();

      expect(data.budget_lines).toEqual([]);
      expect(data.budget_periods).toEqual([]);
    });

    it('leaves out a trashed plan', async () => {
      const category = await helpers.addCustomCategory({ name: 'Trash cat', color: '#555555', raw: true });
      const { plan: trashed } = await helpers.createBudgetPlan({ payload: { name: 'Trashed plan' }, raw: true });
      await helpers.createBudgetPlanLine({
        planId: trashed.id,
        payload: { name: 'Trashed line', categoryIds: [category.id] },
        raw: true,
      });
      await helpers.deleteBudgetPlan({ planId: trashed.id, raw: true });

      const { plan: live } = await helpers.createBudgetPlan({ payload: { name: 'Live plan' }, raw: true });
      await helpers.createBudgetPlanLine({
        planId: live.id,
        payload: { name: 'Live line', categoryIds: [category.id] },
        raw: true,
      });

      const data = await exportBudgets();

      expect(data.budget_lines.map((row) => [row.plan, row.line])).toEqual([['Live plan', 'Live line']]);
      expect(data.budget_periods.map((row) => [row.plan, row.line])).toEqual([['Live plan', 'Live line']]);
    });
  });

  describe('Size limit (ExportTooLargeError → 409)', () => {
    it('responds with 409 + payloadTooLarge when the row count would exceed MAX_EXPORT_ROWS', async () => {
      // The local data-export types module re-exports MAX_EXPORT_ROWS from
      // `@bt/shared/types`, which makes it a getter on the namespace object
      // (not a writable property). `jest.replaceProperty` rejects getters,
      // so spy on the getter instead.
      const exportTypesModule = await import('@services/data-export/types');
      // The getter's return type is the literal `250000`; cast through unknown
      // to swap in the test sentinel without widening the prod type.
      const spy = jest
        .spyOn(exportTypesModule, 'MAX_EXPORT_ROWS', 'get')
        .mockReturnValue(0 as unknown as typeof exportTypesModule.MAX_EXPORT_ROWS);

      try {
        const account = await helpers.createAccount({ raw: true });
        await helpers.createTransaction({
          payload: helpers.buildTransactionPayload({
            accountId: account.id,
            amount: 1,
            transactionType: TRANSACTION_TYPES.expense,
          }),
          raw: true,
        });

        const response = await helpers.exportData({ format: 'json' });
        expect(response.statusCode).toBe(409);
        const body = response.errorBody as { response?: { code?: string } } | null;
        expect(body?.response?.code).toBe(API_ERROR_CODES.payloadTooLarge);
      } finally {
        spy.mockRestore();
      }
    });
  });
});
