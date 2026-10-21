import { ACCOUNT_CATEGORIES, ACCOUNT_TYPES } from '@bt/shared/types';
import { generateRandomRecordId } from '@common/lib/record-id-helpers';
import { Money } from '@common/types/money';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { ValidationError } from '@js/errors';

// ── Mocks (hoisted before importing the module under test) ──────────────────

// The service reads/writes the account through the accounts model (default
// export `findOne`, named `updateAccountById`). Stubbing keeps this unit run
// free of the DB/queue connections the real import graph opens.
jest.mock('@models/accounts.model', () => ({
  __esModule: true,
  default: { findOne: jest.fn() },
  updateAccountById: jest.fn(),
}));
// The service re-derives `refCurrentBalance` as a spot conversion of the shifted
// native balance. The default implementation (set in beforeEach) converts 1:1,
// making ref assertions read as plain native numbers.
jest.mock('@services/calculate-ref-amount.service', () => ({
  __esModule: true,
  calculateRefAmountOrNull: jest.fn(),
}));
// Opening-balance restamps (boundary-rate `refInitialBalance` + Balances
// cascade) are the restamp service's job – here only the delegation is asserted.
jest.mock('./restamp-ref-initial-balance', () => ({
  __esModule: true,
  restampRefInitialBalance: jest.fn(),
}));
// Pinning today's net-worth history row to the account's spot ref balance is the
// Balances model's job – here only the delegation (called with the final row) is
// asserted.
jest.mock('@models/balances.model', () => ({
  __esModule: true,
  default: { setTodayRowToSpot: jest.fn() },
}));

// The owner's base currency decides between the spot pin and a full history
// rebuild. Every case here is same-currency (USD), so the pin path runs.
jest.mock('@models/users-currencies.model', () => ({
  __esModule: true,
  getBaseCurrency: jest.fn(async () => ({ currencyCode: 'USD' })),
}));
jest.mock('@services/balances/revalue-balance-history.service', () => ({
  __esModule: true,
  isRevaluedAccount: jest.fn(() => false),
  scheduleBalanceRevalue: jest.fn(),
}));

// `withTransaction` (imported by the service via ../common/with-transaction)
// reads the ambient CLS transaction from this namespace and, finding none,
// runs the body inside `connection.sequelize.transaction`. The stub runs the
// callback straight through – exactly what a real COMMIT looks like to the
// caller – and reports no ambient transaction so the service's row-lock read
// passes `transaction: undefined`.
jest.mock('@models/connection', () => ({
  __esModule: true,
  connection: {
    sequelize: {
      transaction: (cb: () => Promise<unknown>) => cb(),
    },
  },
  namespace: { get: () => undefined },
}));

/* eslint-disable import/first */
import Accounts, * as AccountsModel from '@models/accounts.model';
import Balances from '@models/balances.model';
import { calculateRefAmountOrNull } from '@services/calculate-ref-amount.service';

import { absorbBalanceAdjustment } from './absorb-balance-adjustment';
import { restampRefInitialBalance } from './restamp-ref-initial-balance';
/* eslint-enable import/first */

const findOneMock = jest.mocked(Accounts.findOne);
const updateAccountByIdMock = jest.mocked(AccountsModel.updateAccountById);
const calculateRefAmountMock = jest.mocked(calculateRefAmountOrNull);
const restampMock = jest.mocked(restampRefInitialBalance);
const setTodayRowToSpotMock = jest.mocked(Balances.setTodayRowToSpot);

type AccountRow = InstanceType<typeof Accounts>;

const USER_ID = 42;

/**
 * Minimal account shape the service touches: identity, type/category (drive the
 * system + dedicated-flow branches), currency, and the Money balances it shifts.
 */
function buildAccount({
  id = generateRandomRecordId(),
  name = 'Account',
  type = ACCOUNT_TYPES.monobank,
  accountCategory = ACCOUNT_CATEGORIES.general,
  currencyCode = 'USD',
  currentBalance = Money.zero(),
  refCurrentBalance = Money.zero(),
  initialBalance = Money.zero(),
  refInitialBalance = Money.zero(),
}: {
  id?: string;
  name?: string;
  type?: ACCOUNT_TYPES;
  accountCategory?: ACCOUNT_CATEGORIES;
  currencyCode?: string;
  currentBalance?: Money;
  refCurrentBalance?: Money;
  initialBalance?: Money;
  refInitialBalance?: Money;
} = {}): AccountRow {
  return {
    id,
    name,
    type,
    accountCategory,
    currencyCode,
    currentBalance,
    refCurrentBalance,
    initialBalance,
    refInitialBalance,
  } as unknown as AccountRow;
}

/** The single `updateAccountById` argument, typed for balance assertions. */
type UpdatePayload = {
  id: string;
  userId: number;
  currentBalance: Money;
  refCurrentBalance: Money;
  initialBalance?: Money;
};

const lastUpdatePayload = (): UpdatePayload => updateAccountByIdMock.mock.calls[0]![0] as unknown as UpdatePayload;

beforeEach(() => {
  jest.clearAllMocks();
  findOneMock.mockResolvedValue(null as never);
  // Default: the update succeeds and echoes a distinct sentinel so tests can
  // assert the service returns the written row (not the pre-update read).
  updateAccountByIdMock.mockResolvedValue({ id: 'updated-sentinel' } as never);
  // 1:1 spot conversion – ref assertions read as plain native numbers.
  calculateRefAmountMock.mockImplementation(async ({ amount }) => amount);
  restampMock.mockResolvedValue('restamped');
  setTodayRowToSpotMock.mockResolvedValue(undefined as never);
});

describe('absorbBalanceAdjustment', () => {
  it('non-system account: shifts the current balance, remeasures the ref balance, never touches the opening balance', async () => {
    const accountId = generateRandomRecordId();
    const account = buildAccount({
      id: accountId,
      type: ACCOUNT_TYPES.monobank,
      accountCategory: ACCOUNT_CATEGORIES.general,
      currentBalance: Money.fromDecimal(100),
      refCurrentBalance: Money.fromDecimal(120),
      initialBalance: Money.fromDecimal(10),
      refInitialBalance: Money.fromDecimal(12),
    });
    findOneMock.mockResolvedValue(account as never);

    const result = await absorbBalanceAdjustment({
      userId: USER_ID,
      accountId,
      amountDelta: Money.fromDecimal(50),
    });

    expect(updateAccountByIdMock).toHaveBeenCalledTimes(1);
    const payload = lastUpdatePayload();
    expect(payload.id).toBe(accountId);
    expect(payload.userId).toBe(USER_ID);
    // currentBalance = original + amountDelta.
    expect(payload.currentBalance.toCents()).toBe(Money.fromDecimal(150).toCents());
    // refCurrentBalance is a spot remeasure of the NEW native balance (1:1 mock),
    // never `stored ref + a delta`.
    expect(payload.refCurrentBalance.toCents()).toBe(Money.fromDecimal(150).toCents());
    expect(calculateRefAmountMock).toHaveBeenCalledWith(
      expect.objectContaining({ userId: USER_ID, baseCode: 'USD', bypassCache: true }),
    );
    expect(calculateRefAmountMock.mock.calls[0]![0].amount.toCents()).toBe(Money.fromDecimal(150).toCents());
    // The provider-owned opening balance must NOT move – this is the regression guard.
    expect(payload).not.toHaveProperty('initialBalance');
    expect(payload).not.toHaveProperty('refInitialBalance');

    expect(restampMock).not.toHaveBeenCalled();

    // Today's net-worth row is pinned to the written row's spot ref balance.
    expect(setTodayRowToSpotMock).toHaveBeenCalledTimes(1);
    expect(setTodayRowToSpotMock).toHaveBeenCalledWith({ account: result });
  });

  it('system account: also shifts the native opening balance and delegates its ref stamp to the restamp service', async () => {
    const accountId = generateRandomRecordId();
    const account = buildAccount({
      id: accountId,
      type: ACCOUNT_TYPES.system,
      accountCategory: ACCOUNT_CATEGORIES.general,
      currentBalance: Money.fromDecimal(200),
      refCurrentBalance: Money.fromDecimal(200),
      initialBalance: Money.fromDecimal(50),
      refInitialBalance: Money.fromDecimal(50),
    });
    const refreshedRow = { id: 'refreshed-after-restamp' } as unknown as AccountRow;
    findOneMock.mockResolvedValueOnce(account as never).mockResolvedValueOnce(refreshedRow as never);

    const result = await absorbBalanceAdjustment({
      userId: USER_ID,
      accountId,
      amountDelta: Money.fromDecimal(30),
    });

    expect(updateAccountByIdMock).toHaveBeenCalledTimes(1);
    const payload = lastUpdatePayload();
    expect(payload.currentBalance.toCents()).toBe(Money.fromDecimal(230).toCents());
    expect(payload.refCurrentBalance.toCents()).toBe(Money.fromDecimal(230).toCents());
    // System accounts absorb the same native delta into the opening balance; its
    // ref stamp is NOT written here – the restamp service derives it.
    expect(payload.initialBalance!.toCents()).toBe(Money.fromDecimal(80).toCents());
    expect(payload).not.toHaveProperty('refInitialBalance');

    expect(restampMock).toHaveBeenCalledTimes(1);
    expect(restampMock).toHaveBeenCalledWith({ accountId });

    // The service returns the row re-read AFTER the restamp so callers see the
    // final ref fields.
    expect(result).toBe(refreshedRow);

    // Today's net-worth row is pinned last, to that same refreshed row's spot ref
    // balance (after the restamp cascade).
    expect(setTodayRowToSpotMock).toHaveBeenCalledTimes(1);
    expect(setTodayRowToSpotMock).toHaveBeenCalledWith({ account: refreshedRow });
  });

  it('system account with a zero delta: writes the (unchanged) balances but skips the restamp', async () => {
    const accountId = generateRandomRecordId();
    const account = buildAccount({
      id: accountId,
      type: ACCOUNT_TYPES.system,
      accountCategory: ACCOUNT_CATEGORIES.general,
      currentBalance: Money.fromDecimal(75),
      refCurrentBalance: Money.fromDecimal(75),
      initialBalance: Money.fromDecimal(5),
      refInitialBalance: Money.fromDecimal(5),
    });
    findOneMock.mockResolvedValue(account as never);

    await absorbBalanceAdjustment({
      userId: USER_ID,
      accountId,
      amountDelta: Money.zero(),
    });

    expect(updateAccountByIdMock).toHaveBeenCalledTimes(1);
    const payload = lastUpdatePayload();
    expect(payload.initialBalance!.toCents()).toBe(Money.fromDecimal(5).toCents());

    // A zero delta cannot move the opening balance – no restamp, no cascade.
    expect(restampMock).not.toHaveBeenCalled();

    // Today's row is still pinned to the (unchanged) spot ref balance.
    expect(setTodayRowToSpotMock).toHaveBeenCalledTimes(1);
  });

  it('non-system account: keeps the stored ref balance by omitting the ref column when the spot remeasure fails', async () => {
    const accountId = generateRandomRecordId();
    const account = buildAccount({
      id: accountId,
      type: ACCOUNT_TYPES.monobank,
      accountCategory: ACCOUNT_CATEGORIES.general,
      currentBalance: Money.fromDecimal(100),
      refCurrentBalance: Money.fromDecimal(120),
    });
    findOneMock.mockResolvedValue(account as never);
    // No rate reaches the pair → the shared spot helper swallows the throw and
    // signals "kept" so absorb leaves the ref column out of the update.
    calculateRefAmountMock.mockRejectedValue(new Error('exchange rate unavailable'));

    const result = await absorbBalanceAdjustment({
      userId: USER_ID,
      accountId,
      amountDelta: Money.fromDecimal(50),
    });

    expect(updateAccountByIdMock).toHaveBeenCalledTimes(1);
    const payload = lastUpdatePayload();
    // The native write still lands…
    expect(payload.currentBalance.toCents()).toBe(Money.fromDecimal(150).toCents());
    // …but the ref column is omitted entirely, so the stored value survives.
    expect(payload).not.toHaveProperty('refCurrentBalance');
    // Non-system: opening balance untouched, no restamp.
    expect(payload).not.toHaveProperty('initialBalance');
    expect(restampMock).not.toHaveBeenCalled();
    // Today's row is still pinned to the (unchanged) stored spot ref balance.
    expect(setTodayRowToSpotMock).toHaveBeenCalledTimes(1);
    expect(setTodayRowToSpotMock).toHaveBeenCalledWith({ account: result });
  });

  it('system account: still shifts the opening balance and restamps when the spot remeasure fails, omitting only the ref column', async () => {
    const accountId = generateRandomRecordId();
    const account = buildAccount({
      id: accountId,
      type: ACCOUNT_TYPES.system,
      accountCategory: ACCOUNT_CATEGORIES.general,
      currentBalance: Money.fromDecimal(200),
      refCurrentBalance: Money.fromDecimal(200),
      initialBalance: Money.fromDecimal(50),
      refInitialBalance: Money.fromDecimal(50),
    });
    const refreshedRow = { id: 'refreshed-after-restamp' } as unknown as AccountRow;
    findOneMock.mockResolvedValueOnce(account as never).mockResolvedValueOnce(refreshedRow as never);
    calculateRefAmountMock.mockRejectedValue(new Error('exchange rate unavailable'));

    await absorbBalanceAdjustment({
      userId: USER_ID,
      accountId,
      amountDelta: Money.fromDecimal(30),
    });

    const payload = lastUpdatePayload();
    expect(payload.currentBalance.toCents()).toBe(Money.fromDecimal(230).toCents());
    // System accounts still absorb the same native delta into the opening balance…
    expect(payload.initialBalance!.toCents()).toBe(Money.fromDecimal(80).toCents());
    // …only the ref current balance is omitted (kept at its stored value).
    expect(payload).not.toHaveProperty('refCurrentBalance');
    // The opening-balance restamp still runs (it has its own missing-rate catch).
    expect(restampMock).toHaveBeenCalledTimes(1);
    expect(setTodayRowToSpotMock).toHaveBeenCalledTimes(1);
    expect(setTodayRowToSpotMock).toHaveBeenCalledWith({ account: refreshedRow });
  });

  it('throws ValidationError and never writes when the account is not found', async () => {
    findOneMock.mockResolvedValue(null as never);

    await expect(
      absorbBalanceAdjustment({
        userId: USER_ID,
        accountId: generateRandomRecordId(),
        amountDelta: Money.fromDecimal(10),
      }),
    ).rejects.toThrow(ValidationError);

    expect(updateAccountByIdMock).not.toHaveBeenCalled();
    expect(restampMock).not.toHaveBeenCalled();
    expect(setTodayRowToSpotMock).not.toHaveBeenCalled();
  });

  it.each([ACCOUNT_CATEGORIES.vehicle, ACCOUNT_CATEGORIES.loan])(
    'throws ValidationError for a dedicated-flow account (%s) without writing or restamping',
    async (accountCategory) => {
      const accountId = generateRandomRecordId();
      findOneMock.mockResolvedValue(
        buildAccount({ id: accountId, name: 'Car', type: ACCOUNT_TYPES.monobank, accountCategory }) as never,
      );

      await expect(
        absorbBalanceAdjustment({
          userId: USER_ID,
          accountId,
          amountDelta: Money.fromDecimal(10),
        }),
      ).rejects.toThrow(ValidationError);

      expect(updateAccountByIdMock).not.toHaveBeenCalled();
      expect(restampMock).not.toHaveBeenCalled();
      expect(setTodayRowToSpotMock).not.toHaveBeenCalled();
    },
  );

  it('throws ValidationError when the update returns falsy', async () => {
    const accountId = generateRandomRecordId();
    findOneMock.mockResolvedValue(
      buildAccount({
        id: accountId,
        type: ACCOUNT_TYPES.monobank,
        accountCategory: ACCOUNT_CATEGORIES.general,
      }) as never,
    );
    updateAccountByIdMock.mockResolvedValue(null as never);

    await expect(
      absorbBalanceAdjustment({
        userId: USER_ID,
        accountId,
        amountDelta: Money.fromDecimal(10),
      }),
    ).rejects.toThrow(ValidationError);

    expect(restampMock).not.toHaveBeenCalled();
    expect(setTodayRowToSpotMock).not.toHaveBeenCalled();
  });
});
