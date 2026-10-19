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

export type TrendsFilterGroupKey = 'categories' | 'payees' | 'tags';

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

export const toStatsFilterParams = ({ filters }: { filters: TrendsFilters }): StatsFilterParams => {
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
  apply({ group: filters.payees, includeKey: 'payeeIds', excludeKey: 'excludedPayeeIds' });
  apply({ group: filters.tags, includeKey: 'tagIds', excludeKey: 'excludedTagIds' });

  if (filters.accountIds.length > 0) params.accountIds = filters.accountIds;

  return params;
};

export const countActiveFilters = ({ filters }: { filters: TrendsFilters }): number =>
  [filters.categories.ids, filters.payees.ids, filters.tags.ids, filters.accountIds].filter((ids) => ids.length > 0)
    .length;

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
