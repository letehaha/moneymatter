import { getCashFlow, getNetWorthHistory, getVentureContributions } from '@/api/stats';
import { QUERY_CACHE_STALE_TIME, VUE_QUERY_CACHE_KEYS } from '@/common/const';
import { usePortfoliosAnnualizedReturns } from '@/composable/data-queries/portfolios-annualized-returns';
import { useAccountsStore } from '@/stores';
import { type FireSettings, isPortfolioIndicatorId, type CashFlowPeriodData } from '@bt/shared/types';
import { useQuery } from '@tanstack/vue-query';
import { format, parseISO, startOfMonth, subMonths } from 'date-fns';
import { storeToRefs } from 'pinia';
import { type MaybeRefOrGetter, type Ref, computed, shallowRef, toValue, watchEffect } from 'vue';

import { buildFirePlan } from './build-fire-plan';
import { getFireSeedPeriods, getFireSeedWindow } from './derive-fire-seed';
import { type ResolvedFireSettings, resolveFireSettings } from './resolve-fire-settings';

const HISTORY_MONTHS = 120;

export const useResolvedFireSettings = ({
  fire,
  enabled = true,
}: {
  fire: MaybeRefOrGetter<FireSettings | undefined>;
  enabled?: MaybeRefOrGetter<boolean>;
}) => {
  const isReturnsEnabled = computed(
    () => toValue(enabled) && isPortfolioIndicatorId({ id: toValue(fire)?.returnIndicatorId ?? '' }),
  );
  const returnsQuery = usePortfoliosAnnualizedReturns({
    enabled: isReturnsEnabled,
  });
  const settings = computed(() =>
    resolveFireSettings({
      fire: toValue(fire),
      portfolioReturns: returnsQuery.data.value ?? [],
    }),
  );
  // A disabled query keeps its last error, so only count it while the settings use it.
  const isError = computed(() => isReturnsEnabled.value && returnsQuery.isError.value);
  return {
    settings,
    isLoading: returnsQuery.isLoading,
    isError,
    refetch: () => {
      if (isError.value) returnsQuery.refetch();
    },
  };
};

export const useFirePlan = ({
  settings,
  includeHistory,
  enabled = true,
}: {
  settings: Ref<ResolvedFireSettings>;
  includeHistory: MaybeRefOrGetter<boolean>;
  enabled?: MaybeRefOrGetter<boolean>;
}) => {
  const now = new Date();
  const historyFrom = computed(() =>
    toValue(includeHistory) ? startOfMonth(subMonths(now, HISTORY_MONTHS - 1)) : startOfMonth(now),
  );
  const seedWindow = getFireSeedWindow({ now });
  const seedKey = format(seedWindow.from, 'yyyy-MM-dd');

  const accountsStore = useAccountsStore();
  const { accounts, isAccountsFetched, isAccountsError } = storeToRefs(accountsStore);
  const ownedAccountIds = computed(() =>
    (accounts.value ?? []).filter((a) => !a.share || a.share.isOwner).map((a) => a.id),
  );

  const historyQuery = useQuery({
    queryKey: computed(() => [...VUE_QUERY_CACHE_KEYS.fireNetWorthHistory, format(historyFrom.value, 'yyyy-MM-dd')]),
    queryFn: () =>
      getNetWorthHistory({
        from: historyFrom.value,
        to: now,
        granularity: 'monthly',
      }),
    enabled,
    staleTime: QUERY_CACHE_STALE_TIME.ANALYTICS,
  });

  const isCashFlowEnabled = computed(() => toValue(enabled) && ownedAccountIds.value.length > 0);
  // An empty accountIds list widens to every accessible account on the server.
  const cashFlowParams = () => ({
    ...seedWindow,
    granularity: 'monthly' as const,
    excludePlanned: true,
    accountIds: ownedAccountIds.value,
  });
  const cashFlowQuery = useQuery({
    queryKey: computed(() => [...VUE_QUERY_CACHE_KEYS.fireCashFlow, seedKey, ownedAccountIds.value]),
    queryFn: () => getCashFlow(cashFlowParams()),
    enabled: isCashFlowEnabled,
    staleTime: QUERY_CACHE_STALE_TIME.ANALYTICS,
  });

  const excludedIds = computed(() => [...settings.value.spendingExcludedCategoryIds].sort());
  const isFilteredEnabled = computed(() => isCashFlowEnabled.value && excludedIds.value.length > 0);
  const filteredCashFlowQuery = useQuery({
    queryKey: computed(() => [
      ...VUE_QUERY_CACHE_KEYS.fireCashFlow,
      seedKey,
      ownedAccountIds.value,
      'excluded',
      excludedIds.value,
    ]),
    queryFn: () => getCashFlow({ ...cashFlowParams(), excludedCategoryIds: excludedIds.value }),
    enabled: isFilteredEnabled,
    staleTime: QUERY_CACHE_STALE_TIME.ANALYTICS,
  });
  // null until the first filtered response; a toggle keeps the last applied periods until the new ones land.
  const appliedFilteredPeriods = shallowRef<CashFlowPeriodData[] | null>(null);
  watchEffect(() => {
    if (excludedIds.value.length === 0) appliedFilteredPeriods.value = [];
    else if (filteredCashFlowQuery.data.value) appliedFilteredPeriods.value = filteredCashFlowQuery.data.value.periods;
  });

  const venturesFrom = computed(
    () => getFireSeedPeriods({ periods: cashFlowQuery.data.value?.periods ?? [], now })[0]?.periodStart ?? null,
  );
  const isVenturesEnabled = computed(
    () => toValue(enabled) && !settings.value.includeVentures && venturesFrom.value !== null,
  );
  const venturesQuery = useQuery({
    queryKey: computed(() => [...VUE_QUERY_CACHE_KEYS.fireVentureContributions, venturesFrom.value]),
    queryFn: () => getVentureContributions({ from: parseISO(venturesFrom.value ?? seedKey), to: seedWindow.to }),
    enabled: isVenturesEnabled,
    staleTime: QUERY_CACHE_STALE_TIME.ANALYTICS,
  });

  const isLoading = computed(
    () =>
      !isAccountsFetched.value ||
      historyQuery.isLoading.value ||
      cashFlowQuery.isLoading.value ||
      (appliedFilteredPeriods.value === null && filteredCashFlowQuery.isLoading.value) ||
      venturesQuery.isLoading.value,
  );
  const failedQueries = computed(() =>
    [
      { isError: isAccountsError, refetch: accountsStore.refetchAccounts },
      historyQuery,
      cashFlowQuery,
      ...(isFilteredEnabled.value ? [filteredCashFlowQuery] : []),
      ...(isVenturesEnabled.value ? [venturesQuery] : []),
    ].filter((q) => q.isError.value),
  );

  const plan = computed(() =>
    buildFirePlan({
      settings: settings.value,
      history: historyQuery.data.value,
      cashFlowPeriods: cashFlowQuery.data.value?.periods ?? [],
      filteredCashFlowPeriods: appliedFilteredPeriods.value ?? [],
      ventureContributions: venturesQuery.data.value ?? [],
      hasOwnedAccounts: ownedAccountIds.value.length > 0,
      isLoading: isLoading.value,
      now,
    }),
  );

  return {
    plan,
    isError: computed(() => failedQueries.value.length > 0),
    refetch: () => failedQueries.value.forEach((q) => q.refetch()),
  };
};
