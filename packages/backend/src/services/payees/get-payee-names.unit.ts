import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import Payees from '@models/payees.model';
import { Op } from 'sequelize';

import { getPayeeNames } from './get-payee-names';

jest.mock('@models/payees.model', () => ({ __esModule: true, default: { findAll: jest.fn() } }));

const findAll = jest.mocked(Payees.findAll);

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

beforeEach(() => {
  jest.resetAllMocks();
});

describe('getPayeeNames', () => {
  it('reads every name in one query scoped to the caller', async () => {
    findAll.mockResolvedValue([
      { id: A, name: 'Starbucks' },
      { id: B, name: 'Lidl' },
    ] as never);

    const names = await getPayeeNames({ userId: 42, payeeIds: [A, B] });

    expect(findAll).toHaveBeenCalledTimes(1);
    expect(findAll).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 42, id: { [Op.in]: [A, B] } }, raw: true }),
    );
    expect(names).toEqual(
      new Map([
        [A, 'Starbucks'],
        [B, 'Lidl'],
      ]),
    );
  });

  it('leaves out an id that is not the caller own: the scoped query does not return it', async () => {
    findAll.mockResolvedValue([{ id: A, name: 'Starbucks' }] as never);

    const names = await getPayeeNames({ userId: 42, payeeIds: [A, B] });

    expect(names.get(A)).toBe('Starbucks');
    expect(names.has(B)).toBe(false);
  });

  it('asks for each id once', async () => {
    findAll.mockResolvedValue([] as never);

    await getPayeeNames({ userId: 42, payeeIds: [A, A, B] });

    expect(findAll).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: 42, id: { [Op.in]: [A, B] } } }));
  });

  it('does not query when there is nothing to look up', async () => {
    const names = await getPayeeNames({ userId: 42, payeeIds: [] });

    expect(names.size).toBe(0);
    expect(findAll).not.toHaveBeenCalled();
  });
});
