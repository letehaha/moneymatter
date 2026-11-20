import { ACCOUNT_TYPES } from '@bt/shared/types';
import { Money } from '@common/types/money';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

jest.mock('@i18n/index', () => ({ __esModule: true, t: ({ key }: { key: string }) => key }));
jest.mock('@models/accounts.model', () => ({ __esModule: true, getAccountById: jest.fn() }));
jest.mock('@services/accounts/lock-account-row', () => ({ __esModule: true, lockAccountRow: jest.fn() }));
jest.mock('@services/common/with-transaction', () => ({
  __esModule: true,
  withTransaction: <T extends unknown[], R>(fn: (...args: T) => Promise<R>) => fn,
}));

/* eslint-disable import/first */
import { lockAccountRow } from '@services/accounts/lock-account-row';
import { ImportJobError } from '@services/import-export/core/queue/import-job-error';

import { assertBankLinksUnchanged, dropFromBankSeam, excludeSeamAccounts, isFromBankSeam } from './bank-seam';
/* eslint-enable import/first */

const USER_ID = 1;
const SEAM_A = new Date('2025-11-08T00:00:00.000Z');
const SEAM_B = new Date('2025-11-20T00:00:00.000Z');

const linkedAccount = ({
  id,
  linkedAt,
  seamBalance = Money.fromDecimal(1000),
}: {
  id: string;
  linkedAt: string;
  seamBalance?: Money | null;
}) => ({
  id,
  type: ACCOUNT_TYPES.lunchflow,
  seamBalance,
  externalData: { bankConnection: { linkedAt, linkingStrategy: 'forward-only' } },
});

const systemAccount = ({ id }: { id: string }) => ({ id, type: ACCOUNT_TYPES.system, seamBalance: null });

const mockLockedAccounts = ({ accounts }: { accounts: Record<string, object | null> }) => {
  jest
    .mocked(lockAccountRow)
    .mockImplementation((async ({ accountId }: { accountId: string }) => accounts[accountId] ?? null) as never);
};

const rejectionOf = ({ promise }: { promise: Promise<unknown> }) => promise.then(() => null).catch((error) => error);

const expectBankLinkChanged = async ({ promise }: { promise: Promise<unknown> }) => {
  const error = await rejectionOf({ promise });
  expect(error).toBeInstanceOf(ImportJobError);
  expect(error).toMatchObject({ failure: { code: 'bank-link-changed' } });
};

const row = ({ accountName, date }: { accountName: string; date: string }) => ({ accountName, date });

const transfer = ({ source, destination, date }: { source: string; destination: string; date: string }) => ({
  sourceAccountName: source,
  destinationAccountName: destination,
  date,
  rowIndices: [0, 1],
});

describe('dropFromBankSeam', () => {
  const seamStartByName = new Map([
    ['A', SEAM_A],
    ['B', SEAM_B],
  ]);

  it('drops a transfer between two seam accounts when either leg is on or after its own seam, counting both legs', () => {
    const outOfA = transfer({ source: 'A', destination: 'B', date: '2025-11-10T12:00:00.000Z' });
    const intoA = transfer({ source: 'B', destination: 'A', date: '2025-11-10T12:00:00.000Z' });
    const beforeBoth = transfer({ source: 'A', destination: 'B', date: '2025-11-05T12:00:00.000Z' });

    const result = dropFromBankSeam({ seamStartByName, rows: [], transfers: [outOfA, intoA, beforeBoth] });

    expect(result).toEqual({ rows: [], transfers: [beforeBoth], droppedCount: 4 });
  });

  it('passes through rows and transfers whose account names map to no seam', () => {
    const rows = [row({ accountName: 'Cash', date: '2030-01-01T00:00:00.000Z' })];
    const transfers = [
      transfer({ source: 'Cash', destination: 'Wallet', date: '2030-01-01T00:00:00.000Z' }),
      transfer({ source: 'Cash', destination: 'A', date: '2025-11-07T12:00:00.000Z' }),
    ];

    expect(dropFromBankSeam({ seamStartByName, rows, transfers })).toEqual({ rows, transfers, droppedCount: 0 });
  });

  it('drops a row exactly at the seam start and keeps one a millisecond before it', () => {
    const atSeam = row({ accountName: 'A', date: '2025-11-08T00:00:00.000Z' });
    const justBefore = row({ accountName: 'A', date: '2025-11-07T23:59:59.999Z' });
    const transferAtSeam = transfer({ source: 'Cash', destination: 'A', date: '2025-11-08T00:00:00.000Z' });
    const transferJustBefore = transfer({ source: 'Cash', destination: 'A', date: '2025-11-07T23:59:59.999Z' });

    const result = dropFromBankSeam({
      seamStartByName,
      rows: [atSeam, justBefore],
      transfers: [transferAtSeam, transferJustBefore],
    });

    expect(result).toEqual({ rows: [justBefore], transfers: [transferJustBefore], droppedCount: 3 });
  });
});

describe('assertBankLinksUnchanged', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('passes when every seam is the one reviewed, locking the accounts in id order', async () => {
    mockLockedAccounts({
      accounts: { b: linkedAccount({ id: 'b', linkedAt: '2025-11-08T09:00:00.000Z' }), a: systemAccount({ id: 'a' }) },
    });

    await expect(
      assertBankLinksUnchanged({
        userId: USER_ID,
        accountIds: ['b', 'a'],
        seamStartByAccountId: new Map([['b', SEAM_A]]),
      }),
    ).resolves.toBeUndefined();
    expect(jest.mocked(lockAccountRow).mock.calls.map(([params]) => params)).toEqual([
      { accountId: 'a', userId: USER_ID, noKey: true },
      { accountId: 'b', userId: USER_ID, noKey: true },
    ]);
  });

  it.each([
    ['relinked on another day', linkedAccount({ id: 'a', linkedAt: '2025-11-20T09:00:00.000Z' })],
    ['unlinked', systemAccount({ id: 'a' })],
  ])('throws the bank-link-changed error when the account was %s', async (_label, account) => {
    mockLockedAccounts({ accounts: { a: account } });

    await expectBankLinkChanged({
      promise: assertBankLinksUnchanged({
        userId: USER_ID,
        accountIds: ['a'],
        seamStartByAccountId: new Map([['a', SEAM_A]]),
      }),
    });
  });

  it('throws when an account reviewed without a seam is now bank-linked with no seam', async () => {
    mockLockedAccounts({
      accounts: { a: linkedAccount({ id: 'a', linkedAt: '2025-11-08T09:00:00.000Z', seamBalance: null }) },
    });

    await expectBankLinkChanged({
      promise: assertBankLinksUnchanged({ userId: USER_ID, accountIds: ['a'], seamStartByAccountId: new Map() }),
    });
  });

  it('skips an account that no longer exists, even one reviewed with a seam', async () => {
    mockLockedAccounts({ accounts: {} });

    await expect(
      assertBankLinksUnchanged({ userId: USER_ID, accountIds: ['a'], seamStartByAccountId: new Map([['a', SEAM_A]]) }),
    ).resolves.toBeUndefined();
  });
});

describe('excludeSeamAccounts', () => {
  it('keeps only the accounts without a seam', () => {
    expect(
      excludeSeamAccounts({ accountIds: ['a', 'b', 'c'], seamStartByAccountId: new Map([['b', SEAM_A]]) }),
    ).toEqual(['a', 'c']);
  });
});

describe('isFromBankSeam', () => {
  it('is true from the seam start on and false before it or without a seam', () => {
    expect([
      isFromBankSeam({ seamStart: SEAM_A, time: '2025-11-08T00:00:00.000Z' }),
      isFromBankSeam({ seamStart: SEAM_A, time: new Date('2025-11-07T23:59:59.999Z') }),
      isFromBankSeam({ seamStart: null, time: '2030-01-01T00:00:00.000Z' }),
    ]).toEqual([true, false, false]);
  });
});
