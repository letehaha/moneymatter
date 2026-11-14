import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Op } from 'sequelize';

// The module under test only needs the boundary and the models as call targets; stubbing them
// keeps this run free of the database connection their real import graph opens.
jest.mock('@models/accounts.model', () => ({ __esModule: true, default: { name: 'Accounts' } }));
jest.mock('@models/transactions.model', () => ({ __esModule: true, default: { name: 'Transactions' } }));
jest.mock('@models/transactions-query', () => ({ __esModule: true, findTransactions: jest.fn() }));
jest.mock('./category-allocation', () => ({ __esModule: true, resolveRefundPairs: jest.fn() }));

/* eslint-disable import/first */
import { findTransactions } from '@models/transactions-query';

import { statsTransactions } from './stats-transactions';
/* eslint-enable import/first */

const findTransactionsMock = jest.mocked(findTransactions);

type TimeBounds = { [Op.gte]?: Date; [Op.lte]?: Date };

const lastWhere = () =>
  findTransactionsMock.mock.calls.at(-1)![0]!.where as unknown as { [Op.and]: unknown[] } | undefined;

const readWindow = async ({ from, to }: { from?: string | Date; to?: string | Date }): Promise<TimeBounds> => {
  await statsTransactions({ access: { creator: 7 }, planned: 'exclude', refunds: 'ignore', window: { from, to } });

  return (lastWhere()![Op.and][0] as { time: TimeBounds }).time;
};

beforeEach(() => {
  jest.clearAllMocks();
  findTransactionsMock.mockResolvedValue([]);
});

describe('statsTransactions window bounds', () => {
  it('covers the whole of the closing day when both ends are day strings', async () => {
    const bounds = await readWindow({ from: '2026-01-01', to: '2026-01-31' });

    expect(bounds[Op.gte]).toEqual(new Date('2026-01-01T00:00:00.000Z'));
    expect(bounds[Op.lte]).toEqual(new Date('2026-01-31T23:59:59.999Z'));
  });

  it('stops at midnight for a day string that closes nothing', async () => {
    // An open-start window keeps the bare midnight bound, so the closing day contributes only a
    // transaction stamped exactly midnight — the semantics every stats report was built against.
    const bounds = await readWindow({ to: '2026-01-31' });

    expect(bounds[Op.lte]).toEqual(new Date('2026-01-31T00:00:00.000Z'));
    expect(bounds[Op.gte]).toBeUndefined();
  });

  it('leaves an exact Date bound alone whether or not it closes a range', async () => {
    const to = new Date('2026-01-31T09:30:00.000Z');

    expect((await readWindow({ from: new Date('2026-01-01T08:00:00.000Z'), to }))[Op.lte]).toEqual(to);
    expect((await readWindow({ to }))[Op.lte]).toEqual(to);
  });

  it('opens the end when only a start is given', async () => {
    const bounds = await readWindow({ from: '2026-01-01' });

    expect(bounds[Op.gte]).toEqual(new Date('2026-01-01T00:00:00.000Z'));
    expect(bounds[Op.lte]).toBeUndefined();
  });

  it('states the money-movement clause and the reporting opt-out for an unbounded window', async () => {
    await statsTransactions({ access: { creator: 7 }, planned: 'exclude', refunds: 'ignore', window: {} });

    const fragments = lastWhere()![Op.and];
    expect(fragments).toHaveLength(2);
    expect(Object.getOwnPropertySymbols(fragments[0]!)).toContain(Op.or);
    expect(Object.getOwnPropertySymbols(fragments[1]!)).toContain(Op.and);
  });
});
