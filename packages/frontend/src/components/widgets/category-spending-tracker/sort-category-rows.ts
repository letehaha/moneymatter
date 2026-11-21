export const CATEGORY_SORT_OPTIONS = ['custom', 'spend-desc', 'spend-asc'] as const;

export type CategorySort = (typeof CATEGORY_SORT_OPTIONS)[number];

export const CATEGORY_SORT_LABELS: Record<CategorySort, string> = {
  custom: 'dashboard.widgets.categoryTracker.sort.custom',
  'spend-desc': 'dashboard.widgets.categoryTracker.sort.spendDesc',
  'spend-asc': 'dashboard.widgets.categoryTracker.sort.spendAsc',
};

export const readCategorySort = ({ config }: { config: Record<string, unknown> | undefined }): CategorySort =>
  CATEGORY_SORT_OPTIONS.find((option) => option === config?.sortBy) ?? 'custom';

/** `getAmount` is signed with expenses negative, so net-income rows rank below every spending one. */
export const sortCategoryRows = <T>({
  rows,
  sortBy,
  getAmount,
}: {
  rows: T[];
  sortBy: CategorySort;
  getAmount: (row: T) => number;
}): T[] => {
  if (sortBy === 'custom') return rows;

  const direction = sortBy === 'spend-desc' ? 1 : -1;
  return [...rows].sort((a, b) => direction * (getAmount(a) - getAmount(b)));
};
