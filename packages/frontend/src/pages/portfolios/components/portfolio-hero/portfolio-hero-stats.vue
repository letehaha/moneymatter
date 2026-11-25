<script setup lang="ts">
import { getGainColorClass } from '@/composable/gain-color';
import { cn } from '@/lib/utils';
import type { PortfolioSummaryModel } from '@bt/shared/types/investments/portfolio-summary.model';
import { computed } from 'vue';

import { getTotalReturn } from './portfolio-hero-derivations';
import { useHeroFormat } from './use-hero-format';

const props = defineProps<{
  variant: 'card' | 'panel';
  summary: PortfolioSummaryModel;
  periodLabel: string;
  /** Derived from the value history, so its money is in `historyCurrencyCode`. */
  periodStats: { marketGain: number; returnPct: number } | null;
  /** Latest cumulative net deposits in `historyCurrencyCode`; null while the history is unavailable. */
  netDeposits: number | null;
  /** The history falls back to the base currency when the display rate is missing, so it can differ from the summary's. */
  historyCurrencyCode: string;
}>();

const { formatMoney, formatSignedMoney, formatPercent } = useHeroFormat({
  currencyCode: () => props.summary.currencyCode,
});
const { formatMoney: formatBaseMoney } = useHeroFormat({ currencyCode: () => props.summary.baseCurrencyCode });
const { formatMoney: formatHistoryMoney, formatSignedMoney: formatSignedHistoryMoney } = useHeroFormat({
  currencyCode: () => props.historyCurrencyCode,
});

const totalValue = computed(() => Number(props.summary.totalPortfolioValue));
// Summary value minus history deposits only makes sense when both sides share a currency.
const totalReturnStats = computed(() =>
  props.historyCurrencyCode === props.summary.currencyCode
    ? getTotalReturn({ totalValue: totalValue.value, netDeposits: props.netDeposits })
    : null,
);
const totalReturn = computed(() => totalReturnStats.value?.amount ?? null);
const totalReturnPct = computed(() => totalReturnStats.value?.pct ?? null);
const unrealized = computed(() => Number(props.summary.unrealizedGainValue));
const realized = computed(() => Number(props.summary.realizedGainValue));

const showBaseEquivalent = computed(
  () => props.summary.baseCurrencyCode && props.summary.currencyCode !== props.summary.baseCurrencyCode,
);

const labelClass = 'text-muted-foreground text-xs font-semibold tracking-wide uppercase';
</script>

<template>
  <div
    :class="
      cn(
        '@container/stats flex flex-col',
        variant === 'card'
          ? 'bg-card/80 gap-2 rounded-xl border px-4 py-3 shadow-lg backdrop-blur-md'
          : 'bg-card gap-4 rounded-xl border p-5',
      )
    "
  >
    <div>
      <p :class="labelClass">{{ $t('portfolioDetail.hero.stats.totalValue') }}</p>
      <p class="text-3xl leading-tight font-bold tracking-tight tabular-nums">
        {{ formatMoney({ amount: totalValue }) }}
      </p>
      <i18n-t
        v-if="showBaseEquivalent"
        keypath="portfolioDetail.balance.baseCurrencyEquivalent"
        tag="p"
        class="text-muted-foreground text-sm tabular-nums"
      >
        <template #value>
          <span class="text-foreground font-medium">
            {{ formatBaseMoney({ amount: Number(summary.totalPortfolioValueInBaseCurrency) }) }}
          </span>
        </template>
        <template #code>{{ summary.baseCurrencyCode }}</template>
      </i18n-t>
      <div class="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
        <span
          v-if="periodStats"
          :class="
            cn(
              'rounded-full px-2 py-0.5 font-semibold tabular-nums',
              periodStats.returnPct >= 0 ? 'bg-success/10' : 'bg-destructive/10',
              getGainColorClass({ gainValue: periodStats.returnPct }),
            )
          "
        >
          {{ formatPercent({ fraction: periodStats.returnPct }) }}
        </span>
        <span
          :class="
            cn('font-semibold tabular-nums', periodStats && getGainColorClass({ gainValue: periodStats.marketGain }))
          "
        >
          {{ formatSignedHistoryMoney({ amount: periodStats?.marketGain ?? null }) }}
        </span>
        <span class="text-muted-foreground">
          {{
            $t(
              (periodStats?.marketGain ?? 0) >= 0
                ? 'portfolioDetail.hero.stats.marketGain'
                : 'portfolioDetail.hero.stats.marketLoss',
              {
                period: periodLabel,
              },
            )
          }}
        </span>
      </div>
    </div>

    <div
      v-if="variant === 'card'"
      class="grid grid-cols-1 divide-y border-t text-sm tabular-nums @xs/stats:grid-cols-3 @xs/stats:gap-3 @xs/stats:divide-y-0 @xs/stats:pt-2"
    >
      <div class="flex min-w-0 items-baseline justify-between gap-4 py-1.5 @xs/stats:block @xs/stats:py-0">
        <p :class="labelClass">{{ $t('portfolioDetail.hero.stats.netDeposits') }}</p>
        <p class="truncate font-semibold @xs/stats:mt-0.5">
          {{ formatHistoryMoney({ amount: netDeposits }) }}
        </p>
      </div>
      <div class="flex min-w-0 items-baseline justify-between gap-4 py-1.5 @xs/stats:block @xs/stats:py-0">
        <p :class="labelClass">{{ $t('portfolioDetail.hero.stats.totalReturn') }}</p>
        <p
          :class="
            cn(
              'truncate font-semibold @xs/stats:mt-0.5',
              totalReturn !== null && getGainColorClass({ gainValue: totalReturn }),
            )
          "
        >
          {{ totalReturn === null ? '—' : formatSignedMoney({ amount: totalReturn }) }}
        </p>
      </div>
      <div class="flex min-w-0 items-baseline justify-between gap-4 py-1.5 @xs/stats:block @xs/stats:py-0">
        <p :class="labelClass">{{ $t('portfolioDetail.hero.stats.unrealized') }}</p>
        <p :class="cn('truncate font-semibold @xs/stats:mt-0.5', getGainColorClass({ gainValue: unrealized }))">
          {{ formatSignedMoney({ amount: unrealized }) }}
        </p>
      </div>
    </div>

    <dl v-else class="divide-y text-sm tabular-nums">
      <div class="flex items-baseline justify-between gap-4 py-2">
        <dt class="text-muted-foreground">{{ $t('portfolioDetail.hero.stats.netDeposits') }}</dt>
        <dd class="font-semibold">{{ formatHistoryMoney({ amount: netDeposits }) }}</dd>
      </div>
      <div class="flex items-baseline justify-between gap-4 py-2">
        <dt class="text-muted-foreground">{{ $t('portfolioDetail.hero.stats.costBasis') }}</dt>
        <dd class="font-semibold">{{ formatMoney({ amount: Number(summary.totalCostBasis) }) }}</dd>
      </div>
      <div class="flex items-baseline justify-between gap-4 py-2">
        <dt class="text-muted-foreground">{{ $t('portfolioDetail.hero.stats.unrealized') }}</dt>
        <dd :class="cn('text-right font-semibold', getGainColorClass({ gainValue: unrealized }))">
          {{ formatSignedMoney({ amount: unrealized }) }} ·
          {{ formatPercent({ fraction: Number(summary.unrealizedGainPercent) / 100 }) }}
        </dd>
      </div>
      <div class="flex items-baseline justify-between gap-4 py-2">
        <dt class="text-muted-foreground">{{ $t('portfolioDetail.hero.stats.realized') }}</dt>
        <dd :class="cn('font-semibold', getGainColorClass({ gainValue: realized }))">
          {{ formatSignedMoney({ amount: realized }) }}
        </dd>
      </div>
      <div class="flex items-baseline justify-between gap-4 py-2">
        <dt class="text-muted-foreground">{{ $t('portfolioDetail.hero.stats.cash') }}</dt>
        <dd class="font-semibold">{{ formatMoney({ amount: Number(summary.totalCashInBaseCurrency) }) }}</dd>
      </div>
      <div class="flex items-baseline justify-between gap-4 py-2">
        <dt class="font-semibold">{{ $t('portfolioDetail.hero.stats.totalReturn') }}</dt>
        <dd :class="cn('text-right font-bold', totalReturn !== null && getGainColorClass({ gainValue: totalReturn }))">
          <template v-if="totalReturn === null">—</template>
          <template v-else>
            {{ formatSignedMoney({ amount: totalReturn }) }}
            <template v-if="totalReturnPct !== null"> · {{ formatPercent({ fraction: totalReturnPct }) }}</template>
          </template>
        </dd>
      </div>
    </dl>
  </div>
</template>
