<script setup lang="ts">
import { loadBudgetPlan, loadBudgetPlanPeriodView, loadBudgetPlanPeriods } from '@/api/budget-plans';
import { VUE_QUERY_CACHE_KEYS } from '@/common/const';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/common/dropdown-menu';
import PageWrapper from '@/components/common/page-wrapper.vue';
import { Button } from '@/components/lib/ui/button';
import { Callout } from '@/components/lib/ui/callout';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/lib/ui/collapsible';
import { ScrollArea } from '@/components/lib/ui/scroll-area';
import { Sheet, SheetContent, SheetTitle } from '@/components/lib/ui/sheet';
import { DesktopOnlyTooltip } from '@/components/lib/ui/tooltip';
import { useFormatCurrency } from '@/composable';
import { isResourceMissingError } from '@/js/errors';
import { cn } from '@/lib/utils';
import { ROUTES_NAMES } from '@/routes/constants';
import { useCategoriesStore } from '@/stores';
import type { BudgetPlanLineEntry, BudgetPlanPeriodViewLine } from '@bt/shared/types';
import {
  ChevronDownIcon,
  InfoIcon,
  LayoutListIcon,
  PanelRightIcon,
  PlusIcon,
  Settings2Icon,
  SlidersHorizontalIcon,
} from '@lucide/vue';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/vue-query';
import { onKeyStroke } from '@vueuse/core';
import { storeToRefs } from 'pinia';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';

import BudgetHeaderTiles from './components/budget-header-tiles.vue';
import BudgetLinesGrid from './components/budget-lines-grid.vue';
import BudgetPlanSkeleton from './components/budget-plan-skeleton.vue';
import BudgetSidePanel from './components/budget-side-panel.vue';
import LineDialog from './components/line-dialog.vue';
import ManageLayoutDialog from './components/manage-layout-dialog.vue';
import PeriodPicker from './components/period-picker.vue';
import PlanSettingsSheet from './components/plan-settings-sheet.vue';
import { type RowBarMode, useGridDisplayOptions } from './composables/use-grid-display-options';
import { cadenceLabel, goalPeriodUnit, lineIdsWithHistory } from './helpers';

const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const queryClient = useQueryClient();
const { formatBaseCurrency } = useFormatCurrency();
const { categoriesMap } = storeToRefs(useCategoriesStore());

const planId = computed(() => String(route.params.planId));

const isSettingsOpen = ref(false);
const isLineDialogOpen = ref(false);
const lineToEdit = ref<Pick<BudgetPlanLineEntry, 'id' | 'name' | 'groupId' | 'categoryIds'> | undefined>();
const lineGroupId = ref<string | null>(null);
const isLayoutOpen = ref(false);
const isPanelSheetOpen = ref(false);
const selectedLineId = ref<string | null>(null);
const panelColumnRef = ref<HTMLElement | null>(null);
const { rowBars, compactRows } = useGridDisplayOptions();

const ROW_BAR_OPTIONS: { value: RowBarMode; labelKey: string }[] = [
  { value: 'spending', labelKey: 'budgetPlans.options.rowBarSpending' },
  { value: 'goal', labelKey: 'budgetPlans.options.rowBarGoal' },
  { value: 'combined', labelKey: 'budgetPlans.options.rowBarCombined' },
  { value: 'split', labelKey: 'budgetPlans.options.rowBarSplit' },
  { value: 'none', labelKey: 'budgetPlans.options.rowBarNone' },
];

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

const previousPeriod = computed(() => {
  const list = periods.value ?? [];
  const index = list.findIndex((period) => period.id === selectedPeriodId.value);
  const previous = index > 0 ? list[index - 1] : undefined;
  const poolFrom = plan.value?.plan.poolFrom;
  // Periods before the pool started have no pool balance to carry over.
  if (previous && poolFrom && previous.startDate < poolFrom) return undefined;
  return previous;
});

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

const goalUnit = computed(() =>
  plan.value ? goalPeriodUnit({ cadence: plan.value.plan.cadence, intervalN: plan.value.plan.intervalN }) : 'period',
);

const archivedLines = computed(() => (plan.value?.lines ?? []).filter((line) => line.activeUntil !== null));

const liveGroupIds = computed(
  () =>
    new Set(
      (plan.value?.lines ?? []).flatMap((line) => (line.activeUntil === null && line.groupId ? [line.groupId] : [])),
    ),
);

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

const selectedLine = computed(() => view.value?.lines.find((line) => line.lineId === selectedLineId.value));

const toggleLine = ({ lineId }: { lineId: string }) => {
  selectedLineId.value = selectedLineId.value === lineId ? null : lineId;
  // The panel column is display:none on narrow containers, so the details open in the sheet instead.
  if (selectedLineId.value && !panelColumnRef.value?.offsetParent) isPanelSheetOpen.value = true;
};

watch(isPanelSheetOpen, (open) => {
  if (!open) selectedLineId.value = null;
});

onKeyStroke('Escape', (event) => {
  // Escape inside a popover, menu or field belongs to that control.
  if (event.target instanceof Element && event.target.closest('[role="dialog"], [role="menu"], input, textarea')) {
    return;
  }
  selectedLineId.value = null;
});

const openLineDialog = ({ line, groupId = null }: { line?: BudgetPlanPeriodViewLine; groupId?: string | null }) => {
  lineToEdit.value = line && {
    id: line.lineId,
    name: line.name,
    groupId: line.groupId,
    categoryIds: line.categoryIds,
    ...plan.value?.lines.find((entry) => entry.id === line.lineId),
  };
  lineGroupId.value = groupId;
  isLineDialogOpen.value = true;
};
</script>

<template>
  <PageWrapper>
    <div class="@container/budget-plan">
      <div class="grid items-start gap-6 @5xl/budget-plan:grid-cols-[minmax(0,1fr)_300px]">
        <div class="grid min-w-0 gap-6">
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

              <Button
                variant="outline"
                size="sm"
                class="@5xl/budget-plan:hidden"
                :disabled="!view"
                @click="isPanelSheetOpen = true"
              >
                <PanelRightIcon class="size-4" />
                {{ $t('budgetPlans.panel.summary') }}
              </Button>

              <DropdownMenu>
                <DropdownMenuTrigger as-child>
                  <Button
                    variant="outline"
                    size="sm"
                    :disabled="!plan || !view"
                    :aria-label="$t('budgetPlans.options.title')"
                  >
                    <SlidersHorizontalIcon class="size-4" />
                    <span class="hidden @lg/budget-plan:inline">{{ $t('budgetPlans.options.title') }}</span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" class="min-w-48">
                  <DropdownMenuLabel class="text-muted-foreground px-2 py-1.5 text-xs font-medium">
                    {{ $t('budgetPlans.options.rowBars') }}
                  </DropdownMenuLabel>
                  <DropdownMenuRadioGroup
                    :model-value="rowBars"
                    @update:model-value="(value) => (rowBars = value as RowBarMode)"
                  >
                    <DropdownMenuRadioItem v-for="option in ROW_BAR_OPTIONS" :key="option.value" :value="option.value">
                      {{ $t(option.labelKey) }}
                    </DropdownMenuRadioItem>
                  </DropdownMenuRadioGroup>
                  <DropdownMenuSeparator />
                  <DropdownMenuCheckboxItem v-model="compactRows">
                    {{ $t('budgetPlans.options.compactRows') }}
                  </DropdownMenuCheckboxItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem @select="isLayoutOpen = true">
                    <LayoutListIcon class="size-4" />
                    {{ $t('budgetPlans.options.manageLayout') }}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

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
            :class="cn('grid min-w-0 gap-6 transition-opacity', isViewPlaceholder && 'opacity-60')"
          >
            <BudgetHeaderTiles :plan-id="planId" :view="view" :previous-period="previousPeriod" />

            <BudgetLinesGrid
              :plan-id="planId"
              :view="view"
              :archived-lines="archivedLines"
              :history-line-ids="historyLineIds"
              :selected-line-id="selectedLineId"
              :live-group-ids="liveGroupIds"
              :unit="goalUnit"
              :row-bars="rowBars"
              :compact-rows="compactRows"
              @edit="(line) => openLineDialog({ line })"
              @add-line="(groupId) => openLineDialog({ groupId })"
              @select="(lineId) => toggleLine({ lineId })"
            />

            <div>
              <Button variant="outline" @click="openLineDialog({})">
                <PlusIcon class="size-4" />
                {{ $t('budgetPlans.grid.addLine') }}
              </Button>
            </div>

            <Collapsible v-if="view.unbudgeted.length" v-slot="{ open }">
              <CollapsibleTrigger as-child>
                <Button
                  variant="outline"
                  class="border-border bg-muted/40 h-auto w-full justify-start py-3 font-normal"
                >
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
                  <div
                    v-for="entry in view.unbudgeted"
                    :key="entry.categoryId"
                    class="flex justify-between gap-3 text-sm"
                  >
                    <span class="truncate">{{ categoriesMap[entry.categoryId]?.name }}</span>
                    <span class="tabular-nums">{{ formatBaseCurrency(Math.abs(entry.activity)) }}</span>
                  </div>
                </div>
              </CollapsibleContent>
            </Collapsible>
          </div>
        </div>

        <aside
          v-if="view && plan"
          ref="panelColumnRef"
          :inert="isViewPlaceholder"
          :class="
            cn(
              'sticky top-(--panel-top) hidden transition-opacity [--panel-top:calc(var(--header-height)+1rem)] @5xl/budget-plan:block',
              isViewPlaceholder && 'opacity-60',
            )
          "
        >
          <ScrollArea viewport-class="max-h-[calc(100dvh-var(--panel-top))]">
            <BudgetSidePanel
              :plan-id="planId"
              :cadence="plan.plan.cadence"
              :unit="goalUnit"
              :view="view"
              :line="selectedLine"
              @close="selectedLineId = null"
              @select-line="(lineId) => toggleLine({ lineId })"
            />
          </ScrollArea>
        </aside>
      </div>

      <Sheet v-model:open="isPanelSheetOpen">
        <SheetContent side="right" class="w-80 p-4 pt-16 sm:max-w-80">
          <SheetTitle class="sr-only">{{ $t('budgetPlans.panel.summary') }}</SheetTitle>
          <ScrollArea viewport-class="max-h-[calc(100dvh-5rem)]">
            <BudgetSidePanel
              v-if="view && plan"
              :plan-id="planId"
              :cadence="plan.plan.cadence"
              :unit="goalUnit"
              :view="view"
              :line="selectedLine"
              @close="selectedLineId = null"
              @select-line="(lineId) => toggleLine({ lineId })"
            />
          </ScrollArea>
        </SheetContent>
      </Sheet>

      <LineDialog
        v-model:open="isLineDialogOpen"
        :plan-id="planId"
        :line="lineToEdit"
        :lines="plan?.lines ?? []"
        :period-lines="pastActiveFrom ? view?.lines : undefined"
        :active-from="pastActiveFrom"
        :groups="view?.groups ?? []"
        :group-id="lineGroupId"
      />

      <ManageLayoutDialog
        v-if="plan && view"
        v-model:open="isLayoutOpen"
        :plan-id="planId"
        :lines="plan.lines"
        :groups="view.groups"
      />

      <PlanSettingsSheet v-if="plan" v-model:open="isSettingsOpen" :plan="plan" />
    </div>
  </PageWrapper>
</template>
