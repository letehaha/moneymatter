import { describe, expect, it } from '@jest/globals';

import { mergeUpdateIntoCreate } from './revise-pending-create';

const CREATE = {
  accountId: 'a1',
  amount: 12.5,
  transactionType: 'expense',
  paymentType: 'creditCard',
  transferNature: 'not_transfer',
  time: '2026-10-21T12:00:00Z',
  merchantName: 'Cafe',
  note: 'lunch',
  tagIds: ['t1'],
};

describe('mergeUpdateIntoCreate', () => {
  it('lays the fields the update names over the create and keeps the rest', () => {
    expect(
      mergeUpdateIntoCreate({
        createArgs: CREATE,
        updateArgs: { id: '$proposal:x', time: '2026-10-21T12:25:00Z', amount: 13 },
      }),
    ).toEqual({ ...CREATE, time: '2026-10-21T12:25:00Z', amount: 13 });
  });

  it('never carries the target id into the create', () => {
    expect(mergeUpdateIntoCreate({ createArgs: CREATE, updateArgs: { id: '$proposal:x' } })).not.toHaveProperty('id');
  });

  it('leaves out a field the update clears with null or an empty list', () => {
    const merged = mergeUpdateIntoCreate({ createArgs: CREATE, updateArgs: { id: 'x', note: null, tagIds: [] } });

    expect(merged).not.toHaveProperty('note');
    expect(merged).not.toHaveProperty('tagIds');
  });

  it('swaps the merchant name for a payee id the edit gives', () => {
    const merged = mergeUpdateIntoCreate({ createArgs: CREATE, updateArgs: { id: 'x', payeeId: 'p1' } });

    expect(merged).toMatchObject({ payeeId: 'p1' });
    expect(merged).not.toHaveProperty('merchantName');
  });

  it('keeps the merchant name when the edit clears the payee', () => {
    expect(mergeUpdateIntoCreate({ createArgs: CREATE, updateArgs: { id: 'x', payeeId: null } })).toMatchObject({
      merchantName: 'Cafe',
    });
  });
});
