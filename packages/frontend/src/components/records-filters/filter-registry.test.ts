import {
  CATEGORIZATION_SOURCE,
  FILTER_OPERATION,
  TRANSACTION_TRANSFER_NATURE,
  TRANSACTION_TYPES,
} from '@bt/shared/types';
import { describe, expect, it } from 'vitest';

import { DEFAULT_FILTERS, FiltersStruct } from './const';
import { EXTRA_FILTERS, FILTER_REGISTRY, isAnyGroupDissolvingFilterActive, type FilterKey } from './filter-registry';

const makeFilters = (overrides: Partial<FiltersStruct> = {}): FiltersStruct => ({
  ...DEFAULT_FILTERS,
  ...overrides,
});

/** One narrowing value per filter – keys must stay in sync with the registry. */
const NARROWING_EXAMPLES: Record<FilterKey, Partial<FiltersStruct>> = {
  search: { search: 'coffee' },
  date: { start: new Date('2026-01-01') },
  accounts: { accountIds: ['acc-1'] },
  categories: { categoryIds: ['cat-1'] },
  categorizationSource: { categorizationSource: CATEGORIZATION_SOURCE.ai },
  batchId: { batchId: 'batch-1' },
  type: { transactionType: TRANSACTION_TYPES.expense },
  tags: { tagIds: ['tag-1'] },
  payees: { payeeIds: ['payee-1'] },
  trackers: { trackerIds: ['tracker-1'] },
  amount: { amountGte: 10 },
  transferKinds: { transferNatures: [TRANSACTION_TRANSFER_NATURE.common_transfer] },
  refunds: { refundFilter: FILTER_OPERATION.exclude },
  transfers: { transferFilter: FILTER_OPERATION.only },
  planned: { plannedFilter: FILTER_OPERATION.only },
  attachments: { attachmentFilter: FILTER_OPERATION.only },
};

const REGISTRY_ENTRIES = Object.entries(FILTER_REGISTRY) as [FilterKey, (typeof FILTER_REGISTRY)[FilterKey]][];

describe('FILTER_REGISTRY', () => {
  describe('isActive', () => {
    it.each(REGISTRY_ENTRIES)('"%s" is inactive on default filters', (_key, definition) => {
      expect(definition.isActive(makeFilters())).toBe(false);
    });

    it.each(REGISTRY_ENTRIES)('"%s" is active on its narrowing example', (key, definition) => {
      expect(definition.isActive(makeFilters(NARROWING_EXAMPLES[key]))).toBe(true);
    });

    it('treats a whitespace-only search as inactive', () => {
      expect(FILTER_REGISTRY.search.isActive(makeFilters({ search: '   ' }))).toBe(false);
    });
  });

  describe('defaultSlice', () => {
    const EXTRA_ENTRIES = Object.entries(EXTRA_FILTERS) as [
      keyof typeof EXTRA_FILTERS,
      (typeof EXTRA_FILTERS)[keyof typeof EXTRA_FILTERS],
    ][];

    it.each(EXTRA_ENTRIES)('"%s": applying the slice deactivates the filter', (key, definition) => {
      const narrowed = makeFilters(NARROWING_EXAMPLES[key]);
      expect(definition.isActive(narrowed)).toBe(true);

      const reset = { ...narrowed, ...definition.defaultSlice() };
      expect(definition.isActive(reset)).toBe(false);
    });
  });
});

describe('isAnyGroupDissolvingFilterActive', () => {
  it('returns false on default filters', () => {
    expect(isAnyGroupDissolvingFilterActive(makeFilters())).toBe(false);
  });

  it('returns false when only the date range is set – groups are date-based', () => {
    expect(
      isAnyGroupDissolvingFilterActive(makeFilters({ start: new Date('2026-01-01'), end: new Date('2026-02-01') })),
    ).toBe(false);
  });

  const CONTENT_FILTER_KEYS = (Object.keys(NARROWING_EXAMPLES) as FilterKey[]).filter(
    (key) => FILTER_REGISTRY[key].dissolvesGroups,
  );

  it.each(CONTENT_FILTER_KEYS)('returns true when "%s" narrows the result', (key) => {
    expect(isAnyGroupDissolvingFilterActive(makeFilters(NARROWING_EXAMPLES[key]))).toBe(true);
  });
});
