import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Op } from 'sequelize';

// ── Mocks (hoisted before importing the module under test) ──────────────────

// The backfill reads candidates and writes the payee link through the query
// boundary; stubbing it is what lets the policy axes be asserted directly.
jest.mock('@models/transactions-query', () => ({
  __esModule: true,
  findTransactions: jest.fn(),
  updateTransactions: jest.fn(),
}));
jest.mock('@models/payees.model', () => ({ __esModule: true, default: { findAll: jest.fn() } }));
// Referenced only as the include model / association target, never called here.
jest.mock('@models/accounts.model', () => ({ __esModule: true, default: {} }));
jest.mock('@models/payee-aliases.model', () => ({ __esModule: true, default: {} }));
// The follow-up writes each linked row triggers are covered by their own suites.
jest.mock('./apply-categorization', () => ({ __esModule: true, applyPayeeCategorization: jest.fn() }));
jest.mock('./apply-default-tags', () => ({ __esModule: true, applyPayeeDefaultTags: jest.fn() }));
jest.mock('./apply-default-location', () => ({ __esModule: true, applyPayeeDefaultLocation: jest.fn() }));
jest.mock('@services/transactions/payment-legs', () => ({ __esModule: true, syncLegsOfMains: jest.fn() }));
jest.mock('./payee-namespace', () => ({
  __esModule: true,
  ensureAliasExists: jest.fn(),
  isPayeeNameIgnored: jest.fn(async () => false),
}));
// The real wrapper opens a DB transaction; running the body straight through is
// what a committed run looks like to the caller.
jest.mock('../common/with-transaction', () => ({
  __esModule: true,
  withTransaction: <T extends unknown[], R>(fn: (...args: T) => Promise<R>) => fn,
}));
jest.mock('@js/utils/logger', () => ({
  __esModule: true,
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn() },
}));

/* eslint-disable import/first */
import Payees from '@models/payees.model';
import { findTransactions, updateTransactions } from '@models/transactions-query';

import { runNoteFuzzyBackfill } from './note-fuzzy-backfill';
/* eslint-enable import/first */

const findTransactionsMock = jest.mocked(findTransactions);
const updateTransactionsMock = jest.mocked(updateTransactions);
const payeesFindAllMock = jest.mocked(Payees.findAll);

const USER_ID = 42;
const PAYEE_ID = 'payee-1';

type Candidate = { id: string; note: string | null };

function seed({ candidates }: { candidates: Candidate[] }) {
  payeesFindAllMock.mockResolvedValue([{ id: PAYEE_ID, name: 'Amazon', aliases: [] }] as never);
  findTransactionsMock.mockResolvedValue(candidates as never);
  updateTransactionsMock.mockResolvedValue([candidates.length] as never);
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('runNoteFuzzyBackfill candidate scan', () => {
  it('excludes planned rows and scopes to the account owner', async () => {
    seed({ candidates: [] });

    await runNoteFuzzyBackfill({ userId: USER_ID, transactionIds: ['tx-1'] });

    expect(findTransactionsMock).toHaveBeenCalledTimes(1);
    expect(findTransactionsMock.mock.calls[0]![0]).toMatchObject({
      planned: 'exclude',
      access: { accountOwner: USER_ID },
      completeness: 'all',
    });
  });

  it('narrows to unlinked, unlocked rows carrying a note, within the given ids', async () => {
    seed({ candidates: [] });

    await runNoteFuzzyBackfill({ userId: USER_ID, transactionIds: ['tx-1', 'tx-2'] });

    expect(findTransactionsMock.mock.calls[0]![0]!.where).toEqual({
      id: { [Op.in]: ['tx-1', 'tx-2'] },
      payeeId: null,
      payeeLocked: false,
      note: { [Op.ne]: null },
      paymentParentId: null,
    });
  });

  it('keeps balance-adjustment rows in scope', async () => {
    seed({ candidates: [] });

    await runNoteFuzzyBackfill({ userId: USER_ID, transactionIds: ['tx-1'] });

    expect(findTransactionsMock.mock.calls[0]![0]!.balanceAdjustments).toBe('include');
  });

  it('never queries when the caller passed no ids', async () => {
    seed({ candidates: [] });

    const result = await runNoteFuzzyBackfill({ userId: USER_ID, transactionIds: [] });

    expect(findTransactionsMock).not.toHaveBeenCalled();
    expect(result).toEqual({ scanned: 0, linked: 0 });
  });
});

describe('runNoteFuzzyBackfill payee link write', () => {
  it('excludes planned rows and re-states the idempotency guard', async () => {
    seed({ candidates: [{ id: 'tx-1', note: 'Amazon' }] });

    const result = await runNoteFuzzyBackfill({ userId: USER_ID, transactionIds: ['tx-1'] });

    expect(result).toEqual({ scanned: 1, linked: 1 });
    expect(updateTransactionsMock).toHaveBeenCalledTimes(1);
    expect(updateTransactionsMock.mock.calls[0]![0]).toEqual({
      values: { payeeId: PAYEE_ID },
      planned: 'exclude',
      access: 'unscoped-internal',
      balanceAdjustments: 'include',
      where: { id: 'tx-1', payeeId: null, payeeLocked: false },
    });
  });

  it('writes nothing when no note matches a payee', async () => {
    seed({ candidates: [{ id: 'tx-1', note: 'Municipal water bill' }] });

    const result = await runNoteFuzzyBackfill({ userId: USER_ID, transactionIds: ['tx-1'] });

    expect(updateTransactionsMock).not.toHaveBeenCalled();
    expect(result).toEqual({ scanned: 1, linked: 0 });
  });
});
