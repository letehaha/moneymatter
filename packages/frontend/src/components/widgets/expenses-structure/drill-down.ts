import type { MetricType } from '@/common/utils/analytics-metric';
import { collectSubtreeIds, getAncestors, getLevelCategoryIds } from '@/common/utils/category-tree';
import type { TrendsLocationInput } from '@/common/utils/trends-deep-link';
import type { DonutChartItem } from '@/components/common/charts/donut-chart-item';
import { assignSiblingColors } from '@/composable/charts/assign-sibling-colors';
import type { Period } from '@/composable/use-period-navigation';

type CategoryInfo = { id: string; name: string; color: string; parentId: string | null };
type CategoriesMap = Record<string, CategoryInfo>;
type Spendings = Record<string, { name: string; color: string; amount: number }>;

const getKeptRows = ({ spendings, excludedCategoryIds }: { spendings: Spendings; excludedCategoryIds: string[] }) =>
  Object.entries(spendings).filter(([id, value]) => !excludedCategoryIds.includes(id) && value.amount > 0);

export const getLevelTotal = ({
  spendings,
  excludedCategoryIds,
}: {
  spendings: Spendings;
  excludedCategoryIds: string[];
}): number => getKeptRows({ spendings, excludedCategoryIds }).reduce((sum, [, value]) => sum + value.amount, 0);

export const buildLevelSlices = ({
  spendings,
  drilledCategoryId,
  categoriesMap,
  excludedCategoryIds,
}: {
  spendings: Spendings;
  drilledCategoryId: string | null;
  categoriesMap: CategoriesMap;
  excludedCategoryIds: string[];
}): DonutChartItem[] => {
  const categories = Object.values(categoriesMap);
  const isDrillable = ({ categoryId }: { categoryId: string }) =>
    getLevelCategoryIds({ scopeId: categoryId, categories, excludedIds: excludedCategoryIds }).length > 1;

  const slices = getKeptRows({ spendings, excludedCategoryIds }).map(([id, value]) => {
    const isRemainder = id === drilledCategoryId;
    return {
      categoryId: id,
      name: value.name,
      color: value.color,
      amount: value.amount,
      isDrillable: !isRemainder && isDrillable({ categoryId: id }),
    };
  });

  if (!drilledCategoryId) return slices;

  slices.sort((a, b) => b.amount - a.amount);
  const colors = assignSiblingColors({
    items: slices.map(({ categoryId, color }) => ({ id: categoryId, color })),
    parentColor: categoriesMap[drilledCategoryId]?.color,
  });

  return slices.map((slice) => ({ ...slice, color: colors[slice.categoryId] ?? slice.color }));
};

/** Category filter for the current level's transactions: `undefined` means unfiltered, `null` means nothing is left to open. */
export const getLevelTransactionCategoryIds = ({
  drilledCategoryId,
  categoriesMap,
  excludedCategoryIds,
}: {
  drilledCategoryId: string | null;
  categoriesMap: CategoriesMap;
  excludedCategoryIds: string[];
}): string[] | undefined | null => {
  const categories = Object.values(categoriesMap);

  if (drilledCategoryId) {
    return collectSubtreeIds({ rootId: drilledCategoryId, categories, excludedIds: excludedCategoryIds });
  }
  if (excludedCategoryIds.length === 0) return undefined;

  const excluded = new Set(excludedCategoryIds.flatMap((id) => collectSubtreeIds({ rootId: id, categories })));
  const remaining = categories.map((category) => category.id).filter((id) => !excluded.has(id));
  return remaining.length > 0 ? remaining : null;
};

/** A drill is stale once its category is gone or it sits on or under an excluded category. */
export const isDrillStale = ({
  trail,
  excludedCategoryIds,
}: {
  trail: Pick<CategoryInfo, 'id'>[];
  excludedCategoryIds: string[];
}): boolean => trail.length === 0 || trail.some((category) => excludedCategoryIds.includes(category.id));

export const buildWidgetAnalyticsLink = ({
  drilledCategoryId,
  excludedCategoryIds,
  metric,
  period,
}: {
  drilledCategoryId: string | null;
  excludedCategoryIds: string[];
  metric: MetricType;
  period: Period;
}): TrendsLocationInput =>
  drilledCategoryId ? { categoryIds: [drilledCategoryId], metric, period } : { excludedCategoryIds, metric, period };

/** Root first, ending with `categoryId`. Empty when the category is unknown. */
export const buildTrail = ({
  categoryId,
  categoriesMap,
}: {
  categoryId: string | null;
  categoriesMap: CategoriesMap;
}): CategoryInfo[] => {
  const category = categoryId ? categoriesMap[categoryId] : undefined;
  return category ? [...getAncestors({ id: category.id, categoriesMap }), category] : [];
};
