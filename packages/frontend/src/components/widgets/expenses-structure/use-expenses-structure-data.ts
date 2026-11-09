import { getSpendingsByCategories } from '@/api';
import { VUE_QUERY_CACHE_KEYS } from '@/common/const';
import { type MetricType, metricTransactionType } from '@/common/utils/analytics-metric';
import { getLevelCategoryIds } from '@/common/utils/category-tree';
import { useAnimatedNumber } from '@/composable/use-animated-number';
import { calculatePercentageDifference } from '@/js/helpers';
import { useCategoriesStore } from '@/stores';
import { type GetSpendingsByCategoriesReturnType } from '@bt/shared/types';
import { useQuery } from '@tanstack/vue-query';
import { differenceInDays, endOfMonth, format, isSameMonth, startOfMonth, subDays, subMonths } from 'date-fns';
import { storeToRefs } from 'pinia';
import { type Ref, computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

import { buildLevelSlices, getLevelTotal } from './drill-down';

export function useExpensesStructureData({
  selectedPeriod,
  excludedCategoryIds,
  includePlanned,
  metric,
  drilledCategoryId,
}: {
  selectedPeriod: () => { from: Date; to: Date };
  excludedCategoryIds: Ref<string[]>;
  includePlanned: Ref<boolean>;
  metric: Ref<MetricType>;
  drilledCategoryId: Ref<string | null>;
}) {
  const { t } = useI18n();
  const { categories, categoriesMap } = storeToRefs(useCategoriesStore());

  const periodQueryKey = ref(`${new Date().getTime()}-${new Date().getTime()}`);

  const hasExcludedStats = computed(() => excludedCategoryIds.value.length > 0);

  const periodLabel = computed(() => {
    const from = selectedPeriod().from;
    const to = selectedPeriod().to;
    const now = new Date();

    if (isSameMonth(now, to) && isSameMonth(from, to)) {
      return t('dashboard.widgets.expensesStructure.today');
    }

    if (isSameMonth(from, to)) {
      return format(to, 'MMMM yyyy');
    }

    const isFromMonthStart = from.getDate() === 1;
    const endOfToMonth = new Date(to.getFullYear(), to.getMonth() + 1, 0);
    const isToMonthEnd = to.getDate() === endOfToMonth.getDate();

    if (isFromMonthStart && isToMonthEnd) {
      return `${format(from, 'MMM yyyy')} - ${format(to, 'MMM yyyy')}`;
    }

    return `${format(from, 'MMM d, yyyy')} - ${format(to, 'MMM d, yyyy')}`;
  });

  watch(
    selectedPeriod,
    () => {
      periodQueryKey.value = `${selectedPeriod().from.getTime()}-${selectedPeriod().to.getTime()}`;
    },
    { deep: true },
  );

  const excludedKey = computed(() => `${excludedCategoryIds.value.join(',')}:planned-${includePlanned.value}`);
  const excludePlannedParam = computed(() => !includePlanned.value || undefined);
  // `undefined` at the root keeps the stats endpoint's default roll-up to root categories.
  const levelCategoryIds = computed(() =>
    drilledCategoryId.value
      ? getLevelCategoryIds({
          scopeId: drilledCategoryId.value,
          categories: categories.value,
          excludedIds: excludedCategoryIds.value,
        })
      : undefined,
  );
  const levelKey = computed(() => `${metric.value}:${levelCategoryIds.value?.join(',') ?? 'root'}`);

  const fetchSpendings = ({ from, to }: { from: Date; to: Date }) =>
    getSpendingsByCategories({
      from,
      to,
      type: metricTransactionType({ metric: metric.value }),
      categoryIds: levelCategoryIds.value,
      excludedCategoryIds: excludedCategoryIds.value.length > 0 ? excludedCategoryIds.value : undefined,
      excludePlanned: excludePlannedParam.value,
    });

  // Another level's rows would render as a wrong slice set until the fetch lands, so only same-level data carries over.
  const sameLevelPlaceholder = (
    previousData: GetSpendingsByCategoriesReturnType | undefined,
    previousQuery?: { queryKey: readonly unknown[] },
  ) => (previousQuery?.queryKey.at(-1) === levelKey.value ? previousData : undefined);

  const {
    data: spendingsByCategories,
    isFetching: isSpendingsByCategoriesFetching,
    isError,
    refetch: refetchCurrent,
  } = useQuery({
    queryKey: [...VUE_QUERY_CACHE_KEYS.widgetExpensesStructureTotal, periodQueryKey, excludedKey, levelKey],
    queryFn: () => fetchSpendings(selectedPeriod()),
    staleTime: Infinity,
    placeholderData: sameLevelPlaceholder,
  });

  // Calculate previous period. For full-month selections, use the full previous month
  // to avoid skipping days (e.g., Feb 28 days vs Jan 31 days).
  // For custom date ranges, fall back to same-duration comparison.
  const prevPeriod = computed(() => {
    const { from, to } = selectedPeriod();

    const isFullMonth = isSameMonth(from, to) && from.getDate() === 1 && to.getDate() === endOfMonth(to).getDate();

    if (isFullMonth) {
      const prevMonth = subMonths(from, 1);
      return { from: startOfMonth(prevMonth), to: endOfMonth(prevMonth) };
    }

    const durationInDays = differenceInDays(to, from) + 1;
    const prevTo = subDays(from, 1);
    const prevFrom = subDays(from, durationInDays);

    return { from: prevFrom, to: prevTo };
  });

  const {
    data: prevSpendingsByCategories,
    isFetching: isPrevSpendingsFetching,
    isError: isPrevError,
    refetch: refetchPrev,
  } = useQuery({
    queryKey: [...VUE_QUERY_CACHE_KEYS.widgetExpensesStructurePrevTotal, periodQueryKey, excludedKey, levelKey],
    queryFn: () => fetchSpendings(prevPeriod.value),
    staleTime: Infinity,
    placeholderData: sameLevelPlaceholder,
  });

  const isWidgetDataFetching = computed(() => isSpendingsByCategoriesFetching.value || isPrevSpendingsFetching.value);

  const chartData = computed(() =>
    buildLevelSlices({
      spendings: spendingsByCategories.value ?? {},
      drilledCategoryId: drilledCategoryId.value,
      categoriesMap: categoriesMap.value,
      excludedCategoryIds: excludedCategoryIds.value,
    }),
  );

  const totalAmount = computed(() =>
    getLevelTotal({ spendings: spendingsByCategories.value ?? {}, excludedCategoryIds: excludedCategoryIds.value }),
  );

  const { displayValue: animatedTotal } = useAnimatedNumber({
    value: totalAmount,
  });

  const periodDiff = computed<number | null>(() => {
    if (isPrevError.value || !prevSpendingsByCategories.value) return null;
    const prevTotal = getLevelTotal({
      spendings: prevSpendingsByCategories.value,
      excludedCategoryIds: excludedCategoryIds.value,
    });
    return Number(Number(calculatePercentageDifference(totalAmount.value, prevTotal)).toFixed(2));
  });

  const isDataEmpty = computed(() => chartData.value.length === 0);
  const hasData = computed(() => spendingsByCategories.value !== undefined);
  const showError = computed(() => isError.value && !hasData.value);

  const refetch = () => Promise.all([refetchCurrent(), refetchPrev()]);

  return {
    hasExcludedStats,
    periodLabel,
    isWidgetDataFetching,
    animatedTotal,
    periodDiff,
    showError,
    refetch,
    chartData,
    isDataEmpty,
    hasData,
    totalAmount,
  };
}
