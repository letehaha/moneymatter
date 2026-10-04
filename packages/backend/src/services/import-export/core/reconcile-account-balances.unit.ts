import { ACCOUNT_CATEGORIES } from '@bt/shared/types';
import { generateRandomRecordId } from '@common/lib/record-id-helpers';
import { Money } from '@common/types/money';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { ValidationError } from '@js/errors';

// ── Mocks (hoisted before importing the module under test) ──────────────────

// The module imports the account model, the absorb-adjustment service (linked
// accounts), the accounts service (created-account targets), and the
// transactions query boundary for its capture/finalize database work; stubbing
// them keeps this unit run free of the database/queue connections their real
// import graph opens.
jest.mock('@models/accounts.model', () => ({ __esModule: true, getAccountById: jest.fn() }));
jest.mock('@models/import-batch-account-effects.model', () => ({
  __esModule: true,
  default: { create: jest.fn(), update: jest.fn() },
}));
jest.mock('@models/transactions-query', () => ({ __esModule: true, findOneTransaction: jest.fn() }));
jest.mock('@services/accounts.service', () => ({ __esModule: true, updateAccount: jest.fn() }));
jest.mock('@services/accounts/absorb-balance-adjustment', () => ({
  __esModule: true,
  absorbBalanceAdjustment: jest.fn(),
}));
jest.mock('@services/accounts/lock-account-row', () => ({ __esModule: true, lockAccountRow: jest.fn() }));
// The real wrapper needs a DB connection this unit test has none of.
jest.mock('@services/common/with-transaction', () => ({
  __esModule: true,
  withTransaction: <T extends unknown[], R>(fn: (...args: T) => Promise<R>) => fn,
}));

/* eslint-disable import/first */
import * as Accounts from '@models/accounts.model';
import ImportBatchAccountEffects from '@models/import-batch-account-effects.model';
import { findOneTransaction } from '@models/transactions-query';
import { updateAccount } from '@services/accounts.service';
import { absorbBalanceAdjustment } from '@services/accounts/absorb-balance-adjustment';
import { lockAccountRow } from '@services/accounts/lock-account-row';

import { startBalanceReconciliation } from './reconcile-account-balances';
/* eslint-enable import/first */

const getAccountByIdMock = jest.mocked(Accounts.getAccountById);
const findOneMock = jest.mocked(findOneTransaction);
const updateAccountMock = jest.mocked(updateAccount);
const absorbMock = jest.mocked(absorbBalanceAdjustment);
const lockAccountRowMock = jest.mocked(lockAccountRow);
const createEffectMock = jest.mocked(ImportBatchAccountEffects.create);
const updateEffectMock = jest.mocked(ImportBatchAccountEffects.update);

type AccountRow = NonNullable<Awaited<ReturnType<typeof Accounts.getAccountById>>>;
type TransactionRow = Awaited<ReturnType<typeof findOneTransaction>>;

const USER_ID = 42;
const IMPORT_BATCH_ID = generateRandomRecordId();

/** Minimal account shape the session reads: name, balance, category. */
function buildAccount({
  id,
  name,
  currentBalance = Money.zero(),
  accountCategory = ACCOUNT_CATEGORIES.general,
}: {
  id: string;
  name: string;
  currentBalance?: Money;
  accountCategory?: ACCOUNT_CATEGORIES;
}): AccountRow {
  return { id, name, currentBalance, accountCategory } as unknown as AccountRow;
}

/**
 * Wire the account/boundary mocks for a set of accounts: `getAccountById`
 * resolves per id and `findOneTransaction` returns each account's latest
 * transaction time (null → the account has no transactions, hence no boundary).
 */
function mockAccounts(accounts: { account: AccountRow; latestTxIso?: string }[]) {
  const byId = new Map(accounts.map((a) => [(a.account as { id: string }).id, a]));
  getAccountByIdMock.mockImplementation(async ({ id }) => byId.get(id)?.account ?? null);
  findOneMock.mockImplementation((async (options: { where: { accountId: string } }) => {
    const entry = byId.get(options.where.accountId);
    if (!entry?.latestTxIso) return null;
    return { time: new Date(entry.latestTxIso) } as unknown as TransactionRow;
  }) as unknown as typeof findOneTransaction);
}

/**
 * Make the absorb mock behave like the real service against the mocked account
 * set: return the account with `currentBalance` shifted by `amountDelta`, so
 * finalize's read-of-the-write summary math can be asserted end to end.
 */
function mockAbsorbApplyingDelta(accounts: { account: AccountRow }[]) {
  const byId = new Map(accounts.map((a) => [(a.account as { id: string }).id, a.account]));
  absorbMock.mockImplementation((async ({ accountId, amountDelta }: { accountId: string; amountDelta: Money }) => {
    const account = byId.get(accountId)!;
    return {
      ...(account as object),
      currentBalance: (account as { currentBalance: Money }).currentBalance.add(amountDelta),
    };
  }) as unknown as typeof absorbBalanceAdjustment);
}

/** recordRow payload builder — tallies are native-only (ref sides are derived). */
function row({ signedAmount }: { signedAmount: Money }) {
  return { signedAmount };
}

beforeEach(() => {
  jest.clearAllMocks();
  updateAccountMock.mockResolvedValue(undefined as never);
  absorbMock.mockRejectedValue(new Error('absorb mock not wired for this test') as never);
  lockAccountRowMock.mockImplementation((async ({ accountId }: { accountId: string }) =>
    buildAccount({ id: accountId, name: 'Locked' })) as unknown as typeof lockAccountRow);
  getAccountByIdMock.mockResolvedValue(null);
  findOneMock.mockResolvedValue(null);
});

describe('startBalanceReconciliation', () => {
  it('throws ValidationError when a captured account cannot be resolved', async () => {
    getAccountByIdMock.mockResolvedValue(null);

    await expect(
      startBalanceReconciliation({ userId: USER_ID, accountIds: [generateRandomRecordId()] }),
    ).rejects.toThrow(ValidationError);
  });

  it('skips dedicated-flow (vehicle/loan) accounts entirely — no reconcile, no summary entry', async () => {
    const vehicleId = generateRandomRecordId();
    mockAccounts([
      {
        account: buildAccount({ id: vehicleId, name: 'Car', accountCategory: ACCOUNT_CATEGORIES.vehicle }),
      },
    ]);

    const reconciler = await startBalanceReconciliation({ userId: USER_ID, accountIds: [vehicleId] });
    // Rows recorded against the skipped account must not resurrect it.
    reconciler.recordRow({
      accountId: vehicleId,
      rowIso: '2024-01-15',
      ...row({ signedAmount: Money.fromDecimal(10) }),
    });
    const { accountBalanceChanges, errors } = await reconciler.finalize({
      importBatchId: IMPORT_BATCH_ID,
      recalculateBalance: true,
      logLabel: 'test import',
    });

    expect(absorbMock).not.toHaveBeenCalled();
    expect(updateAccountMock).not.toHaveBeenCalled();
    expect(accountBalanceChanges).toHaveLength(0);
    expect(errors).toHaveLength(0);
  });
});

describe('recordRow classification against the pre-import boundary', () => {
  it('classifies every row as new when the account has no transactions (no boundary)', async () => {
    const accountId = generateRandomRecordId();
    mockAccounts([{ account: buildAccount({ id: accountId, name: 'Empty', currentBalance: Money.zero() }) }]);

    const reconciler = await startBalanceReconciliation({ userId: USER_ID, accountIds: [accountId] });
    reconciler.recordRow({
      accountId,
      rowIso: '1999-12-31T23:59:59.000Z',
      ...row({ signedAmount: Money.fromDecimal(100) }),
    });
    reconciler.recordRow({ accountId, rowIso: '2024-01-15', ...row({ signedAmount: Money.fromDecimal(-40) }) });
    const { accountBalanceChanges } = await reconciler.finalize({
      importBatchId: IMPORT_BATCH_ID,
      recalculateBalance: true,
      logLabel: 'test import',
    });

    // All rows are new, so with recalc ON there is nothing to remove — the
    // balance hook already left the account at its target and no write happens.
    expect(absorbMock).not.toHaveBeenCalled();
    expect(accountBalanceChanges[0]).toMatchObject({ movedCount: 2, historicalCount: 0, delta: 60, balanceAfter: 60 });
  });

  it('splits rows around the boundary day: older → historical, on/after → new', async () => {
    const accountId = generateRandomRecordId();
    const accounts = [
      {
        account: buildAccount({ id: accountId, name: 'Boundary', currentBalance: Money.fromDecimal(500) }),
        latestTxIso: '2024-01-16T10:00:00.000Z',
      },
    ];
    mockAccounts(accounts);

    const reconciler = await startBalanceReconciliation({ userId: USER_ID, accountIds: [accountId] });
    // Older than the boundary day → historical (does not touch deltaNew).
    reconciler.recordRow({ accountId, rowIso: '2024-01-15', ...row({ signedAmount: Money.fromDecimal(-100.5) }) });
    // On the boundary day → new.
    reconciler.recordRow({ accountId, rowIso: '2024-01-16', ...row({ signedAmount: Money.fromDecimal(-50) }) });
    // Newer than the boundary day → new.
    reconciler.recordRow({ accountId, rowIso: '2024-01-17', ...row({ signedAmount: Money.fromDecimal(2500) }) });

    // The balance hook applied all three rows before finalize runs.
    accounts[0]!.account = buildAccount({
      id: accountId,
      name: 'Boundary',
      currentBalance: Money.fromDecimal(500 - 100.5 - 50 + 2500),
    });
    mockAbsorbApplyingDelta(accounts);

    const { accountBalanceChanges } = await reconciler.finalize({
      importBatchId: IMPORT_BATCH_ID,
      recalculateBalance: true,
      logLabel: 'test import',
    });

    // Recalc ON removes only the backfill: adjustment = −(−100.50) = +100.50.
    expect(absorbMock).toHaveBeenCalledTimes(1);
    const call = absorbMock.mock.calls[0]![0];
    expect(call.accountId).toBe(accountId);
    expect(call.amountDelta.toNumber()).toBe(100.5);

    // deltaNew = −50 + 2500 = 2450; the −100.50 backfill is absorbed.
    expect(accountBalanceChanges[0]).toMatchObject({
      balanceBefore: 500,
      balanceAfter: 2950,
      delta: 2450,
      movedCount: 2,
      historicalCount: 1,
    });
  });

  it('is day-granular — time of day on the boundary day never flips the class', async () => {
    const accountId = generateRandomRecordId();
    const accounts = [
      {
        account: buildAccount({ id: accountId, name: 'Granular', currentBalance: Money.fromDecimal(3) }),
        latestTxIso: '2024-01-16T23:00:00.000Z',
      },
    ];
    mockAccounts(accounts);
    mockAbsorbApplyingDelta(accounts);

    const reconciler = await startBalanceReconciliation({ userId: USER_ID, accountIds: [accountId] });
    // Both extremes of the boundary calendar day → new.
    reconciler.recordRow({
      accountId,
      rowIso: '2024-01-16T00:00:00.000Z',
      ...row({ signedAmount: Money.fromDecimal(1) }),
    });
    reconciler.recordRow({
      accountId,
      rowIso: '2024-01-16T23:59:59.999Z',
      ...row({ signedAmount: Money.fromDecimal(1) }),
    });
    // One millisecond before the boundary day starts → historical.
    reconciler.recordRow({
      accountId,
      rowIso: '2024-01-15T23:59:59.999Z',
      ...row({ signedAmount: Money.fromDecimal(1) }),
    });
    const { accountBalanceChanges } = await reconciler.finalize({
      importBatchId: IMPORT_BATCH_ID,
      recalculateBalance: true,
      logLabel: 'test import',
    });

    expect(absorbMock.mock.calls[0]![0].amountDelta.toNumber()).toBe(-1);
    expect(accountBalanceChanges[0]).toMatchObject({ movedCount: 2, historicalCount: 1, delta: 2 });
  });

  it('keeps per-account tallies independent (transfer legs record once per side)', async () => {
    const sourceId = generateRandomRecordId();
    const destinationId = generateRandomRecordId();
    const accounts = [
      {
        account: buildAccount({ id: sourceId, name: 'Source', currentBalance: Money.fromDecimal(979) }),
        // Boundary after the transfer date → the source leg is backfill.
        latestTxIso: '2024-08-01T12:00:00.000Z',
      },
      {
        account: buildAccount({ id: destinationId, name: 'Dest', currentBalance: Money.fromDecimal(20) }),
      },
    ];
    // Capture-time balances differ from finalize-time ones (the hook moves the
    // balance while rows are written); getAccountById serves capture time only.
    mockAccounts([
      {
        account: buildAccount({ id: sourceId, name: 'Source', currentBalance: Money.fromDecimal(1000) }),
        latestTxIso: '2024-08-01T12:00:00.000Z',
      },
      { account: buildAccount({ id: destinationId, name: 'Dest', currentBalance: Money.fromDecimal(20) }) },
    ]);
    mockAbsorbApplyingDelta(accounts);

    const reconciler = await startBalanceReconciliation({
      userId: USER_ID,
      accountIds: [sourceId, destinationId],
    });
    reconciler.recordRow({
      accountId: sourceId,
      rowIso: '2024-07-31',
      ...row({ signedAmount: Money.fromDecimal(-21) }),
    });
    reconciler.recordRow({
      accountId: destinationId,
      rowIso: '2024-07-31',
      ...row({ signedAmount: Money.fromDecimal(21) }),
    });
    const { accountBalanceChanges } = await reconciler.finalize({
      importBatchId: IMPORT_BATCH_ID,
      recalculateBalance: true,
      logLabel: 'test import',
    });

    // Only the source has backfill to remove; the destination needs no write.
    expect(absorbMock).toHaveBeenCalledTimes(1);
    expect(absorbMock.mock.calls[0]![0].accountId).toBe(sourceId);
    expect(absorbMock.mock.calls[0]![0].amountDelta.toNumber()).toBe(21);

    const changeFor = (id: string) => accountBalanceChanges.find((c) => c.accountId === id);
    expect(changeFor(sourceId)).toMatchObject({ delta: 0, movedCount: 0, historicalCount: 1, balanceAfter: 1000 });
    expect(changeFor(destinationId)).toMatchObject({ delta: 21, movedCount: 1, historicalCount: 0, balanceAfter: 41 });
  });
});

describe('finalize — captured (linked) accounts', () => {
  it('recalc ON with only new rows: skips the balance write and reports the hook-applied result', async () => {
    const accountId = generateRandomRecordId();
    mockAccounts([{ account: buildAccount({ id: accountId, name: 'Linked', currentBalance: Money.fromDecimal(-5) }) }]);

    const reconciler = await startBalanceReconciliation({ userId: USER_ID, accountIds: [accountId] });
    reconciler.recordRow({ accountId, rowIso: '2024-01-17', ...row({ signedAmount: Money.fromDecimal(2349.5) }) });
    const { accountBalanceChanges, errors } = await reconciler.finalize({
      importBatchId: IMPORT_BATCH_ID,
      recalculateBalance: true,
      logLabel: 'test import',
    });

    expect(absorbMock).not.toHaveBeenCalled();
    expect(createEffectMock).not.toHaveBeenCalled();
    expect(updateAccountMock).not.toHaveBeenCalled();
    expect(errors).toHaveLength(0);
    expect(accountBalanceChanges).toEqual([
      {
        accountId,
        accountName: 'Linked',
        balanceBefore: -5,
        balanceAfter: 2344.5,
        delta: 2349.5,
        movedCount: 1,
        historicalCount: 0,
        isNewAccount: false,
      },
    ]);
  });

  it('recalc OFF: removes this import’s whole contribution as a signed adjustment', async () => {
    const accountId = generateRandomRecordId();
    const accounts = [
      { account: buildAccount({ id: accountId, name: 'Preserved', currentBalance: Money.fromDecimal(375) }) },
    ];
    mockAccounts([
      { account: buildAccount({ id: accountId, name: 'Preserved', currentBalance: Money.fromDecimal(300) }) },
    ]);
    mockAbsorbApplyingDelta(accounts);

    const reconciler = await startBalanceReconciliation({ userId: USER_ID, accountIds: [accountId] });
    reconciler.recordRow({ accountId, rowIso: '2024-01-17', ...row({ signedAmount: Money.fromDecimal(75) }) });
    const { accountBalanceChanges } = await reconciler.finalize({
      importBatchId: IMPORT_BATCH_ID,
      recalculateBalance: false,
      logLabel: 'test import',
    });

    // The adjustment is −Σ(all recorded rows), never an absolute target — a
    // concurrent writer's contribution between capture and finalize survives.
    expect(absorbMock).toHaveBeenCalledTimes(1);
    expect(absorbMock.mock.calls[0]![0].amountDelta.toNumber()).toBe(-75);
    // The exact absorbed delta is recorded against the batch so undo can negate it.
    expect(createEffectMock).toHaveBeenCalledTimes(1);
    const effect = createEffectMock.mock.calls[0]![0] as { absorbedAmount: Money };
    expect(effect).toMatchObject({ importBatchId: IMPORT_BATCH_ID, accountId });
    expect(effect.absorbedAmount.toNumber()).toBe(-75);
    expect(absorbMock.mock.invocationCallOrder[0]!).toBeLessThan(createEffectMock.mock.invocationCallOrder[0]!);
    expect(accountBalanceChanges[0]).toMatchObject({
      balanceBefore: 300,
      balanceAfter: 300,
      delta: 0,
      movedCount: 1,
      historicalCount: 0,
    });
  });

  it('passes only the native delta to absorb — ref balances are derived, never delta-shifted', async () => {
    const accountId = generateRandomRecordId();
    const accounts = [
      { account: buildAccount({ id: accountId, name: 'Foreign', currentBalance: Money.fromDecimal(100) }) },
    ];
    mockAccounts(accounts);
    mockAbsorbApplyingDelta(accounts);

    const reconciler = await startBalanceReconciliation({ userId: USER_ID, accountIds: [accountId] });
    reconciler.recordRow({
      accountId,
      rowIso: '2024-01-17',
      ...row({ signedAmount: Money.fromDecimal(-100) }),
    });
    await reconciler.finalize({
      importBatchId: IMPORT_BATCH_ID,
      recalculateBalance: false,
      logLabel: 'test import',
    });

    const call = absorbMock.mock.calls[0]![0];
    expect(call.amountDelta.toNumber()).toBe(100);
    // absorb takes only the native `amountDelta`: it derives refCurrentBalance from
    // the shifted native balance at the latest rate and restamps refInitialBalance at
    // the boundary rate itself, so no `refAmountDelta` is passed.
    expect(call).not.toHaveProperty('refAmountDelta');
  });

  it('reports a failed linked write as account-balance-desync and continues with the rest', async () => {
    const failingId = generateRandomRecordId();
    const healthyId = generateRandomRecordId();
    const accounts = [
      { account: buildAccount({ id: failingId, name: 'Failing', currentBalance: Money.fromDecimal(11) }) },
      { account: buildAccount({ id: healthyId, name: 'Healthy', currentBalance: Money.fromDecimal(22) }) },
    ];
    mockAccounts([
      { account: buildAccount({ id: failingId, name: 'Failing', currentBalance: Money.fromDecimal(10) }) },
      { account: buildAccount({ id: healthyId, name: 'Healthy', currentBalance: Money.fromDecimal(20) }) },
    ]);
    mockAbsorbApplyingDelta(accounts);
    absorbMock.mockImplementationOnce(async () => {
      throw new Error('db down');
    });

    const reconciler = await startBalanceReconciliation({ userId: USER_ID, accountIds: [failingId, healthyId] });
    // Recalc OFF gives both accounts a nonzero adjustment (−1 each). Ids are
    // processed sorted, so pin the failure to whichever sorts first via
    // mockImplementationOnce + sorted expectation below.
    reconciler.recordRow({
      accountId: failingId,
      rowIso: '2024-01-17',
      ...row({ signedAmount: Money.fromDecimal(1) }),
    });
    reconciler.recordRow({
      accountId: healthyId,
      rowIso: '2024-01-17',
      ...row({ signedAmount: Money.fromDecimal(1) }),
    });
    const { accountBalanceChanges, errors } = await reconciler.finalize({
      importBatchId: IMPORT_BATCH_ID,
      recalculateBalance: false,
      logLabel: 'test import',
    });

    const [firstId] = [failingId, healthyId].toSorted((a, b) => a.localeCompare(b));
    const firstName = firstId === failingId ? 'Failing' : 'Healthy';
    expect(errors).toEqual([
      {
        rowIndex: null,
        code: 'account-balance-desync',
        error: `${firstName}: balance could not be updated after import; this account balance may be incorrect`,
      },
    ]);
    // The failed account gets no summary entry; the other one still does.
    expect(accountBalanceChanges).toHaveLength(1);
    expect(accountBalanceChanges[0]!.accountId).not.toBe(firstId);
    // A failed absorb records no effect, so undo has nothing to reverse for it.
    expect(createEffectMock).toHaveBeenCalledTimes(1);
    expect(createEffectMock.mock.calls[0]![0]).not.toMatchObject({ accountId: firstId });
  });
});

describe('finalize — created accounts', () => {
  it('emits an isNewAccount entry from the read-back, without balanceBefore/delta', async () => {
    const createdId = generateRandomRecordId();
    mockAccounts([
      { account: buildAccount({ id: createdId, name: 'Fresh', currentBalance: Money.fromDecimal(2349.5) }) },
    ]);

    // Created accounts are not captured — the id goes to finalize only.
    const reconciler = await startBalanceReconciliation({ userId: USER_ID, accountIds: [] });
    reconciler.recordRow({
      accountId: createdId,
      rowIso: '2024-01-17',
      ...row({ signedAmount: Money.fromDecimal(2349.5) }),
    });
    const { accountBalanceChanges, errors } = await reconciler.finalize({
      importBatchId: IMPORT_BATCH_ID,
      recalculateBalance: true,
      createdAccounts: [{ accountId: createdId, accountName: 'Fresh' }],
      logLabel: 'test import',
    });

    expect(errors).toHaveLength(0);
    expect(updateAccountMock).not.toHaveBeenCalled();
    expect(absorbMock).not.toHaveBeenCalled();
    expect(accountBalanceChanges).toEqual([
      {
        accountId: createdId,
        accountName: 'Fresh',
        balanceAfter: 2349.5,
        movedCount: 1,
        historicalCount: 0,
        isNewAccount: true,
      },
    ]);
    expect(accountBalanceChanges[0]).not.toHaveProperty('balanceBefore');
    expect(accountBalanceChanges[0]).not.toHaveProperty('delta');
  });

  it('forces targetCurrentBalance via updateAccount and records the shift for undo', async () => {
    const createdId = generateRandomRecordId();
    mockAccounts([
      { account: buildAccount({ id: createdId, name: 'Targeted', currentBalance: Money.fromDecimal(5000.5) }) },
    ]);
    lockAccountRowMock.mockResolvedValue(
      buildAccount({ id: createdId, name: 'Targeted', currentBalance: Money.fromDecimal(-1700) }) as never,
    );

    const reconciler = await startBalanceReconciliation({ userId: USER_ID, accountIds: [] });
    const { accountBalanceChanges } = await reconciler.finalize({
      importBatchId: IMPORT_BATCH_ID,
      recalculateBalance: true,
      createdAccounts: [
        { accountId: createdId, accountName: 'Targeted', targetCurrentBalance: Money.fromDecimal(5000.5) },
      ],
      logLabel: 'test import',
    });

    expect(updateAccountMock).toHaveBeenCalledTimes(1);
    const call = updateAccountMock.mock.calls[0]![0] as { id: string; currentBalance: Money };
    expect(call.id).toBe(createdId);
    expect(call.currentBalance.toNumber()).toBe(5000.5);
    expect(updateEffectMock).toHaveBeenCalledTimes(1);
    const [values, options] = updateEffectMock.mock.calls[0]! as unknown as [
      { absorbedAmount: Money },
      { where: { importBatchId: string; accountId: string } },
    ];
    expect(values.absorbedAmount.toNumber()).toBe(6700.5);
    expect(options.where).toEqual({ importBatchId: IMPORT_BATCH_ID, accountId: createdId });
    expect(createEffectMock).not.toHaveBeenCalled();
    expect(accountBalanceChanges[0]).toMatchObject({ balanceAfter: 5000.5, isNewAccount: true });
  });

  it('tags a failed target write as account-balance-desync and still emits the truthful summary entry', async () => {
    const createdId = generateRandomRecordId();
    mockAccounts([
      // Read-back shows what the rows actually produced (the target never applied).
      { account: buildAccount({ id: createdId, name: 'Desynced', currentBalance: Money.fromDecimal(700) }) },
    ]);
    updateAccountMock.mockRejectedValue(new Error('db down') as never);

    const reconciler = await startBalanceReconciliation({ userId: USER_ID, accountIds: [] });
    const { accountBalanceChanges, errors } = await reconciler.finalize({
      importBatchId: IMPORT_BATCH_ID,
      recalculateBalance: true,
      createdAccounts: [
        { accountId: createdId, accountName: 'Desynced', targetCurrentBalance: Money.fromDecimal(9999) },
      ],
      logLabel: 'test import',
    });

    expect(errors).toEqual([
      {
        rowIndex: null,
        code: 'account-balance-desync',
        error: 'Desynced: entered balance could not be applied after import; this account balance may be incorrect',
      },
    ]);
    expect(updateEffectMock).not.toHaveBeenCalled();
    expect(accountBalanceChanges).toEqual([
      {
        accountId: createdId,
        accountName: 'Desynced',
        balanceAfter: 700,
        movedCount: 0,
        historicalCount: 0,
        isNewAccount: true,
      },
    ]);
  });

  it('skips the summary entry (without failing) when a created account cannot be read back', async () => {
    const createdId = generateRandomRecordId();
    getAccountByIdMock.mockResolvedValue(null);

    const reconciler = await startBalanceReconciliation({ userId: USER_ID, accountIds: [] });
    const { accountBalanceChanges, errors } = await reconciler.finalize({
      importBatchId: IMPORT_BATCH_ID,
      recalculateBalance: true,
      createdAccounts: [{ accountId: createdId, accountName: 'Ghost' }],
      logLabel: 'test import',
    });

    expect(accountBalanceChanges).toHaveLength(0);
    expect(errors).toHaveLength(0);
  });

  it('skips the summary entry (without failing) when the created-account read-back throws', async () => {
    const createdId = generateRandomRecordId();
    getAccountByIdMock.mockRejectedValue(new Error('connection reset') as never);

    const reconciler = await startBalanceReconciliation({ userId: USER_ID, accountIds: [] });
    // Everything is committed by finalize time — a transient read failure must
    // not reject (a failed job here would invite a duplicating re-import).
    const { accountBalanceChanges, errors } = await reconciler.finalize({
      importBatchId: IMPORT_BATCH_ID,
      recalculateBalance: true,
      createdAccounts: [{ accountId: createdId, accountName: 'Flaky' }],
      logLabel: 'test import',
    });

    expect(accountBalanceChanges).toHaveLength(0);
    expect(errors).toHaveLength(0);
  });
});
