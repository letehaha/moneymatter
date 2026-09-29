import { TRANSACTION_TRANSFER_NATURE } from '@bt/shared/types';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { IncludeOptions, Op } from 'sequelize';

// The module under test only needs the models as call targets; stubbing them keeps this run free
// of the database connection their real import graph opens.
jest.mock('@js/utils/logger', () => ({
  __esModule: true,
  logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn() },
}));
jest.mock('@models/transactions.model', () => ({
  __esModule: true,
  default: { findAll: jest.fn(), update: jest.fn(), destroy: jest.fn() },
}));
jest.mock('@models/accounts.model', () => ({ __esModule: true, default: { findAll: jest.fn() } }));
jest.mock('@models/budget-transactions.model', () => ({ __esModule: true, default: { findAll: jest.fn() } }));
jest.mock('@services/sharing/auth/get-accessible-account-ids.service', () => ({
  __esModule: true,
  getAccessibleAccountIdsForUser: jest.fn(),
}));

/* eslint-disable import/first */
import { logger } from '@js/utils/logger';
import Transactions from '@models/transactions.model';
import { getAccessibleAccountIdsForUser } from '@services/sharing/auth/get-accessible-account-ids.service';

import { destroyTransactions, findTransactions, transactionsInclude, updateTransactions } from './index';
/* eslint-enable import/first */

const NOT_BALANCE_ADJUSTMENT_SQL = `("Transactions"."externalData" IS NULL OR NOT ("Transactions"."externalData" @> '{"balanceAdjustment": true}'))`;

const findAllMock = jest.mocked(Transactions.findAll);
const updateMock = jest.mocked(Transactions.update);
const destroyMock = jest.mocked(Transactions.destroy);
const accessibleAccountIdsMock = jest.mocked(getAccessibleAccountIdsForUser);
const infoMock = jest.mocked(logger.info);
const warnMock = jest.mocked(logger.warn);

const composedAnd = (where: unknown): unknown[] => (where as { [Op.and]: unknown[] })[Op.and];

const literalSql = (fragment: unknown): string => (fragment as { val: string }).val;

const lastUpdateOptions = () => updateMock.mock.calls.at(-1)![1];

const lastDestroyOptions = () => destroyMock.mock.calls.at(-1)![0]!;

const resolveRows = (count: number) =>
  findAllMock.mockResolvedValue(Array.from({ length: count }, (_, index) => ({ id: `tx-${index}` })) as never);

beforeEach(() => {
  jest.clearAllMocks();
  resolveRows(0);
  updateMock.mockResolvedValue([3]);
  destroyMock.mockResolvedValue(2);
});

describe('findTransactions truncation reporting', () => {
  const cappedRead = ({ limit, context }: { limit: number; context?: Record<string, unknown> }) =>
    findTransactions({
      planned: 'exclude',
      access: { creator: 7 },
      balanceAdjustments: 'exclude',
      completeness: { cap: { limit, onTruncated: 'log', context } },
    });

  it('reports a full capped result at info level, with the caller context merged in', async () => {
    resolveRows(2);

    await cappedRead({ limit: 2, context: { userId: 7, source: 'reminders' } });

    expect(warnMock).not.toHaveBeenCalled();
    expect(infoMock).toHaveBeenCalledTimes(1);

    const [message, meta] = infoMock.mock.calls[0]!;

    expect(message).toContain('cap of 2 rows');
    expect(meta).toEqual(expect.objectContaining({ cap: 2, userId: 7, source: 'reminders' }));
    expect(typeof (meta as { caller: unknown }).caller).toBe('string');
  });

  it('stays quiet when the capped result came back short', async () => {
    resolveRows(1);

    await cappedRead({ limit: 2 });

    expect(infoMock).not.toHaveBeenCalled();
  });

  it('stays quiet for reads that state no cap', async () => {
    resolveRows(3);

    await findTransactions({
      planned: 'exclude',
      access: { creator: 7 },
      balanceAdjustments: 'exclude',
      completeness: 'all',
    });

    expect(infoMock).not.toHaveBeenCalled();
  });
});

describe('updateTransactions', () => {
  it('composes the policy fragments before the caller where', async () => {
    await updateTransactions({
      planned: 'exclude',
      access: { creator: 7 },
      balanceAdjustments: 'exclude',
      where: { id: 'tx-1' },
      values: { categoryId: 'cat-1' },
    });

    const fragments = composedAnd(lastUpdateOptions().where);

    expect(fragments).toHaveLength(4);
    expect(fragments[0]).toEqual({ isPlanned: false });
    expect(fragments[1]).toEqual({ userId: 7 });
    expect(literalSql(fragments[2])).toBe(NOT_BALANCE_ADJUSTMENT_SQL);
    expect(fragments[3]).toEqual({ id: 'tx-1' });
  });

  it('honours the optional axes', async () => {
    await updateTransactions({
      planned: 'include',
      access: 'unscoped-internal',
      balanceAdjustments: 'include',
      transfers: 'exclude',
      where: { id: 'tx-1' },
      values: { payeeId: 'payee-1' },
    });

    expect(composedAnd(lastUpdateOptions().where)).toEqual([
      { transferNature: TRANSACTION_TRANSFER_NATURE.not_transfer },
      { id: 'tx-1' },
    ]);
  });

  it('refuses to run when nothing narrows the rows', async () => {
    await expect(
      updateTransactions({
        planned: 'include',
        access: 'unscoped-internal',
        balanceAdjustments: 'include',
        where: {},
        values: { categoryId: 'cat-1' },
      }),
    ).rejects.toThrow(/updateTransactions was called with no effective predicates/);

    expect(updateMock).not.toHaveBeenCalled();
  });

  it('pre-resolves { accessibleTo } into an account scope', async () => {
    accessibleAccountIdsMock.mockResolvedValue(['acc-1', 'acc-2']);

    await updateTransactions({
      planned: 'exclude',
      access: { accessibleTo: 11 },
      balanceAdjustments: 'include',
      where: { id: 'tx-1' },
      values: { payeeId: 'payee-1' },
    });

    expect(accessibleAccountIdsMock).toHaveBeenCalledWith({ userId: 11 });
    expect(composedAnd(lastUpdateOptions().where)[1]).toEqual({ accountId: { [Op.in]: ['acc-1', 'acc-2'] } });
  });

  it('passes the values and the Sequelize write options through untouched', async () => {
    const transaction = { id: 'tx-scope' };
    const values = { categoryId: 'cat-1', payeeLocked: true };

    await updateTransactions({
      planned: 'exclude',
      access: { creator: 7 },
      balanceAdjustments: 'exclude',
      where: { id: 'tx-1' },
      values,
      individualHooks: true,
      returning: true,
      hooks: false,
      fields: ['categoryId'],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      transaction: transaction as any,
    });

    const options = lastUpdateOptions();

    expect(updateMock.mock.calls.at(-1)![0]).toBe(values);
    expect(options.individualHooks).toBe(true);
    expect(options.returning).toBe(true);
    expect(options.hooks).toBe(false);
    expect(options.fields).toEqual(['categoryId']);
    expect(options.transaction).toBe(transaction);
  });

  it('states no hook policy of its own', async () => {
    await updateTransactions({
      planned: 'exclude',
      access: { creator: 7 },
      balanceAdjustments: 'exclude',
      where: { id: 'tx-1' },
      values: { categoryId: 'cat-1' },
    });

    expect('individualHooks' in lastUpdateOptions()).toBe(false);
    expect('hooks' in lastUpdateOptions()).toBe(false);
  });

  it('returns the Sequelize result unchanged', async () => {
    await expect(
      updateTransactions({
        planned: 'exclude',
        access: { creator: 7 },
        balanceAdjustments: 'exclude',
        where: { id: 'tx-1' },
        values: { categoryId: 'cat-1' },
      }),
    ).resolves.toEqual([3]);
  });
});

describe('destroyTransactions', () => {
  it('composes the policy fragments before the caller where', async () => {
    await destroyTransactions({
      planned: 'only',
      access: { creator: 7 },
      balanceAdjustments: 'exclude',
      where: { id: { [Op.in]: ['tx-1', 'tx-2'] } },
    });

    const fragments = composedAnd(lastDestroyOptions().where);

    expect(fragments).toHaveLength(4);
    expect(fragments[0]).toEqual({ isPlanned: true });
    expect(fragments[1]).toEqual({ userId: 7 });
    expect(literalSql(fragments[2])).toBe(NOT_BALANCE_ADJUSTMENT_SQL);
    expect(fragments[3]).toEqual({ id: { [Op.in]: ['tx-1', 'tx-2'] } });
  });

  it('refuses to run when nothing narrows the rows', async () => {
    await expect(
      destroyTransactions({
        planned: 'include',
        access: 'unscoped-internal',
        balanceAdjustments: 'include',
        transfers: 'include',
        where: {},
      }),
    ).rejects.toThrow(/destroyTransactions was called with no effective predicates/);

    expect(destroyMock).not.toHaveBeenCalled();
  });

  it('passes the Sequelize delete options through and forces a hard delete', async () => {
    const transaction = { id: 'tx-scope' };

    await destroyTransactions({
      planned: 'exclude',
      access: { creator: 7 },
      balanceAdjustments: 'include',
      where: { id: 'tx-1' },
      individualHooks: true,
      limit: 10,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      transaction: transaction as any,
    });

    const options = lastDestroyOptions();

    expect(options.individualHooks).toBe(true);
    expect(options.limit).toBe(10);
    expect(options.transaction).toBe(transaction);
    expect(options.force).toBe(true);
  });

  it('states no hook policy of its own', async () => {
    await destroyTransactions({
      planned: 'exclude',
      access: { creator: 7 },
      balanceAdjustments: 'exclude',
      where: { id: 'tx-1' },
    });

    expect('individualHooks' in lastDestroyOptions()).toBe(false);
  });

  it('returns the destroyed row count', async () => {
    await expect(
      destroyTransactions({
        planned: 'exclude',
        access: { creator: 7 },
        balanceAdjustments: 'exclude',
        where: { id: 'tx-1' },
      }),
    ).resolves.toBe(2);
  });
});

describe('transactionsInclude', () => {
  it('states the join type the caller asked for alongside the planned filter', () => {
    const include = transactionsInclude({ planned: 'exclude', required: true, as: 'transactions' }) as IncludeOptions;

    expect(include.model).toBe(Transactions);
    expect(include.required).toBe(true);
    expect(composedAnd(include.where)).toEqual([{ isPlanned: false }]);
  });

  it('still states the join type when the policy filters nothing', () => {
    const include = transactionsInclude({ planned: 'include', required: false }) as IncludeOptions;

    expect(include.required).toBe(false);
    expect('where' in include).toBe(false);
  });
});
