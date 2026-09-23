<script setup lang="ts">
import { loadBudgetPlan, loadBudgetPlanPeriodView, loadBudgetPlanPeriods } from '@/api/budget-plans';
import { VUE_QUERY_CACHE_KEYS } from '@/common/const';
import PageWrapper from '@/components/common/page-wrapper.vue';
import { Button } from '@/components/lib/ui/button';
import { Callout } from '@/components/lib/ui/callout';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/lib/ui/collapsible';
import { DesktopOnlyTooltip } from '@/components/lib/ui/tooltip';
import { useFormatCurrency } from '@/composable';
import { isResourceMissingError } from '@/js/errors';
import { cn } from '@/lib/utils';
import { ROUTES_NAMES } from '@/routes/constants';
import { useCategoriesStore } from '@/stores';
import type { BudgetPlanLineEntry } from '@bt/shared/types';
import { ChevronDownIcon, InfoIcon, PlusIcon, Settings2Icon } from '@lucide/vue';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/vue-query';
import { storeToRefs } from 'pinia';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';

import BudgetHeaderTiles from './components/budget-header-tiles.vue';
import BudgetLinesGrid from './components/budget-lines-grid.vue';
import BudgetPlanSkeleton from './components/budget-plan-skeleton.vue';
import LineDialog from './components/line-dialog.vue';
import PeriodPicker from './components/period-picker.vue';
import PlanSettingsSheet from './components/plan-settings-sheet.vue';
import { cadenceLabel, lineIdsWithHistory } from './helpers';

const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const queryClient = useQueryClient();
const { formatBaseCurrency } = useFormatCurrency();
const { categoriesMap } = storeToRefs(useCategoriesStore());

const planId = computed(() => String(route.params.planId));

const isSettingsOpen = ref(false);
const isLineDialogOpen = ref(false);
const lineToEdit = ref<BudgetPlanLineEntry | undefined>();

const {
  data: plan,
  error: planError,
  refetch: refetchPlan,
} = useQuery({
  queryKey: computed(() => [...VUE_QUERY_CACHE_KEYS.budgetPlan, planId.value]),
  queryFn: () => loadBudgetPlan({ planId: planId.value }),
});

const {
  data: periods,
  error: periodsError,
  refetch: refetchPeriods,
} = useQuery({
  queryKey: computed(() => [...VUE_QUERY_CACHE_KEYS.budgetPlanPeriods, planId.value]),
  queryFn: () => loadBudgetPlanPeriods({ planId: planId.value }),
});

const selectedPeriodId = computed(() => {
  const list = periods.value ?? [];
  const requested = typeof route.query.period === 'string' ? route.query.period : undefined;
  if (requested && list.some((period) => period.id === requested)) return requested;
  return list.find((period) => period.isCurrent)?.id ?? list[0]?.id;
});

const selectedPeriod = computed(() => periods.value?.find((period) => period.id === selectedPeriodId.value));

const {
  data: view,
  error: viewError,
  isPlaceholderData: isViewPlaceholder,
  refetch: refetchView,
} = useQuery({
  queryKey: computed(() => [...VUE_QUERY_CACHE_KEYS.budgetPlanPeriodView, planId.value, selectedPeriodId.value]),
  queryFn: () => loadBudgetPlanPeriodView({ planId: planId.value, periodId: selectedPeriodId.value! }),
  enabled: computed(() => Boolean(selectedPeriodId.value)),
  placeholderData: keepPreviousData,
});

const isPlanMissing = computed(
  () => isResourceMissingError(planError.value) || isResourceMissingError(periodsError.value),
);
// A failed background refetch keeps the cached data, so only a query with nothing to show counts as a load error.
const hasLoadError = computed(
  () =>
    !isPlanMissing.value &&
    Boolean(
      (planError.value && !plan.value) || (periodsError.value && !periods.value) || (viewError.value && !view.value),
    ),
);

// Drop the cache first, otherwise the budget page reads the stale list and redirects straight back here.
watch(
  isPlanMissing,
  (missing) => {
    if (!missing) return;
    queryClient.removeQueries({ queryKey: VUE_QUERY_CACHE_KEYS.budgetPlans });
    router.replace({ name: ROUTES_NAMES.budget });
  },
  { immediate: true },
);

const retryLoad = () => {
  if (planError.value) refetchPlan();
  if (periodsError.value) refetchPeriods();
  if (viewError.value) refetchView();
};

const selectPeriod = ({ periodId }: { periodId: string }) => {
  router.replace({ query: { ...route.query, period: periodId } });
};

const subtitle = computed(() => {
  if (!plan.value) return '';
  const { key, params } = cadenceLabel({ cadence: plan.value.plan.cadence, intervalN: plan.value.plan.intervalN });
  if (!view.value) return t(key, params);
  return `${t(key, params)} · ${t('budgetPlans.lineCount', { count: view.value.lines.length })}`;
});

const archivedLines = computed(() => (plan.value?.lines ?? []).filter((line) => line.activeUntil !== null));

const historyLineIds = computed(() =>
  lineIdsWithHistory({ lines: plan.value?.lines ?? [], periods: periods.value ?? [] }),
);

// The backend rejects future starts, so current and future periods leave it unset and default to the current period.
const pastActiveFrom = computed(() => {
  const current = periods.value?.find((period) => period.isCurrent);
  const selected = selectedPeriod.value;
  return selected && current && selected.startDate < current.startDate ? selected.startDate : undefined;
});

const unbudgetedTotal = computed(() =>
  (view.value?.unbudgeted ?? []).reduce((sum, entry) => sum + Math.abs(entry.activity), 0),
);

const openLineDialog = ({ lineId }: { lineId?: string }) => {
  const line = plan.value?.lines.find((entry) => entry.id === lineId);
  if (lineId && !line) return;
  lineToEdit.value = line;
  isLineDialogOpen.value = true;
};
</script>

<template>
  <PageWrapper>
    <div class="@container/budget-plan grid gap-6">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div class="min-w-0">
          <h1 class="text-2xl font-semibold tracking-tight wrap-break-word">
            {{ plan?.plan.name ?? $t('budgetPlans.title') }}
          </h1>
          <p class="text-muted-foreground mt-1 text-sm">{{ subtitle }}</p>
        </div>

        <div class="flex min-w-0 items-center gap-2">
          <PeriodPicker
            :periods="periods ?? []"
            :selected-id="selectedPeriodId"
            @select="(periodId) => selectPeriod({ periodId })"
          />

          <DesktopOnlyTooltip :content="$t('budgetPlans.settings.title')">
            <Button
              variant="outline"
              size="sm"
              :disabled="!plan"
              :aria-label="$t('budgetPlans.settings.title')"
              @click="isSettingsOpen = true"
            >
              <Settings2Icon class="size-4" />
              <span class="hidden @lg/budget-plan:inline">{{ $t('budgetPlans.settings.title') }}</span>
            </Button>
          </DesktopOnlyTooltip>
        </div>
      </div>

      <Callout v-if="hasLoadError" variant="destructive">
        <p>{{ $t('budgetPlans.loadError') }}</p>
        <Button variant="outline" size="sm" class="mt-3" @click="retryLoad">
          {{ $t('common.actions.retry') }}
        </Button>
      </Callout>

      <BudgetPlanSkeleton v-else-if="!view" />

      <div
        v-else
        :inert="isViewPlaceholder"
        :class="cn('grid gap-6 transition-opacity', isViewPlaceholder && 'opacity-60')"
      >
        <BudgetHeaderTiles :view="view" />

        <BudgetLinesGrid
          :plan-id="planId"
          :view="view"
          :archived-lines="archivedLines"
          :history-line-ids="historyLineIds"
          @edit="(line) => openLineDialog({ lineId: line.lineId })"
        />

        <div>
          <Button variant="outline" @click="openLineDialog({})">
            <PlusIcon class="size-4" />
            {{ $t('budgetPlans.grid.addLine') }}
          </Button>
        </div>

        <Collapsible v-if="view.unbudgeted.length" v-slot="{ open }">
          <CollapsibleTrigger as-child>
            <Button variant="outline" class="border-border bg-muted/40 h-auto w-full justify-start py-3 font-normal">
              <InfoIcon class="text-muted-foreground size-4 shrink-0" />
              <span class="min-w-0 flex-1 truncate text-left">
                {{
                  $t('budgetPlans.unbudgeted.summary', {
                    amount: formatBaseCurrency(unbudgetedTotal),
                    count: view.unbudgeted.length,
                  })
                }}
              </span>
              <ChevronDownIcon
                :class="cn('text-muted-foreground size-4 shrink-0 transition-transform', open && 'rotate-180')"
              />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div class="border-border mt-2 grid gap-1 rounded-lg border p-3">
              <div v-for="entry in view.unbudgeted" :key="entry.categoryId" class="flex justify-between gap-3 text-sm">
                <span class="truncate">{{ categoriesMap[entry.categoryId]?.name }}</span>
                <span class="tabular-nums">{{ formatBaseCurrency(Math.abs(entry.activity)) }}</span>
              </div>
            </div>
          </CollapsibleContent>
        </Collapsible>
      </div>

      <LineDialog
        v-model:open="isLineDialogOpen"
        :plan-id="planId"
        :line="lineToEdit"
        :lines="plan?.lines ?? []"
        :period-lines="pastActiveFrom ? view?.lines : undefined"
        :active-from="pastActiveFrom"
      />

      <PlanSettingsSheet v-if="plan" v-model:open="isSettingsOpen" :plan="plan" />
    </div>
  </PageWrapper>
</template>
