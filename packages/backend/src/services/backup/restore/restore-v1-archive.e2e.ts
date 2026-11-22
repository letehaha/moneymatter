import { BACKUP_FORMAT_VERSION } from '@bt/shared/types';
import { t } from '@i18n/index';
import { beforeEach, describe, expect, it } from '@jest/globals';
import * as helpers from '@tests/helpers';
import { join } from 'node:path';

type Row = Record<string, unknown>;

/**
 * A format version 1 archive (money as integer cents) for a small ledger: three accounts (one
 * negative balance, one in USD, one loan), three transactions with a split, balances, a tag
 * reminder, a loan with events, a tracker, a subscription and a template. The cents in the
 * files are the source of truth; the expected decimals below are those cents divided by 100.
 */
const FIXTURE_DIR = join(__dirname, 'fixtures', 'backup-v1');
const NO_LOGO = { logoDomain: null, logoInitials: null, logoColor: null, logoIcon: null, logoImageId: null };

async function buildFixtureUpload({ edit }: { edit?: (files: Map<string, Buffer>) => void } = {}): Promise<string> {
  const files = helpers.readBackupFixture({ dir: FIXTURE_DIR });
  edit?.(files);
  return helpers.repackBackup({ files });
}

describe('Restoring a format version 1 backup (cents to decimals)', () => {
  beforeEach(() => helpers.resetBackupRateLimits());

  it('stores every amount, JSON-field amounts included, as the cents divided by 100, restoring the whole ledger', async () => {
    const status = await helpers.restoreBackupAndWait({ fileContent: await buildFixtureUpload() });

    expect(
      (status.summary?.warnings ?? []).filter((warning) => helpers.BLOCKING_RESTORE_WARNING_CODES.has(warning.code)),
    ).toEqual([]);
    expect(status.summary?.insertedByTable).toMatchObject({
      accounts: 3,
      transactions: 3,
      'transaction-splits': 1,
      balances: 4,
      'loan-details': 1,
    });

    const archive = await helpers.exportParsedBackup();
    expect(archive.manifest.formatVersion).toBe(BACKUP_FORMAT_VERSION);

    const accounts = helpers.backupRows({ archive, name: 'accounts' });
    const checking = helpers.findBackupRow({ rows: accounts, key: 'name', value: 'Checking' });
    helpers.expectDecimal({ actual: checking.initialBalance, expected: '1500.75' });
    helpers.expectDecimal({ actual: checking.refInitialBalance, expected: '1500.75' });
    helpers.expectDecimal({ actual: checking.currentBalance, expected: '-1234566431.87' });
    helpers.expectDecimal({ actual: checking.refCurrentBalance, expected: '-1234566431.87' });
    helpers.expectDecimal({ actual: checking.creditLimit, expected: '500' });
    helpers.expectDecimal({ actual: checking.refCreditLimit, expected: '500' });

    const dollars = helpers.findBackupRow({ rows: accounts, key: 'name', value: 'Dollars' });
    helpers.expectDecimal({ actual: dollars.initialBalance, expected: '200' });
    helpers.expectDecimal({ actual: dollars.refInitialBalance, expected: '800' });
    helpers.expectDecimal({ actual: dollars.currentBalance, expected: '280.1' });
    helpers.expectDecimal({ actual: dollars.refCurrentBalance, expected: '1120.4' });
    helpers.expectDecimal({ actual: dollars.creditLimit, expected: '0' });

    const mortgageAccount = helpers.findBackupRow({ rows: accounts, key: 'name', value: 'Mortgage' });
    helpers.expectDecimal({ actual: mortgageAccount.currentBalance, expected: '-200000.5' });

    const transactions = helpers.backupRows({ archive, name: 'transactions' });
    const shop = helpers.findBackupRow({ rows: transactions, key: 'note', value: 'Weekly shop' });
    helpers.expectDecimal({ actual: shop.amount, expected: '42.5' });
    helpers.expectDecimal({ actual: shop.refAmount, expected: '42.5' });
    helpers.expectDecimal({ actual: shop.commissionRate, expected: '1.5' });
    helpers.expectDecimal({ actual: shop.refCommissionRate, expected: '1.5' });
    helpers.expectDecimal({ actual: shop.cashbackAmount, expected: '0.25' });
    expect(shop.originalAmount).toBeNull();

    const refund = helpers.findBackupRow({ rows: transactions, key: 'note', value: 'Refund' });
    helpers.expectDecimal({ actual: refund.amount, expected: '80.1' });
    helpers.expectDecimal({ actual: refund.refAmount, expected: '320.4' });
    helpers.expectDecimal({ actual: refund.originalAmount, expected: '75' });

    const large = helpers.findBackupRow({ rows: transactions, key: 'note', value: 'Large purchase' });
    helpers.expectDecimal({ actual: large.amount, expected: '1234567890.12' });

    const [split] = helpers.backupRows({ archive, name: 'transaction-splits' });
    helpers.expectDecimal({ actual: split!.amount, expected: '10.05' });
    helpers.expectDecimal({ actual: split!.refAmount, expected: '10.05' });

    const balanceByKey = new Map(
      helpers
        .backupRows({ archive, name: 'balances' })
        .map((row) => [`${String(row.accountId)}@${String(row.date)}`, row.amount]),
    );
    const checkingId = String(checking.id);
    const dollarsId = String(dollars.id);
    helpers.expectDecimal({ actual: balanceByKey.get(`${checkingId}@2025-03-01`), expected: '1500.75' });
    helpers.expectDecimal({ actual: balanceByKey.get(`${checkingId}@2025-03-02`), expected: '-1234566431.87' });
    helpers.expectDecimal({ actual: balanceByKey.get(`${dollarsId}@2025-03-01`), expected: '200' });
    helpers.expectDecimal({ actual: balanceByKey.get(`${dollarsId}@2025-03-02`), expected: '280.1' });

    const [loan] = helpers.backupRows({ archive, name: 'loan-details' });
    helpers.expectDecimal({ actual: loan!.originalPrincipal, expected: '200000.5' });
    helpers.expectDecimal({ actual: loan!.refOriginalPrincipal, expected: '200000.5' });
    helpers.expectDecimal({ actual: loan!.minPayment, expected: '1200' });
    helpers.expectDecimal({ actual: loan!.refMinPayment, expected: '1200' });
    helpers.expectDecimal({ actual: loan!.plannedPayment, expected: '1250.5' });
    helpers.expectDecimal({ actual: loan!.refPlannedPayment, expected: '1250.5' });

    const [tracker] = helpers.backupRows({ archive, name: 'trackers' });
    helpers.expectDecimal({ actual: tracker!.limitAmount, expected: '50000.25' });

    const [subscription] = helpers.backupRows({ archive, name: 'subscriptions' });
    helpers.expectDecimal({ actual: subscription!.expectedAmount, expected: '15.99' });

    const [template] = helpers.backupRows({ archive, name: 'transaction-templates' });
    helpers.expectDecimal({ actual: template!.amount, expected: '42.5' });

    const [reminder] = helpers.backupRows({ archive, name: 'tag-reminders' });
    expect(reminder!.settings).toEqual({ amountThreshold: 1500.5 });

    expect(loan!.events).toEqual([
      { type: 'planned_payment_change', at: '2024-01-01T00:00:00.000Z', fromCents: 1200, toCents: 1250.5 },
      { type: 'balance_correction', at: '2024-02-01T00:00:00.000Z', fromCents: 199000, toCents: 198750.25 },
      { type: 'rate_change', at: '2024-03-01T00:00:00.000Z', from: 5, to: 6 },
    ]);
  });

  it('restores holdings from an archive that predates the currency logo with no logo', async () => {
    await helpers.restoreBackupAndWait({ fileContent: await buildFixtureUpload() });

    const holdings = helpers.backupRows({ archive: await helpers.exportParsedBackup(), name: 'users-currencies' });
    expect(holdings.length).toBeGreaterThan(0);
    for (const holding of holdings) expect(holding).toMatchObject(NO_LOGO);

    const userCurrencies = await helpers.getUserCurrencies();
    expect(userCurrencies.length).toBeGreaterThan(0);
    for (const item of userCurrencies) expect(item).toMatchObject(NO_LOGO);
  });

  it('exports the restored ledger as a format version 4 archive that round-trips exactly', async () => {
    await helpers.restoreBackupAndWait({ fileContent: await buildFixtureUpload() });
    const firstExport = await helpers.exportBackup();
    const first = helpers.parseBackupArchive({ buffer: firstExport.body });
    expect(first.manifest.formatVersion).toBe(BACKUP_FORMAT_VERSION);
    expect(typeof helpers.backupRows({ archive: first, name: 'transactions' })[0]!.amount).toBe('string');

    await helpers.restoreBackupAndWait({ fileContent: firstExport.body.toString('base64') });
    const second = await helpers.exportParsedBackup();

    const dataNames = [...first.files.keys()]
      .filter((path) => path.startsWith('data/') && path.endsWith('.json'))
      .map((path) => path.slice('data/'.length, -'.json'.length))
      .filter((name) => name !== 'user' && name !== 'user-settings');
    expect(dataNames.length).toBeGreaterThan(0);
    for (const name of dataNames) {
      expect({ name, rows: helpers.canonicalBackupRows({ rows: second.readData({ name }) }) }).toEqual({
        name,
        rows: helpers.canonicalBackupRows({ rows: first.readData({ name }) }),
      });
    }
  });

  it('rounds the cents of a JPY account to whole yen', async () => {
    const base64 = await buildFixtureUpload({
      edit: (files) => {
        for (const name of ['accounts', 'transactions', 'users-currencies']) {
          const path = `data/${name}.json`;
          const rows = JSON.parse(files.get(path)!.toString('utf8')) as Row[];
          for (const row of rows) if (row.currencyCode === 'USD') row.currencyCode = 'JPY';
          if (name === 'accounts') {
            rows.find((row) => row.name === 'Dollars')!.externalData = {
              bankConnection: {
                linkedAt: '2025-03-01T00:00:00.000Z',
                linkingStrategy: 'forward-only',
                balanceReconciliation: {
                  systemBalance: 100049,
                  externalBalance: 150050,
                  difference: 50001,
                  adjustmentTransactionId: null,
                  absorbedResidual: null,
                },
              },
            };
          }
          files.set(path, Buffer.from(JSON.stringify(rows)));
        }
      },
    });

    await helpers.restoreBackupAndWait({ fileContent: base64 });

    const archive = await helpers.exportParsedBackup();
    // 20000 and 28010 cents read as 200 and 280.1, which lands as 280 yen.
    const yen = helpers.findBackupRow({
      rows: helpers.backupRows({ archive, name: 'accounts' }),
      key: 'name',
      value: 'Dollars',
    });
    expect(yen.currencyCode).toBe('JPY');
    helpers.expectDecimal({ actual: yen.initialBalance, expected: '200' });
    helpers.expectDecimal({ actual: yen.currentBalance, expected: '280' });
    expect(yen.externalData).toMatchObject({
      bankConnection: {
        balanceReconciliation: { systemBalance: 1000, externalBalance: 1501, difference: 500, absorbedResidual: null },
      },
    });
    // 8010 cents read as 80.1; its AED refAmount keeps 2 decimals.
    const refund = helpers.findBackupRow({
      rows: helpers.backupRows({ archive, name: 'transactions' }),
      key: 'note',
      value: 'Refund',
    });
    helpers.expectDecimal({ actual: refund.amount, expected: '80' });
    helpers.expectDecimal({ actual: refund.refAmount, expected: '320.4' });
  });

  it('rejects an amount that is not a number with a 422', async () => {
    const base64 = await buildFixtureUpload({
      edit: (files) => {
        const accounts = JSON.parse(files.get('data/accounts.json')!.toString('utf8')) as Row[];
        accounts[0]!.initialBalance = 'twelve';
        files.set('data/accounts.json', Buffer.from(JSON.stringify(accounts)));
      },
    });

    const restore = await helpers.restoreBackup({ fileContent: base64 });

    expect(restore.statusCode).toBe(422);
    expect(restore.message).toBe(
      t({
        key: 'backup.restore.errors.amountNotCents',
        variables: { path: 'data/accounts.json (initialBalance)', value: '"twelve"' },
      }),
    );
  });
});
