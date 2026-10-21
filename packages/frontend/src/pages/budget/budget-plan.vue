<script setup lang="ts">
import { loadBudgetPlan, loadBudgetPlanPeriodView, loadBudgetPlanPeriods } from '@/api/budget-plans';
import { config } from '@/common/config';
import { VUE_QUERY_CACHE_KEYS } from '@/common/const';
import {
  DropdownMenu,
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
import { Drawer, DrawerContent, DrawerTitle } from '@/components/lib/ui/drawer';
import { DesktopOnlyTooltip } from '@/components/lib/ui/tooltip';
import { useFormatCurrency } from '@/composable';
import { budgetPeriodToChatPeriod } from '@/composable/chat/budget-period-context';
import { provideChatPageContext } from '@/composable/chat/use-chat-page-context';
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
import { createReusableTemplate, onKeyStroke, useElementSize } from '@vueuse/core';
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
import LineActionsMenu from './components/line-actions-menu.vue';
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
// The desktop stats strip wraps at some widths, so everything sticking below it reads its measured height.
const stripRef = ref<HTMLElement | null>(null);
const { height: stripHeight } = useElementSize(stripRef, undefined, { box: 'border-box' });
// The floating panel is absolutely positioned inside the clipping frame, so the frame must be at least as tall.
const floatingPanelRef = ref<HTMLElement | null>(null);
const { height: floatingPanelHeight } = useElementSize(floatingPanelRef, undefined, { box: 'border-box' });
const { rowBars } = useGridDisplayOptions();
const { panelWidth, panelOpen, startResize, isNarrow, isPanelAttached, isPanelFloating, isPanelTab } = useFrameLayout({
  frameRef,
});

// Sits right under the sticky page title row, which is h-11.
const FRAME_STICKY_CLASS = 'sticky top-[calc(var(--header-height)+2.75rem)]';

const selectMode = ref(false);
watch(isNarrow, (narrow) => {
  if (!narrow) selectMode.value = false;
});

const [DefineOptionsMenu, OptionsMenu] = createReusableTemplate();
const [DefineSettingsButton, SettingsButton] = createReusableTemplate();
const [DefineMobileToolbar, MobileToolbar] = createReusableTemplate();
const [DefineProgressLabel, ProgressLabel] = createReusableTemplate();

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

// The plan is the route's entity; the chat also sees the period on screen.
provideChatPageContext(() => (selectedPeriod.value ? { period: budgetPeriodToChatPeriod(selectedPeriod.value) } : {}));

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

const gridRef = ref<InstanceType<typeof BudgetLinesGrid> | null>(null);
// Archive and delete confirm in their own dialog, so the drawer steps aside for them.
const pickDrawerLineAction = ({ action }: { action: 'edit' | 'archive' | 'delete' }) => {
  const line = selectedLine.value;
  if (!line) return;
  if (action !== 'edit') isPanelSheetOpen.value = false;
  gridRef.value?.pickMenuAction({ line, action });
};

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
    <div class="@container/budget-plan grid gap-2">
      <DefineOptionsMenu>
        <DropdownMenu>
          <DropdownMenuTrigger as-child>
            <Button
              variant="outline"
              :size="isNarrow ? 'sm' : 'default'"
              :class="isNarrow && '@max-lg/budget-plan:w-9 @max-lg/budget-plan:px-0'"
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
            <DropdownMenuItem @select="isLayoutOpen = true">
              <LayoutListIcon class="size-4" />
              {{ $t('budgetPlans.options.manageLayout') }}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </DefineOptionsMenu>

      <DefineMobileToolbar>
        <div :class="cn('bg-card z-10', !selectMode && FRAME_STICKY_CLASS)">
          <div class="border-border bg-muted/40 flex items-center gap-1.5 border-b px-2 py-1.5">
            <Button size="sm" :disabled="!view" @click="openLineDialog({})">
              <PlusIcon class="size-4" />
              {{ $t('budgetPlans.grid.addLine') }}
            </Button>
            <DesktopOnlyTooltip :content="$t('budgetPlans.panel.overview')">
              <Button
                variant="outline"
                size="icon-sm"
                class="size-9"
                :disabled="!view"
                :aria-label="$t('budgetPlans.panel.overview')"
                @click="openOverviewSheet"
              >
                <PieChartIcon class="size-4" />
              </Button>
            </DesktopOnlyTooltip>
            <span class="flex-1" />
            <DesktopOnlyTooltip v-if="!selectMode" :content="$t('budgetPlans.grid.selectMode')">
              <Button
                variant="outline"
                size="icon-sm"
                class="size-9"
                :disabled="!view"
                :aria-label="$t('budgetPlans.grid.selectMode')"
                @click="selectMode = true"
              >
                <ListChecksIcon class="size-4" />
              </Button>
            </DesktopOnlyTooltip>
            <OptionsMenu />
            <SettingsButton />
          </div>
        </div>
      </DefineMobileToolbar>

      <DefineSettingsButton>
        <DesktopOnlyTooltip :content="$t('budgetPlans.settings.title')">
          <Button
            variant="outline"
            :size="isNarrow ? 'icon-sm' : 'icon'"
            :class="isNarrow && 'size-9'"
            :disabled="!plan"
            :aria-label="$t('budgetPlans.settings.title')"
            @click="isSettingsOpen = true"
          >
            <Settings2Icon class="size-4" />
          </Button>
        </DesktopOnlyTooltip>
      </DefineSettingsButton>

      <DefineProgressLabel>
        <span v-if="progress" class="text-muted-foreground min-w-0 truncate text-sm">
          {{ $t('budgetPlans.period.dayOf', progress) }} ·
          {{ $t('budgetPlans.panel.daysLeft', { n: progress.daysLeft }) }}
        </span>
      </DefineProgressLabel>

      <div
        :class="
          cn(
            'bg-background sticky top-(--header-height) z-20 -mx-4 flex h-11 min-w-0 items-center px-4 md:-mx-6 md:px-6',
            isNarrow ? 'gap-x-1.5' : 'gap-x-3',
          )
        "
      >
        <h1 :class="cn('min-w-0 truncate font-semibold tracking-tight', isNarrow ? 'text-xl' : 'text-2xl')">
          {{ plan?.plan.name ?? $t('budgetPlans.title') }}
        </h1>
        <span aria-hidden="true" class="text-muted-foreground/50 text-2xl font-light select-none">/</span>
        <PeriodPicker
          class="shrink-0"
          :compact="isNarrow"
          :periods="periods ?? []"
          :selected-id="selectedPeriodId"
          @select="(periodId) => selectPeriod({ periodId })"
        />
        <ProgressLabel v-if="!isNarrow" />
        <Button
          as-child
          variant="ghost"
          :size="isNarrow ? 'icon-sm' : 'sm'"
          class="text-muted-foreground ml-auto shrink-0"
        >
          <a
            :href="`${config.docsUrl}/budgeting/start-budgeting/`"
            target="_blank"
            rel="noopener noreferrer"
            :aria-label="$t('budgetPlans.docs.howItWorks')"
          >
            <BookOpenIcon class="size-4" />
            <span v-if="!isNarrow">{{ $t('budgetPlans.docs.howItWorks') }}</span>
          </a>
        </Button>
      </div>
      <div v-if="isNarrow && progress"><ProgressLabel /></div>

      <BudgetTrialNotice />

      <section
        ref="frameRef"
        :class="
          cn(
            'border-border bg-card grid min-w-0 overflow-clip rounded-lg border max-md:-mx-4 max-md:rounded-none max-md:border-x-0',
            isPanelAttached && 'grid-cols-[minmax(0,1fr)_var(--panel-width)]',
            isPanelTab && 'grid-cols-[minmax(0,1fr)_2.75rem]',
            isPanelFloating && 'min-h-[calc(var(--strip-h)+var(--floating-panel-h)+1.25rem+2px)]',
          )
        "
        :style="{
          '--panel-width': `${panelWidth}px`,
          '--strip-h': `${stripHeight}px`,
          '--floating-panel-h': `${floatingPanelHeight}px`,
        }"
      >
        <div class="relative min-w-0">
          <div
            v-if="isNarrow && selectMode"
            :class="
              cn(
                'border-border bg-card z-10 flex items-center justify-between gap-2 border-b px-2 py-1.5',
                FRAME_STICKY_CLASS,
              )
            "
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

          <div
            v-else-if="!isNarrow"
            ref="stripRef"
            :class="
              cn('border-border bg-card z-10 flex min-w-0 items-center gap-4 border-b px-4 py-2', FRAME_STICKY_CLASS)
            "
          >
            <BudgetSummaryStrip
              v-if="view?.pool"
              :plan-id="planId"
              :view="view"
              :previous-period="previousPeriod"
              :zero-sum="plan?.plan.zeroSum ?? false"
            />
            <dl
              v-if="overviewStats"
              :class="
                cn(
                  'min-w-0',
                  view?.pool
                    ? 'border-border grid max-w-130 grid-cols-2 gap-x-7 gap-y-1 border-x px-5'
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
                <dt class="text-muted-foreground flex min-w-0 gap-1 text-[11px] font-medium tracking-wide uppercase">
                  <span class="truncate">{{ $t(stat.labelKey) }}</span>
                  <span v-if="stat.key === 'overspent'" class="shrink-0">
                    ·
                    {{
                      $t('budgetPlans.tiles.overspentLines', {
                        count: overviewStats.overspentLineCount,
                      })
                    }}
                  </span>
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

            <div class="ml-auto flex shrink-0 items-center gap-2">
              <OptionsMenu />
              <SettingsButton />
              <DesktopOnlyTooltip :content="$t('budgetPlans.panel.summary')">
                <Button
                  variant="outline"
                  size="icon"
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

            <div v-if="isPanelFloating" class="sticky top-[calc(var(--header-height)+2.75rem+var(--strip-h))] z-20 h-0">
              <aside
                ref="floatingPanelRef"
                class="border-border bg-card absolute top-2.5 right-2.5 flex max-h-[calc(100dvh-var(--header-height)-3.75rem-var(--strip-h))] w-(--panel-width) max-w-[calc(100%-1.25rem)] overflow-hidden rounded-lg border shadow-2xl"
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
                <ScrollArea
                  class="min-w-0 flex-1"
                  viewport-class="max-h-[calc(100dvh-var(--header-height)-3.75rem-var(--strip-h))] p-4"
                >
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
              ref="gridRef"
              :plan-id="planId"
              :account-ids="plan?.accountIds ?? []"
              :view="view"
              :archived-lines="archivedLines"
              :history-line-ids="historyLineIds"
              :selected-ids="selection.selectedIds.value"
              :selection-available="selectionAvailable"
              :state-of="selection.stateOf"
              :live-group-ids="liveGroupIds"
              :unit="goalUnit"
              :row-bars="rowBars"
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
                <Button v-if="!isNarrow" variant="secondary" size="sm" @click="openLineDialog({})">
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
                  <span class="text-muted-foreground tabular-nums">
                    {{ formatBaseCurrency(Math.abs(entry.activity)) }}
                  </span>
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
          <div :class="FRAME_STICKY_CLASS">
            <ScrollArea viewport-class="max-h-[calc(100dvh-var(--header-height)-3.75rem)] p-4">
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
          <span class="sticky top-[calc(var(--header-height)+3.25rem)] flex flex-col items-center gap-3">
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

      <Drawer v-model:open="isPanelSheetOpen">
        <DrawerContent class="h-[88dvh]">
          <DrawerTitle class="sr-only">{{ $t('budgetPlans.panel.summary') }}</DrawerTitle>
          <div class="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
            <template v-if="view && plan">
              <BudgetSidePanel
                drawer
                :plan-id="planId"
                :cadence="plan.plan.cadence"
                :unit="goalUnit"
                :view="view"
                :lines="selectedLines"
                @select-line="(lineId) => toggleLine({ lineId })"
              >
                <template v-if="!selectedLines.length && overviewStats" #summary>
                  <dl class="grid grid-cols-2 gap-3">
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
                </template>
                <template v-if="selectedLine" #actions>
                  <AssignPopover :plan-id="planId" :period-id="view.period.id" :line="selectedLine">
                    <Button size="sm">{{ $t('budgetPlans.pool.assign') }}</Button>
                  </AssignPopover>
                  <LineActionsMenu
                    v-if="!archivedLines.some((line) => line.id === selectedLine?.lineId)"
                    @pick="(action) => pickDrawerLineAction({ action })"
                  />
                </template>
              </BudgetSidePanel>
            </template>
          </div>
        </DrawerContent>
      </Drawer>

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
