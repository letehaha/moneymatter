import type { AccountExternalData } from '@bt/shared/types';
import { generateRandomRecordId } from '@common/lib/record-id-helpers';
import { Money } from '@common/types/money';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { UnexpectedError } from '@js/errors';

// ── Mocks (hoisted before importing the module under test) ──────────────────

// The service locks/re-reads the account through the model's default export and
// moves the opening balance through the static `update`.
jest.mock('@models/accounts.model', () => ({
  __esModule: true,
  default: { findOne: jest.fn(), update: jest.fn() },
}));
// The ledger sum is a raw SELECT off the Transactions model's sequelize handle,
// which is undefined outside an initialized connection.
jest.mock('@models/transactions.model', () => ({
  __esModule: true,
  default: { sequelize: { query: jest.fn() } },
}));
jest.mock('./restamp-ref-initial-balance', () => ({
  __esModule: true,
  restampRefInitialBalance: jest.fn(),
}));
jest.mock('@models/balances.model', () => ({
  __esModule: true,
  default: { setTodayRowToSpot: jest.fn() },
}));
// Import-time stubs: the real modules pull the Redis client and the transaction-create graph.
jest.mock('@services/accounts/balance-adjustment', () => ({
  __esModule: true,
  createBalanceAdjustmentTransaction: jest.fn(),
}));
jest.mock('@services/bank-data-providers/utils/write-bank-balance-with-history', () => ({
  __esModule: true,
  writeBankBalanceWithHistory: jest.fn(),
}));
jest.mock('@js/utils/logger', () => ({
  __esModule: true,
  logger: { error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() },
}));

// `withTransaction` runs the body inside `connection.sequelize.transaction` when
// no ambient CLS transaction exists. The stub runs the callback straight through
// and reports no ambient transaction, so the row-lock read passes
// `transaction: undefined` and `lock: undefined`.
jest.mock('@models/connection', () => ({
  __esModule: true,
  connection: {
    sequelize: {
      transaction: (cb: () => Promise<unknown>) => cb(),
    },
  },
  namespace: { get: () => undefined },
}));

import { logger } from '@js/utils/logger';
/* eslint-disable import/first */
import Accounts from '@models/accounts.model';
import Balances from '@models/balances.model';
import Transactions from '@models/transactions.model';

import { absorbLinkResidual, runPendingLinkAbsorb } from './absorb-link-residual';
import { restampRefInitialBalance } from './restamp-ref-initial-balance';
/* eslint-enable import/first */

const findOneMock = jest.mocked(Accounts.findOne);
const accountsUpdateMock = jest.mocked(Accounts.update);
const queryMock = jest.mocked(Transactions.sequelize!.query);
const restampMock = jest.mocked(restampRefInitialBalance);
const setTodayRowToSpotMock = jest.mocked(Balances.setTodayRowToSpot);
const loggerErrorMock = jest.mocked(logger.error);

type AccountRow = InstanceType<typeof Accounts>;

const USER_ID = 42;

function buildAccount({
  id = generateRandomRecordId(),
  currentBalance = Money.zero(),
  initialBalance = Money.zero(),
  externalData = null,
}: {
  id?: string;
  currentBalance?: Money;
  initialBalance?: Money;
  externalData?: AccountExternalData | null;
} = {}): AccountRow & { update: jest.Mock } {
  return {
    id,
    currentBalance,
    initialBalance,
    externalData,
    update: jest.fn(async () => undefined),
  } as unknown as AccountRow & { update: jest.Mock };
}

function buildReconciliation({
  pendingAbsorb,
  extra = {},
}: {
  pendingAbsorb?: boolean;
  extra?: Record<string, unknown>;
} = {}): AccountExternalData {
  return {
    someUnrelatedKey: 'keep-me',
    bankConnection: {
      linkedAt: '2024-06-01T00:00:00.000Z',
      linkingStrategy: 'forward-only',
      balanceReconciliation: {
        systemBalance: 10,
        externalBalance: 12,
        difference: 2,
        adjustmentTransactionId: null,
        ...(pendingAbsorb === undefined ? {} : { pendingAbsorb }),
      },
      ...extra,
    },
  };
}

/** Sets the ledger sum the raw SELECT reports back; the argument is in cents, the DECIMAL column answers in decimals. */
const mockSignedSum = (cents: number) =>
  queryMock.mockResolvedValue([{ signedSum: Money.fromCents(cents).toDecimalString(18) }] as never);

const lastUpdatePayload = () => accountsUpdateMock.mock.calls[0]![0] as unknown as { initialBalance: Money };

beforeEach(() => {
  jest.clearAllMocks();
  findOneMock.mockResolvedValue(null as never);
  accountsUpdateMock.mockResolvedValue([1] as never);
  mockSignedSum(0);
  restampMock.mockResolvedValue('restamped');
  setTodayRowToSpotMock.mockResolvedValue(undefined as never);
});

describe('absorbLinkResidual', () => {
  it('returns no outcome and writes nothing when the account is missing', async () => {
    findOneMock.mockResolvedValue(null as never);

    const result = await absorbLinkResidual({
      accountId: generateRandomRecordId(),
      userId: USER_ID,
    });

    expect(result).toEqual({});
    expect(loggerErrorMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ code: 'ACCOUNT_LINK_RESIDUAL_ACCOUNT_MISSED' }),
    );
    expect(queryMock).not.toHaveBeenCalled();
    expect(accountsUpdateMock).not.toHaveBeenCalled();
    expect(restampMock).not.toHaveBeenCalled();
    expect(setTodayRowToSpotMock).not.toHaveBeenCalled();
  });

  it('returns no outcome and writes nothing when the ledger identity already holds', async () => {
    const accountId = generateRandomRecordId();
    findOneMock.mockResolvedValue(
      buildAccount({
        id: accountId,
        currentBalance: Money.fromDecimal(150),
        initialBalance: Money.fromDecimal(50),
      }) as never,
    );
    mockSignedSum(Money.fromDecimal(100).toCents());

    const result = await absorbLinkResidual({ accountId, userId: USER_ID });

    expect(result).toEqual({});
    expect(accountsUpdateMock).not.toHaveBeenCalled();
    expect(restampMock).not.toHaveBeenCalled();
    expect(setTodayRowToSpotMock).not.toHaveBeenCalled();
  });

  it('folds a positive gap into the opening balance, restamps it, and re-pins today’s row', async () => {
    const accountId = generateRandomRecordId();
    const account = buildAccount({
      id: accountId,
      currentBalance: Money.fromDecimal(200),
      initialBalance: Money.fromDecimal(50),
    });
    const restampedRow = buildAccount({ id: accountId, initialBalance: Money.fromDecimal(100) });
    findOneMock.mockResolvedValueOnce(account as never).mockResolvedValueOnce(restampedRow as never);
    mockSignedSum(Money.fromDecimal(100).toCents());

    const result = await absorbLinkResidual({ accountId, userId: USER_ID });

    expect(result).toEqual({ absorbedResidual: Money.fromDecimal(50).toCents() });
    expect(accountsUpdateMock).toHaveBeenCalledTimes(1);
    expect(lastUpdatePayload().initialBalance.toCents()).toBe(Money.fromDecimal(100).toCents());
    expect(accountsUpdateMock.mock.calls[0]![1]).toEqual(
      expect.objectContaining({ where: { id: accountId, userId: USER_ID } }),
    );
    expect(restampMock).toHaveBeenCalledWith({ accountId, allowProviderAccount: true });
    expect(setTodayRowToSpotMock).toHaveBeenCalledWith({ account: restampedRow });
  });

  it('folds a negative gap into the opening balance', async () => {
    const accountId = generateRandomRecordId();
    const account = buildAccount({
      id: accountId,
      currentBalance: Money.fromDecimal(120),
      initialBalance: Money.fromDecimal(50),
    });
    findOneMock.mockResolvedValue(account as never);
    mockSignedSum(Money.fromDecimal(100).toCents());

    const result = await absorbLinkResidual({ accountId, userId: USER_ID });

    expect(result).toEqual({ absorbedResidual: Money.fromDecimal(-30).toCents() });
    expect(lastUpdatePayload().initialBalance.toCents()).toBe(Money.fromDecimal(20).toCents());
    expect(restampMock).toHaveBeenCalledTimes(1);
  });

  it('treats a missing sum row as an empty ledger', async () => {
    const accountId = generateRandomRecordId();
    findOneMock.mockResolvedValue(
      buildAccount({
        id: accountId,
        currentBalance: Money.fromDecimal(70),
        initialBalance: Money.fromDecimal(10),
      }) as never,
    );
    queryMock.mockResolvedValue([] as never);

    const result = await absorbLinkResidual({ accountId, userId: USER_ID });

    expect(result).toEqual({ absorbedResidual: Money.fromDecimal(60).toCents() });
    expect(lastUpdatePayload().initialBalance.toCents()).toBe(Money.fromDecimal(70).toCents());
  });

  it('throws UnexpectedError and stops before re-pinning when the restamp fails', async () => {
    const accountId = generateRandomRecordId();
    findOneMock.mockResolvedValue(
      buildAccount({
        id: accountId,
        currentBalance: Money.fromDecimal(200),
        initialBalance: Money.fromDecimal(50),
      }) as never,
    );
    mockSignedSum(Money.fromDecimal(100).toCents());
    restampMock.mockResolvedValue('failed');

    await expect(absorbLinkResidual({ accountId, userId: USER_ID })).rejects.toThrow(UnexpectedError);

    expect(accountsUpdateMock).toHaveBeenCalledTimes(1);
    expect(findOneMock).toHaveBeenCalledTimes(1);
    expect(setTodayRowToSpotMock).not.toHaveBeenCalled();
  });

  it.each(['restamped', 'unchanged', 'skipped'] as const)(
    'completes the absorb when the restamp reports %s',
    async (outcome) => {
      const accountId = generateRandomRecordId();
      findOneMock.mockResolvedValue(
        buildAccount({
          id: accountId,
          currentBalance: Money.fromDecimal(200),
          initialBalance: Money.fromDecimal(50),
        }) as never,
      );
      mockSignedSum(Money.fromDecimal(100).toCents());
      restampMock.mockResolvedValue(outcome);

      const result = await absorbLinkResidual({ accountId, userId: USER_ID });

      expect(result).toEqual({ absorbedResidual: Money.fromDecimal(50).toCents() });
      expect(setTodayRowToSpotMock).toHaveBeenCalledTimes(1);
    },
  );

  it('still returns the gap, logging instead of re-pinning, when the post-restamp re-read misses', async () => {
    const accountId = generateRandomRecordId();
    const account = buildAccount({
      id: accountId,
      currentBalance: Money.fromDecimal(200),
      initialBalance: Money.fromDecimal(50),
    });
    findOneMock.mockResolvedValueOnce(account as never).mockResolvedValueOnce(null as never);
    mockSignedSum(Money.fromDecimal(100).toCents());

    const result = await absorbLinkResidual({ accountId, userId: USER_ID });

    expect(result).toEqual({ absorbedResidual: Money.fromDecimal(50).toCents() });
    expect(loggerErrorMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ code: 'ACCOUNT_LINK_RESIDUAL_REREAD_MISSED' }),
    );
    expect(setTodayRowToSpotMock).not.toHaveBeenCalled();
  });
});

describe('runPendingLinkAbsorb', () => {
  it('returns null without absorbing when the account is missing', async () => {
    findOneMock.mockResolvedValue(null as never);

    const result = await runPendingLinkAbsorb({ accountId: generateRandomRecordId(), userId: USER_ID });

    expect(result).toBeNull();
    expect(queryMock).not.toHaveBeenCalled();
    expect(accountsUpdateMock).not.toHaveBeenCalled();
  });

  it.each([
    ['no bankConnection metadata', null],
    ['a reconciliation snapshot without the marker', buildReconciliation()],
    ['the marker explicitly cleared', buildReconciliation({ pendingAbsorb: false })],
  ])('returns null without absorbing for %s', async (_label, externalData) => {
    const accountId = generateRandomRecordId();
    findOneMock.mockResolvedValue(buildAccount({ id: accountId, externalData }) as never);

    const result = await runPendingLinkAbsorb({ accountId, userId: USER_ID });

    expect(result).toBeNull();
    expect(queryMock).not.toHaveBeenCalled();
    expect(accountsUpdateMock).not.toHaveBeenCalled();
  });

  it('clears the marker and records the residual when the absorb moved the opening balance', async () => {
    const accountId = generateRandomRecordId();
    const pending = buildAccount({
      id: accountId,
      currentBalance: Money.fromDecimal(200),
      initialBalance: Money.fromDecimal(50),
      externalData: buildReconciliation({ pendingAbsorb: true, extra: { providerName: 'monobank' } }),
    });
    const fresh = buildAccount({
      id: accountId,
      externalData: buildReconciliation({ pendingAbsorb: true, extra: { providerName: 'monobank' } }),
    });
    findOneMock
      .mockResolvedValueOnce(pending as never)
      .mockResolvedValueOnce(pending as never)
      .mockResolvedValueOnce(pending as never)
      .mockResolvedValueOnce(fresh as never);
    mockSignedSum(Money.fromDecimal(100).toCents());

    const result = await runPendingLinkAbsorb({ accountId, userId: USER_ID });

    expect(result).toEqual({ absorbedResidual: Money.fromDecimal(50).toCents() });
    expect(fresh.update).toHaveBeenCalledTimes(1);
    expect(fresh.update.mock.calls[0]![0]).toEqual({
      externalData: {
        someUnrelatedKey: 'keep-me',
        bankConnection: {
          linkedAt: '2024-06-01T00:00:00.000Z',
          linkingStrategy: 'forward-only',
          providerName: 'monobank',
          balanceReconciliation: {
            systemBalance: 10,
            externalBalance: 12,
            difference: 2,
            adjustmentTransactionId: null,
            pendingAbsorb: false,
            absorbedResidual: Money.fromDecimal(50).toCents(),
          },
        },
      },
    });
  });

  it('clears the marker without recording a residual when the absorb found no gap', async () => {
    const accountId = generateRandomRecordId();
    const pending = buildAccount({
      id: accountId,
      currentBalance: Money.fromDecimal(150),
      initialBalance: Money.fromDecimal(50),
      externalData: buildReconciliation({ pendingAbsorb: true }),
    });
    const fresh = buildAccount({
      id: accountId,
      externalData: buildReconciliation({ pendingAbsorb: true }),
    });
    findOneMock
      .mockResolvedValueOnce(pending as never)
      .mockResolvedValueOnce(pending as never)
      .mockResolvedValueOnce(fresh as never);
    mockSignedSum(Money.fromDecimal(100).toCents());

    const result = await runPendingLinkAbsorb({ accountId, userId: USER_ID });

    expect(result).toEqual({});
    expect(accountsUpdateMock).not.toHaveBeenCalled();
    expect(fresh.update).toHaveBeenCalledTimes(1);
    const written = fresh.update.mock.calls[0]![0] as { externalData: AccountExternalData };
    const reconciliation = written.externalData.bankConnection!.balanceReconciliation;
    expect(reconciliation.pendingAbsorb).toBe(false);
    expect(reconciliation).not.toHaveProperty('absorbedResidual');
  });

  it('returns the absorbed residual without writing when the post-absorb re-read misses', async () => {
    const accountId = generateRandomRecordId();
    const pending = buildAccount({
      id: accountId,
      currentBalance: Money.fromDecimal(200),
      initialBalance: Money.fromDecimal(50),
      externalData: buildReconciliation({ pendingAbsorb: true }),
    });
    findOneMock
      .mockResolvedValueOnce(pending as never)
      .mockResolvedValueOnce(pending as never)
      .mockResolvedValueOnce(pending as never)
      .mockResolvedValueOnce(null as never);
    mockSignedSum(Money.fromDecimal(100).toCents());

    const result = await runPendingLinkAbsorb({ accountId, userId: USER_ID });

    expect(result).toEqual({ absorbedResidual: Money.fromDecimal(50).toCents() });
    expect(pending.update).not.toHaveBeenCalled();
  });

  it('returns the absorbed residual without writing when the re-read row lost its bankConnection metadata', async () => {
    const accountId = generateRandomRecordId();
    const pending = buildAccount({
      id: accountId,
      currentBalance: Money.fromDecimal(200),
      initialBalance: Money.fromDecimal(50),
      externalData: buildReconciliation({ pendingAbsorb: true }),
    });
    const fresh = buildAccount({ id: accountId, externalData: { someUnrelatedKey: 'keep-me' } });
    findOneMock
      .mockResolvedValueOnce(pending as never)
      .mockResolvedValueOnce(pending as never)
      .mockResolvedValueOnce(pending as never)
      .mockResolvedValueOnce(fresh as never);
    mockSignedSum(Money.fromDecimal(100).toCents());

    const result = await runPendingLinkAbsorb({ accountId, userId: USER_ID });

    expect(result).toEqual({ absorbedResidual: Money.fromDecimal(50).toCents() });
    expect(fresh.update).not.toHaveBeenCalled();
  });
});
