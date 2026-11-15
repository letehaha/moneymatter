import { describe, expect, it } from 'vitest';

import { summaryFields } from './card-summary';
import { buildCard, buildField } from './card-test-fixtures';

const pathsOf = ({ fields }: { fields: { path: string }[] }) => fields.map((field) => field.path);

describe('summaryFields', () => {
  it('names a transaction by date, amount, payee and account, in that order', () => {
    const card = buildCard({
      fields: [
        buildField({ path: 'accountId', value: 'acc-1' }),
        buildField({ path: 'note', value: 'Lunch' }),
        buildField({ path: 'payeeId', value: 'payee-1' }),
        buildField({ path: 'amount', value: 12.5 }),
        buildField({ path: 'time', value: '2026-10-19T07:26:00Z' }),
        buildField({ path: 'categoryId', value: 'cat-1' }),
      ],
    });

    expect(pathsOf({ fields: summaryFields({ card }) })).toEqual(['time', 'amount', 'payeeId', 'accountId']);
  });

  it('takes the note when the record has no payee', () => {
    const card = buildCard({
      fields: [buildField({ path: 'amount', value: 12.5 }), buildField({ path: 'note', value: 'Lunch' })],
    });

    expect(pathsOf({ fields: summaryFields({ card }) })).toEqual(['amount', 'note']);
  });

  it('names the record an update targets, not the fields it changes', () => {
    const card = buildCard({
      kind: 'update',
      fields: [buildField({ path: 'categoryId', value: 'cat-2' }), buildField({ path: 'note', value: 'Dinner' })],
      target: [buildField({ path: 'amount', value: 28.1 }), buildField({ path: 'note', value: 'Nord Coffee' })],
    });

    expect(summaryFields({ card }).map((field) => field.value)).toEqual([28.1, 'Nord Coffee']);
  });

  it('matches a nested argument by its last segment and skips empty values', () => {
    const card = buildCard({
      fields: [
        buildField({ path: 'transaction.amount', value: 5 }),
        buildField({ path: 'payeeId', value: null }),
        buildField({ path: 'note', value: '' }),
      ],
    });

    expect(pathsOf({ fields: summaryFields({ card }) })).toEqual(['transaction.amount']);
  });

  it('falls back to the first fields of a card none of whose fields names a record', () => {
    const card = buildCard({
      kind: 'action',
      fields: [
        buildField({ path: 'categoryIds', value: ['cat-1'] }),
        buildField({ path: 'isEnabled', value: true }),
        buildField({ path: 'mode', value: 'auto' }),
      ],
    });

    expect(pathsOf({ fields: summaryFields({ card }) })).toEqual(['categoryIds', 'isEnabled']);
  });
});
