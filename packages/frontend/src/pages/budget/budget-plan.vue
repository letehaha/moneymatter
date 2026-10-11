<script setup lang="ts">
import { loadBudgetPlan, loadBudgetPlanPeriodView, loadBudgetPlanPeriods } from '@/api/budget-plans';
import { config } from '@/common/config';
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
  BookOpenIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  InfoIcon,
  LayoutListIcon,
  ListChecksIcon,
  PanelRightIcon,
  PanelRightOpenIcon,
  PieChartIcon,
  PlusIcon,
  Settings2Icon,
  SlidersHorizontalIcon,
} from '@lucide/vue';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/vue-query';
import { createReusableTemplate, onKeyStroke } from '@vueuse/core';
import { upperFirst } from 'lodash-es';
import { storeToRefs } from 'pinia';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';

import BudgetLinesGrid from './components/budget-lines-grid.vue';
import BudgetPlanSkeleton from './components/budget-plan-skeleton.vue';
import BudgetSidePanelSkeleton from './components/budget-side-panel-skeleton.vue';
import BudgetSummaryStrip from './components/budget-summary-strip.vue';
import BudgetSidePanel from './components/budget-side-panel.vue';
import BudgetTrialNotice from './components/budget-trial-notice.vue';
import AssignPopover from './components/assign-popover.vue';
import LineDialog from './components/line-dialog.vue';
import ManageLayoutDialog from './components/manage-layout-dialog.vue';
import PeriodPicker from './components/period-picker.vue';
import PlanSettingsSheet from './components/plan-settings-sheet.vue';
import { ROW_BAR_MODES, type RowBarMode, useGridDisplayOptions } from './composables/use-grid-display-options';
import { useLineSelection } from './composables/use-line-selection';
import { useFrameLayout } from './composables/use-panel-layout';
import {
  amountToneClass,
  goalPeriodUnit,
  groupLines,
  headerStats,
  lineIdsWithHistory,
  periodProgress,
  sumLineTotals,
} from './helpers';

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
const lineCategoryIds = ref<string[]>([]);
const isLayoutOpen = ref(false);
const isPanelSheetOpen = ref(false);
const frameRef = ref<HTMLElement | null>(null);
const { rowBars, compactRows } = useGridDisplayOptions();
const { panelWidth, panelOpen, startResize, isNarrow, isPanelAttached, isPanelFloating, isPanelTab } = useFrameLayout({
  frameRef,
});

const selectMode = ref(false);
watch(isNarrow, (narrow) => {
  if (!narrow) selectMode.value = false;
});

const [DefineOptionsMenu, OptionsMenu] = createReusableTemplate();
const [DefineSettingsButton, SettingsButton] = createReusableTemplate();
const [DefineMobileToolbar, MobileToolbar] = createReusableTemplate();

const togglePanel = () => {
  if (isNarrow.value) isPanelSheetOpen.value = true;
  else panelOpen.value = !panelOpen.value;
};

const ROW_BAR_OPTIONS = ROW_BAR_MODES.map((value) => ({
  value,
  labelKey: `budgetPlans.options.rowBar${upperFirst(value)}`,
}));

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
  queryFn: () =>
    loadBudgetPlanPeriodView({
      planId: planId.value,
      periodId: selectedPeriodId.value!,
    }),
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

const progress = computed(() => (selectedPeriod.value?.isCurrent ? periodProgress(selectedPeriod.value) : undefined));

const goalUnit = computed(() =>
  plan.value
    ? goalPeriodUnit({
        cadence: plan.value.plan.cadence,
        intervalN: plan.value.plan.intervalN,
      })
    : 'period',
);

const archivedLines = computed(() => (plan.value?.lines ?? []).filter((line) => line.activeUntil !== null));

const liveGroupIds = computed(
  () =>
    new Set(
      (plan.value?.lines ?? []).flatMap((line) => (line.activeUntil === null && line.groupId ? [line.groupId] : [])),
    ),
);

const historyLineIds = computed(() =>
  lineIdsWithHistory({
    lines: plan.value?.lines ?? [],
    periods: periods.value ?? [],
  }),
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

const orderedLineIds = computed(() => {
  if (!view.value) return [];
  const { ungrouped, groups } = groupLines({
    lines: view.value.lines,
    groups: view.value.groups,
  });
  return [...ungrouped, ...groups.flatMap((section) => section.lines)].map((line) => line.lineId);
});
const selection = useLineSelection({ orderedIds: orderedLineIds });
const selectedLines = computed(() => {
  const ids = new Set(selection.selectedIds.value);
  return (view.value?.lines ?? []).filter((line) => ids.has(line.lineId));
});

const openPanelIfHidden = () => {
  if (!selection.count.value) return;
  if (isNarrow.value) isPanelSheetOpen.value = true;
  else panelOpen.value = true;
};

const toggleLine = ({ lineId }: { lineId: string }) => {
  selection.select({ lineId });
  openPanelIfHidden();
};

const openOverviewSheet = () => {
  if (!selectMode.value) selection.clear();
  isPanelSheetOpen.value = true;
};

const exitSelectMode = () => {
  selectMode.value = false;
  selection.clear();
};

// In select mode the drawer only previews the selection, so closing it keeps the checkboxes.
watch(isPanelSheetOpen, (open) => {
  if (!open && !selectMode.value) selection.clear();
});

const selectedLine = computed(() => (selectedLines.value.length === 1 ? selectedLines.value[0] : undefined));
const selectionAvailable = computed(() => sumLineTotals({ lines: selectedLines.value }).available);
const panelTabAvailable = computed(() =>
  selectedLines.value.length ? selectionAvailable.value : (view.value?.header.totalAvailable ?? 0),
);
const overviewStats = computed(() => (view.value ? headerStats({ view: view.value }) : undefined));

onKeyStroke('Escape', (event) => {
  // Escape inside a popover, menu or field belongs to that control.
  if (event.target instanceof Element && event.target.closest('[role="dialog"], [role="menu"], input, textarea')) {
    return;
  }
  if (selectMode.value) exitSelectMode();
  else selection.clear();
});

const openLineDialog = ({
  line,
  groupId = null,
  categoryIds = [],
}: {
  line?: BudgetPlanPeriodViewLine;
  groupId?: string | null;
  categoryIds?: string[];
}) => {
  lineToEdit.value = line && {
    id: line.lineId,
    name: line.name,
    groupId: line.groupId,
    categoryIds: line.categoryIds,
    ...plan.value?.lines.find((entry) => entry.id === line.lineId),
  };
  lineGroupId.value = groupId;
  lineCategoryIds.value = categoryIds;
  isLineDialogOpen.value = true;
};
</script>

<template>
  <PageWrapper>
    <div class="@container/budget-plan grid gap-6">
      <DefineOptionsMenu>
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
              <ChevronDownIcon class="text-muted-foreground hidden size-4 @lg/budget-plan:inline" />
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
            <DropdownMenuSeparator />
            <DropdownMenuItem as-child>
              <a :href="`${config.docsUrl}/budgeting/start-budgeting/`" target="_blank" rel="noopener noreferrer">
                <BookOpenIcon class="size-4" />
                {{ $t('budgetPlans.docs.howItWorks') }}
              </a>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </DefineOptionsMenu>

      <DefineMobileToolbar>
        <div class="border-border bg-muted/40 flex items-center gap-1.5 border-b px-2 py-1.5">
          <Button size="sm" :disabled="!view" @click="openLineDialog({})">
            <PlusIcon class="size-4" />
            {{ $t('budgetPlans.grid.addLine') }}
          </Button>
          <DesktopOnlyTooltip :content="$t('budgetPlans.panel.overview')">
            <Button
              variant="outline"
              size="icon-sm"
              :disabled="!view"
              :aria-label="$t('budgetPlans.panel.overview')"
              @click="openOverviewSheet"
            >
              <PieChartIcon class="size-4" />
            </Button>
          </DesktopOnlyTooltip>
          <span class="flex-1" />
          <OptionsMenu />
          <SettingsButton />
        </div>
      </DefineMobileToolbar>

      <DefineSettingsButton>
        <DesktopOnlyTooltip :content="$t('budgetPlans.settings.title')">
          <Button
            variant="outline"
            size="icon-sm"
            :disabled="!plan"
            :aria-label="$t('budgetPlans.settings.title')"
            @click="isSettingsOpen = true"
          >
            <Settings2Icon class="size-4" />
          </Button>
        </DesktopOnlyTooltip>
      </DefineSettingsButton>

      <div class="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
        <h1 class="text-2xl font-semibold tracking-tight wrap-break-word">
          {{ plan?.plan.name ?? $t('budgetPlans.title') }}
        </h1>
        <span aria-hidden="true" class="text-muted-foreground/50 text-2xl font-light select-none">/</span>
        <PeriodPicker
          :periods="periods ?? []"
          :selected-id="selectedPeriodId"
          @select="(periodId) => selectPeriod({ periodId })"
        />
        <span v-if="progress" class="text-muted-foreground text-sm">
          {{ $t('budgetPlans.period.dayOf', progress) }} ·
          {{ $t('budgetPlans.panel.daysLeft', { n: progress.daysLeft }) }}
        </span>
      </div>

      <BudgetTrialNotice />

      <section
        ref="frameRef"
        :class="
          cn(
            'border-border bg-card grid min-w-0 overflow-clip rounded-lg border',
            isPanelAttached && 'grid-cols-[minmax(0,1fr)_var(--panel-width)]',
            isPanelTab && 'grid-cols-[minmax(0,1fr)_2.75rem]',
          )
        "
        :style="{ '--panel-width': `${panelWidth}px` }"
      >
        <div class="relative min-w-0">
          <div
            v-if="isNarrow && selectMode"
            class="border-border flex items-center justify-between gap-2 border-b px-2 py-1.5"
          >
            <Button variant="ghost" size="sm" @click="exitSelectMode">{{ $t('common.actions.cancel') }}</Button>
            <span class="text-sm font-semibold">{{ $t('budgetPlans.grid.selectedCount', selection.count.value) }}</span>
            <Button
              variant="ghost"
              size="sm"
              class="text-primary-text"
              @click="selection.toggleMany({ lineIds: orderedLineIds })"
            >
              {{ $t('budgetPlans.grid.selectAll') }}
            </Button>
          </div>

          <div v-else class="border-border flex min-w-0 items-center gap-4 border-b px-4 py-2">
            <BudgetSummaryStrip
              v-if="view?.pool && !isNarrow"
              :plan-id="planId"
              :view="view"
              :previous-period="previousPeriod"
              :zero-sum="plan?.plan.zeroSum ?? false"
            />
            <dl
              v-if="overviewStats && !isNarrow"
              :class="
                cn(
                  'min-w-0',
                  view?.pool
                    ? 'border-border grid max-w-[520px] grid-cols-2 gap-x-7 gap-y-1 border-x px-5'
                    : 'divide-border flex flex-1 divide-x',
                )
              "
            >
              <div
                v-for="stat in overviewStats.stats"
                :key="stat.key"
                :class="
                  cn('min-w-0', view?.pool ? 'flex items-baseline justify-between gap-3' : 'flex-1 px-4 first:pl-0')
                "
              >
                <dt class="text-muted-foreground truncate text-[11px] font-medium tracking-wide uppercase">
                  {{ $t(stat.labelKey) }}
                  <template v-if="stat.key === 'overspent'">
                    ·
                    {{
                      $t('budgetPlans.tiles.overspentLines', {
                        count: overviewStats.overspentLineCount,
                      })
                    }}
                  </template>
                </dt>
                <dd
                  :class="
                    cn(
                      'font-bold tabular-nums',
                      view?.pool ? 'text-sm' : 'text-lg',
                      stat.toned && amountToneClass({ amount: stat.amount }),
                    )
                  "
                >
                  {{ formatBaseCurrency(stat.amount) }}
                </dd>
              </div>
            </dl>

            <DesktopOnlyTooltip v-if="isNarrow" :content="$t('budgetPlans.grid.selectMode')">
              <Button
                variant="outline"
                size="icon-sm"
                class="ml-auto"
                :disabled="!view"
                :aria-label="$t('budgetPlans.grid.selectMode')"
                @click="selectMode = true"
              >
                <ListChecksIcon class="size-4" />
              </Button>
            </DesktopOnlyTooltip>

            <div v-else class="ml-auto flex shrink-0 items-center gap-2">
              <OptionsMenu />
              <SettingsButton />
              <DesktopOnlyTooltip :content="$t('budgetPlans.panel.summary')">
                <Button
                  variant="outline"
                  size="icon-sm"
                  :class="cn(panelOpen && 'text-primary-text')"
                  :disabled="!view"
                  :aria-label="$t('budgetPlans.panel.summary')"
                  :aria-pressed="panelOpen"
                  @click="togglePanel"
                >
                  <PanelRightIcon class="size-4" />
                </Button>
              </DesktopOnlyTooltip>
            </div>
          </div>

          <MobileToolbar v-if="isNarrow && (hasLoadError || !view)" />

          <Callout v-if="hasLoadError" variant="destructive" class="m-4">
            <p>{{ $t('budgetPlans.loadError') }}</p>
            <Button variant="outline" size="sm" class="mt-3" @click="retryLoad">
              {{ $t('common.actions.retry') }}
            </Button>
          </Callout>

          <BudgetPlanSkeleton v-else-if="!view" :narrow="isNarrow" />

          <div
            v-else
            :inert="isViewPlaceholder"
            :class="cn('min-w-0 transition-opacity', isViewPlaceholder && 'opacity-60')"
          >
            <BudgetSummaryStrip
              v-if="view.pool && isNarrow"
              class="border-border border-b px-4 py-2.5"
              :plan-id="planId"
              :view="view"
              :previous-period="previousPeriod"
              :zero-sum="plan?.plan.zeroSum ?? false"
            />

            <MobileToolbar v-if="isNarrow" />

            <div v-if="isPanelFloating" class="sticky top-[calc(var(--header-height)+1rem)] z-20 h-0">
              <aside
                class="border-border bg-card absolute top-2.5 right-2.5 flex max-h-[calc(100dvh-var(--header-height)-2rem)] w-[var(--panel-width)] max-w-[calc(100%-1.25rem)] overflow-hidden rounded-lg border shadow-2xl"
              >
                <div
                  class="border-border bg-muted/40 hover:bg-primary/20 flex w-6 shrink-0 cursor-col-resize touch-none flex-col items-center justify-center border-r transition-colors"
                  role="separator"
                  aria-orientation="vertical"
                  :aria-label="$t('budgetPlans.panel.resize')"
                  @pointerdown="startResize"
                >
                  <DesktopOnlyTooltip :content="$t('budgetPlans.panel.collapse')">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      class="h-6 w-5"
                      :aria-label="$t('budgetPlans.panel.collapse')"
                      @pointerdown.stop
                      @click="panelOpen = false"
                    >
                      <ChevronRightIcon class="size-4" />
                    </Button>
                  </DesktopOnlyTooltip>
                </div>
                <ScrollArea class="min-w-0 flex-1" viewport-class="max-h-[calc(100dvh-var(--header-height)-2rem)] p-4">
                  <BudgetSidePanel
                    v-if="plan"
                    :plan-id="planId"
                    :cadence="plan.plan.cadence"
                    :unit="goalUnit"
                    :view="view"
                    :lines="selectedLines"
                    @close="selection.clear()"
                    @select-line="(lineId) => toggleLine({ lineId })"
                  />
                </ScrollArea>
              </aside>
            </div>

            <BudgetLinesGrid
              :plan-id="planId"
              :view="view"
              :archived-lines="archivedLines"
              :history-line-ids="historyLineIds"
              :selected-ids="selection.selectedIds.value"
              :selection-available="selectionAvailable"
              :state-of="selection.stateOf"
              :live-group-ids="liveGroupIds"
              :unit="goalUnit"
              :row-bars="rowBars"
              :compact-rows="compactRows"
              :narrow="isNarrow"
              :select-mode="isNarrow && selectMode"
              @edit="(line) => openLineDialog({ line })"
              @add-line="(groupId) => openLineDialog({ groupId })"
              @select="(lineId) => toggleLine({ lineId })"
              @toggle="(payload) => (selection.toggle(payload), !selectMode && openPanelIfHidden())"
              @toggle-many="(lineIds) => (selection.toggleMany({ lineIds }), !selectMode && openPanelIfHidden())"
              @clear-selection="selection.clear()"
              @open-panel="isPanelSheetOpen = true"
            />

            <Collapsible v-slot="{ open }" class="border-border border-t">
              <div class="flex min-w-0 flex-wrap items-center gap-1 px-2 py-1">
                <Button v-if="!isNarrow" variant="ghost" size="sm" @click="openLineDialog({})">
                  <PlusIcon class="size-4" />
                  {{ $t('budgetPlans.grid.addLine') }}
                </Button>
                <CollapsibleTrigger v-if="view.unbudgeted.length" as-child>
                  <Button variant="ghost" size="sm" class="min-w-0 font-normal">
                    <InfoIcon class="text-muted-foreground size-4 shrink-0" />
                    <span class="truncate">
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
              </div>
              <CollapsibleContent>
                <div
                  v-for="entry in view.unbudgeted"
                  :key="entry.categoryId"
                  class="border-border flex items-center gap-3 border-t py-1 pr-2 pl-6 text-sm"
                >
                  <span
                    class="size-2 shrink-0 rounded-full"
                    :style="{
                      background: categoriesMap[entry.categoryId]?.color,
                    }"
                  />
                  <span class="min-w-0 flex-1 truncate">{{ categoriesMap[entry.categoryId]?.name }}</span>
                  <span class="text-muted-foreground tabular-nums">{{ formatBaseCurrency(entry.activity) }}</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    class="ml-4"
                    @click="openLineDialog({ categoryIds: [entry.categoryId] })"
                  >
                    {{ $t('budgetPlans.grid.addLine') }}
                  </Button>
                </div>
              </CollapsibleContent>
            </Collapsible>
          </div>
        </div>

        <aside
          v-if="!hasLoadError && isPanelAttached"
          :inert="isViewPlaceholder"
          :class="cn('border-border relative border-l transition-opacity', isViewPlaceholder && 'opacity-60')"
        >
          <div
            role="separator"
            aria-orientation="vertical"
            :aria-label="$t('budgetPlans.panel.resize')"
            class="hover:bg-primary/40 active:bg-primary/60 absolute inset-y-0 -left-1 z-10 w-2 cursor-col-resize touch-none transition-colors"
            @pointerdown="startResize"
          />
          <div class="sticky top-[calc(var(--header-height)+1rem)]">
            <ScrollArea viewport-class="max-h-[calc(100dvh-var(--header-height)-2rem)] p-4">
              <BudgetSidePanel
                v-if="view && plan"
                :plan-id="planId"
                :cadence="plan.plan.cadence"
                :unit="goalUnit"
                :view="view"
                :lines="selectedLines"
                @close="selection.clear()"
                @select-line="(lineId) => toggleLine({ lineId })"
              />
              <BudgetSidePanelSkeleton v-else />
            </ScrollArea>
          </div>
        </aside>

        <Button
          v-else-if="!hasLoadError && isPanelTab"
          variant="ghost"
          class="border-border bg-muted/40 h-auto items-start rounded-none border-l px-0 py-3"
          :aria-label="$t('budgetPlans.panel.open')"
          @click="panelOpen = true"
        >
          <span class="sticky top-[calc(var(--header-height)+1rem)] flex flex-col items-center gap-3">
            <PanelRightOpenIcon class="text-muted-foreground size-4" />
            <span
              v-if="selection.count.value"
              class="bg-primary text-primary-foreground rounded-full px-1.5 text-[11px] font-semibold tabular-nums"
            >
              {{ selection.count.value }}
            </span>
            <span
              :class="
                cn(
                  'rotate-180 text-xs font-semibold tabular-nums [writing-mode:vertical-rl]',
                  amountToneClass({ amount: panelTabAvailable }),
                )
              "
            >
              {{ formatBaseCurrency(panelTabAvailable) }} ·
              {{ $t('budgetPlans.grid.available') }}
            </span>
          </span>
        </Button>
      </section>

      <Sheet v-model:open="isPanelSheetOpen">
        <SheetContent side="bottom" class="h-[88dvh] rounded-t-xl px-0 pt-3 pb-4">
          <SheetTitle class="sr-only">{{ $t('budgetPlans.panel.summary') }}</SheetTitle>
          <ScrollArea viewport-class="max-h-[calc(88dvh-2rem)] px-4">
            <template v-if="view && plan">
              <dl v-if="!selectedLines.length && overviewStats" class="mb-4 grid grid-cols-2 gap-3">
                <div
                  v-for="stat in overviewStats.stats"
                  :key="stat.key"
                  class="border-border bg-muted/40 rounded-lg border px-3 py-2"
                >
                  <dt class="text-muted-foreground text-[11px] font-medium tracking-wide uppercase">
                    {{ $t(stat.labelKey) }}
                  </dt>
                  <dd
                    :class="
                      cn('text-lg font-bold tabular-nums', stat.toned && amountToneClass({ amount: stat.amount }))
                    "
                  >
                    {{ formatBaseCurrency(stat.amount) }}
                  </dd>
                  <dd v-if="stat.key === 'overspent'" class="text-muted-foreground text-[11px]">
                    {{
                      $t('budgetPlans.tiles.overspentLines', {
                        count: overviewStats.overspentLineCount,
                      })
                    }}
                  </dd>
                </div>
              </dl>
              <div v-if="selectedLine" class="mb-3 flex justify-end pr-10">
                <AssignPopover :plan-id="planId" :period-id="view.period.id" :line="selectedLine">
                  <Button size="sm">{{ $t('budgetPlans.pool.assign') }}</Button>
                </AssignPopover>
              </div>
              <BudgetSidePanel
                :plan-id="planId"
                :cadence="plan.plan.cadence"
                :unit="goalUnit"
                :view="view"
                :lines="selectedLines"
                @close="isPanelSheetOpen = false"
                @select-line="(lineId) => toggleLine({ lineId })"
              />
            </template>
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
        :initial-category-ids="lineCategoryIds"
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
