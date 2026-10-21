import { DEFAULT_FILTERS, type FiltersStruct } from '@/components/records-filters/const';
import { TRANSACTION_TYPES } from '@bt/shared/types';
import { describe, expect, it } from 'vitest';

import { buildTransactionsChatContext } from './transaction-filters-context';

const withFilters = (overrides: Partial<FiltersStruct>): FiltersStruct => ({ ...DEFAULT_FILTERS, ...overrides });

describe('buildTransactionsChatContext', () => {
  it('has nothing to tell for the default filters', () => {
    expect(buildTransactionsChatContext({ filters: DEFAULT_FILTERS })).toEqual({});
  });

  it('sends the period as calendar dates', () => {
    const context = buildTransactionsChatContext({
      filters: withFilters({ start: new Date(2026, 2, 1), end: new Date(2026, 2, 31) }),
    });

    expect(context).toEqual({ period: { from: '2026-03-01', to: '2026-03-31' } });
  });

  it('leaves a period with only one end out', () => {
    expect(buildTransactionsChatContext({ filters: withFilters({ start: new Date(2026, 2, 1) }) })).toEqual({});
  });

  it('sends the filters that narrow the list under the keys the server checks for ownership', () => {
    const context = buildTransactionsChatContext({
      filters: withFilters({
        accountIds: ['a1'],
        categoryIds: ['c1', 'c2'],
        payeeIds: ['p1'],
        tagIds: ['t1'],
        trackerIds: ['b1'],
        transactionType: TRANSACTION_TYPES.expense,
        amountGte: 10,
        amountLte: 99.5,
        noteIncludes: 'coffee',
      }),
    });

    expect(context.filters).toEqual({
      accountIds: ['a1'],
      categoryIds: ['c1', 'c2'],
      payeeIds: ['p1'],
      tagIds: ['t1'],
      trackerIds: ['b1'],
      transactionType: 'expense',
      amountGte: 10,
      amountLte: 99.5,
      noteIncludes: 'coffee',
    });
  });

  it('does not send empty lists or blank text', () => {
    const context = buildTransactionsChatContext({ filters: withFilters({ noteIncludes: '   ', accountIds: [] }) });

    expect(context).toEqual({});
  });

  it('keeps only the first ids of a very long list so the context stays small', () => {
    const ids = Array.from({ length: 120 }, (_, index) => `id-${index}`);

    const context = buildTransactionsChatContext({ filters: withFilters({ categoryIds: ids }) });

    const sent = context.filters?.categoryIds as string[];

    expect(sent).toHaveLength(50);
    expect(sent[0]).toBe('id-0');
  });
});
