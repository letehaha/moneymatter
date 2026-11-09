import { type MetricType, metricTransactionType } from '@/common/utils/analytics-metric';
import { type CategoryNode, collectSubtreeIds, getLevelCategoryIds } from '@/common/utils/category-tree';
import type { TrendsDeepLink } from '@/common/utils/trends-deep-link';

export interface FilterGroup {
  mode: 'include' | 'exclude';
  ids: string[];
}

export interface TrendsFilters {
  categories: FilterGroup;
  payees: FilterGroup;
  tags: FilterGroup;
  accountIds: string[];
}

export type TrendsFilterGroupKey = 'payees' | 'tags';

export const emptyTrendsFilters = (): TrendsFilters => ({
  categories: { mode: 'include', ids: [] },
  payees: { mode: 'include', ids: [] },
  tags: { mode: 'include', ids: [] },
  accountIds: [],
});

interface StatsFilterParams {
  categoryIds?: string[];
  excludedCategoryIds?: string[];
  payeeIds?: string[];
  excludedPayeeIds?: string[];
  tagIds?: string[];
  excludedTagIds?: string[];
  accountIds?: string[];
}

/** The one category the page is drilled into, if the selection is exactly one included category. */
export const getScopeCategoryId = ({ filters }: { filters: TrendsFilters }): string | undefined => {
  const { mode, ids } = filters.categories;
  return mode === 'include' && ids.length === 1 ? ids[0] : undefined;
};

/** `detail` sends every category in the selection, so each comes back with only its own amount. */
export const toStatsFilterParams = ({
  filters,
  categories = [],
  detail = false,
}: {
  filters: TrendsFilters;
  categories?: CategoryNode[];
  detail?: boolean;
}): StatsFilterParams => {
  const params: StatsFilterParams = {};

  const apply = ({
    group,
    includeKey,
    excludeKey,
  }: {
    group: FilterGroup;
    includeKey: keyof StatsFilterParams;
    excludeKey: keyof StatsFilterParams;
  }) => {
    if (group.ids.length === 0) return;
    params[group.mode === 'exclude' ? excludeKey : includeKey] = group.ids;
  };

  apply({ group: filters.categories, includeKey: 'categoryIds', excludeKey: 'excludedCategoryIds' });
  const scopeId = getScopeCategoryId({ filters });
  if (scopeId) {
    params.categoryIds = getLevelCategoryIds({ scopeId, categories });
  }

  if (detail) {
    delete params.excludedCategoryIds;
    params.categoryIds =
      getTransactionCategoryIds({ filters, categories }) ?? categories.map((category) => category.id);
  }

  apply({ group: filters.payees, includeKey: 'payeeIds', excludeKey: 'excludedPayeeIds' });
  apply({ group: filters.tags, includeKey: 'tagIds', excludeKey: 'excludedTagIds' });

  if (filters.accountIds.length > 0) params.accountIds = filters.accountIds;

  return params;
};

/** Categories live in the category bar, so the Filters badge counts only the other groups. */
export const countActiveFilters = ({ filters }: { filters: TrendsFilters }): number =>
  [filters.payees.ids, filters.tags.ids, filters.accountIds].filter((ids) => ids.length > 0).length;

/** Category ids for the Transactions list, which has no exclude param and no roll-up. */
export const getTransactionCategoryIds = ({
  filters,
  categories,
}: {
  filters: TrendsFilters;
  categories: CategoryNode[];
}): string[] | undefined => {
  const { mode, ids } = filters.categories;
  if (ids.length === 0) return undefined;

  const subtrees = new Set(ids.flatMap((rootId) => collectSubtreeIds({ rootId, categories })));
  if (mode === 'include') return [...subtrees];
  return categories.filter((c) => !subtrees.has(c.id)).map((c) => c.id);
};

/** Only what the Transactions page reads from its URL; payees and tags have no param there. */
export const toTransactionFilterParams = ({
  filters,
  categories,
  metric,
}: {
  filters: TrendsFilters;
  categories: CategoryNode[];
  metric: MetricType;
}) => {
  const categoryIds = getTransactionCategoryIds({ filters, categories });
  return {
    ...(categoryIds && { categoryIds }),
    ...(filters.accountIds.length > 0 && { accountIds: filters.accountIds }),
    transactionType: metricTransactionType({ metric }),
  };
};

export const scopeTo = ({
  filters,
  categoryIds,
}: {
  filters: TrendsFilters;
  categoryIds: string[];
}): TrendsFilters => ({
  ...filters,
  categories: { mode: 'include', ids: categoryIds },
});

/** A link with `metric` replaces every filter; without it, `categoryIds` only rescope the current filters. */
export const filtersFromDeepLink = ({
  filters,
  link,
}: {
  filters: TrendsFilters;
  link: Pick<TrendsDeepLink, 'categoryIds' | 'excludedCategoryIds' | 'metric'>;
}): TrendsFilters => {
  const { categoryIds, excludedCategoryIds, metric } = link;

  if (!metric) return categoryIds.length > 0 ? scopeTo({ filters, categoryIds }) : filters;

  const empty = emptyTrendsFilters();
  if (categoryIds.length > 0) return scopeTo({ filters: empty, categoryIds });
  if (excludedCategoryIds.length > 0) return { ...empty, categories: { mode: 'exclude', ids: excludedCategoryIds } };
  return empty;
};

export const hideCategory = ({
  filters,
  categoryId,
}: {
  filters: TrendsFilters;
  categoryId: string;
}): TrendsFilters => {
  const { categories } = filters;

  if (categories.mode === 'exclude') {
    if (categories.ids.includes(categoryId)) return filters;
    return { ...filters, categories: { mode: 'exclude', ids: [...categories.ids, categoryId] } };
  }

  const remaining = categories.ids.filter((id) => id !== categoryId);

  // An empty include list means "all categories", so the only way to drop one is to flip to exclude.
  if (remaining.length === 0) {
    return { ...filters, categories: { mode: 'exclude', ids: [categoryId] } };
  }

  return { ...filters, categories: { mode: 'include', ids: remaining } };
};

export const showCategory = ({
  filters,
  categoryId,
}: {
  filters: TrendsFilters;
  categoryId: string;
}): TrendsFilters => {
  const { categories } = filters;
  if (categories.mode !== 'exclude') return filters;
  return { ...filters, categories: { mode: 'exclude', ids: categories.ids.filter((id) => id !== categoryId) } };
};

const isFilterGroup = (value: unknown): value is FilterGroup => {
  const group = value as FilterGroup | null;
  return (
    typeof group === 'object' &&
    group !== null &&
    (group.mode === 'include' || group.mode === 'exclude') &&
    Array.isArray(group.ids) &&
    group.ids.every((id) => typeof id === 'string')
  );
};

/** Session-storage reader: anything that isn't the current shape starts over from empty. */
export const parseTrendsFilters = ({ raw }: { raw: string }): TrendsFilters => {
  try {
    const parsed = JSON.parse(raw) as TrendsFilters;
    const isValid =
      isFilterGroup(parsed?.categories) &&
      isFilterGroup(parsed.payees) &&
      isFilterGroup(parsed.tags) &&
      Array.isArray(parsed.accountIds) &&
      parsed.accountIds.every((id) => typeof id === 'string');

    return isValid ? parsed : emptyTrendsFilters();
  } catch {
    return emptyTrendsFilters();
  }
};
