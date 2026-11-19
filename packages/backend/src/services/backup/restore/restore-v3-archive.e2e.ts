import { BACKUP_FORMAT_VERSION } from '@bt/shared/types';
import { t } from '@i18n/index';
import { beforeEach, describe, expect, it } from '@jest/globals';
import * as helpers from '@tests/helpers';
import { join } from 'node:path';

type Row = Record<string, unknown>;

/**
 * A format version 3 archive (money as integer cents) holding the money tables the version 1
 * fixture lacks: a budget plan with income, assignments and line goals, two goals (one with a
 * fixed amount, one reached), a vehicle with a manual value, a partial refund link, a tracker line,
 * a subscription candidate, and the transaction snapshots kept in venture-event-link and
 * portfolio-transfer `metaData`. The cents in the files are the source of truth; the expected
 * decimals below are those cents divided by 100.
 *
 * Import-batch account effects are not covered: no endpoint creates one without a file import.
 */
const FIXTURE_DIR = join(__dirname, 'fixtures', 'backup-v3');

describe('Restoring a format version 3 backup (cents to decimals)', () => {
  beforeEach(() => helpers.resetBackupRateLimits());

  it('stores the amounts of every money table and metaData snapshot in the archive as the cents divided by 100', async () => {
    const status = await helpers.restoreBackupAndWait({
      fileContent: await helpers.repackBackup({ files: helpers.readBackupFixture({ dir: FIXTURE_DIR }) }),
    });
    expect(
      (status.summary?.warnings ?? []).filter((warning) => helpers.BLOCKING_RESTORE_WARNING_CODES.has(warning.code)),
    ).toEqual([]);

    const archive = await helpers.exportParsedBackup();
    expect(archive.manifest.formatVersion).toBe(BACKUP_FORMAT_VERSION);

    const checking = helpers.findBackupRow({
      rows: helpers.backupRows({ archive, name: 'accounts' }),
      key: 'name',
      value: 'Checking',
    });
    helpers.expectDecimal({ actual: checking.initialBalance, expected: '2500.75' });
    helpers.expectDecimal({ actual: checking.currentBalance, expected: '453.6' });

    const [plan] = helpers.backupRows({ archive, name: 'budget-plans' });
    helpers.expectDecimal({ actual: plan!.expectedIncome, expected: '3200.45' });

    const assignments = helpers.backupRows({ archive, name: 'budget-assignments' });
    const baseline = assignments.find((row) => row.baselineAmount !== null)!;
    helpers.expectDecimal({ actual: baseline.baselineAmount, expected: '800.55' });
    expect(baseline.overrideAmount).toBeNull();
    const override = assignments.find((row) => row.overrideAmount !== null)!;
    helpers.expectDecimal({ actual: override.overrideAmount, expected: '150.65' });
    expect(override.baselineAmount).toBeNull();

    const lineGoals = helpers.backupRows({ archive, name: 'budget-line-goals' });
    const budgetAnother = helpers.findBackupRow({ rows: lineGoals, key: 'behavior', value: 'budget_another' });
    helpers.expectDecimal({ actual: budgetAnother.amount, expected: '120.45' });
    helpers.expectDecimal({ actual: budgetAnother.stopAtBalance, expected: '300.15' });
    expect(budgetAnother.fundingCap).toBeNull();
    const refillUpTo = helpers.findBackupRow({ rows: lineGoals, key: 'behavior', value: 'refill_up_to' });
    helpers.expectDecimal({ actual: refillUpTo.amount, expected: '900.4' });
    helpers.expectDecimal({ actual: refillUpTo.fundingCap, expected: '250.35' });
    expect(refillUpTo.stopAtBalance).toBeNull();

    const goals = helpers.backupRows({ archive, name: 'goals' });
    const emergency = helpers.findBackupRow({ rows: goals, key: 'name', value: 'Emergency fund' });
    helpers.expectDecimal({ actual: emergency.targetAmount, expected: '5000.55' });
    helpers.expectDecimal({ actual: emergency.plannedMonthly, expected: '250.25' });
    expect(emergency.achievedAmount).toBeNull();
    const reached = helpers.findBackupRow({ rows: goals, key: 'name', value: 'Small goal' });
    helpers.expectDecimal({ actual: reached.targetAmount, expected: '50.5' });
    helpers.expectDecimal({ actual: reached.achievedAmount, expected: '75.25' });

    const fixedShare = helpers.findBackupRow({
      rows: helpers.backupRows({ archive, name: 'goal-accounts' }),
      key: 'goalId',
      value: emergency.id,
    });
    helpers.expectDecimal({ actual: fixedShare.fixedAmount, expected: '100.15' });

    const [vehicle] = helpers.backupRows({ archive, name: 'vehicles' });
    helpers.expectDecimal({ actual: vehicle!.purchasePrice, expected: '20000.5' });
    helpers.expectDecimal({ actual: vehicle!.valueAnchor, expected: '15000.75' });
    const [servedVehicle] = await helpers.getVehicles({ raw: true });
    expect({ purchasePrice: servedVehicle!.purchasePrice, valueAnchor: servedVehicle!.valueAnchor }).toEqual({
      purchasePrice: 20000.5,
      valueAnchor: 15000.75,
    });

    const [refundLink] = helpers.backupRows({ archive, name: 'refund-transactions' });
    helpers.expectDecimal({ actual: refundLink!.amount, expected: '12.35' });

    const [tracker] = helpers.backupRows({ archive, name: 'trackers' });
    helpers.expectDecimal({ actual: tracker!.limitAmount, expected: '500.25' });
    const [trackerLine] = helpers.backupRows({ archive, name: 'tracker-lines' });
    helpers.expectDecimal({ actual: trackerLine!.limitAmount, expected: '120.5' });

    const [candidate] = helpers.backupRows({ archive, name: 'subscription-candidates' });
    helpers.expectDecimal({ actual: candidate!.averageAmount, expected: '15.99' });

    const [ventureLink] = helpers.backupRows({ archive, name: 'venture-event-links' });
    expect((ventureLink!.metaData as Row).originalTransactionState).toMatchObject({
      note: 'Venture investment',
      amount: 1736.45,
      refAmount: 1736.45,
    });

    const [portfolioTransfer] = helpers.backupRows({ archive, name: 'portfolio-transfers' });
    expect((portfolioTransfer!.metaData as Row).originalTransactionState).toMatchObject({
      note: 'Broker deposit',
      amount: 300.6,
      refAmount: 300.6,
    });
  });
  it('refuses fractional cents in a money column, which its BIGINT source never held', async () => {
    const files = helpers.readBackupFixture({ dir: FIXTURE_DIR });
    const accounts = JSON.parse(files.get('data/accounts.json')!.toString('utf8')) as Row[];
    accounts[0]!.initialBalance = 1550.5;
    files.set('data/accounts.json', Buffer.from(JSON.stringify(accounts)));

    const restore = await helpers.restoreBackup({ fileContent: await helpers.repackBackup({ files }) });

    expect(restore.statusCode).toBe(422);
    expect(restore.message).toBe(
      t({
        key: 'backup.restore.errors.amountNotCents',
        variables: { path: 'data/accounts.json (initialBalance)', value: '1550.5' },
      }),
    );
  });
});
