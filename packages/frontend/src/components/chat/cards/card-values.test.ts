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

  it.each(['originalPrincipal', 'minPayment', 'plannedPayment', 'purchasePrice'])(
    'takes %s of a new record from the currency argument of the card',
    (path) => {
      const card = buildCard({ fields: [buildField({ path: 'currencyCode', value: 'EUR' })] });

      expect(moneyCurrencyOf({ card, path, accountCurrency, baseCurrencyCode: 'CAD' })).toBe('EUR');
    },
  );

  it('reads the threshold of a tag reminder in the base currency', () => {
    const card = buildCard({ fields: [buildField({ path: 'amountThreshold', value: 250 })] });

    expect(moneyCurrencyOf({ card, path: 'amountThreshold', accountCurrency, baseCurrencyCode: 'CAD' })).toBe('CAD');
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

  it('uses the expected currency for an expected amount, over the account and the base currency', () => {
    const card = buildCard({
      fields: [
        buildField({ path: 'expectedCurrencyCode', value: 'GEL' }),
        buildField({ path: 'accountId', value: 'usd' }),
      ],
    });

    expect(moneyCurrencyOf({ card, path: 'expectedAmount', accountCurrency, baseCurrencyCode: 'USD' })).toBe('GEL');
  });

  it('reads the values it is given over the ones on the card', () => {
    const card = buildCard({ fields: [buildField({ path: 'currencyCode', value: 'GBP' })] });

    const values = { currencyCode: 'JPY' };

    expect(moneyCurrencyOf({ card, values, path: 'amount', accountCurrency, baseCurrencyCode: null })).toBe('JPY');
  });

  describe('on a card whose amount the server states the currency of', () => {
    const stated = ({ path }: { path: string }) =>
      buildField({ path, value: 25, display: { kind: 'money', currencyCode: 'GEL' } });

    it('uses the stated currency over the base currency', () => {
      const card = buildCard({ fields: [stated({ path: 'currentBalance' })] });

      expect(moneyCurrencyOf({ card, path: 'currentBalance', accountCurrency, baseCurrencyCode: 'USD' })).toBe('GEL');
    });

    it('gives way to an account the form picks', () => {
      const card = buildCard({ fields: [stated({ path: 'destinationAmount' })] });
      const values = { destinationAccountId: 'eur' };

      expect(
        moneyCurrencyOf({ card, values, path: 'destinationAmount', accountCurrency, baseCurrencyCode: 'USD' }),
      ).toBe('EUR');
    });
  });

  describe('on a card that targets a stored record', () => {
    const stored = ({ path, currencyCode }: { path: string; currencyCode: string }) =>
      buildField({ path, value: 25, display: { kind: 'money', currencyCode } });

    it('uses the currency of the record when the card names none', () => {
      const card = buildCard({ target: [stored({ path: 'amount', currencyCode: 'GEL' })] });

      expect(moneyCurrencyOf({ card, path: 'amount', accountCurrency, baseCurrencyCode: 'USD' })).toBe('GEL');
    });

    it('prefers the currency the card names', () => {
      const card = buildCard({
        fields: [buildField({ path: 'expectedCurrencyCode', value: 'EUR' })],
        target: [stored({ path: 'expectedAmount', currencyCode: 'USD' })],
      });

      expect(moneyCurrencyOf({ card, path: 'expectedAmount', accountCurrency, baseCurrencyCode: 'CAD' })).toBe('EUR');
    });

    it('prefers the account an amount moves to', () => {
      const card = buildCard({
        fields: [buildField({ path: 'accountId', value: 'eur' })],
        target: [stored({ path: 'amount', currencyCode: 'USD' })],
      });

      expect(moneyCurrencyOf({ card, path: 'amount', accountCurrency, baseCurrencyCode: 'CAD' })).toBe('EUR');
    });

    it('keeps an amount with a currency of its own in the stored one, whichever account the card names', () => {
      const card = buildCard({
        fields: [buildField({ path: 'accountId', value: 'eur' })],
        target: [stored({ path: 'expectedAmount', currencyCode: 'USD' })],
      });

      expect(moneyCurrencyOf({ card, path: 'expectedAmount', accountCurrency, baseCurrencyCode: 'CAD' })).toBe('USD');
    });

    it('does not guess from the record when the account is a card not applied yet', () => {
      const card = buildCard({
        fields: [buildField({ path: 'accountId', value: '$proposal:p1' })],
        target: [stored({ path: 'amount', currencyCode: 'USD' })],
      });

      expect(moneyCurrencyOf({ card, path: 'amount', accountCurrency, baseCurrencyCode: 'CAD' })).toBe('CAD');
    });

    it('stays in the stored currency when the account argument only names the record', () => {
      const card = buildCard({
        fields: [{ ...buildField({ path: 'accountId', value: 'eur' }), namesRecord: true as const }],
        target: [stored({ path: 'amount', currencyCode: 'USD' })],
      });

      expect(moneyCurrencyOf({ card, path: 'amount', accountCurrency, baseCurrencyCode: 'CAD' })).toBe('USD');
    });
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
