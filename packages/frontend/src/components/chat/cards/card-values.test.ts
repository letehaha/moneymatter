import { describe, expect, it } from 'vitest';

import { buildCard, buildField } from './card-test-fixtures';
import {
  buildEditedArgs,
  cardArgsOf,
  fieldEntityKind,
  isProposalRef,
  moneyCurrencyOf,
  proposalRefId,
  replaceArg,
  summarizeValue,
} from './card-values';

const accountCurrency = ({ id }: { id: string }) => ({ usd: 'USD', eur: 'EUR' })[id] ?? null;

describe('proposal refs', () => {
  it('recognizes a $proposal ref and reads its id', () => {
    expect(isProposalRef({ value: '$proposal:abc' })).toBe(true);
    expect(proposalRefId({ value: '$proposal:abc' })).toBe('abc');
    expect(isProposalRef({ value: 'abc' })).toBe(false);
    expect(isProposalRef({ value: 5 })).toBe(false);
    expect(proposalRefId({ value: null })).toBeNull();
  });
});

describe('cardArgsOf and replaceArg', () => {
  const card = buildCard({
    fields: [buildField({ path: 'amount', value: 12 }), buildField({ path: 'note', value: 'Lunch' })],
  });

  it('rebuilds the argument set from the fields', () => {
    expect(cardArgsOf({ card })).toEqual({ amount: 12, note: 'Lunch' });
  });

  it('replaces one argument and keeps the rest', () => {
    expect(replaceArg({ card, path: 'note', value: 'Dinner' })).toEqual({ amount: 12, note: 'Dinner' });
  });
});

describe('buildEditedArgs', () => {
  const card = buildCard({
    fields: [
      buildField({ path: 'amount', value: 12 }),
      buildField({ path: 'note', value: 'Lunch' }),
      buildField({ path: 'tagIds', value: ['t1', 't2'] }),
    ],
  });

  it('reports only the fields whose draft value differs', () => {
    const { args, changed } = buildEditedArgs({ card, draft: { amount: 12, note: 'Dinner', tagIds: ['t1', 't2'] } });

    expect(changed).toEqual(['note']);
    expect(args).toEqual({ amount: 12, note: 'Dinner', tagIds: ['t1', 't2'] });
  });

  it('compares arrays by content, not identity', () => {
    expect(buildEditedArgs({ card, draft: { tagIds: ['t1', 't2'] } }).changed).toEqual([]);
    expect(buildEditedArgs({ card, draft: { tagIds: ['t1'] } }).changed).toEqual(['tagIds']);
  });

  it('ignores a draft key that is not a field of the card', () => {
    expect(buildEditedArgs({ card, draft: { extra: 1 } })).toEqual({
      args: { amount: 12, note: 'Lunch', tagIds: ['t1', 't2'] },
      changed: [],
    });
  });
});

describe('fieldEntityKind', () => {
  it('reads the entity from the editor or the display', () => {
    expect(
      fieldEntityKind({ field: buildField({ path: 'categoryId', editable: { type: 'entity', entity: 'category' } }) }),
    ).toBe('category');
    expect(
      fieldEntityKind({
        field: buildField({
          path: 'x',
          editable: null,
          display: { kind: 'entity', entity: { kind: 'loan', id: '1', label: 'Car loan' } },
        }),
      }),
    ).toBe('loan');
    expect(fieldEntityKind({ field: buildField({ path: 'note' }) })).toBeNull();
  });
});

describe('moneyCurrencyOf', () => {
  it('uses the card currencyCode field first', () => {
    const card = buildCard({
      fields: [buildField({ path: 'currencyCode', value: 'GBP' }), buildField({ path: 'accountId', value: 'usd' })],
    });

    expect(moneyCurrencyOf({ card, path: 'amount', accountCurrency, baseCurrencyCode: 'CAD' })).toBe('GBP');
  });

  it('uses the account currency, and the destination account for a destination amount', () => {
    const card = buildCard({
      fields: [
        buildField({ path: 'accountId', value: 'usd' }),
        buildField({ path: 'destinationAccountId', value: 'eur' }),
      ],
    });

    expect(moneyCurrencyOf({ card, path: 'amount', accountCurrency, baseCurrencyCode: 'CAD' })).toBe('USD');
    expect(moneyCurrencyOf({ card, path: 'destinationAmount', accountCurrency, baseCurrencyCode: 'CAD' })).toBe('EUR');
  });

  it('uses the original currency for an original amount', () => {
    const card = buildCard({
      fields: [
        buildField({ path: 'originalCurrencyCode', value: 'JPY' }),
        buildField({ path: 'accountId', value: 'usd' }),
      ],
    });

    expect(moneyCurrencyOf({ card, path: 'originalAmount', accountCurrency, baseCurrencyCode: null })).toBe('JPY');
  });

  it('falls back to the base currency, then to none', () => {
    const card = buildCard({ fields: [buildField({ path: 'accountId', value: '$proposal:p1' })] });

    expect(moneyCurrencyOf({ card, path: 'amount', accountCurrency, baseCurrencyCode: 'CAD' })).toBe('CAD');
    expect(moneyCurrencyOf({ card, path: 'amount', accountCurrency, baseCurrencyCode: null })).toBeNull();
  });
});

describe('summarizeValue', () => {
  it('shows scalars as text and structures as compact JSON', () => {
    expect(summarizeValue({ value: 'Lunch' })).toBe('Lunch');
    expect(summarizeValue({ value: 5 })).toBe('5');
    expect(summarizeValue({ value: { a: 1 } })).toBe('{"a":1}');
    expect(summarizeValue({ value: ['a', 'b'] })).toBe('a, b');
    expect(summarizeValue({ value: null })).toBe('');
  });

  it('cuts a long structure', () => {
    const text = summarizeValue({ value: { text: 'x'.repeat(500) } });

    expect(text.length).toBeLessThanOrEqual(121);
    expect(text.endsWith('…')).toBe(true);
  });
});
