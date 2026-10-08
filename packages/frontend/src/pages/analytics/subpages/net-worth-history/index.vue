<template>
  <div class="@container/net-worth-history space-y-5">
    <ReportControls v-model:period="selectedPeriod">
      <KindFilter
        v-model="storedAssetKinds"
        :kinds="availableAssetKinds"
        :label-keys="NET_WORTH_ASSET_KIND_LABEL_KEYS"
        :colors="NET_WORTH_ASSET_KIND_COLORS"
        i18n-prefix="netWorthHistory.assetFilter"
      />
      <KindFilter
        v-model="storedLiabilityKinds"
        :kinds="availableLiabilityKinds"
        :label-keys="ACCOUNT_CATEGORIES_TRANSLATION_KEYS"
        i18n-prefix="netWorthHistory.kindFilter"
      />
      <GranularitySelector
        :model-value="effectiveGranularity"
        :granularities="NET_WORTH_HISTORY_GRANULARITIES"
        :disabled-values="disabledGranularityValues"
        label-key-prefix="netWorthHistory.granularity"
        @update:model-value="granularityOverride = $event"
      />
      <SettingsPopover v-model:zoom-liabilities-scale="zoomLiabilitiesScale" />
    </ReportControls>

    <template v-if="query.isLoading.value">
      <div class="grid grid-cols-1 gap-4 @sm/net-worth-history:grid-cols-2 @xl/net-worth-history:grid-cols-3">
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
      <p class="text-muted-foreground text-sm">{{ $t('netWorthHistory.states.loadError') }}</p>
    </div>

    <template v-else>
      <Callout v-if="degraded" variant="warning" :title="$t('netWorthHistory.degraded.title')">
        <ul class="space-y-1">
          <li v-if="unpricedSecuritiesLabel">
            {{
              unpricedSecurities.length > MAX_LISTED_SECURITIES
                ? $t('netWorthHistory.degraded.unpricedSecuritiesTruncated', {
                    count: unpricedSecurities.length,
                    securities: unpricedSecuritiesLabel,
                  })
                : $t('netWorthHistory.degraded.unpricedSecurities', { securities: unpricedSecuritiesLabel })
            }}
          </li>
          <li v-if="fxFallbackCurrenciesLabel">
            {{ $t('netWorthHistory.degraded.fxFallback', { currencies: fxFallbackCurrenciesLabel }) }}
          </li>
        </ul>
      </Callout>

      <SummaryRows v-if="hasData" :items="summaryRows" class="@md/net-worth-history:hidden">
        <i18n-t v-if="averageOwed > 0" keypath="netWorthHistory.cards.averageLiabilities" tag="p" class="text-sm">
          <template #amount>
            <span class="text-app-expense-color font-semibold">{{ formatBaseCurrency(averageOwed) }}</span>
          </template>
        </i18n-t>
        <p v-else class="text-app-income-color flex items-center gap-1.5 text-sm font-medium">
          <CircleCheckIcon class="size-4 shrink-0" />
          {{ $t('netWorthHistory.cards.noLiabilities') }}
        </p>
      </SummaryRows>

      <div v-if="hasData" class="hidden grid-cols-2 gap-4 @md/net-worth-history:grid @xl/net-worth-history:grid-cols-3">
        <SummaryCard :title="$t('netWorthHistory.cards.currentNetWorth')" :value="currentNetWorth" />

        <div class="border-border bg-card rounded-lg border p-4">
          <div class="text-muted-foreground mb-1 text-sm whitespace-nowrap">
            {{ $t('netWorthHistory.cards.periodChange') }}
          </div>
          <div
            class="text-lg font-semibold @xl/net-worth-history:text-2xl"
            :class="periodChange.amount >= 0 ? 'text-app-income-color' : 'text-app-expense-color'"
          >
            {{ formattedPeriodChange }}
            <span v-if="periodChange.pct !== null" class="text-sm font-medium"> ({{ formattedPeriodChangePct }}) </span>
          </div>
          <div v-if="formattedAnnualizedGrowth" class="text-muted-foreground mt-0.5 text-xs">
            {{ $t('netWorthHistory.cards.annualized', { pct: formattedAnnualizedGrowth }) }}
          </div>
        </div>

        <div class="border-border bg-card rounded-lg border p-4">
          <i18n-t v-if="averageOwed > 0" keypath="netWorthHistory.cards.averageLiabilities" tag="p" class="text-sm">
            <template #amount>
              <span class="text-app-expense-color font-semibold">{{ formatBaseCurrency(averageOwed) }}</span>
            </template>
          </i18n-t>
          <p v-else class="text-app-income-color flex items-center gap-1.5 text-sm font-medium">
            <CircleCheckIcon class="size-4 shrink-0" />
            {{ $t('netWorthHistory.cards.noLiabilities') }}
          </p>
        </div>
      </div>

      <div class="border-border bg-card space-y-3 rounded-lg border p-3">
        <div v-if="!hasData" class="flex h-72 flex-col items-center justify-center gap-2 text-center">
          <ChartLineIcon class="text-muted-foreground size-8" />
          <p class="text-muted-foreground text-sm">{{ $t('netWorthHistory.states.noData') }}</p>
          <p class="text-muted-foreground max-w-md text-xs">{{ $t('netWorthHistory.states.noDataHint') }}</p>
        </div>
        <NetWorthChart
          v-else
          :points="displayPoints"
          :granularity="effectiveGranularity"
          :average-owed="averageOwed"
          :zoom-liabilities-scale="zoomLiabilitiesScale"
        />
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { getNetWorthHistory } from '@/api';
import { ACCOUNT_CATEGORIES_TRANSLATION_KEYS } from '@/common/const/account-categories-verbose';
import { QUERY_CACHE_STALE_TIME, VUE_QUERY_CACHE_KEYS } from '@/common/const';
import { Callout } from '@/components/lib/ui/callout';
import { useFormatCurrency } from '@/composable/formatters';
import type { Period } from '@/composable/use-period-navigation';
import {
  NET_WORTH_HISTORY_GRANULARITIES,
  type NetWorthHistoryGranularity,
  type NetWorthLiabilityKind,
  type NetWorthAssetKind,
} from '@bt/shared/types';
import { keepPreviousData, useQuery } from '@tanstack/vue-query';
import { useLocalStorage, useSessionStorage } from '@vueuse/core';
import { endOfMonth, startOfMonth, subMonths } from 'date-fns';
import { ChartLineIcon, CircleCheckIcon, TriangleAlertIcon } from '@lucide/vue';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

import { createPeriodSerializer } from '../../utils';
import GranularitySelector from '../../components/granularity-selector.vue';
import ReportControls from '../../components/report-controls.vue';
import SummaryCard from '../cash-flow/components/summary-card.vue';
import SummaryRows, { type SummaryRowItem } from '../../components/summary-rows.vue';
import KindFilter from './components/kind-filter.vue';
import NetWorthChart from './components/net-worth-chart.vue';
import SettingsPopover from './components/net-worth-history-settings-popover.vue';
import {
  annualizedGrowthPct,
  assetKindsWithActivity,
  autoGranularity,
  averageOwedLiabilities,
  buildDisplayPoints,
  computePeriodChange,
  disabledGranularities,
  kindsWithActivity,
  NET_WORTH_ASSET_KIND_COLORS,
  NET_WORTH_ASSET_KIND_LABEL_KEYS,
  resolveSelectedKinds,
} from './composables/net-worth-history-derivations';

const DEFAULT_PERIOD_MONTHS = 12;

const getDefaultPeriod = (): Period => ({
  from: startOfMonth(subMonths(new Date(), DEFAULT_PERIOD_MONTHS - 1)),
  to: endOfMonth(new Date()),
});

const periodSerializer = createPeriodSerializer({ getDefaultPeriod });

const selectedPeriod = useSessionStorage<Period>('net-worth-history-period', getDefaultPeriod(), {
  serializer: periodSerializer,
});

// 'auto' derives the granularity from the period length; a concrete value is a
// sticky user override. There is no UI back to 'auto' — the auto value simply
// wins again whenever the override would blow the bucket cap.
const granularityOverride = useLocalStorage<NetWorthHistoryGranularity | 'auto'>(
  'net-worth-history-granularity',
  'auto',
);

// The chart auto-zooms the owed region when debts are tiny next to assets; this
// lets the user turn that off and keep everything on one shared scale.
const zoomLiabilitiesScale = useLocalStorage('net-worth-history-zoom-liabilities-scale', true);

const disabledGranularityValues = computed(() =>
  disabledGranularities({ from: selectedPeriod.value.from, to: selectedPeriod.value.to }),
);

const effectiveGranularity = computed<NetWorthHistoryGranularity>(() => {
  const override = granularityOverride.value;
  if (
    override !== 'auto' &&
    // A granularity dropped from the contract may still be persisted from an older
    // session; ignore it rather than send a value the API now rejects.
    NET_WORTH_HISTORY_GRANULARITIES.includes(override) &&
    !disabledGranularityValues.value.includes(override)
  ) {
    return override;
  }
  return autoGranularity({ from: selectedPeriod.value.from, to: selectedPeriod.value.to });
});

const queryParams = computed(() => ({
  from: selectedPeriod.value.from,
  to: selectedPeriod.value.to,
  granularity: effectiveGranularity.value,
}));

const query = useQuery({
  queryKey: [...VUE_QUERY_CACHE_KEYS.analyticsNetWorthHistory, queryParams],
  queryFn: () => getNetWorthHistory(queryParams.value),
  staleTime: QUERY_CACHE_STALE_TIME.ANALYTICS,
  gcTime: QUERY_CACHE_STALE_TIME.ANALYTICS * 2,
  // Keep the prior range's chart on screen while a new range loads, so changing a
  // control doesn't flash the skeleton back in.
  placeholderData: keepPreviousData,
});

const points = computed(() => query.data.value?.points ?? []);

// Empty = all kinds (the sentinel the filter components share). Kind toggling is
// purely client-side — it reshapes the loaded series, never refetches.
const storedLiabilityKinds = useLocalStorage<NetWorthLiabilityKind[]>('net-worth-history-liability-kinds', []);
const storedAssetKinds = useLocalStorage<NetWorthAssetKind[]>('net-worth-history-asset-kinds', []);

const availableLiabilityKinds = computed(() => kindsWithActivity({ points: points.value }));
const availableAssetKinds = computed(() => assetKindsWithActivity({ points: points.value }));

const selectedLiabilityKinds = computed(() =>
  resolveSelectedKinds({ stored: storedLiabilityKinds.value, available: availableLiabilityKinds.value }),
);
const selectedAssetKinds = computed(() =>
  resolveSelectedKinds({ stored: storedAssetKinds.value, available: availableAssetKinds.value }),
);

const displayPoints = computed(() =>
  buildDisplayPoints({
    points: points.value,
    selectedAssetKinds: selectedAssetKinds.value,
    selectedLiabilityKinds: selectedLiabilityKinds.value,
  }),
);

// The backend returns a full list of all-zero buckets even for a user with no
// balances, so row presence can't distinguish "no data" — only nonzero values can.
const hasData = computed(() => points.value.some((point) => point.assetsTotal !== 0 || point.liabilitiesTotal !== 0));

const { t } = useI18n();
const { formatBaseCurrency } = useFormatCurrency();

const currentNetWorth = computed(() => displayPoints.value[displayPoints.value.length - 1]?.netWorth ?? 0);

const periodChange = computed(() => computePeriodChange({ points: displayPoints.value }));

// Explicit "+" so a gain reads as a change, not a balance.
const formattedPeriodChange = computed(() => {
  const { amount } = periodChange.value;
  return `${amount > 0 ? '+' : ''}${formatBaseCurrency(amount)}`;
});

const formattedPeriodChangePct = computed(() => {
  const pct = periodChange.value.pct;
  if (pct === null) return '';
  return `${pct > 0 ? '+' : ''}${pct.toFixed(1)}%`;
});

// Compound annual growth rate, shown under the period change for ranges of a year
// or more; empty string suppresses the line for shorter or non-positive ranges.
const formattedAnnualizedGrowth = computed(() => {
  const pct = annualizedGrowthPct({ points: displayPoints.value });
  if (pct === null) return '';
  return `${pct > 0 ? '+' : ''}${pct.toFixed(1)}%`;
});

const summaryRows = computed<SummaryRowItem[]>(() => [
  { label: t('netWorthHistory.cards.currentNetWorth'), value: formatBaseCurrency(currentNetWorth.value) },
  {
    label: t('netWorthHistory.cards.periodChange'),
    value: formattedPeriodChange.value,
    valueClass: periodChange.value.amount >= 0 ? 'text-app-income-color' : 'text-app-expense-color',
    hint: [
      periodChange.value.pct === null ? '' : `(${formattedPeriodChangePct.value})`,
      formattedAnnualizedGrowth.value
        ? t('netWorthHistory.cards.annualized', { pct: formattedAnnualizedGrowth.value })
        : '',
    ]
      .filter(Boolean)
      .join(' · '),
  },
]);

const averageOwed = computed(() => averageOwedLiabilities({ points: displayPoints.value }));

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
