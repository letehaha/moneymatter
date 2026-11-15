import { DEFAULT_FILTERS, type FiltersStruct } from '@/components/records-filters/const';
import {
  CATEGORIZATION_SOURCE,
  FILTER_OPERATION,
  TRANSACTION_TRANSFER_NATURE,
  TRANSACTION_TYPES,
} from '@bt/shared/types';
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
        excludedTrackerIds: ['b2'],
        transactionType: TRANSACTION_TYPES.expense,
        amountGte: 10,
        amountLte: 99.5,
        search: ' coffee ',
      }),
    });

    expect(context.filters).toEqual({
      accountIds: ['a1'],
      categoryIds: ['c1', 'c2'],
      payeeIds: ['p1'],
      tagIds: ['t1'],
      trackerIds: ['b1'],
      excludedTrackerIds: ['b2'],
      transactionType: 'expense',
      amountGte: 10,
      amountLte: 99.5,
      search: 'coffee',
    });
  });

  it('sends the include, exclude and only filters that are not left at all', () => {
    const context = buildTransactionsChatContext({
      filters: withFilters({
        transferFilter: FILTER_OPERATION.exclude,
        refundFilter: FILTER_OPERATION.only,
        plannedFilter: FILTER_OPERATION.all,
        attachmentFilter: FILTER_OPERATION.only,
        categorizationSource: CATEGORIZATION_SOURCE.ai,
      }),
    });

    expect(context.filters).toEqual({
      transferFilter: 'exclude',
      refundFilter: 'only',
      attachmentFilter: 'only',
      categorizationSource: 'ai',
    });
  });

  it('sends the transfer kinds only when some are deselected', () => {
    const context = buildTransactionsChatContext({
      filters: withFilters({ transferNatures: [TRANSACTION_TRANSFER_NATURE.common_transfer] }),
    });

    expect(context.filters).toEqual({ transferNatures: [TRANSACTION_TRANSFER_NATURE.common_transfer] });
  });

  it('leaves the import batch of a deep link out', () => {
    expect(buildTransactionsChatContext({ filters: withFilters({ batchId: 'batch-1' }) })).toEqual({});
  });

  it('does not send empty lists or blank text', () => {
    const context = buildTransactionsChatContext({ filters: withFilters({ search: '   ', accountIds: [] }) });

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
