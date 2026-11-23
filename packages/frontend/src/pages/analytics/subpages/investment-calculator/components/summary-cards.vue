<template>
  <div
    data-testid="summary-cards"
    class="border-border grid grid-cols-2 gap-3 border-b pb-6 sm:grid-cols-[repeat(auto-fill,minmax(200px,1fr))] sm:gap-4"
  >
    <div v-for="card in cards" :key="card.title">
      <div class="text-muted-foreground mb-1 text-xs sm:text-sm">
        <ResponsiveTooltip v-if="card.tooltip" :content="card.tooltip" content-class-name="max-w-56">
          <span class="cursor-help underline decoration-dashed underline-offset-2">{{ card.title }}</span>
        </ResponsiveTooltip>
        <template v-else>{{ card.title }}</template>
      </div>
      <div class="text-base font-semibold sm:text-lg lg:text-xl" :class="card.valueClass">
        {{ card.value }}
      </div>
      <div v-if="card.subtitle" class="mt-0.5 text-xs" :class="card.subtitleClass ?? 'text-muted-foreground'">
        {{ card.subtitle }}
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import ResponsiveTooltip from '@/components/common/responsive-tooltip.vue';
import { useFormatCurrency } from '@/composable';
import { maskAmountText } from '@/js/helpers/formatters';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

import type { ProjectionSummary } from '../composables/use-projection-calc';

const props = defineProps<{
  summary: ProjectionSummary;
}>();

const { t } = useI18n();
const { formatBaseCurrency } = useFormatCurrency();

const cards = computed(() => [
  {
    title: t('analytics.investmentCalculator.totalInvested'),
    value: formatBaseCurrency(props.summary.totalInvested),
    subtitle: t('analytics.investmentCalculator.totalInvestedBreakdown', {
      initial: formatBaseCurrency(props.summary.initialBalance),
      contributions: formatBaseCurrency(props.summary.totalContributions),
    }),
  },
  {
    title: t('analytics.investmentCalculator.nominalFinalValue'),
    value: formatBaseCurrency(props.summary.nominalFinalValue),
    valueClass: props.summary.nominalGrowth > 0 ? 'text-app-income-color' : undefined,
    subtitle: `${maskAmountText({ text: `${props.summary.nominalGrowth > 0 ? '+' : ''}${formatBaseCurrency(props.summary.nominalGrowth)}` })} ${t('analytics.investmentCalculator.growth')}`,
    subtitleClass: props.summary.nominalGrowth > 0 ? 'text-app-income-color/70' : 'text-muted-foreground',
  },
  {
    title: t('analytics.investmentCalculator.realFinalValue'),
    value: formatBaseCurrency(props.summary.realFinalValue),
    valueClass: props.summary.realGrowth > 0 ? 'text-app-income-color' : undefined,
    subtitle: `${maskAmountText({ text: `${props.summary.realGrowth > 0 ? '+' : ''}${formatBaseCurrency(props.summary.realGrowth)}` })} ${t('analytics.investmentCalculator.realGrowth')}`,
    subtitleClass: props.summary.realGrowth > 0 ? 'text-app-income-color/70' : 'text-muted-foreground',
  },
  {
    title: t('analytics.investmentCalculator.realMultiplier'),
    tooltip: t('analytics.investmentCalculator.realMultiplierTooltip'),
    value: `${props.summary.realMultiplier.toFixed(1)}x`,
    valueClass: props.summary.realMultiplier > 1 ? 'text-app-income-color' : undefined,
    subtitle: t('analytics.investmentCalculator.ofMoneyInvested'),
  },
]);
</script>
