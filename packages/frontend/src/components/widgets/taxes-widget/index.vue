<script lang="ts" setup>
import { getCashFlow } from '@/api/stats';
import type { DashboardWidgetConfig } from '@/api/user-settings';
import { VUE_QUERY_CACHE_KEYS } from '@/common/const';
import { ChartTooltipHeader, ChartTooltipRow } from '@/components/common/charts/chart-tooltip';
import ResponsiveTooltip from '@/components/common/responsive-tooltip.vue';
import SlidingPanels from '@/components/common/sliding-panels.vue';
import { Button, buttonVariants } from '@/components/lib/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/lib/ui/popover';
import { DesktopOnlyTooltip } from '@/components/lib/ui/tooltip';
import { useNotificationCenter } from '@/components/notification-center';
import { AVERAGE_LINE_COLOR } from '@/composable/charts/render-average-line';
import { ApiErrorResponseError } from '@/js/errors';
import { useUserSettings } from '@/composable/data-queries/user-settings';
import { useFormatCurrency } from '@/composable/formatters';
import { cn } from '@/lib/utils';
import { ROUTES_NAMES } from '@/routes/constants';
import { useCategoriesStore, useRootStore } from '@/stores';
import {
  ArrowLeftIcon,
  ArrowUpRightIcon,
  CheckIcon,
  ChevronRightIcon,
  InfoIcon,
  LandmarkIcon,
  SettingsIcon,
} from '@lucide/vue';
import { useQuery } from '@tanstack/vue-query';
import { endOfMonth, format, parseISO, startOfMonth, subMonths } from 'date-fns';
import { storeToRefs } from 'pinia';
import { useI18n } from 'vue-i18n';
import { type Ref, computed, inject, ref, watch } from 'vue';

import EmptyState from '../components/empty-state.vue';
import ErrorState from '../components/error-state.vue';
import LoadingState from '../components/loading-state.vue';
import WidgetWrapper from '../components/widget-wrapper.vue';
import { OTHER_SEGMENT_ID, buildTaxSummary, withDirectChildren } from './build-tax-summary';

defineOptions({ name: 'taxes-widget' });

const TREND_MONTHS = 12;

const WINDOW_OPTIONS = ['3', '6', '12'];
const PANEL_SLIDE_MS = 320;

const widgetConfigRef = inject<Ref<DashboardWidgetConfig> | null>('dashboard-widget-config', null);
const windowMonths = computed(() => {
  const stored = String(widgetConfigRef?.value?.config?.months);
  return WINDOW_OPTIONS.includes(stored) ? Number(stored) : TREND_MONTHS;
});

const isSettingsOpen = ref(false);
const settingsView = ref<'main' | 'months'>('main');
// Reset after the close animation so the popover doesn't flip panels while still visible.
watch(isSettingsOpen, (open) => {
  if (!open) setTimeout(() => (settingsView.value = 'main'), PANEL_SLIDE_MS);
});
const saveWidgetConfig =
  inject<(params: { widgetId: string; config: Record<string, unknown> }) => Promise<void>>(
    'dashboard-save-widget-config',
  );
const { t } = useI18n();
const { addErrorNotification } = useNotificationCenter();

const onWindowChange = async ({ months }: { months: string }) => {
  settingsView.value = 'main';
  if (!saveWidgetConfig || !widgetConfigRef?.value) return;
  try {
    await saveWidgetConfig({ widgetId: widgetConfigRef.value.widgetId, config: { months } });
  } catch (error) {
    if (error instanceof ApiErrorResponseError) {
      addErrorNotification(error.data.message ?? error.message);
    } else {
      // eslint-disable-next-line no-console
      console.error(error);
      addErrorNotification(t('dashboard.widgets.taxes.config.months.saveError'));
    }
  }
};
const MIN_BAR_HEIGHT_PERCENT = 3;

const { isAppInitialized } = storeToRefs(useRootStore());
const { categories } = storeToRefs(useCategoriesStore());
const {
  data: userSettings,
  isPending: isSettingsPending,
  isError: isSettingsError,
  refetch: refetchSettings,
} = useUserSettings();
const { formatBaseCurrency, formatCompactBaseCurrency } = useFormatCurrency();

const taxCategoryIds = computed(() => userSettings.value?.taxCategoryIds ?? []);

const breakdownCategoryIds = computed(() =>
  withDirectChildren({ categoryIds: taxCategoryIds.value, categories: categories.value }),
);

const today = new Date();
const range = { from: startOfMonth(subMonths(today, TREND_MONTHS - 1)), to: endOfMonth(today) };
const rangeKey = format(range.from, 'yyyy-MM');
const hasTaxCategories = computed(() => taxCategoryIds.value.length > 0);
const enabled = computed(() => isAppInitialized.value && hasTaxCategories.value);

const {
  data: allData,
  isFetching: isAllFetching,
  isError: isAllError,
  refetch: refetchAll,
} = useQuery({
  queryKey: computed(() => [...VUE_QUERY_CACHE_KEYS.widgetTaxes, 'all', rangeKey]),
  queryFn: () => getCashFlow({ ...range, granularity: 'monthly' }),
  staleTime: Infinity,
  placeholderData: (prev) => prev,
  enabled,
});

const {
  data: taxData,
  isFetching: isTaxFetching,
  isError: isTaxError,
  refetch: refetchTaxes,
} = useQuery({
  queryKey: computed(() => [...VUE_QUERY_CACHE_KEYS.widgetTaxes, 'taxes', rangeKey, breakdownCategoryIds.value]),
  queryFn: () =>
    getCashFlow({
      ...range,
      granularity: 'monthly',
      categoryIds: breakdownCategoryIds.value,
    }),
  staleTime: Infinity,
  placeholderData: (prev) => prev,
  enabled,
});

const isFetching = computed(() => isAllFetching.value || isTaxFetching.value);
const isError = computed(() => isSettingsError.value || isAllError.value || isTaxError.value);
const retry = () => {
  if (isSettingsError.value) refetchSettings();
  if (isAllError.value) refetchAll();
  if (isTaxError.value) refetchTaxes();
};

const summary = computed(() =>
  allData.value && taxData.value
    ? buildTaxSummary({
        allPeriods: allData.value.periods,
        taxPeriods: taxData.value.periods,
        windowMonths: windowMonths.value,
      })
    : undefined,
);

const formatRate = ({ rate }: { rate: number | null }) => (rate === null ? '–' : `${(rate * 100).toFixed(1)}%`);
const formatShare = ({ share }: { share: number }) => `${Math.round(share * 100)}%`;

const rateDelta = computed(() => {
  const { current, trailing } = summary.value ?? {};
  if (current?.rate == null || trailing?.rate == null) return null;
  const points = (current.rate - trailing.rate) * 100;
  return `${points > 0 ? '+' : ''}${points.toFixed(1)}`;
});

// Floored at 1 so a range without any payment doesn't divide by zero.
const scale = computed(() => Math.max(summary.value?.maxTaxes ?? 0, 1));

const bars = computed(() =>
  (summary.value?.months ?? []).map((month) => {
    const date = parseISO(month.periodStart);
    return {
      ...month,
      label: format(date, 'MMM yyyy'),
      shortLabel: format(date, 'MMM'),
      heightPercent: (Math.max(0, month.taxes) / scale.value) * 100,
    };
  }),
);

const averagePercent = computed(() => ((summary.value?.averageTaxes ?? 0) / scale.value) * 100);
// Share of the bar row taken by the months outside the averaging window.
const averageLineOffset = computed(() => 1 - windowMonths.value / (bars.value.length || 1));
</script>

<template>
  <WidgetWrapper :is-fetching="isFetching">
    <template #title>
      <span class="inline-flex items-center gap-1">
        {{ $t('dashboard.widgets.taxes.title') }}

        <ResponsiveTooltip
          :content="$t('dashboard.widgets.taxes.description')"
          content-class-name="max-w-56"
          :delay-duration="100"
        >
          <InfoIcon class="text-muted-foreground ml-1 size-4 cursor-help" />
        </ResponsiveTooltip>
      </span>
    </template>

    <template v-if="summary" #action>
      <DesktopOnlyTooltip :content="$t('dashboard.widgets.taxes.viewDetails')">
        <span class="inline-flex">
          <router-link
            :class="
              buttonVariants({
                variant: 'ghost',
                size: 'icon-sm',
                class: 'text-muted-foreground',
              })
            "
            :to="{ name: ROUTES_NAMES.analyticsCashFlow }"
            :aria-label="$t('dashboard.widgets.taxes.viewDetails')"
          >
            <ArrowUpRightIcon class="size-4" />
          </router-link>
        </span>
      </DesktopOnlyTooltip>

      <Popover v-model:open="isSettingsOpen">
        <PopoverTrigger as-child>
          <Button size="icon-sm" variant="ghost" :aria-label="$t('common.actions.settings')">
            <SettingsIcon class="text-muted-foreground size-4" />
          </Button>
        </PopoverTrigger>
        <PopoverContent class="w-64 overflow-hidden p-0" align="end">
          <SlidingPanels v-model="settingsView" :panels="['main', 'months']">
            <template #main>
              <div class="flex flex-col">
                <header class="border-b px-3 py-2 text-sm font-medium">
                  {{ $t('common.actions.settings') }}
                </header>

                <div class="flex flex-col p-2">
                  <button
                    type="button"
                    class="hover:bg-accent flex items-center justify-between gap-2 rounded-md px-2 py-2 text-left transition-colors"
                    @click="settingsView = 'months'"
                  >
                    <span class="flex flex-col">
                      <span class="text-sm font-medium">
                        {{ $t('dashboard.widgets.taxes.config.months.label') }}
                      </span>
                      <span class="text-muted-foreground text-xs">
                        {{ $t(`dashboard.widgets.taxes.lastMonths.m${windowMonths}`) }}
                      </span>
                    </span>
                    <ChevronRightIcon class="text-muted-foreground size-4" />
                  </button>
                </div>
              </div>
            </template>

            <template #months>
              <div class="flex flex-col">
                <header class="flex items-center gap-2 border-b px-2 py-2">
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    type="button"
                    :aria-label="$t('common.actions.back')"
                    @click="settingsView = 'main'"
                  >
                    <ArrowLeftIcon class="size-4" />
                  </Button>
                  <span class="text-sm font-medium">
                    {{ $t('dashboard.widgets.taxes.config.months.label') }}
                  </span>
                </header>

                <div class="flex flex-col p-2">
                  <button
                    v-for="option in WINDOW_OPTIONS"
                    :key="option"
                    type="button"
                    class="hover:bg-accent flex items-center justify-between gap-2 rounded-md px-2 py-2 text-left transition-colors"
                    @click="onWindowChange({ months: option })"
                  >
                    <span class="text-sm">{{ $t(`dashboard.widgets.taxes.lastMonths.m${option}`) }}</span>
                    <CheckIcon v-if="String(windowMonths) === option" class="text-primary-text size-4" />
                  </button>
                </div>
              </div>
            </template>
          </SlidingPanels>
        </PopoverContent>
      </Popover>
    </template>

    <template v-if="isError && !summary">
      <ErrorState :message="$t('dashboard.widgets.taxes.loadFailed')" @retry="retry" />
    </template>

    <template v-else-if="isSettingsPending || (hasTaxCategories && !summary)">
      <LoadingState />
    </template>

    <div
      v-else-if="!hasTaxCategories"
      class="flex h-full flex-col items-center justify-center gap-2 text-center"
      data-testid="taxes-no-categories"
    >
      <LandmarkIcon class="text-muted-foreground size-12" />
      <p class="text-sm font-medium">
        {{ $t('dashboard.widgets.taxes.noCategories.title') }}
      </p>
      <p class="text-muted-foreground max-w-64 text-xs">
        {{ $t('dashboard.widgets.taxes.noCategories.description') }}
      </p>
      <router-link
        :class="buttonVariants({ variant: 'outline', size: 'sm', class: 'mt-2' })"
        :to="{ name: ROUTES_NAMES.settingsGeneral }"
      >
        {{ $t('dashboard.widgets.taxes.noCategories.action') }}
      </router-link>
    </div>

    <template v-else-if="summary && summary.trailing.taxes === 0">
      <EmptyState>
        <LandmarkIcon class="size-32" />
      </EmptyState>
    </template>

    <div v-else-if="summary" class="flex h-full flex-col gap-3">
      <div class="flex items-baseline justify-between gap-2">
        <div>
          <span class="text-primary-text text-2xl font-bold tracking-tight tabular-nums">
            {{ formatRate({ rate: summary.current.rate }) }}
          </span>
          <span class="text-muted-foreground ml-1.5 text-xs">{{ $t('dashboard.widgets.taxes.ofIncome') }}</span>
        </div>
        <DesktopOnlyTooltip
          :content="`${formatBaseCurrency(summary.current.taxes)} / ${formatBaseCurrency(summary.current.income)}`"
        >
          <div class="text-muted-foreground text-right text-xs tabular-nums">
            {{ formatCompactBaseCurrency({ amount: summary.current.taxes }) }}
            /
            {{ formatCompactBaseCurrency({ amount: summary.current.income }) }}
          </div>
        </DesktopOnlyTooltip>
      </div>

      <div class="text-muted-foreground flex items-center justify-between gap-2 text-xs tabular-nums">
        <span class="font-medium tracking-tight uppercase">
          {{ $t(`dashboard.widgets.taxes.lastMonths.m${windowMonths}`) }}
        </span>

        <span class="inline-flex items-center gap-1.5" :style="{ color: AVERAGE_LINE_COLOR }">
          <span class="w-4 border-t-2 border-dashed border-current" />
          {{
            $t('dashboard.widgets.taxes.average', {
              amount: formatCompactBaseCurrency({ amount: summary.averageTaxes }),
            })
          }}
        </span>
      </div>

      <p v-if="windowMonths < TREND_MONTHS && rateDelta !== null" class="text-muted-foreground text-xs tabular-nums">
        {{
          $t('dashboard.widgets.taxes.vsTrailingRate', {
            delta: rateDelta,
            rate: formatRate({ rate: summary.trailing.rate }),
          })
        }}
      </p>

      <div class="relative flex min-h-16 flex-1 items-end gap-1">
        <div
          class="pointer-events-none absolute right-0 border-t-2 border-dashed"
          :style="{
            bottom: `${averagePercent}%`,
            // The 0.25rem term is the bar gap, which the percentage alone leaves out.
            left: `calc(${averageLineOffset * 100}% + ${averageLineOffset * 0.25}rem)`,
            borderColor: AVERAGE_LINE_COLOR,
          }"
        />

        <!-- The bar's pseudo-element stretches the hover area over the whole column while the tooltip stays anchored to the bar. -->
        <div v-for="bar in bars" :key="bar.periodStart" class="relative flex h-full flex-1 items-end">
          <ResponsiveTooltip variant="chart" content-class-name="min-w-40" :delay-duration="100">
            <div
              :class="
                cn(
                  'w-full rounded-t-xs transition-all duration-500 before:absolute before:inset-0',
                  bar.isCurrent ? 'bg-primary' : 'bg-primary/25',
                )
              "
              :style="{
                height: `${Math.max(bar.heightPercent, MIN_BAR_HEIGHT_PERCENT)}%`,
              }"
            />
            <template #content>
              <ChartTooltipHeader>{{ bar.label }}</ChartTooltipHeader>
              <ChartTooltipRow
                color="var(--primary)"
                :label="$t('dashboard.widgets.taxes.amount')"
                :value="formatBaseCurrency(bar.taxes)"
              />
              <ChartTooltipRow
                :label="$t('dashboard.widgets.taxes.shareOfIncome')"
                :value="formatRate({ rate: bar.rate })"
              />
            </template>
          </ResponsiveTooltip>
        </div>
      </div>

      <div class="text-muted-foreground flex gap-1 text-[9px] leading-none">
        <span
          v-for="bar in bars"
          :key="bar.periodStart"
          :class="cn('flex-1 text-center', bar.isCurrent && 'text-foreground font-bold')"
        >
          {{ bar.shortLabel }}
        </span>
      </div>

      <template v-if="summary.segments.length">
        <div class="flex h-2 gap-0.5 overflow-hidden rounded-full">
          <ResponsiveTooltip
            v-for="segment in summary.segments"
            :key="segment.id"
            variant="chart"
            content-class-name="min-w-48"
            :delay-duration="100"
          >
            <div
              class="h-full"
              :style="{
                flex: segment.value,
                backgroundColor: segment.color,
              }"
            />
            <template #content>
              <ChartTooltipHeader>
                {{ segment.id === OTHER_SEGMENT_ID ? $t('dashboard.widgets.taxes.other') : segment.name }}
              </ChartTooltipHeader>
              <ChartTooltipRow
                :color="segment.color"
                :label="$t('dashboard.widgets.taxes.amount')"
                :value="formatBaseCurrency(segment.value)"
              />
              <ChartTooltipRow
                :label="$t('dashboard.widgets.taxes.shareOfTaxes')"
                :value="formatShare({ share: segment.share })"
              />
              <ChartTooltipRow
                v-for="child in segment.children"
                :key="child.id"
                :color="child.color"
                :label="child.name"
                :value="formatBaseCurrency(child.value)"
              />
            </template>
          </ResponsiveTooltip>
        </div>

        <div class="text-muted-foreground flex flex-wrap gap-x-3 gap-y-1 text-xs">
          <span v-for="segment in summary.segments" :key="segment.id" class="inline-flex min-w-0 items-center gap-1.5">
            <span class="size-2 shrink-0 rounded-xs" :style="{ backgroundColor: segment.color }" />
            <span class="truncate">
              {{
                segment.id === OTHER_SEGMENT_ID
                  ? $t('dashboard.widgets.taxes.moreCategories', {
                      count: segment.children?.length ?? 0,
                    })
                  : segment.name
              }}
            </span>
            <span class="tabular-nums">{{ formatShare({ share: segment.share }) }}</span>
          </span>
        </div>
      </template>
    </div>
  </WidgetWrapper>
</template>
