<template>
  <!-- Loading State -->
  <div v-if="isFetching && !summary" class="space-y-1.5">
    <div class="bg-muted h-7 w-28 animate-pulse rounded" />
    <div class="bg-muted h-5 w-24 animate-pulse rounded" />
    <div class="bg-muted h-4 w-20 animate-pulse rounded" />
  </div>

  <!-- Loaded State -->
  <div v-else-if="hasValue" class="space-y-1.5">
    <!-- Total Value -->
    <p class="text-2xl font-bold tracking-tight">
      {{ formattedValue }}
    </p>

    <!-- Unrealized Gain/Loss -->
    <div v-if="summary" class="flex items-center gap-1.5" :class="gainColorClass">
      <component :is="gainIcon" class="size-3.5" />
      <span class="text-sm font-medium">
        {{ unrealizedGainFormatted }}
      </span>
      <span class="text-xs opacity-80"> ({{ unrealizedPercentFormatted }}) </span>
    </div>

    <!-- Cost Basis -->
    <p v-if="summary" class="text-muted-foreground text-xs">
      {{ $t('investments.card.costBasis') }}: {{ formattedCostBasis }}
    </p>
  </div>

  <!-- No Data -->
  <div v-else class="text-2xl font-bold tracking-tight">-</div>
</template>

<script setup lang="ts">
import { usePortfolioSummaries } from '@/composable/data-queries/portfolio-summary';
import { useFormatCurrency } from '@/composable/formatters';
import { maskAmountText } from '@/js/helpers/formatters';
import type { UserCurrencyModel } from '@bt/shared/types';
import { TrendingDownIcon, TrendingUpIcon } from '@lucide/vue';
import { computed } from 'vue';

const props = defineProps<{
  portfolioId: string;
  currencies: UserCurrencyModel[];
}>();

const { data: summaries, isFetching } = usePortfolioSummaries();
const summary = computed(() => summaries.value?.find((item) => item.portfolioId === props.portfolioId));
const { formatCompactAmount } = useFormatCurrency();

const hasValue = computed(
  () => summary.value && summary.value.totalPortfolioValue !== undefined && summary.value.totalPortfolioValue !== null,
);

const findUserCurrency = (currencyCode: string) =>
  props.currencies.find((c) => c.currency?.code === currencyCode.toUpperCase());

const formatCurrency = ({ amount, currencyCode }: { amount: number; currencyCode: string }) => {
  const userCurrency = findUserCurrency(currencyCode);
  return formatCompactAmount(amount, userCurrency?.currencyCode ?? currencyCode);
};

const formattedValue = computed(() => {
  if (!summary.value) return '';
  return formatCurrency({
    amount: Number(summary.value.totalPortfolioValue),
    currencyCode: summary.value.currencyCode,
  });
});

const formattedCostBasis = computed(() => {
  if (!summary.value) return '';
  return formatCurrency({
    amount: Number(summary.value.totalCostBasis),
    currencyCode: summary.value.currencyCode,
  });
});

const unrealizedGainValue = computed(() => (summary.value ? Number(summary.value.unrealizedGainValue) : 0));
const unrealizedGainPercent = computed(() => (summary.value ? Number(summary.value.unrealizedGainPercent) : 0));

const unrealizedGainFormatted = computed(() => {
  if (!summary.value) return '';
  const sign = unrealizedGainValue.value >= 0 ? '+' : '';
  return maskAmountText({
    text: `${sign}${formatCurrency({ amount: unrealizedGainValue.value, currencyCode: summary.value.currencyCode })}`,
  });
});

const unrealizedPercentFormatted = computed(() => {
  const sign = unrealizedGainPercent.value >= 0 ? '+' : '';
  return `${sign}${unrealizedGainPercent.value.toFixed(2)}%`;
});

const gainColorClass = computed(() => {
  if (unrealizedGainPercent.value > 0) return 'text-green-600';
  if (unrealizedGainPercent.value < 0) return 'text-destructive-text';
  return 'text-muted-foreground';
});

const gainIcon = computed(() => (unrealizedGainValue.value >= 0 ? TrendingUpIcon : TrendingDownIcon));
</script>
