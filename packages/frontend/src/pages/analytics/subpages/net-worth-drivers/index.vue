<template>
  <div class="@container/net-worth-drivers space-y-5">
    <CalculationInfoDialog v-if="!showNoPortfoliosPlaceholder" />

    <!-- With no portfolios there is no growth to separate from saving, so the whole
         report collapses to a placeholder that points at where to start. -->
    <NoPortfoliosPlaceholder
      v-if="showNoPortfoliosPlaceholder"
      :icon="TrendingUpIcon"
      :title="$t('netWorthDrivers.states.noPortfoliosTitle')"
      :description="$t('netWorthDrivers.states.noPortfoliosPlaceholder')"
      :action-label="$t('netWorthDrivers.states.noPortfoliosAction')"
      @action="goToInvestments"
    />

    <template v-else>
      <ReportControls v-model:period="selectedPeriod">
        <PortfolioFilter v-model="selectedPortfolioIds" scope-hint-key="netWorthDrivers.portfolioFilter.scopeHint" />
        <GranularitySelector
          v-model="selectedGranularity"
          :granularities="NET_WORTH_DRIVERS_GRANULARITIES"
          label-key-prefix="netWorthDrivers.granularity"
        />
      </ReportControls>

      <div v-if="isLoading" class="border-border bg-card space-y-3 rounded-lg border p-3">
        <div class="space-y-2">
          <div class="bg-muted h-4 w-32 animate-pulse rounded" />
          <div class="bg-muted h-3 w-56 animate-pulse rounded" />
        </div>
        <div class="bg-muted/60 h-72 w-full animate-pulse rounded" />
      </div>

      <div v-else-if="query.isError.value" class="flex h-72 flex-col items-center justify-center gap-2 text-center">
        <TriangleAlertIcon class="text-muted-foreground size-8" />
        <p class="text-muted-foreground text-sm">{{ $t('netWorthDrivers.states.loadError') }}</p>
      </div>

      <template v-else>
        <Callout v-if="degraded" variant="warning" :title="$t('netWorthDrivers.degraded.title')">
          <ul class="space-y-1">
            <li v-if="unpricedSecuritiesLabel">
              {{
                unpricedSecurities.length > MAX_LISTED_SECURITIES
                  ? $t('netWorthDrivers.degraded.unpricedSecuritiesTruncated', {
                      count: unpricedSecurities.length,
                      securities: unpricedSecuritiesLabel,
                    })
                  : $t('netWorthDrivers.degraded.unpricedSecurities', { securities: unpricedSecuritiesLabel })
              }}
            </li>
            <li v-if="fxFallbackCurrenciesLabel">
              {{ $t('netWorthDrivers.degraded.fxFallback', { currencies: fxFallbackCurrenciesLabel }) }}
            </li>
          </ul>
        </Callout>

        <div class="border-border bg-card space-y-3 rounded-lg border p-3">
          <div class="space-y-0.5">
            <h2 class="text-sm font-semibold">{{ $t('netWorthDrivers.chart.title') }}</h2>
            <p class="text-muted-foreground text-xs">{{ $t('netWorthDrivers.chart.subtitle') }}</p>
          </div>

          <div v-if="!hasData" class="flex h-72 flex-col items-center justify-center gap-2 text-center">
            <ChartAreaIcon class="text-muted-foreground size-8" />
            <p class="text-muted-foreground text-sm">{{ $t('netWorthDrivers.states.noData') }}</p>
            <p class="text-muted-foreground max-w-md text-xs">{{ $t('netWorthDrivers.states.noDataHint') }}</p>
          </div>
          <template v-else>
            <DriversChart :points="cumulativePoints" :granularity="selectedGranularity" />

            <div class="flex flex-wrap items-center justify-center gap-4 px-1">
              <span class="text-muted-foreground flex items-center gap-1.5 text-xs">
                <span class="size-2 rounded-full" :style="{ backgroundColor: seriesColors.saved }" />
                {{ $t('netWorthDrivers.chart.saved') }}
              </span>
              <span class="text-muted-foreground flex items-center gap-1.5 text-xs">
                <span class="size-2 rounded-full" :style="{ backgroundColor: seriesColors.grown }" />
                {{ $t('netWorthDrivers.chart.grown') }}
              </span>
            </div>

            <p v-if="allocationContextLine" class="text-muted-foreground text-center text-xs">
              {{ allocationContextLine }}
            </p>
          </template>
        </div>

        <div v-if="hasData" class="border-border bg-card space-y-3 rounded-lg border p-3">
          <div class="space-y-0.5">
            <h2 class="text-sm font-semibold">{{ $t('netWorthDrivers.breakdownChart.title') }}</h2>
            <p class="text-muted-foreground text-xs">{{ $t('netWorthDrivers.breakdownChart.subtitle') }}</p>
          </div>

          <DriversBreakdownChart
            :bars="breakdownModel.bars"
            :legend="breakdownModel.legend"
            :granularity="selectedGranularity"
          />

          <div class="flex flex-wrap items-center justify-center gap-4 px-1">
            <span class="text-muted-foreground flex items-center gap-1.5 text-xs">
              <span class="size-2 rounded-full" :style="{ backgroundColor: seriesColors.saved }" />
              {{ $t('netWorthDrivers.chart.saved') }}
            </span>
            <span
              v-for="entry in breakdownModel.legend"
              :key="entry.portfolioId"
              class="text-muted-foreground flex items-center gap-1.5 text-xs"
            >
              <span class="size-2 rounded-full" :style="{ backgroundColor: entry.color }" />
              {{ entry.portfolioId === OTHERS_SERIES_ID ? $t('netWorthDrivers.breakdownChart.others') : entry.name }}
            </span>
          </div>
        </div>

        <TargetPanel
          v-if="hasPortfolioActivity"
          :current-portfolio-value="targetSeeds.currentPortfolioValue"
          :avg-monthly-savings="targetSeeds.avgMonthlySavings"
        />

        <p v-else class="text-muted-foreground text-xs">
          {{ $t('netWorthDrivers.states.noPortfoliosHint') }}
        </p>
      </template>
    </template>
  </div>
</template>

<script setup lang="ts">
import { getNetWorthDrivers } from '@/api';
import { QUERY_CACHE_STALE_TIME, VUE_QUERY_CACHE_KEYS } from '@/common/const';
import { Callout } from '@/components/lib/ui/callout';
import { useDateLocale } from '@/composable/use-date-locale';
import type { Period } from '@/composable/use-period-navigation';
import { NET_WORTH_DRIVERS_GRANULARITIES, type NetWorthDriversGranularity } from '@bt/shared/types';
import { useQuery } from '@tanstack/vue-query';
import { useLocalStorage, useSessionStorage } from '@vueuse/core';
import { endOfMonth, parseISO, startOfMonth, subMonths } from 'date-fns';
import { ChartAreaIcon, TrendingUpIcon, TriangleAlertIcon } from '@lucide/vue';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

import { createPeriodSerializer } from '../../utils';
import ReportControls from '../../components/report-controls.vue';
import CalculationInfoDialog from './components/calculation-info-dialog.vue';
import GranularitySelector from '../../components/granularity-selector.vue';
import NoPortfoliosPlaceholder from '../../components/no-portfolios-placeholder.vue';
import PortfolioFilter from '../../components/portfolio-filter.vue';
import { usePortfolioGatedReport } from '../../composables/use-portfolio-gated-report';
import DriversBreakdownChart from './components/drivers-breakdown-chart.vue';
import DriversChart from './components/drivers-chart.vue';
import TargetPanel from './components/target-panel.vue';
import {
  OTHERS_SERIES_ID,
  buildBreakdownModel,
  buildCumulativeSeries,
  computeAllocationContext,
  deriveTargetSeeds,
  hasAnyData,
  hasPortfolios,
} from './composables/net-worth-drivers-derivations';
import { useSeriesColors } from './composables/use-series-colors';

const DEFAULT_PERIOD_MONTHS = 12;

const getDefaultPeriod = (): Period => ({
  from: startOfMonth(subMonths(new Date(), DEFAULT_PERIOD_MONTHS - 1)),
  to: endOfMonth(new Date()),
});

const periodSerializer = createPeriodSerializer({ getDefaultPeriod });

const selectedPeriod = useSessionStorage<Period>('net-worth-drivers-period', getDefaultPeriod(), {
  serializer: periodSerializer,
});
const selectedGranularity = useLocalStorage<NetWorthDriversGranularity>('net-worth-drivers-granularity', 'monthly');

// Empty = all enabled portfolios (the default), sent to the API as no filter.
const selectedPortfolioIds = useLocalStorage<string[]>('net-worth-drivers-portfolio-ids', []);

const queryParams = computed(() => ({
  from: selectedPeriod.value.from,
  to: selectedPeriod.value.to,
  granularity: selectedGranularity.value,
  // Omit the filter entirely when all portfolios are included so the cache key and
  // request match the wide-open "all" case.
  portfolioIds: selectedPortfolioIds.value.length > 0 ? selectedPortfolioIds.value : undefined,
}));

const query = useQuery({
  queryKey: [...VUE_QUERY_CACHE_KEYS.analyticsNetWorthDrivers, queryParams],
  queryFn: () => getNetWorthDrivers(queryParams.value),
  staleTime: QUERY_CACHE_STALE_TIME.ANALYTICS,
  gcTime: QUERY_CACHE_STALE_TIME.ANALYTICS * 2,
});

const buckets = computed(() => query.data.value?.buckets ?? []);
const portfolios = computed(() => query.data.value?.portfolios ?? []);

const cumulativePoints = computed(() => buildCumulativeSeries({ buckets: buckets.value }));

const breakdownModel = computed(() => buildBreakdownModel({ buckets: buckets.value, portfolios: portfolios.value }));

const { t } = useI18n();
const { format: formatDate } = useDateLocale();

const allocationContext = computed(() => computeAllocationContext({ buckets: buckets.value }));

/**
 * One-line footnote on where net worth sits. Suppressed under a portfolio filter:
 * the response scopes holdings to the filter but keeps cash global, so the ratio
 * would compare two different scopes and read wrong.
 */
const allocationContextLine = computed(() => {
  const { currentSharePct, referenceSharePct, referencePeriodEnd } = allocationContext.value;
  if (currentSharePct === null || selectedPortfolioIds.value.length > 0) return null;

  const share = Math.round(currentSharePct);

  if (referenceSharePct === null || referencePeriodEnd === null) {
    return t('netWorthDrivers.chart.allocationContextNoReference', { share });
  }

  return t('netWorthDrivers.chart.allocationContext', {
    share,
    reference: Math.round(referenceSharePct),
    date: formatDate(parseISO(referencePeriodEnd), 'MMM yyyy'),
  });
});

const seriesColors = useSeriesColors();

const hasData = computed(() => hasAnyData({ buckets: buckets.value }));
const hasPortfolioActivity = computed(() => hasPortfolios({ buckets: buckets.value }));

const targetSeeds = computed(() => deriveTargetSeeds({ buckets: buckets.value }));

// Portfolios drive the whole "grown" half; without any, the report has nothing to
// split, so it yields to a placeholder instead of a savings-only chart.
const { isPortfoliosLoading, showNoPortfoliosPlaceholder, goToInvestments } = usePortfolioGatedReport();

// Cover both fetches so nothing flashes between them: the portfolios list decides
// whether the report renders at all, the drivers query fills it in.
const isLoading = computed(() => isPortfoliosLoading.value || query.isLoading.value);

/** Present only when the range could not be valued truthfully; never an empty object. */
const degraded = computed(() => query.data.value?.degraded);

/** Beyond this the list stops being a hint and becomes a wall of tickers. */
const MAX_LISTED_SECURITIES = 5;

const unpricedSecurities = computed(() => degraded.value?.unpricedSecurities ?? []);

/**
 * Both label columns are nullable, so the id is the last resort — it identifies
 * nothing to the user, but it beats rendering an empty entry.
 */
const unpricedSecuritiesLabel = computed(() =>
  unpricedSecurities.value
    .slice(0, MAX_LISTED_SECURITIES)
    .map((security) => security.symbol ?? security.name ?? String(security.securityId))
    .join(', '),
);

const fxFallbackCurrenciesLabel = computed(() => (degraded.value?.fxFallbackCurrencies ?? []).join(', '));
</script>
