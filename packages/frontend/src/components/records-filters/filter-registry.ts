import { FILTER_OPERATION } from '@bt/shared/types';

import { DEFAULT_FILTERS, FiltersStruct, SELECTABLE_TRANSFER_NATURES } from './const';

/**
 * Single home for everything the app knows about one transactions filter:
 * whether it currently narrows the result, what removing it resets, and how it
 * appears in the filter-picker menu. The filters toolbar, filter analytics, and
 * the list view's group-dissolving check all derive from this registry, so a
 * new filter needs one entry here (plus its control component) to be wired
 * everywhere – the `Record<..., ...>` typings turn a missing entry into a
 * compile error.
 */

interface FilterDefinition {
  /** True when the filter narrows the result compared to `DEFAULT_FILTERS`. */
  isActive: (filters: FiltersStruct) => boolean;
  /**
   * The list view groups transactions by date, so any active filter that
   * narrows by content (not time) would show misleading partial groups – the
   * list dissolves groups while such a filter is active. Only the date range
   * keeps groups visible.
   */
  dissolvesGroups: boolean;
}

interface ExtraFilterDefinition extends FilterDefinition {
  /** i18n key of the filter's row in the "Filters" picker menu. */
  menuLabelKey: string;
  /** Slice of `FiltersStruct` that removing the filter's chip resets. */
  defaultSlice: () => Partial<FiltersStruct>;
}

/** Filters the user can add to the filter bar via the picker menu. The
 * always-visible search, date range, accounts and categories are not part of this list. */
export const EXTRA_FILTER_KEYS = [
  'type',
  'tags',
  'payees',
  'trackers',
  'amount',
  'transferKinds',
  'refunds',
  'transfers',
  'planned',
  'attachments',
] as const;

export type ExtraFilterKey = (typeof EXTRA_FILTER_KEYS)[number];

/** Always-visible filters plus query-param-only ones (`categorizationSource`
 * and `batchId` come from dashboard/import-history deep links) – present in
 * every view, so the picker menu doesn't offer them. */
const BUILTIN_FILTER_KEYS = ['search', 'date', 'accounts', 'categories', 'categorizationSource', 'batchId'] as const;

type BuiltinFilterKey = (typeof BUILTIN_FILTER_KEYS)[number];

export type FilterKey = ExtraFilterKey | BuiltinFilterKey;

export const EXTRA_FILTERS: Record<ExtraFilterKey, ExtraFilterDefinition> = {
  type: {
    menuLabelKey: 'transactions.filters.menu.type',
    defaultSlice: () => ({ transactionType: DEFAULT_FILTERS.transactionType }),
    isActive: (filters) => filters.transactionType !== null,
    dissolvesGroups: true,
  },
  tags: {
    menuLabelKey: 'transactions.filters.menu.tags',
    defaultSlice: () => ({ tagIds: [] }),
    isActive: (filters) => filters.tagIds.length > 0,
    dissolvesGroups: true,
  },
  payees: {
    menuLabelKey: 'transactions.filters.payees.label',
    defaultSlice: () => ({ payeeIds: [] }),
    isActive: (filters) => filters.payeeIds.length > 0,
    dissolvesGroups: true,
  },
  trackers: {
    menuLabelKey: 'transactions.filters.menu.budgets',
    defaultSlice: () => ({ trackerIds: [] }),
    isActive: (filters) => filters.trackerIds.length > 0,
    dissolvesGroups: true,
  },
  amount: {
    menuLabelKey: 'transactions.filters.menu.amount',
    defaultSlice: () => ({ amountGte: DEFAULT_FILTERS.amountGte, amountLte: DEFAULT_FILTERS.amountLte }),
    isActive: (filters) => filters.amountGte != null || filters.amountLte != null,
    dissolvesGroups: true,
  },
  transferKinds: {
    menuLabelKey: 'transactions.filters.transferNature.label',
    defaultSlice: () => ({ transferNatures: [...SELECTABLE_TRANSFER_NATURES] }),
    isActive: (filters) => filters.transferNatures.length !== SELECTABLE_TRANSFER_NATURES.length,
    dissolvesGroups: true,
  },
  refunds: {
    menuLabelKey: 'transactions.filters.refundsFilter.label',
    defaultSlice: () => ({ refundFilter: DEFAULT_FILTERS.refundFilter }),
    isActive: (filters) => filters.refundFilter !== FILTER_OPERATION.all,
    dissolvesGroups: true,
  },
  transfers: {
    menuLabelKey: 'transactions.filters.transferFilter.label',
    defaultSlice: () => ({ transferFilter: DEFAULT_FILTERS.transferFilter }),
    isActive: (filters) => filters.transferFilter !== FILTER_OPERATION.all,
    dissolvesGroups: true,
  },
  planned: {
    menuLabelKey: 'transactions.filters.plannedFilter.label',
    defaultSlice: () => ({ plannedFilter: DEFAULT_FILTERS.plannedFilter }),
    isActive: (filters) => filters.plannedFilter !== FILTER_OPERATION.all,
    dissolvesGroups: true,
  },
  attachments: {
    menuLabelKey: 'transactions.filters.attachments.label',
    defaultSlice: () => ({ attachmentFilter: DEFAULT_FILTERS.attachmentFilter }),
    isActive: (filters) => filters.attachmentFilter !== FILTER_OPERATION.all,
    dissolvesGroups: true,
  },
};

const BUILTIN_FILTERS: Record<BuiltinFilterKey, FilterDefinition> = {
  search: {
    isActive: (filters) => filters.search.trim().length > 0,
    dissolvesGroups: true,
  },
  date: {
    isActive: (filters) => filters.start != null || filters.end != null,
    dissolvesGroups: false,
  },
  accounts: {
    isActive: (filters) => filters.accountIds.length > 0,
    dissolvesGroups: true,
  },
  categories: {
    isActive: (filters) => filters.categoryIds.length > 0,
    dissolvesGroups: true,
  },
  categorizationSource: {
    isActive: (filters) => filters.categorizationSource !== null,
    dissolvesGroups: true,
  },
  batchId: {
    isActive: (filters) => filters.batchId != null,
    dissolvesGroups: true,
  },
};

export const FILTER_REGISTRY: Record<FilterKey, FilterDefinition> = { ...BUILTIN_FILTERS, ...EXTRA_FILTERS };

/** Whether any group-dissolving (see `dissolvesGroups`) filter is narrowing the result. */
export const isAnyGroupDissolvingFilterActive = (filters: FiltersStruct): boolean =>
  Object.values(FILTER_REGISTRY).some((definition) => definition.dissolvesGroups && definition.isActive(filters));
