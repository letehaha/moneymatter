<template>
  <div class="@container/investment-contributions space-y-5">
    <!-- Contributions are money moved into portfolios, so with no portfolios the
         report has nothing to measure and collapses to a placeholder that points
         at where to start. -->
    <NoPortfoliosPlaceholder
      v-if="showNoPortfoliosPlaceholder"
      :icon="PiggyBankIcon"
      :title="$t('investmentContributions.states.noPortfoliosTitle')"
      :description="$t('investmentContributions.states.noPortfoliosPlaceholder')"
      :action-label="$t('investmentContributions.states.noPortfoliosAction')"
      @action="goToInvestments"
    />

    <template v-else>
      <ReportControls v-model:period="selectedPeriod">
        <PortfolioFilter
          v-model="selectedPortfolioIds"
          scope-hint-key="investmentContributions.portfolioFilter.scopeHint"
        />
        <GranularitySelector
          v-model="selectedGranularity"
          :granularities="INVESTMENT_CONTRIBUTIONS_GRANULARITIES"
          label-key-prefix="investmentContributions.granularity"
        />
      </ReportControls>

      <template v-if="isLoading">
        <SummaryRows :items="summaryRows" class="@md/investment-contributions:hidden" />
        <div
          class="hidden grid-cols-2 gap-4 @md/investment-contributions:grid @xl/investment-contributions:grid-cols-3"
        >
          <div v-for="n in 3" :key="`card-skeleton-${n}`" class="border-border bg-card rounded-lg border p-4">
            <div class="bg-muted mb-2 h-4 w-24 animate-pulse rounded" />
            <div class="bg-muted h-7 w-16 animate-pulse rounded" />
          </div>
        </div>
        <div class="border-border bg-card rounded-lg border p-3">
          <div class="bg-muted/60 h-72 w-full animate-pulse rounded" />
        </div>
      </template>

      <div v-else-if="query.isError.value" class="flex h-72 flex-col items-center justify-center gap-2 text-center">
        <TriangleAlertIcon class="text-muted-foreground size-8" />
        <p class="text-muted-foreground text-sm">{{ $t('investmentContributions.states.loadError') }}</p>
      </div>

      <template v-else>
        <SummaryRows :items="summaryRows" class="@md/investment-contributions:hidden" />
        <div
          class="hidden grid-cols-2 gap-4 @md/investment-contributions:grid @xl/investment-contributions:grid-cols-3"
        >
          <SummaryCard
            :title="$t('investmentContributions.cards.totalContributed')"
            :value="model.rangeTotal"
            :change="vsPreviousPeriodPct"
            :comparison-period-label="$t('analytics.cashFlow.vsPreviousPeriod')"
          />
          <SummaryCard
            :title="$t('investmentContributions.cards.shareOfSavings')"
            :value="shareOfSavings ?? 0"
            suffix="%"
            :value-label="shareOfSavings === null ? '—' : undefined"
          />
          <SummaryCard :title="$t('investmentContributions.cards.averagePerPeriod')" :value="model.averagePerPeriod" />
        </div>

        <div class="border-border bg-card space-y-3 rounded-lg border p-3">
          <div v-if="!hasContributionData" class="flex h-72 flex-col items-center justify-center gap-2 text-center">
            <ChartColumnIcon class="text-muted-foreground size-8" />
            <p class="text-muted-foreground text-sm">{{ $t('investmentContributions.states.noData') }}</p>
            <p class="text-muted-foreground max-w-md text-xs">{{ $t('investmentContributions.states.noDataHint') }}</p>
          </div>
          <template v-else>
            <ContributionsChart :model="model" :granularity="selectedGranularity" />

            <div class="flex flex-wrap items-center justify-center gap-4 px-1">
              <span
                v-for="entry in model.legend"
                :key="entry.portfolioId"
                class="text-muted-foreground flex items-center gap-1.5 text-xs"
              >
                <span class="size-2 rounded-full" :style="{ backgroundColor: entry.color }" />
                {{ entry.name }}
              </span>
            </div>
          </template>
        </div>
      </template>
    </template>
  </div>
</template>

<script setup lang="ts">
import { getInvestmentContributions } from '@/api';
import { QUERY_CACHE_STALE_TIME, VUE_QUERY_CACHE_KEYS } from '@/common/const';
import { CATEGORICAL_SERIES_PALETTE } from '@/composable/charts/categorical-series-palette';
import type { Period } from '@/composable/use-period-navigation';
import {
  INVESTMENT_CONTRIBUTIONS_GRANULARITIES,
  type InvestmentContributionsGranularity,
  type GetInvestmentContributionsResponse,
} from '@bt/shared/types';
import { keepPreviousData, useQuery } from '@tanstack/vue-query';
import { useLocalStorage, useSessionStorage } from '@vueuse/core';
import { differenceInDays, endOfMonth, startOfMonth, subDays, subMonths } from 'date-fns';
import { ChartColumnIcon, PiggyBankIcon, TriangleAlertIcon } from '@lucide/vue';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { useFormatCurrency } from '@/composable';

import { createPeriodSerializer } from '../../utils';
import ReportControls from '../../components/report-controls.vue';
import SummaryCard from '../cash-flow/components/summary-card.vue';
import SummaryRows, { type SummaryRowItem } from '../../components/summary-rows.vue';
import GranularitySelector from '../../components/granularity-selector.vue';
import NoPortfoliosPlaceholder from '../../components/no-portfolios-placeholder.vue';
import PortfolioFilter from '../../components/portfolio-filter.vue';
import { usePortfolioGatedReport } from '../../composables/use-portfolio-gated-report';
import ContributionsChart from './components/contributions-chart.vue';
import {
  buildContributionsChartModel,
  computeVsPreviousPeriodPct,
  sharePctOfSavings,
} from './composables/contributions-derivations';

const { t } = useI18n();
const { formatBaseCurrency } = useFormatCurrency();

const DEFAULT_PERIOD_MONTHS = 12;

const getDefaultPeriod = (): Period => ({
  from: startOfMonth(subMonths(new Date(), DEFAULT_PERIOD_MONTHS - 1)),
  to: endOfMonth(new Date()),
});

const periodSerializer = createPeriodSerializer({ getDefaultPeriod });

const selectedPeriod = useSessionStorage<Period>('investment-contributions-period', getDefaultPeriod(), {
  serializer: periodSerializer,
});
const selectedGranularity = useLocalStorage<InvestmentContributionsGranularity>(
  'investment-contributions-granularity',
  'monthly',
);

// Empty = all enabled portfolios (the default), sent to the API as no filter.
const selectedPortfolioIds = useLocalStorage<string[]>('investment-contributions-portfolio-ids', []);

// The immediately-preceding span of equal length, for the "vs previous period" card.
const previousPeriod = computed(() => {
  const periodDays = differenceInDays(selectedPeriod.value.to, selectedPeriod.value.from) + 1;
  return {
    from: subDays(selectedPeriod.value.from, periodDays),
    to: subDays(selectedPeriod.value.from, 1),
  };
});

const queryParams = computed(() => ({
  from: selectedPeriod.value.from,
  to: selectedPeriod.value.to,
  granularity: selectedGranularity.value,
  // Omit the filter entirely when all portfolios are included so the cache key and
  // request match the wide-open "all" case.
  portfolioIds: selectedPortfolioIds.value.length > 0 ? selectedPortfolioIds.value : undefined,
}));

const previousQueryParams = computed(() => ({
  from: previousPeriod.value.from,
  to: previousPeriod.value.to,
  granularity: selectedGranularity.value,
  portfolioIds: selectedPortfolioIds.value.length > 0 ? selectedPortfolioIds.value : undefined,
}));

const query = useQuery({
  queryKey: [...VUE_QUERY_CACHE_KEYS.analyticsInvestmentContributions, queryParams],
  queryFn: () => getInvestmentContributions(queryParams.value),
  staleTime: QUERY_CACHE_STALE_TIME.ANALYTICS,
  gcTime: QUERY_CACHE_STALE_TIME.ANALYTICS * 2,
  // Keep the prior range's bars on screen while a new range loads, so changing a
  // filter doesn't flash the skeleton back in.
  placeholderData: keepPreviousData,
});

const previousQuery = useQuery({
  queryKey: [...VUE_QUERY_CACHE_KEYS.analyticsInvestmentContributions, previousQueryParams],
  queryFn: () => getInvestmentContributions(previousQueryParams.value),
  staleTime: QUERY_CACHE_STALE_TIME.ANALYTICS,
  gcTime: QUERY_CACHE_STALE_TIME.ANALYTICS * 2,
  placeholderData: keepPreviousData,
});

const EMPTY_RESPONSE: GetInvestmentContributionsResponse = { buckets: [], portfolios: [] };

const model = computed(() =>
  buildContributionsChartModel({ response: query.data.value ?? EMPTY_RESPONSE, palette: CATEGORICAL_SERIES_PALETTE }),
);
const previousModel = computed(() =>
  buildContributionsChartModel({
    response: previousQuery.data.value ?? EMPTY_RESPONSE,
    palette: CATEGORICAL_SERIES_PALETTE,
  }),
);

// Hidden (undefined → SummaryCard drops the badge) until the previous span actually
// loads: an unresolved or failed previous query must not be coerced into a
// real-looking ±100% comparison against an empty fallback.
const vsPreviousPeriodPct = computed(() =>
  previousQuery.isSuccess.value
    ? computeVsPreviousPeriodPct({
        currentTotal: model.value.rangeTotal,
        previousTotal: previousModel.value.rangeTotal,
      })
    : undefined,
);

// Null when there was no positive saving to funnel from — the card shows "—" then,
// which must stay distinct from a real 0% (saved money, invested none of it).
const shareOfSavings = computed(() =>
  sharePctOfSavings({ rangeTotal: model.value.rangeTotal, savingsTotal: model.value.savingsTotal }),
);

// A valid range always yields buckets, so "no contributions" can't be read from the
// bucket count — it's the empty legend: no portfolio moved money in over the window.
const hasContributionData = computed(() => model.value.legend.length > 0);

// Without any portfolio there is nothing to contribute to, so the report yields to
// a placeholder instead of an empty chart.
const { isPortfoliosLoading, showNoPortfoliosPlaceholder, goToInvestments } = usePortfolioGatedReport();

// Cover both fetches so nothing flashes between them: the portfolios list decides
// whether the report renders at all, the contributions query fills it in.
const isLoading = computed(() => isPortfoliosLoading.value || query.isLoading.value);

const summaryRows = computed<SummaryRowItem[]>(() => [
  {
    label: t('investmentContributions.cards.totalContributed'),
    value: formatBaseCurrency(model.value.rangeTotal),
    change: vsPreviousPeriodPct.value,
    comparisonPeriodLabel: t('analytics.cashFlow.vsPreviousPeriod'),
  },
  {
    label: t('investmentContributions.cards.shareOfSavings'),
    value: shareOfSavings.value === null ? '—' : `${shareOfSavings.value}%`,
  },
  {
    label: t('investmentContributions.cards.averagePerPeriod'),
    value: formatBaseCurrency(model.value.averagePerPeriod),
  },
]);
</script>
