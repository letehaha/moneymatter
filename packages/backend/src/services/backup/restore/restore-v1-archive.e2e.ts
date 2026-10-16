import { BACKUP_FORMAT_VERSION } from '@bt/shared/types';
import { beforeEach, describe, expect, it } from '@jest/globals';
import { RateLimitService } from '@services/common/rate-limit.service';
import * as helpers from '@tests/helpers';
import Big from 'big.js';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

type Row = Record<string, unknown>;

/**
 * A format version 1 archive (money as integer cents) for a small ledger: three accounts (one
 * negative balance, one in USD, one loan), three transactions with a split, balances, a tag
 * reminder, a loan with events, a tracker, a subscription and a template. The cents in the
 * files are the source of truth; the expected decimals below are those cents divided by 100.
 */
const FIXTURE_DIR = join(__dirname, 'fixtures', 'backup-v1');

function readFixtureFiles({ dir = FIXTURE_DIR }: { dir?: string } = {}): Map<string, Buffer> {
  const files = new Map<string, Buffer>();
  const walk = (current: string) => {
    for (const entry of readdirSync(current)) {
      const full = join(current, entry);
      if (statSync(full).isDirectory()) walk(full);
      else files.set(relative(dir, full), readFileSync(full));
    }
  };
  walk(dir);
  return files;
}

function writeFileJson({ files, path, value }: { files: Map<string, Buffer>; path: string; value: unknown }): void {
  files.set(path, Buffer.from(JSON.stringify(value)));
}

async function buildFixtureUpload({ edit }: { edit?: (files: Map<string, Buffer>) => void } = {}): Promise<string> {
  const files = readFixtureFiles();
  edit?.(files);
  return helpers.repackBackup({ files });
}

async function restoreUpload({ base64 }: { base64: string }) {
  const restore = await helpers.restoreBackup({ fileContent: base64 });
  expect({ statusCode: restore.statusCode, message: restore.message }).toEqual({ statusCode: 200, message: null });
  const status = await helpers.waitForRestore({ jobId: restore.jobId! });
  expect({ status: status.status, error: status.error }).toEqual({ status: 'completed', error: undefined });
  return status;
}

async function exportParsed() {
  const response = await helpers.exportBackup();
  expect(response.statusCode).toBe(200);
  return helpers.parseBackupArchive({ buffer: response.body });
}

/** Exact equality of a dumped DECIMAL (a string like "1500.750000000000000000") with an expected decimal. */
function expectDecimal({ actual, expected }: { actual: unknown; expected: string }): void {
  expect(typeof actual).toBe('string');
  expect(new Big(actual as string).eq(expected)).toBe(true);
}

type ParsedArchive = ReturnType<typeof helpers.parseBackupArchive>;

function rowsOf({ archive, name }: { archive: ParsedArchive; name: string }): Row[] {
  return archive.readData({ name }) as Row[];
}

function findRow({ rows, key, value }: { rows: Row[]; key: string; value: unknown }): Row {
  const row = rows.find((candidate) => candidate[key] === value);
  expect(row).toBeDefined();
  return row!;
}

// Same ordering-independent comparison the main restore suite uses.
function deepSort(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(deepSort);
  if (value && typeof value === 'object') {
    const out: Row = {};
    for (const key of Object.keys(value as Row).toSorted()) out[key] = deepSort((value as Row)[key]);
    return out;
  }
  return value;
}

const canonicalRows = ({ rows }: { rows: unknown }): string[] =>
  (Array.isArray(rows) ? rows : []).map((row) => JSON.stringify(deepSort(row))).toSorted();

const BLOCKING_WARNING_CODES = new Set([
  'foreign_reference_dropped',
  'foreign_reference_nulled',
  'invalid_row_dropped',
  'currency_missing',
  'unknown_column_dropped',
]);

describe('Restoring a format version 1 backup (cents to decimals)', () => {
  beforeEach(async () => {
    const user = (await helpers.makeRequest({ method: 'get', url: '/user', raw: true })) as { id: number };
    await RateLimitService.resetRateLimit(`backup:user:${user.id}`);
    await RateLimitService.resetRateLimit(`backup-restore:user:${user.id}`);
  });

  it('stores every amount as the cents divided by 100, restoring the whole ledger', async () => {
    const status = await restoreUpload({ base64: await buildFixtureUpload() });

    expect((status.summary?.warnings ?? []).filter((warning) => BLOCKING_WARNING_CODES.has(warning.code))).toEqual([]);
    expect(status.summary?.insertedByTable).toMatchObject({
      accounts: 3,
      transactions: 3,
      'transaction-splits': 1,
      balances: 4,
      'loan-details': 1,
    });

    const archive = await exportParsed();
    expect(archive.manifest.formatVersion).toBe(BACKUP_FORMAT_VERSION);

    const accounts = rowsOf({ archive, name: 'accounts' });
    const checking = findRow({ rows: accounts, key: 'name', value: 'Checking' });
    expectDecimal({ actual: checking.initialBalance, expected: '1500.75' });
    expectDecimal({ actual: checking.refInitialBalance, expected: '1500.75' });
    expectDecimal({ actual: checking.currentBalance, expected: '-1234566431.87' });
    expectDecimal({ actual: checking.refCurrentBalance, expected: '-1234566431.87' });
    expectDecimal({ actual: checking.creditLimit, expected: '500' });
    expectDecimal({ actual: checking.refCreditLimit, expected: '500' });

    const dollars = findRow({ rows: accounts, key: 'name', value: 'Dollars' });
    expectDecimal({ actual: dollars.initialBalance, expected: '200' });
    expectDecimal({ actual: dollars.refInitialBalance, expected: '800' });
    expectDecimal({ actual: dollars.currentBalance, expected: '280.1' });
    expectDecimal({ actual: dollars.refCurrentBalance, expected: '1120.4' });
    expectDecimal({ actual: dollars.creditLimit, expected: '0' });

    const mortgageAccount = findRow({ rows: accounts, key: 'name', value: 'Mortgage' });
    expectDecimal({ actual: mortgageAccount.currentBalance, expected: '-200000.5' });

    const transactions = rowsOf({ archive, name: 'transactions' });
    const shop = findRow({ rows: transactions, key: 'note', value: 'Weekly shop' });
    expectDecimal({ actual: shop.amount, expected: '42.5' });
    expectDecimal({ actual: shop.refAmount, expected: '42.5' });
    expectDecimal({ actual: shop.commissionRate, expected: '1.5' });
    expectDecimal({ actual: shop.refCommissionRate, expected: '1.5' });
    expectDecimal({ actual: shop.cashbackAmount, expected: '0.25' });
    expect(shop.originalAmount).toBeNull();

    const refund = findRow({ rows: transactions, key: 'note', value: 'Refund' });
    expectDecimal({ actual: refund.amount, expected: '80.1' });
    expectDecimal({ actual: refund.refAmount, expected: '320.4' });
    expectDecimal({ actual: refund.originalAmount, expected: '75' });

    const large = findRow({ rows: transactions, key: 'note', value: 'Large purchase' });
    expectDecimal({ actual: large.amount, expected: '1234567890.12' });

    const [split] = rowsOf({ archive, name: 'transaction-splits' });
    expectDecimal({ actual: split!.amount, expected: '10.05' });
    expectDecimal({ actual: split!.refAmount, expected: '10.05' });

    const balanceByKey = new Map(
      rowsOf({ archive, name: 'balances' }).map((row) => [`${String(row.accountId)}@${String(row.date)}`, row.amount]),
    );
    const checkingId = String(checking.id);
    const dollarsId = String(dollars.id);
    expectDecimal({ actual: balanceByKey.get(`${checkingId}@2025-03-01`), expected: '1500.75' });
    expectDecimal({ actual: balanceByKey.get(`${checkingId}@2025-03-02`), expected: '-1234566431.87' });
    expectDecimal({ actual: balanceByKey.get(`${dollarsId}@2025-03-01`), expected: '200' });
    expectDecimal({ actual: balanceByKey.get(`${dollarsId}@2025-03-02`), expected: '280.1' });

    const [loan] = rowsOf({ archive, name: 'loan-details' });
    expectDecimal({ actual: loan!.originalPrincipal, expected: '200000.5' });
    expectDecimal({ actual: loan!.refOriginalPrincipal, expected: '200000.5' });
    expectDecimal({ actual: loan!.minPayment, expected: '1200' });
    expectDecimal({ actual: loan!.refMinPayment, expected: '1200' });
    expectDecimal({ actual: loan!.plannedPayment, expected: '1250.5' });
    expectDecimal({ actual: loan!.refPlannedPayment, expected: '1250.5' });

    const [tracker] = rowsOf({ archive, name: 'trackers' });
    expectDecimal({ actual: tracker!.limitAmount, expected: '50000.25' });

    const [subscription] = rowsOf({ archive, name: 'subscriptions' });
    expectDecimal({ actual: subscription!.expectedAmount, expected: '15.99' });

    const [template] = rowsOf({ archive, name: 'transaction-templates' });
    expectDecimal({ actual: template!.amount, expected: '42.5' });
  });

  it('converts the amounts held in JSON fields and leaves the other JSON values alone', async () => {
    await restoreUpload({ base64: await buildFixtureUpload() });

    const archive = await exportParsed();

    const [reminder] = rowsOf({ archive, name: 'tag-reminders' });
    expect(reminder!.settings).toEqual({ amountThreshold: 1500.5 });

    const [loan] = rowsOf({ archive, name: 'loan-details' });
    expect(loan!.events).toEqual([
      { type: 'planned_payment_change', at: '2024-01-01T00:00:00.000Z', fromCents: 1200, toCents: 1250.5 },
      { type: 'balance_correction', at: '2024-02-01T00:00:00.000Z', fromCents: 199000, toCents: 198750.25 },
      { type: 'rate_change', at: '2024-03-01T00:00:00.000Z', from: 5, to: 6 },
    ]);
  });

  it('serves the restored accounts with the source balances', async () => {
    await restoreUpload({ base64: await buildFixtureUpload() });

    const accounts = await helpers.getAccounts();
    const byName = new Map(accounts.map((account) => [account.name, account]));
    expect(byName.get('Checking')!.currentBalance).toBe(-1234566431.87);
    expect(byName.get('Checking')!.initialBalance).toBe(1500.75);
    expect(byName.get('Dollars')!.currentBalance).toBe(280.1);
    expect(byName.get('Dollars')!.refCurrentBalance).toBe(1120.4);
  });

  it('exports the restored ledger as a format version 3 archive that round-trips exactly', async () => {
    await restoreUpload({ base64: await buildFixtureUpload() });
    const firstExport = await helpers.exportBackup();
    const first = helpers.parseBackupArchive({ buffer: firstExport.body });
    expect(first.manifest.formatVersion).toBe(BACKUP_FORMAT_VERSION);
    expect(typeof rowsOf({ archive: first, name: 'transactions' })[0]!.amount).toBe('string');

    await restoreUpload({ base64: firstExport.body.toString('base64') });
    const second = await exportParsed();

    const dataNames = [...first.files.keys()]
      .filter((path) => path.startsWith('data/') && path.endsWith('.json'))
      .map((path) => path.slice('data/'.length, -'.json'.length))
      .filter((name) => name !== 'user' && name !== 'user-settings');
    expect(dataNames.length).toBeGreaterThan(0);
    for (const name of dataNames) {
      expect({ name, rows: canonicalRows({ rows: second.readData({ name }) }) }).toEqual({
        name,
        rows: canonicalRows({ rows: first.readData({ name }) }),
      });
    }
  });

  it('rejects an amount that is not a number with a 422', async () => {
    const base64 = await buildFixtureUpload({
      edit: (files) => {
        const accounts = JSON.parse(files.get('data/accounts.json')!.toString('utf8')) as Row[];
        accounts[0]!.initialBalance = 'twelve';
        writeFileJson({ files, path: 'data/accounts.json', value: accounts });
      },
    });

    const restore = await helpers.restoreBackup({ fileContent: base64 });

    expect(restore.statusCode).toBe(422);
    expect(restore.message).toMatch(/expected an amount in cents/);
  });

  it('rejects an archive newer than the version this app writes with a 422', async () => {
    const base64 = await buildFixtureUpload({
      edit: (files) => {
        const manifest = JSON.parse(files.get('manifest.json')!.toString('utf8')) as Row;
        manifest.formatVersion = BACKUP_FORMAT_VERSION + 1;
        writeFileJson({ files, path: 'manifest.json', value: manifest });
      },
    });

    const restore = await helpers.restoreBackup({ fileContent: base64 });

    expect(restore.statusCode).toBe(422);
    expect(restore.message).toMatch(/version/i);
  });

  it('exports a user with no data as a format version 3 archive with empty money files', async () => {
    const archive = await exportParsed();

    expect(archive.manifest.formatVersion).toBe(3);
    expect(rowsOf({ archive, name: 'accounts' })).toEqual([]);
    expect(rowsOf({ archive, name: 'transactions' })).toEqual([]);
  });
});
