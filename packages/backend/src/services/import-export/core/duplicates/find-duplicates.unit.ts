import type { DuplicateMatch, ParsedTransactionRow } from '@bt/shared/types';
import { TRANSACTION_TYPES } from '@bt/shared/types';
import { generateRandomRecordId } from '@common/lib/record-id-helpers';
import { Money } from '@common/types/money';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

// ── Mocks (must be hoisted before importing the module under test) ─────────────

// Stub Transactions.findWithFilters — returns rows we control per test.
const findWithFilters = jest.fn<() => Promise<unknown[]>>();
jest.mock('@models/transactions.model', () => ({
  __esModule: true,
  findWithFilters: () => findWithFilters(),
}));

// Every account is reported at `mockAccountDecimals`, which a test can change.
let mockAccountDecimals = 2;
jest.mock('./get-account-decimals', () => ({
  __esModule: true,
  getAccountDecimals: ({ accountIds }: { accountIds: string[] }) =>
    Promise.resolve(new Map(accountIds.map((id) => [id, mockAccountDecimals]))),
}));

// eslint-disable-next-line import/first
import { findDuplicates } from './find-duplicates';

// ── Helpers ───────────────────────────────────────────────────────────────────

type FakeTx = {
  id: string;
  accountId: string;
  /** ISO instant string */
  time: string;
  amount: Money;
  transactionType: string;
  note: string;
};

function makeTx(
  overrides: Partial<Omit<FakeTx, 'amount'>> & { accountId: string; time: string; amount: number },
): FakeTx {
  return {
    id: overrides.id ?? generateRandomRecordId(),
    accountId: overrides.accountId,
    time: overrides.time,
    amount: Money.fromDecimal(overrides.amount),
    transactionType: overrides.transactionType ?? TRANSACTION_TYPES.expense,
    note: overrides.note ?? '',
  };
}

function makeRow(
  overrides: Omit<Partial<ParsedTransactionRow>, 'amount'> & { accountName: string; date: string; amount: number },
): ParsedTransactionRow {
  return {
    rowIndex: overrides.rowIndex ?? 0,
    date: overrides.date,
    amount: overrides.amount,
    description: overrides.description ?? 'Test transaction',
    accountName: overrides.accountName,
    currencyCode: overrides.currencyCode ?? 'USD',
    transactionType: overrides.transactionType ?? 'expense',
  };
}

const USER_ID = 1;
const ACCOUNT_ID = generateRandomRecordId();
const ACCOUNT_NAME = 'Checking';

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('findDuplicates', () => {
  beforeEach(() => {
    mockAccountDecimals = 2;
    findWithFilters.mockReset();
    findWithFilters.mockResolvedValue([]);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ── Empty-input / no-match paths ────────────────────────────────────────────

  it('returns an empty array when validRows is empty (no DB call)', async () => {
    const result = await findDuplicates({
      userId: USER_ID,
      validRows: [],
      accountNameToId: new Map([[ACCOUNT_NAME, ACCOUNT_ID]]),
    });

    expect(result).toEqual([]);
    expect(findWithFilters).not.toHaveBeenCalled();
  });

  it('returns an empty array when all accounts are new (no existing account IDs)', async () => {
    // null value = new account not yet in the system
    const row = makeRow({ accountName: ACCOUNT_NAME, date: '2026-06-01T12:00:00.000Z', amount: 50 });

    const result = await findDuplicates({
      userId: USER_ID,
      validRows: [row],
      accountNameToId: new Map([[ACCOUNT_NAME, null]]),
    });

    expect(result).toEqual([]);
    expect(findWithFilters).not.toHaveBeenCalled();
  });

  it('returns an empty array when no existing transactions match the import rows', async () => {
    const row = makeRow({ accountName: ACCOUNT_NAME, date: '2026-06-01T12:00:00.000Z', amount: 50 });
    findWithFilters.mockResolvedValue([]); // DB has nothing

    const result = await findDuplicates({
      userId: USER_ID,
      validRows: [row],
      accountNameToId: new Map([[ACCOUNT_NAME, ACCOUNT_ID]]),
    });

    expect(result).toEqual([]);
  });

  // ── Day-normalisation: same calendar day matches ─────────────────────────────

  it('matches an import row at 15:00 UTC against an existing tx at 00:00 UTC (same calendar day)', async () => {
    // The import row is anchored to an afternoon instant; the stored transaction
    // is at midnight — both are on 2026-06-01. The day-granular key must unify them.
    const txId = generateRandomRecordId();
    const existingTx = makeTx({
      id: txId,
      accountId: ACCOUNT_ID,
      time: '2026-06-01T00:00:00.000Z',
      amount: 50,
      transactionType: TRANSACTION_TYPES.expense,
      note: 'Coffee',
    });

    findWithFilters.mockResolvedValue([existingTx]);

    const row = makeRow({
      rowIndex: 0,
      accountName: ACCOUNT_NAME,
      date: '2026-06-01T15:00:00.000Z',
      amount: 50,
      transactionType: 'expense',
      description: 'Coffee',
    });

    const result = await findDuplicates({
      userId: USER_ID,
      validRows: [row],
      accountNameToId: new Map([[ACCOUNT_NAME, ACCOUNT_ID]]),
    });

    expect(result).toHaveLength(1);
    expect(result[0]!.rowIndex).toBe(0);
    expect(result[0]!.existingTransaction.id).toBe(txId);
  });

  it('matches an import row at 23:59:59 UTC against an existing tx at 09:00 UTC (same calendar day)', async () => {
    const txId = generateRandomRecordId();
    const existingTx = makeTx({
      id: txId,
      accountId: ACCOUNT_ID,
      time: '2026-06-01T09:00:00.000Z',
      amount: 10,
      transactionType: TRANSACTION_TYPES.expense,
    });

    findWithFilters.mockResolvedValue([existingTx]);

    const row = makeRow({
      rowIndex: 1,
      accountName: ACCOUNT_NAME,
      date: '2026-06-01T23:59:59.000Z',
      amount: 10,
      transactionType: 'expense',
    });

    const result = await findDuplicates({
      userId: USER_ID,
      validRows: [row],
      accountNameToId: new Map([[ACCOUNT_NAME, ACCOUNT_ID]]),
    });

    expect(result).toHaveLength(1);
    expect(result[0]!.existingTransaction.id).toBe(txId);
  });

  // ── Day-normalisation: different calendar day must NOT match ─────────────────

  it('does NOT match a row at 2026-06-01T23:59:59Z against an existing tx at 2026-06-02T00:00:00Z', async () => {
    const existingTx = makeTx({
      accountId: ACCOUNT_ID,
      time: '2026-06-02T00:00:00.000Z', // June 2
      amount: 50,
      transactionType: TRANSACTION_TYPES.expense,
    });

    findWithFilters.mockResolvedValue([existingTx]);

    const row = makeRow({
      accountName: ACCOUNT_NAME,
      date: '2026-06-01T23:59:59.000Z', // June 1
      amount: 50,
      transactionType: 'expense',
    });

    const result = await findDuplicates({
      userId: USER_ID,
      validRows: [row],
      accountNameToId: new Map([[ACCOUNT_NAME, ACCOUNT_ID]]),
    });

    expect(result).toEqual([]);
  });

  // ── Amount matching ──────────────────────────────────────────────────────────

  it('does NOT match when amounts differ (same day, same type)', async () => {
    const existingTx = makeTx({
      accountId: ACCOUNT_ID,
      time: '2026-06-01T12:00:00.000Z',
      amount: 99.99, // different from row's 50
      transactionType: TRANSACTION_TYPES.expense,
    });

    findWithFilters.mockResolvedValue([existingTx]);

    const row = makeRow({
      accountName: ACCOUNT_NAME,
      date: '2026-06-01T12:00:00.000Z',
      amount: 50,
      transactionType: 'expense',
    });

    const result = await findDuplicates({
      userId: USER_ID,
      validRows: [row],
      accountNameToId: new Map([[ACCOUNT_NAME, ACCOUNT_ID]]),
    });

    expect(result).toEqual([]);
  });

  // ── Transaction-type matching ────────────────────────────────────────────────

  it('does NOT match when transaction type differs (same day, same amount)', async () => {
    // Existing is income; import row is expense — no match despite same day+amount.
    const existingTx = makeTx({
      accountId: ACCOUNT_ID,
      time: '2026-06-01T12:00:00.000Z',
      amount: 50,
      transactionType: TRANSACTION_TYPES.income,
    });

    findWithFilters.mockResolvedValue([existingTx]);

    const row = makeRow({
      accountName: ACCOUNT_NAME,
      date: '2026-06-01T12:00:00.000Z',
      amount: 50,
      transactionType: 'expense',
    });

    const result = await findDuplicates({
      userId: USER_ID,
      validRows: [row],
      accountNameToId: new Map([[ACCOUNT_NAME, ACCOUNT_ID]]),
    });

    expect(result).toEqual([]);
  });

  // ── Single candidate: exact vs fuzzy confidence based on description ─────────

  it('produces matchType=exact when there is one candidate and descriptions are similar', async () => {
    const txId = generateRandomRecordId();
    const existingTx = makeTx({
      id: txId,
      accountId: ACCOUNT_ID,
      time: '2026-06-01T00:00:00.000Z',
      amount: 25,
      transactionType: TRANSACTION_TYPES.expense,
      note: 'Grocery store',
    });

    findWithFilters.mockResolvedValue([existingTx]);

    const row = makeRow({
      accountName: ACCOUNT_NAME,
      date: '2026-06-01T12:00:00.000Z',
      amount: 25,
      transactionType: 'expense',
      description: 'Grocery store',
    });

    const result = await findDuplicates({
      userId: USER_ID,
      validRows: [row],
      accountNameToId: new Map([[ACCOUNT_NAME, ACCOUNT_ID]]),
    });

    expect(result).toHaveLength(1);
    expect(result[0]!.matchType).toBe('exact');
    expect(result[0]!.confidence).toBe(100);
  });

  it('produces matchType=fuzzy with lower confidence when descriptions are very different', async () => {
    const txId = generateRandomRecordId();
    const existingTx = makeTx({
      id: txId,
      accountId: ACCOUNT_ID,
      time: '2026-06-01T00:00:00.000Z',
      amount: 25,
      transactionType: TRANSACTION_TYPES.expense,
      note: 'AAAAAAAAAAAAA', // completely different description
    });

    findWithFilters.mockResolvedValue([existingTx]);

    const row = makeRow({
      accountName: ACCOUNT_NAME,
      date: '2026-06-01T12:00:00.000Z',
      amount: 25,
      transactionType: 'expense',
      description: 'ZZZZZZZZZZZZZZZZZZZZZZZZ', // low similarity
    });

    const result = await findDuplicates({
      userId: USER_ID,
      validRows: [row],
      accountNameToId: new Map([[ACCOUNT_NAME, ACCOUNT_ID]]),
    });

    expect(result).toHaveLength(1);
    expect(result[0]!.matchType).toBe('fuzzy');
    expect(result[0]!.confidence).toBeLessThan(100);
  });

  // ── Row skipped when account not in accountNameToId ──────────────────────────

  it('skips a row whose account name is not in the accountNameToId map', async () => {
    const existingTx = makeTx({
      accountId: ACCOUNT_ID,
      time: '2026-06-01T00:00:00.000Z',
      amount: 50,
      transactionType: TRANSACTION_TYPES.expense,
    });

    findWithFilters.mockResolvedValue([existingTx]);

    const row = makeRow({
      accountName: 'Unknown Account', // not in the map
      date: '2026-06-01T12:00:00.000Z',
      amount: 50,
      transactionType: 'expense',
    });

    const result = await findDuplicates({
      userId: USER_ID,
      validRows: [row],
      accountNameToId: new Map([[ACCOUNT_NAME, ACCOUNT_ID]]),
    });

    expect(result).toEqual([]);
  });

  // ── DuplicateMatch output shape ──────────────────────────────────────────────

  it('returns the correct DuplicateMatch shape with date as YYYY-MM-DD string', async () => {
    const txId = generateRandomRecordId();
    const existingTx = makeTx({
      id: txId,
      accountId: ACCOUNT_ID,
      time: '2026-06-01T09:00:00.000Z',
      amount: 30,
      transactionType: TRANSACTION_TYPES.expense,
      note: 'Note',
    });

    findWithFilters.mockResolvedValue([existingTx]);

    const row = makeRow({
      rowIndex: 5,
      accountName: ACCOUNT_NAME,
      date: '2026-06-01T15:00:00.000Z',
      amount: 30,
      transactionType: 'expense',
      description: 'Note',
    });

    const result = await findDuplicates({
      userId: USER_ID,
      validRows: [row],
      accountNameToId: new Map([[ACCOUNT_NAME, ACCOUNT_ID]]),
    });

    expect(result).toHaveLength(1);
    const match = result[0] as DuplicateMatch;
    expect(match.rowIndex).toBe(5);
    expect(match.importedTransaction).toEqual(row);
    expect(match.existingTransaction.id).toBe(txId);
    expect(match.existingTransaction.date).toBe('2026-06-01');
    expect(match.existingTransaction.amount).toBe(30);
    expect(match.existingTransaction.note).toBe('Note');
    expect(match.existingTransaction.accountId).toBe(ACCOUNT_ID);
  });

  // ── Amounts at the account currency's decimals ───────────────────────────────

  describe('at 3 decimals', () => {
    const findOne = ({ rowAmount, existingAmount }: { rowAmount: number; existingAmount: number }) => {
      mockAccountDecimals = 3;
      findWithFilters.mockResolvedValue([
        makeTx({ accountId: ACCOUNT_ID, time: '2026-06-01T09:00:00.000Z', amount: existingAmount }),
      ]);

      return findDuplicates({
        userId: USER_ID,
        validRows: [makeRow({ accountName: ACCOUNT_NAME, date: '2026-06-01T15:00:00.000Z', amount: rowAmount })],
        accountNameToId: new Map([[ACCOUNT_NAME, ACCOUNT_ID]]),
      });
    };

    it('keeps 1.234 and 1.231 apart', async () => {
      expect(await findOne({ rowAmount: 1.234, existingAmount: 1.231 })).toEqual([]);
    });

    it('matches 1.234 against 1.234 and reports the existing amount in decimals', async () => {
      const result = await findOne({ rowAmount: 1.234, existingAmount: 1.234 });

      expect(result).toHaveLength(1);
      expect(result[0]!.existingTransaction.amount).toBe(1.234);
    });

    it('rounds a row with an extra digit half-up before keying it', async () => {
      expect(await findOne({ rowAmount: 1.2345, existingAmount: 1.235 })).toHaveLength(1);
    });
  });
});
