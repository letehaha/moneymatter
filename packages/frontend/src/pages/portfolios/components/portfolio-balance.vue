<template>
  <Card class="@container/balance overflow-hidden">
    <!-- Loading State (skeleton matches loaded layout to prevent jumps) -->
    <div v-if="isLoading" class="p-6">
      <!-- Total Value skeleton -->
      <div class="space-y-2">
        <div class="bg-muted h-9 w-48 animate-pulse rounded" />
        <div class="bg-muted h-5 w-36 animate-pulse rounded" />
        <div class="bg-muted h-4 w-20 animate-pulse rounded" />
      </div>
      <!-- Metrics skeleton -->
      <div class="mt-5 grid grid-cols-2 gap-4 border-t pt-5 @md/balance:grid-cols-4">
        <div v-for="i in 4" :key="i" class="space-y-1.5">
          <div class="bg-muted h-3 w-16 animate-pulse rounded" />
          <div class="bg-muted h-5 w-24 animate-pulse rounded" />
          <div class="bg-muted h-3 w-12 animate-pulse rounded" />
        </div>
      </div>
    </div>

    <!-- Error State -->
    <div v-else-if="error" class="p-6 text-center">
      <div class="bg-destructive/10 mx-auto mb-3 flex size-10 items-center justify-center rounded-full">
        <TrendingDownIcon class="text-destructive-text size-5" />
      </div>
      <p class="text-destructive-text text-sm">{{ $t('portfolioDetail.balance.loadError') }}</p>
    </div>

    <!-- Content -->
    <div v-else-if="summary" class="p-6">
      <!--
        Container query breakpoints (based on card width):
        - < 28rem (448px): value on top, metrics 2x2 grid below
        - 28rem–56rem: value on top, metrics 4-col row below
        - >= 56rem (896px): all in one row with border-l divider
      -->

      <div class="@3xl/balance:flex @3xl/balance:items-center @3xl/balance:gap-8">
        <!-- Total Value + Gain -->
        <div class="shrink-0">
          <div class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h2 class="text-3xl font-semibold tracking-tight">
              {{ formatCurrency(Number(summary.totalPortfolioValue), summary.currencyCode) }}
            </h2>
            <div :class="getGainColorClass({ gainValue: getTotalGainValue() })" class="flex items-center gap-1.5">
              <component :is="getTotalGainValue() >= 0 ? TrendingUpIcon : TrendingDownIcon" class="size-4" />
              <span class="text-sm font-medium">
                {{ getTotalGainValue() >= 0 ? '+' : '' }}{{ formatCurrency(getTotalGainValue(), summary.currencyCode) }}
              </span>
              <span class="text-xs">
                ({{ getTotalGainPercent() >= 0 ? '+' : '' }}{{ getTotalGainPercent().toFixed(2) }}%)
              </span>
            </div>
          </div>
          <!-- Base-currency equivalent, only when the display currency differs -->
          <i18n-t
            v-if="summary.baseCurrencyCode && summary.currencyCode !== summary.baseCurrencyCode"
            keypath="portfolioDetail.balance.baseCurrencyEquivalent"
            tag="p"
            class="text-muted-foreground mt-1 text-base tabular-nums"
          >
            <template #value>
              <span class="text-foreground font-medium">
                {{ formatCurrency(Number(summary.totalPortfolioValueInBaseCurrency), summary.baseCurrencyCode) }}
              </span>
            </template>
            <template #code>{{ summary.baseCurrencyCode }}</template>
          </i18n-t>
          <p class="text-muted-foreground mt-0.5 text-sm">{{ $t('portfolioDetail.balance.totalValue') }}</p>
        </div>

        <!-- Metrics Grid -->
        <div
          class="mt-5 grid grid-cols-2 gap-4 border-t pt-5 @md/balance:grid-cols-4 @3xl/balance:mt-0 @3xl/balance:flex-1 @3xl/balance:border-t-0 @3xl/balance:border-l @3xl/balance:pt-0 @3xl/balance:pl-8"
        >
          <!-- Cost Basis -->
          <div class="space-y-0.5">
            <p class="text-muted-foreground text-xs font-medium tracking-wide uppercase">
              {{ $t('portfolioDetail.balance.metrics.costBasis') }}
            </p>
            <p class="text-base font-semibold">
              {{ formatCurrency(Number(summary.totalCostBasis), summary.currencyCode) }}
            </p>
          </div>

          <!-- Unrealized Gains -->
          <div class="space-y-0.5">
            <p class="text-muted-foreground text-xs font-medium tracking-wide uppercase">
              {{ $t('portfolioDetail.balance.metrics.unrealized') }}
            </p>
            <div :class="getGainColorClass({ gainValue: Number(summary.unrealizedGainValue) })">
              <p class="text-base font-semibold">
                {{ Number(summary.unrealizedGainValue) >= 0 ? '+' : ''
                }}{{ formatCurrency(Number(summary.unrealizedGainValue), summary.currencyCode) }}
              </p>
              <p class="text-xs">
                {{ Number(summary.unrealizedGainPercent) >= 0 ? '+' : ''
                }}{{ Number(summary.unrealizedGainPercent).toFixed(2) }}%
              </p>
            </div>
          </div>

          <!-- Realized Gains -->
          <div class="space-y-0.5">
            <p class="text-muted-foreground text-xs font-medium tracking-wide uppercase">
              {{ $t('portfolioDetail.balance.metrics.realized') }}
            </p>
            <div :class="getGainColorClass({ gainValue: Number(summary.realizedGainValue) })">
              <p class="text-base font-semibold">
                {{ Number(summary.realizedGainValue) >= 0 ? '+' : ''
                }}{{ formatCurrency(Number(summary.realizedGainValue), summary.currencyCode) }}
              </p>
              <p class="text-xs">
                {{ Number(summary.realizedGainPercent) >= 0 ? '+' : ''
                }}{{ Number(summary.realizedGainPercent).toFixed(2) }}%
              </p>
            </div>
          </div>

          <!-- Total Return -->
          <div class="space-y-0.5">
            <p class="text-muted-foreground text-xs font-medium tracking-wide whitespace-nowrap uppercase">
              {{ $t('portfolioDetail.balance.metrics.totalReturn') }}
            </p>
            <div :class="getGainColorClass({ gainValue: getTotalGainValue() })">
              <p class="text-base font-semibold">
                {{ getTotalGainValue() >= 0 ? '+' : '' }}{{ formatCurrency(getTotalGainValue(), summary.currencyCode) }}
              </p>
              <p class="text-xs">{{ getTotalGainPercent() >= 0 ? '+' : '' }}{{ getTotalGainPercent().toFixed(2) }}%</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  </Card>
</template>

<script setup lang="ts">
import { Card } from '@/components/lib/ui/card';
import { usePortfolioSummary } from '@/composable/data-queries/portfolio-summary';
import { useFormatCurrency } from '@/composable/formatters';
import { toLocalNumber } from '@/js/helpers/formatters';
import { getGainColorClass } from '@/composable/gain-color';
import { useCurrenciesStore } from '@/stores/currencies';
import { TrendingDownIcon, TrendingUpIcon } from '@lucide/vue';
import { storeToRefs } from 'pinia';
import { toRef } from 'vue';

const props = defineProps<{ portfolioId: string }>();
const portfolioId = toRef(props, 'portfolioId');

const { data: summary, isLoading, error } = usePortfolioSummary(portfolioId);

const { formatAmountByCurrencyCode } = useFormatCurrency();
const { currencies } = storeToRefs(useCurrenciesStore());

const formatCurrency = (amount: number, currencyCode: string) => {
  const userCurrency = currencies.value.find((c) => c.currency?.code === currencyCode.toUpperCase());
  if (!userCurrency) {
    return toLocalNumber(amount, { maximumFractionDigits: 2 });
  }
  return formatAmountByCurrencyCode(amount, userCurrency.currencyCode);
};

const getTotalGainValue = () => {
  if (!summary.value) return 0;
  return Number(summary.value.unrealizedGainValue) + Number(summary.value.realizedGainValue);
};

const getTotalGainPercent = () => {
  if (!summary.value || Number(summary.value.totalCostBasis) === 0) return 0;
  return (getTotalGainValue() / Number(summary.value.totalCostBasis)) * 100;
};
</script>
