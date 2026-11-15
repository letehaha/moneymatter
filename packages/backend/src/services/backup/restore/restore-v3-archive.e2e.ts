import { BACKUP_FORMAT_VERSION } from '@bt/shared/types';
import { beforeEach, describe, expect, it } from '@jest/globals';
import { RateLimitService } from '@services/common/rate-limit.service';
import * as helpers from '@tests/helpers';
import Big from 'big.js';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

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

function readFixtureFiles(): Map<string, Buffer> {
  const files = new Map<string, Buffer>();
  const walk = (current: string) => {
    for (const entry of readdirSync(current)) {
      const full = join(current, entry);
      if (statSync(full).isDirectory()) walk(full);
      else files.set(relative(FIXTURE_DIR, full), readFileSync(full));
    }
  };
  walk(FIXTURE_DIR);
  return files;
}

async function restoreFixture() {
  const restore = await helpers.restoreBackup({
    fileContent: await helpers.repackBackup({ files: readFixtureFiles() }),
  });
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

const BLOCKING_WARNING_CODES = new Set([
  'foreign_reference_dropped',
  'foreign_reference_nulled',
  'invalid_row_dropped',
  'currency_missing',
  'unknown_column_dropped',
]);

describe('Restoring a format version 3 backup (cents to decimals)', () => {
  beforeEach(async () => {
    const user = (await helpers.makeRequest({ method: 'get', url: '/user', raw: true })) as { id: number };
    await RateLimitService.resetRateLimit(`backup:user:${user.id}`);
    await RateLimitService.resetRateLimit(`backup-restore:user:${user.id}`);
  });

  it('stores the amounts of every money table in the archive as the cents divided by 100', async () => {
    const status = await restoreFixture();
    expect((status.summary?.warnings ?? []).filter((warning) => BLOCKING_WARNING_CODES.has(warning.code))).toEqual([]);

    const archive = await exportParsed();
    expect(archive.manifest.formatVersion).toBe(BACKUP_FORMAT_VERSION);

    const checking = findRow({ rows: rowsOf({ archive, name: 'accounts' }), key: 'name', value: 'Checking' });
    expectDecimal({ actual: checking.initialBalance, expected: '2500.75' });
    expectDecimal({ actual: checking.currentBalance, expected: '453.6' });

    const [plan] = rowsOf({ archive, name: 'budget-plans' });
    expectDecimal({ actual: plan!.expectedIncome, expected: '3200.45' });

    const assignments = rowsOf({ archive, name: 'budget-assignments' });
    const baseline = assignments.find((row) => row.baselineAmount !== null)!;
    expectDecimal({ actual: baseline.baselineAmount, expected: '800.55' });
    expect(baseline.overrideAmount).toBeNull();
    const override = assignments.find((row) => row.overrideAmount !== null)!;
    expectDecimal({ actual: override.overrideAmount, expected: '150.65' });
    expect(override.baselineAmount).toBeNull();

    const lineGoals = rowsOf({ archive, name: 'budget-line-goals' });
    const budgetAnother = findRow({ rows: lineGoals, key: 'behavior', value: 'budget_another' });
    expectDecimal({ actual: budgetAnother.amount, expected: '120.45' });
    expectDecimal({ actual: budgetAnother.stopAtBalance, expected: '300.15' });
    expect(budgetAnother.fundingCap).toBeNull();
    const refillUpTo = findRow({ rows: lineGoals, key: 'behavior', value: 'refill_up_to' });
    expectDecimal({ actual: refillUpTo.amount, expected: '900.4' });
    expectDecimal({ actual: refillUpTo.fundingCap, expected: '250.35' });
    expect(refillUpTo.stopAtBalance).toBeNull();

    const goals = rowsOf({ archive, name: 'goals' });
    const emergency = findRow({ rows: goals, key: 'name', value: 'Emergency fund' });
    expectDecimal({ actual: emergency.targetAmount, expected: '5000.55' });
    expectDecimal({ actual: emergency.plannedMonthly, expected: '250.25' });
    expect(emergency.achievedAmount).toBeNull();
    const reached = findRow({ rows: goals, key: 'name', value: 'Small goal' });
    expectDecimal({ actual: reached.targetAmount, expected: '50.5' });
    expectDecimal({ actual: reached.achievedAmount, expected: '75.25' });

    const fixedShare = findRow({
      rows: rowsOf({ archive, name: 'goal-accounts' }),
      key: 'goalId',
      value: emergency.id,
    });
    expectDecimal({ actual: fixedShare.fixedAmount, expected: '100.15' });

    const [vehicle] = rowsOf({ archive, name: 'vehicles' });
    expectDecimal({ actual: vehicle!.purchasePrice, expected: '20000.5' });
    expectDecimal({ actual: vehicle!.valueAnchor, expected: '15000.75' });

    const [refundLink] = rowsOf({ archive, name: 'refund-transactions' });
    expectDecimal({ actual: refundLink!.amount, expected: '12.35' });

    const [tracker] = rowsOf({ archive, name: 'trackers' });
    expectDecimal({ actual: tracker!.limitAmount, expected: '500.25' });
    const [trackerLine] = rowsOf({ archive, name: 'tracker-lines' });
    expectDecimal({ actual: trackerLine!.limitAmount, expected: '120.5' });

    const [candidate] = rowsOf({ archive, name: 'subscription-candidates' });
    expectDecimal({ actual: candidate!.averageAmount, expected: '15.99' });
  });

  it('converts the transaction snapshots in venture-event-link and portfolio-transfer metaData', async () => {
    await restoreFixture();

    const archive = await exportParsed();

    const [ventureLink] = rowsOf({ archive, name: 'venture-event-links' });
    expect((ventureLink!.metaData as Row).originalTransactionState).toMatchObject({
      note: 'Venture investment',
      amount: 1736.45,
      refAmount: 1736.45,
    });

    const [portfolioTransfer] = rowsOf({ archive, name: 'portfolio-transfers' });
    expect((portfolioTransfer!.metaData as Row).originalTransactionState).toMatchObject({
      note: 'Broker deposit',
      amount: 300.6,
      refAmount: 300.6,
    });
  });

  it('serves the restored goals, vehicle, plan and accounts with decimal amounts', async () => {
    await restoreFixture();

    const goals = await helpers.listGoals({ raw: true });
    const emergency = goals.find((goal) => goal.name === 'Emergency fund')!;
    expect({ targetAmount: emergency.targetAmount, plannedMonthly: emergency.plannedMonthly }).toEqual({
      targetAmount: 5000.55,
      plannedMonthly: 250.25,
    });
    expect(goals.find((goal) => goal.name === 'Small goal')!.achievedAmount).toBe(75.25);

    const [vehicle] = await helpers.getVehicles({ raw: true });
    expect({ purchasePrice: vehicle!.purchasePrice, valueAnchor: vehicle!.valueAnchor }).toEqual({
      purchasePrice: 20000.5,
      valueAnchor: 15000.75,
    });

    const [plan] = await helpers.listBudgetPlans({ raw: true });
    expect(plan!.expectedIncome).toBe(3200.45);

    const accounts = await helpers.getAccounts();
    const checking = accounts.find((account) => account.name === 'Checking')!;
    expect({ initialBalance: checking.initialBalance, currentBalance: checking.currentBalance }).toEqual({
      initialBalance: 2500.75,
      currentBalance: 453.6,
    });
  });
});
