<template>
  <div ref="rootRef" class="border-border bg-card space-y-7.5 rounded-lg border p-4">
    <div :class="cn('flex items-center gap-3', isCompact ? 'justify-between' : 'flex-wrap justify-between')">
      <PeriodSelector v-model="period" variant="solid" :class="isCompact && 'min-w-0 flex-1'" />

      <DesktopOnlyTooltip v-if="isCompact" :content="$t('analytics.cashFlow.composition.settings')">
        <span class="inline-flex">
          <Popover>
            <PopoverTrigger as-child>
              <UiButton variant="outline" size="icon-sm" :aria-label="$t('analytics.cashFlow.composition.settings')">
                <SlidersHorizontalIcon class="size-4" />
              </UiButton>
            </PopoverTrigger>
            <PopoverContent align="end" class="w-auto">
              <MoneyFlowSettings
                v-model:source-level="sourceLevel"
                v-model:expense-level="expenseLevel"
                v-model:top-n="topN"
                show-top-n
              />
            </PopoverContent>
          </Popover>
        </span>
      </DesktopOnlyTooltip>

      <div v-else class="flex flex-wrap items-center justify-center gap-2">
        <Popover>
          <PopoverTrigger as-child>
            <UiButton variant="outline" size="sm">
              {{ $t('analytics.cashFlow.composition.detail') }}
              <span class="text-muted-foreground text-xs font-normal">
                {{
                  $t('analytics.cashFlow.composition.levelsSummary', {
                    sources: sourceLevel,
                    expenses: expenseLevel,
                  })
                }}
              </span>
              <ChevronDownIcon class="size-4" />
            </UiButton>
          </PopoverTrigger>
          <PopoverContent align="end" class="w-auto">
            <MoneyFlowSettings v-model:source-level="sourceLevel" v-model:expense-level="expenseLevel" />
          </PopoverContent>
        </Popover>

        <Select v-model="topN">
          <SelectTrigger class="h-8 w-auto gap-2">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem v-for="option in TOP_N_OPTIONS" :key="option" :value="option">
              {{ $t('analytics.cashFlow.composition.topN', { count: option }) }}
            </SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>

    <div v-if="isLoading" class="animate-pulse space-y-7.5">
      <div :class="cn('border-border border-y', isCompact ? 'divide-border divide-y' : 'flex')">
        <div
          v-for="i in 3"
          :key="i"
          :class="
            cn(
              'border-border',
              isCompact
                ? 'flex items-center justify-between px-1 py-2'
                : 'flex flex-1 flex-col gap-1.5 border-r px-4 py-3 last:border-r-0',
            )
          "
        >
          <div class="bg-muted h-3 w-16 rounded" />
          <div class="bg-muted h-6 w-28 rounded" />
        </div>
      </div>
      <CategoryListSkeleton v-if="isCompact" :item-count="6" />
      <ChartSkeleton v-else :show-legend="false" height-class="h-100" />
    </div>

    <div
      v-else-if="error || contributionsError || venturesError || settingsError"
      class="flex h-100 items-center justify-center"
    >
      <div class="text-destructive-text">{{ $t('analytics.cashFlow.composition.loadError') }}</div>
    </div>

    <template v-else-if="flow && flow.income + flow.expenses + flow.taxes + flow.savings > 0">
      <div :class="cn('border-border border-y', isCompact ? 'divide-border divide-y' : 'flex flex-wrap')">
        <div
          v-for="item in summary"
          :key="item.label"
          :class="
            cn(
              'border-border',
              isCompact
                ? 'flex items-baseline justify-between gap-3 px-1 py-2'
                : 'flex flex-1 basis-40 flex-col gap-0.5 border-r px-4 py-3 last:border-r-0',
            )
          "
        >
          <span class="text-muted-foreground flex items-center gap-1.5 text-[11px] font-bold tracking-widest uppercase">
            <span class="size-2 rounded-xs" :style="{ background: item.color }" />
            {{ item.label }}
          </span>
          <span
            :class="
              cn(
                'flex flex-wrap items-baseline gap-x-1.5 leading-tight font-extrabold tabular-nums',
                isCompact ? 'justify-end text-base' : 'text-[22px]',
              )
            "
          >
            {{ formatBaseCurrency(item.value) }}
            <span
              v-if="item.hint"
              :class="
                cn('text-muted-foreground font-semibold whitespace-nowrap', isCompact ? 'text-xs' : 'text-[13px]')
              "
            >
              {{ item.hint }}
            </span>
          </span>
        </div>
      </div>

      <MoneyFlowList v-if="isCompact" :flow="flow" />
      <MoneyFlowChart v-else :flow="flow" />
    </template>

    <div v-else class="flex h-100 items-center justify-center">
      <div class="text-center">
        <div class="text-muted-foreground">{{ $t('analytics.cashFlow.composition.noData') }}</div>
        <div class="text-muted-foreground mt-1 text-sm">{{ $t('analytics.cashFlow.composition.noDataHint') }}</div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { getInvestmentContributions, getSpendingsByCategoriesByType, getVentureContributions } from '@/api';
import { QUERY_CACHE_STALE_TIME, VUE_QUERY_CACHE_KEYS } from '@/common/const';
import UiButton from '@/components/lib/ui/button/Button.vue';
import Popover from '@/components/lib/ui/popover/Popover.vue';
import PopoverContent from '@/components/lib/ui/popover/PopoverContent.vue';
import PopoverTrigger from '@/components/lib/ui/popover/PopoverTrigger.vue';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/lib/ui/select';
import { DesktopOnlyTooltip } from '@/components/lib/ui/tooltip';
import { useFormatCurrency } from '@/composable';
import { useUserSettings } from '@/composable/data-queries/user-settings';
import { useChartColors } from '@/composable/charts/chart-colors';
import { useAnimatedNumber } from '@/composable/use-animated-number';
import type { Period } from '@/composable/use-period-navigation';
import { useCategoriesStore } from '@/stores';
import { keepPreviousData, useQuery } from '@tanstack/vue-query';
import { useElementSize, useLocalStorage } from '@vueuse/core';
import { ChevronDownIcon, SlidersHorizontalIcon } from '@lucide/vue';
import { cn } from '@/lib/utils';
import { storeToRefs } from 'pinia';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';

import { buildMoneyFlow, formatShare, pctOfIncome } from '../utils/build-money-flow';
import CategoryListSkeleton from './category-list-skeleton.vue';
import ChartSkeleton from './chart-skeleton.vue';
import MoneyFlowChart from './money-flow-chart.vue';
import MoneyFlowList from './money-flow-list.vue';
import MoneyFlowSettings, { TOP_N_OPTIONS } from './money-flow-settings.vue';
import PeriodSelector from './period-selector.vue';

const period = defineModel<Period>('period', { required: true });

const { t } = useI18n();
const { categories } = storeToRefs(useCategoriesStore());
const { formatBaseCurrency } = useFormatCurrency();
const colors = useChartColors();
const { data: userSettings, isPending: settingsPending, error: settingsError } = useUserSettings();

// Below this card width the sankey's two label columns leave no room for ribbons; the list layout takes over.
const COMPACT_WIDTH = 560;
const rootRef = ref<HTMLElement | null>(null);
const { width: rootWidth } = useElementSize(rootRef);
const isCompact = computed(() => rootWidth.value > 0 && rootWidth.value < COMPACT_WIDTH);

const sourceLevel = useLocalStorage('cash-flow-composition-source-level', 2);
const expenseLevel = useLocalStorage('cash-flow-composition-expense-level', 1);
const topN = useLocalStorage('cash-flow-composition-top-n', '8');

const queryParams = computed(() => ({
  from: period.value.from,
  to: period.value.to,
  categoryIds: categories.value.map((c) => c.id),
}));

const {
  data: spendings,
  isLoading: spendingsLoading,
  error,
} = useQuery({
  queryKey: [...VUE_QUERY_CACHE_KEYS.analyticsSpendingsByCategories, 'money-flow', queryParams],
  queryFn: () => getSpendingsByCategoriesByType(queryParams.value),
  staleTime: QUERY_CACHE_STALE_TIME.ANALYTICS,
  gcTime: QUERY_CACHE_STALE_TIME.ANALYTICS * 2,
  placeholderData: keepPreviousData,
  enabled: computed(() => categories.value.length > 0),
});

const contributionsParams = computed(() => ({
  from: period.value.from,
  to: period.value.to,
  granularity: 'yearly' as const,
}));
const {
  data: contributions,
  isPending: contributionsPending,
  error: contributionsError,
} = useQuery({
  queryKey: [...VUE_QUERY_CACHE_KEYS.analyticsInvestmentContributions, 'money-flow', contributionsParams],
  queryFn: () => getInvestmentContributions(contributionsParams.value),
  staleTime: QUERY_CACHE_STALE_TIME.ANALYTICS,
  gcTime: QUERY_CACHE_STALE_TIME.ANALYTICS * 2,
  placeholderData: keepPreviousData,
});

const venturesParams = computed(() => ({ from: period.value.from, to: period.value.to }));
const {
  data: ventures,
  isPending: venturesPending,
  error: venturesError,
} = useQuery({
  queryKey: [...VUE_QUERY_CACHE_KEYS.analyticsVentureContributions, venturesParams],
  queryFn: () => getVentureContributions(venturesParams.value),
  staleTime: QUERY_CACHE_STALE_TIME.ANALYTICS,
  gcTime: QUERY_CACHE_STALE_TIME.ANALYTICS * 2,
  placeholderData: keepPreviousData,
});

const isLoading = computed(
  () => spendingsLoading.value || contributionsPending.value || venturesPending.value || settingsPending.value,
);

const flow = computed(() =>
  spendings.value
    ? buildMoneyFlow({
        data: spendings.value,
        categories: categories.value,
        contributions: contributions.value,
        ventures: ventures.value,
        sourceLevel: sourceLevel.value,
        expenseLevel: expenseLevel.value,
        topN: Number(topN.value),
        savingsCategoryIds: userSettings.value?.savingsCategoryIds,
        taxCategoryIds: userSettings.value?.taxCategoryIds,
      })
    : undefined,
);

const { displayValue: animatedIncome } = useAnimatedNumber({ value: computed(() => flow.value?.income ?? 0) });
const { displayValue: animatedExpenses } = useAnimatedNumber({ value: computed(() => flow.value?.expenses ?? 0) });
const { displayValue: animatedTaxes } = useAnimatedNumber({ value: computed(() => flow.value?.taxes ?? 0) });
const { displayValue: animatedNet } = useAnimatedNumber({ value: computed(() => flow.value?.net ?? 0) });

const summary = computed(() => {
  if (!flow.value) return [];
  const { income, expenses, taxes, net } = flow.value;
  return [
    { label: t('analytics.cashFlow.income'), value: animatedIncome.value, color: colors.value.appIncome },
    ...(taxes > 0
      ? [
          {
            label: t('analytics.cashFlow.composition.taxes'),
            value: animatedTaxes.value,
            color: colors.value.primary,
            hint: pctOfIncome({ value: taxes, income, t }),
          },
        ]
      : []),
    {
      label: t('analytics.cashFlow.expenses'),
      value: animatedExpenses.value,
      color: colors.value.appExpense,
      hint: pctOfIncome({ value: expenses, income, t }),
    },
    {
      label: t('analytics.cashFlow.composition.saved'),
      value: animatedNet.value,
      color: colors.value.appSavings,
      hint: income > 0 ? t('analytics.cashFlow.composition.pctSavingsRate', { pct: formatShare(net / income) }) : '',
    },
  ];
});
</script>
