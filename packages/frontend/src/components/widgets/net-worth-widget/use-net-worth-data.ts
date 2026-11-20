import { getCombinedBalanceHistory } from '@/api/stats';
import { VUE_QUERY_CACHE_KEYS } from '@/common/const';
import { useUserSettings } from '@/composable/data-queries/user-settings';
import { captureException } from '@/lib/sentry';
import { useRootStore } from '@/stores';
import { useQuery } from '@tanstack/vue-query';
import { storeToRefs } from 'pinia';
import { type Ref, computed, watch } from 'vue';

import {
  type NetWorthIncludeSettings,
  computeEndNetWorth,
  computeFetchRange,
  computeGrowthPercent,
  computePrevDelta,
  computeStartNetWorth,
  computeTrendBars,
} from './helpers';

export function useNetWorthData({
  selectedPeriod,
  settings,
}: {
  selectedPeriod: () => { from: Date; to: Date };
  settings: Ref<NetWorthIncludeSettings>;
}) {
  const { isAppInitialized } = storeToRefs(useRootStore());

  const { data: userSettings, isPending: isSettingsPending } = useUserSettings();
  const payday = computed(() => userSettings.value?.payday ?? 1);
  const isReady = computed(() => isAppInitialized.value && !isSettingsPending.value);

  const fetchRange = computed(() => computeFetchRange({ period: selectedPeriod(), payday: payday.value }));

  // The response carries every component, so the include toggles reshape the loaded
  // series client-side and never belong in the key.
  const { data, isFetching, isError, error, refetch } = useQuery({
    queryKey: computed(() => [
      ...VUE_QUERY_CACHE_KEYS.widgetNetWorth,
      { from: fetchRange.value.from.toISOString(), to: fetchRange.value.to.toISOString() },
    ]),
    queryFn: () => getCombinedBalanceHistory({ from: fetchRange.value.from, to: fetchRange.value.to }),
    staleTime: Infinity,
    placeholderData: (prev) => prev,
    enabled: isReady,
  });

  watch(error, (value) => {
    if (value) captureException({ error: value, context: { scope: 'net-worth-widget:load' } });
  });

  const series = computed(() => data.value ?? []);

  const startNetWorth = computed(() =>
    computeStartNetWorth({ series: series.value, settings: settings.value, period: selectedPeriod() }),
  );
  const endNetWorth = computed(() =>
    computeEndNetWorth({ series: series.value, settings: settings.value, period: selectedPeriod() }),
  );
  const currentDelta = computed(() =>
    startNetWorth.value === null || endNetWorth.value === null ? null : endNetWorth.value - startNetWorth.value,
  );

  const prevDelta = computed(() =>
    computePrevDelta({
      series: series.value,
      settings: settings.value,
      period: selectedPeriod(),
      payday: payday.value,
    }),
  );

  const growthPercent = computed(() =>
    computeGrowthPercent({ currentDelta: currentDelta.value, startNetWorth: startNetWorth.value }),
  );

  const trendWindows = computed(() =>
    computeTrendBars({
      series: series.value,
      settings: settings.value,
      period: selectedPeriod(),
      payday: payday.value,
    }),
  );

  // Stays true while the query waits for app init and settings, so a stalled init never
  // renders as an empty widget.
  const isInitialLoading = computed(() => !data.value && (isFetching.value || !isReady.value));
  const isEmpty = computed(() => series.value.length === 0);

  return {
    startNetWorth,
    endNetWorth,
    currentDelta,
    prevDelta,
    growthPercent,
    trendWindows,
    isFetching,
    isInitialLoading,
    isEmpty,
    isError,
    refetch,
  };
}
