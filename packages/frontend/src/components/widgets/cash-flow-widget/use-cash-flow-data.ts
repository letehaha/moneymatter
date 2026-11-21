import { getCashFlow } from '@/api/stats';
import { VUE_QUERY_CACHE_KEYS } from '@/common/const';
import { useUserSettings } from '@/composable/data-queries/user-settings';
import { getPrevPeriod, isFullMonthPeriod, isMonthAligned } from '@/composable/use-period-navigation';
import { useRootStore } from '@/stores';
import { useQuery } from '@tanstack/vue-query';
import { storeToRefs } from 'pinia';
import { type Ref, computed } from 'vue';

import { type CashFlowTotals, computeTrendPeriods, sliceCashFlowTotals } from './helpers';

const ZERO_TOTALS: CashFlowTotals = { income: 0, expenses: 0, netFlow: 0, savingsRate: 0 };

/**
 * Owns all cash-flow data loading for the widget.
 *
 * The widget renders three things over three date ranges: the current period,
 * the previous period (for the "vs previous" badge) and the previous few periods
 * (for the trend bars). When the selected period is a whole calendar month those
 * ranges are month-aligned, so a single monthly call over the widest span
 * (`unionRange`) contains every month they need and the current/previous months
 * are sliced from it. Non-month-aligned (custom) ranges can't be reconstructed
 * from monthly buckets, so the current and previous periods fall back to their
 * own exact calls there.
 */
export function useCashFlowData({
  selectedPeriod,
  excludedCategoryIds,
  includePlanned,
}: {
  selectedPeriod: () => { from: Date; to: Date };
  excludedCategoryIds: Ref<string[]>;
  includePlanned: Ref<boolean>;
}) {
  const { isAppInitialized } = storeToRefs(useRootStore());

  const periodQueryKey = computed(() => `${selectedPeriod().from.toISOString()}-${selectedPeriod().to.toISOString()}`);
  const excludedKey = computed(() => `${excludedCategoryIds.value.join(',')}:planned-${includePlanned.value}`);
  const excludedParam = computed(() => (excludedCategoryIds.value.length > 0 ? excludedCategoryIds.value : undefined));
  const excludePlannedParam = computed(() => !includePlanned.value || undefined);

  const { data: userSettings, isPending: isSettingsPending } = useUserSettings();
  const payday = computed(() => userSettings.value?.payday ?? 1);
  const isReady = computed(() => isAppInitialized.value && !isSettingsPending.value);

  const isFullMonth = computed(() => isMonthAligned({ period: selectedPeriod(), payday: payday.value }));
  // A calendar month keeps calendar buckets even when a payday is set.
  const alignToPayday = computed(() => isFullMonthPeriod({ period: selectedPeriod(), payday: payday.value }));
  const prevPeriod = computed(() => getPrevPeriod({ period: selectedPeriod(), payday: payday.value }));
  const trendPeriods = computed(() => computeTrendPeriods({ ...selectedPeriod(), payday: payday.value }));

  const trendRange = computed(() => {
    const past = trendPeriods.value.filter((p) => !p.isCurrent);
    return { from: past[0]!.from, to: past[past.length - 1]!.to };
  });

  // Widest span the widget needs: the start of the trend range through the end
  // of the current period. In the month-aligned case this single monthly call
  // covers the current month, the previous month and every trend month.
  const unionRange = computed(() => ({ from: trendRange.value.from, to: selectedPeriod().to }));

  const { data: unionData, isFetching: isUnionFetching } = useQuery({
    queryKey: computed(() => [
      ...VUE_QUERY_CACHE_KEYS.widgetCashFlowTrend,
      periodQueryKey.value,
      excludedKey.value,
      payday.value,
    ]),
    queryFn: () =>
      getCashFlow({
        from: unionRange.value.from,
        to: unionRange.value.to,
        granularity: 'monthly',
        alignToPayday: alignToPayday.value,
        excludedCategoryIds: excludedParam.value,
        excludePlanned: excludePlannedParam.value,
      }),
    staleTime: Infinity,
    placeholderData: (prev) => prev,
    enabled: isReady,
  });

  const useExactRanges = computed(() => isReady.value && !isFullMonth.value);

  const { data: currentExactData, isFetching: isCurrentFetching } = useQuery({
    queryKey: computed(() => [...VUE_QUERY_CACHE_KEYS.widgetCashFlow, periodQueryKey.value, excludedKey.value]),
    queryFn: () =>
      getCashFlow({
        from: selectedPeriod().from,
        to: selectedPeriod().to,
        granularity: 'monthly',
        excludedCategoryIds: excludedParam.value,
        excludePlanned: excludePlannedParam.value,
      }),
    staleTime: Infinity,
    placeholderData: (prev) => prev,
    enabled: useExactRanges,
  });

  const { data: prevExactData, isFetching: isPrevFetching } = useQuery({
    queryKey: computed(() => [...VUE_QUERY_CACHE_KEYS.widgetCashFlowPrev, periodQueryKey.value, excludedKey.value]),
    queryFn: () =>
      getCashFlow({
        from: prevPeriod.value.from,
        to: prevPeriod.value.to,
        granularity: 'monthly',
        excludedCategoryIds: excludedParam.value,
        excludePlanned: excludePlannedParam.value,
      }),
    staleTime: Infinity,
    placeholderData: (prev) => prev,
    enabled: useExactRanges,
  });

  const hasCurrentData = computed(() => (isFullMonth.value ? !!unionData.value : !!currentExactData.value));
  const hasPrevData = computed(() => (isFullMonth.value ? !!unionData.value : !!prevExactData.value));

  const currentTotals = computed<CashFlowTotals>(() => {
    if (isFullMonth.value) {
      if (!unionData.value) return ZERO_TOTALS;
      return sliceCashFlowTotals({
        periods: unionData.value.periods,
        from: selectedPeriod().from,
        to: selectedPeriod().to,
      });
    }
    return currentExactData.value?.totals ?? ZERO_TOTALS;
  });

  const prevNetFlow = computed(() => {
    if (isFullMonth.value) {
      if (!unionData.value) return 0;
      return sliceCashFlowTotals({
        periods: unionData.value.periods,
        from: prevPeriod.value.from,
        to: prevPeriod.value.to,
      }).netFlow;
    }
    return prevExactData.value?.totals.netFlow ?? 0;
  });

  const unionPeriods = computed(() => unionData.value?.periods ?? []);

  const isFetching = computed(() => isUnionFetching.value || isCurrentFetching.value || isPrevFetching.value);
  const isInitialLoading = computed(() => (isFetching.value || !isReady.value) && !hasCurrentData.value);
  const isCurrentEmpty = computed(
    () => hasCurrentData.value && currentTotals.value.income === 0 && currentTotals.value.expenses === 0,
  );
  // Empty only when the whole trend span has no activity: a current period
  // without transactions still has past periods to chart.
  const isEmpty = computed(
    () => isCurrentEmpty.value && unionPeriods.value.every((p) => p.income === 0 && p.expenses === 0),
  );

  return {
    currentTotals,
    prevNetFlow,
    trendPeriods,
    unionPeriods,
    hasCurrentData,
    hasPrevData,
    isFetching,
    isInitialLoading,
    isCurrentEmpty,
    isEmpty,
  };
}
