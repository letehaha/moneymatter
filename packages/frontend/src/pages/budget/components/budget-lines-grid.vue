<script setup lang="ts">
import { addSuggestedBudgetLines, archiveBudgetPlanLine, deleteBudgetLineGroup } from '@/api/budget-plans';
import { VUE_QUERY_CACHE_KEYS } from '@/common/const';
import AiUsageBadge from '@/components/common/ai-usage/ai-usage-badge.vue';
import DocsLink from '@/components/common/docs-link.vue';
import ResponsiveAlertDialog from '@/components/common/responsive-alert-dialog.vue';
import ResponsiveDialog from '@/components/common/responsive-dialog.vue';
import ResponsiveMenu from '@/components/common/responsive-menu.vue';
import { Button } from '@/components/lib/ui/button';
import { Checkbox } from '@/components/lib/ui/checkbox';
import { DesktopOnlyTooltip } from '@/components/lib/ui/tooltip';
import { useNotificationCenter } from '@/components/notification-center';
import { useFormatCurrency } from '@/composable';
import { useInvalidatingMutation } from '@/composable/data-queries/use-invalidating-mutation';
import { useAiAllowance } from '@/composable/use-ai-allowance';
import { useQueryClient } from '@tanstack/vue-query';
import { cn } from '@/lib/utils';
import type {
  BudgetPlanLineEntry,
  BudgetPlanLineGroup,
  BudgetPlanPeriodView,
  BudgetPlanPeriodViewLine,
  BudgetSuggestionAnswers,
} from '@bt/shared/types';
import {
  ArchiveIcon,
  CheckIcon,
  ChevronDownIcon,
  EllipsisIcon,
  ListPlusIcon,
  MoonIcon,
  PencilIcon,
  PlusIcon,
  SparklesIcon,
  TargetIcon,
  Trash2Icon,
  XIcon,
} from '@lucide/vue';
import { createReusableTemplate } from '@vueuse/core';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';

import { useCollapsedGroups } from '../composables/use-collapsed-groups';
import type { RowBarMode } from '../composables/use-grid-display-options';
import { useGoalText } from '../composables/use-goal-text';
import {
  GRID_ROW_CLASS,
  type GoalPeriodUnit,
  amountToneClass,
  availablePillClass,
  goalCaption,
  goalStatusDisplay,
  groupLines,
  sumLineTotals,
} from '../helpers';
import ArchivedLinesDialog from './archived-lines-dialog.vue';
import AssignPopover from './assign-popover.vue';
import BudgetLineBars from './budget-line-bars.vue';
import BudgetLineSpentText from './budget-line-spent-text.vue';
import DeleteLineDialog from './delete-line-dialog.vue';
import GoalEditorDialog from './goal-editor-dialog.vue';
import GoalPeekPopover from './goal-peek-popover.vue';
import GroupNameDialog from './group-name-dialog.vue';
import LineActionsMenu from './line-actions-menu.vue';
import SuggestionWizard from './suggestion-wizard.vue';

type GoalDisplay = ReturnType<typeof goalStatusDisplay> & {
  caption: ReturnType<typeof goalCaption>;
};

const props = defineProps<{
  planId: string;
  accountIds: string[];
  view: BudgetPlanPeriodView;
  archivedLines: BudgetPlanLineEntry[];
  historyLineIds: Set<string>;
  /** In row order; two or more selected lines show the bulk-action bar. */
  selectedIds: string[];
  selectionAvailable: number;
  stateOf: (args: { lineIds: string[] }) => boolean | 'indeterminate';
  /** Groups that still hold a live line and so cannot be deleted. */
  liveGroupIds: Set<string>;
  unit: GoalPeriodUnit;
  rowBars: RowBarMode;
  /** Mobile list rows instead of the table; decided by the page so it matches the panel layout. */
  narrow: boolean;
  /** Narrow layout only: rows show checkboxes and tapping a row toggles it. */
  selectMode: boolean;
}>();
const emit = defineEmits<{
  edit: [line: BudgetPlanPeriodViewLine];
  select: [lineId: string];
  toggle: [{ lineId: string; range: boolean }];
  toggleMany: [lineIds: string[]];
  clearSelection: [];
  /** Narrow layout: open the selection's details in the drawer. */
  openPanel: [];
  addLine: [groupId: string | null];
}>();

const [DefineAssignTrigger, AssignTrigger] = createReusableTemplate<{
  line: BudgetPlanPeriodViewLine;
  compact?: boolean;
}>({ inheritAttrs: false });
const [DefineArchivedTrigger, ArchivedTrigger] = createReusableTemplate();
const [DefineGroupsHeader, GroupsHeader] = createReusableTemplate();
const [DefineGroupControls, GroupControls] = createReusableTemplate<{
  group: BudgetPlanLineGroup;
}>({ inheritAttrs: false });
const [DefineGroupMenu, GroupMenu] = createReusableTemplate<{
  group: BudgetPlanLineGroup;
  menuKey: string;
}>({ inheritAttrs: false });
const [DefineLineRow, LineRow] = createReusableTemplate<{
  line: BudgetPlanPeriodViewLine;
}>({ inheritAttrs: false });
const [DefineLineCard, LineCard] = createReusableTemplate<{
  line: BudgetPlanPeriodViewLine;
}>({ inheritAttrs: false });
const [DefineSelectTrigger, SelectTrigger] = createReusableTemplate<{
  line: BudgetPlanPeriodViewLine;
  toggle?: boolean;
}>({ inheritAttrs: false });
const [DefineGoalButton, GoalButton] = createReusableTemplate<{
  line: BudgetPlanPeriodViewLine;
}>({ inheritAttrs: false });
const [DefineLineName, LineName] = createReusableTemplate<{
  line: BudgetPlanPeriodViewLine;
}>({ inheritAttrs: false });
const [DefineMobileCaption, MobileCaption] = createReusableTemplate<{
  line: BudgetPlanPeriodViewLine;
  display?: GoalDisplay;
}>({ inheritAttrs: false });
const [DefineNameCell, NameCell] = createReusableTemplate<{
  line: BudgetPlanPeriodViewLine;
  display?: GoalDisplay;
}>({ inheritAttrs: false });
const [DefineGoalStatus, GoalStatus] = createReusableTemplate<{
  display: GoalDisplay;
}>({ inheritAttrs: false });

const { t } = useI18n();
const queryClient = useQueryClient();
const { addSuccessNotification, addInfoNotification } = useNotificationCenter();
const { formatBaseCurrency, formatShortBaseCurrency } = useFormatCurrency();
const { goalText } = useGoalText();

const archivedLineIds = computed(() => new Set(props.archivedLines.map((line) => line.id)));

const selectedSet = computed(() => new Set(props.selectedIds));
const allLineIds = computed(() => props.view.lines.map((line) => line.lineId));

const goalDisplays = computed(() => {
  const displays = new Map<string, GoalDisplay>();
  for (const line of props.view.lines) {
    if (!line.goal) continue;
    displays.set(line.lineId, {
      ...goalStatusDisplay({ goal: line.goal }),
      caption: goalCaption({ goal: line.goal, unit: props.unit }),
    });
  }
  return displays;
});

// Shared by line cards and group rows so the two amount columns line up down the list.
const MOBILE_ASSIGNED_CLASS = 'w-20 shrink-0 text-right tabular-nums';
const MOBILE_AVAILABLE_CLASS = 'w-24 shrink-0 text-right tabular-nums';

const CHECKBOX_CLASS =
  'border-muted-foreground/50 data-[state=checked]:border-primary data-[state=indeterminate]:border-primary size-[18px] rounded-[4px]';

const availableClass = ({ line }: { line: BudgetPlanPeriodViewLine }) =>
  availablePillClass({
    amount: line.available,
    underfunded: goalDisplays.value.get(line.lineId)?.kind === 'underfunded',
  });

const isGoalEditorOpen = ref(false);
const goalLineId = ref<string | null>(null);
const goalLine = computed(() => props.view.lines.find((line) => line.lineId === goalLineId.value));

const openGoalEditor = ({ line }: { line: BudgetPlanPeriodViewLine }) => {
  goalLineId.value = line.lineId;
  isGoalEditorOpen.value = true;
};

const isArchiveOpen = ref(false);
const isDeleteOpen = ref(false);
const isArchivedListOpen = ref(false);
// Kept after close so the title does not flash empty while the dialog animates out.
const targetLine = ref<BudgetPlanPeriodViewLine | null>(null);
const targetHasHistory = ref(false);
// Keyed per layout: the table row and the mobile card both render a menu for the same group.
const openMenuKey = ref<string | null>(null);

const sections = computed(() => {
  const { ungrouped, groups } = groupLines({
    lines: props.view.lines,
    groups: props.view.groups,
  });
  return {
    ungrouped,
    groups: groups.map((section) => ({
      ...section,
      totals: sumLineTotals({ lines: section.lines }),
    })),
  };
});

const { collapsedIds, setCollapsed, toggleGroup } = useCollapsedGroups({
  planId: () => props.planId,
});
const areAllCollapsed = computed(
  () => props.view.groups.length > 0 && props.view.groups.every((group) => collapsedIds.value.has(group.id)),
);
const toggleAllGroups = () =>
  setCollapsed({
    groupIds: props.view.groups.map((group) => group.id),
    collapsed: !areAllCollapsed.value,
  });

const isGroupDialogOpen = ref(false);
const isGroupDeleteOpen = ref(false);
const targetGroup = ref<BudgetPlanLineGroup | null>(null);

const openGroupDialog = ({ group }: { group: BudgetPlanLineGroup | null }) => {
  targetGroup.value = group;
  isGroupDialogOpen.value = true;
};

const pickGroupAction = ({ group, action }: { group: BudgetPlanLineGroup; action: 'addLine' | 'edit' | 'delete' }) => {
  openMenuKey.value = null;
  if (action === 'addLine') return emit('addLine', group.id);
  if (action === 'edit') return openGroupDialog({ group });
  targetGroup.value = group;
  isGroupDeleteOpen.value = true;
};

const { isPending: isDeletingGroup, mutate: deleteGroup } = useInvalidatingMutation({
  mutationFn: deleteBudgetLineGroup,
  invalidateKeys: [VUE_QUERY_CACHE_KEYS.budgetPlans],
  successKey: 'budgetPlans.groups.deleted',
  errorKey: 'budgetPlans.groups.deleteError',
  onSuccess: () => {
    isGroupDeleteOpen.value = false;
  },
});

const deleteTargetGroup = () => {
  if (!targetGroup.value || isDeletingGroup.value) return;
  deleteGroup({ planId: props.planId, groupId: targetGroup.value.id });
};

const { isPending: isArchiving, mutate: archive } = useInvalidatingMutation({
  mutationFn: archiveBudgetPlanLine,
  invalidateKeys: [VUE_QUERY_CACHE_KEYS.budgetPlans],
  successKey: 'budgetPlans.line.archived',
  errorKey: 'budgetPlans.line.archiveError',
  onSuccess: () => {
    isArchiveOpen.value = false;
    isDeleteOpen.value = false;
  },
});

const pickMenuAction = ({
  line,
  action,
}: {
  line: BudgetPlanPeriodViewLine;
  action: 'edit' | 'archive' | 'delete';
}) => {
  if (action === 'edit') return emit('edit', line);
  targetLine.value = line;
  targetHasHistory.value = props.historyLineIds.has(line.lineId);
  if (action === 'archive') isArchiveOpen.value = true;
  else isDeleteOpen.value = true;
};

defineExpose({ pickMenuAction });

const { isPending: isAddingSuggested, mutate: addSuggested } = useInvalidatingMutation({
  mutationFn: addSuggestedBudgetLines,
  invalidateKeys: [VUE_QUERY_CACHE_KEYS.budgetPlans],
  invalidateOnSettleKeys: [VUE_QUERY_CACHE_KEYS.aiFeaturesStatus],
  errorKey: 'budgetPlans.line.error',
});

const isSuggestOpen = ref(false);
const { isReached } = useAiAllowance();
const isAiReached = computed(() => isReached());

const addSuggestedLines = ({ answers }: { answers?: BudgetSuggestionAnswers }) => {
  if (isAddingSuggested.value) return;
  addSuggested(
    { planId: props.planId, answers },
    {
      onSuccess: ({ created, answersIgnored }) => {
        isSuggestOpen.value = false;
        if (answersIgnored) addInfoNotification(t('budgetPlans.suggest.answersIgnored'));
        if (created) addSuccessNotification(t('budgetPlans.grid.suggestedAdded', created));
        else addInfoNotification(t('budgetPlans.grid.noSuggestions'));
      },
    },
  );
};

const archiveTargetLine = () => {
  if (!targetLine.value || isArchiving.value) return;
  archive({ planId: props.planId, lineId: targetLine.value.lineId });
};

const isArchiveManyOpen = ref(false);
const archivableSelectedIds = computed(() => props.selectedIds.filter((id) => !archivedLineIds.value.has(id)));
const { isPending: isArchivingMany, mutate: archiveMany } = useInvalidatingMutation({
  mutationFn: async ({ lineIds }: { lineIds: string[] }) => {
    const results = await Promise.allSettled(
      lineIds.map((lineId) => archiveBudgetPlanLine({ planId: props.planId, lineId })),
    );
    const failed = results.find((result) => result.status === 'rejected');
    if (!failed) return;
    const archivedIds = lineIds.filter((_, index) => results[index]?.status === 'fulfilled');
    if (archivedIds.length) emit('toggleMany', archivedIds);
    throw failed.reason;
  },
  invalidateKeys: [VUE_QUERY_CACHE_KEYS.budgetPlans],
  errorKey: 'budgetPlans.line.archiveError',
});

const archiveSelected = () => {
  if (isArchivingMany.value) return;
  const lineIds = archivableSelectedIds.value;
  archiveMany(
    { lineIds },
    {
      onSuccess: () => {
        isArchiveManyOpen.value = false;
        addSuccessNotification(t('budgetPlans.line.archivedMany', lineIds.length));
        emit('clearSelection');
      },
      // A partial failure still archived some lines, so the list must refetch either way.
      onError: () =>
        queryClient.invalidateQueries({
          queryKey: VUE_QUERY_CACHE_KEYS.budgetPlans,
        }),
    },
  );
};
</script>

<template>
  <div>
    <DefineAssignTrigger v-slot="{ line, compact }">
      <AssignPopover :plan-id="planId" :period-id="view.period.id" :line="line">
        <Button
          variant="outline"
          size="sm"
          :aria-label="
            $t('budgetPlans.grid.assignAmountFor', {
              name: line.name,
              amount: formatBaseCurrency(line.assigned),
            })
          "
          :class="
            cn(
              'bg-input-background hover:bg-input-background hover:border-ring w-full cursor-text justify-end px-2.5 font-normal tabular-nums',
              line.assigned === 0 ? 'text-muted-foreground hover:text-muted-foreground' : 'hover:text-foreground',
              compact && 'h-8 w-auto min-w-24',
            )
          "
        >
          {{ formatShortBaseCurrency({ amount: line.assigned }) }}
        </Button>
      </AssignPopover>
    </DefineAssignTrigger>

    <DefineSelectTrigger v-slot="{ line, toggle, $slots }">
      <Button
        variant="ghost"
        :aria-pressed="selectedSet.has(line.lineId)"
        class="-mx-2 h-auto min-w-0 flex-1 flex-col items-stretch gap-0 px-2 py-0 text-left font-normal"
        @click="toggle ? emit('toggle', { lineId: line.lineId, range: false }) : emit('select', line.lineId)"
      >
        <component :is="$slots.default" />
      </Button>
    </DefineSelectTrigger>

    <DefineGoalButton v-slot="{ line }">
      <span class="flex size-5 shrink-0 items-center justify-center">
        <GoalPeekPopover
          v-if="line.goal"
          :plan-id="planId"
          :period-id="view.period.id"
          :unit="unit"
          :line="{ ...line, goal: line.goal }"
          @edit="openGoalEditor({ line })"
        />
        <DesktopOnlyTooltip v-else :content="$t('budgetPlans.goals.create')">
          <Button
            variant="ghost"
            size="icon-sm"
            class="border-muted-foreground/50 text-muted-foreground size-6 rounded-full border border-dashed opacity-0 group-focus-within/line:opacity-100 group-hover/line:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100"
            :aria-label="$t('budgetPlans.goals.create')"
            @click="openGoalEditor({ line })"
          >
            <TargetIcon class="size-3" />
          </Button>
        </DesktopOnlyTooltip>
      </span>
    </DefineGoalButton>

    <DefineGoalStatus v-slot="{ display }">
      <span :class="cn('flex shrink-0 items-center gap-1 text-xs leading-4 tabular-nums', display.textClass)">
        <CheckIcon v-if="display.caption.icon === 'check'" class="size-3" />
        <MoonIcon v-else-if="display.caption.icon === 'moon'" class="size-3" />
        {{ goalText({ part: display.caption.part }) }}
      </span>
    </DefineGoalStatus>

    <DefineNameCell v-slot="{ line, display }">
      <span class="flex min-w-0 items-center justify-between gap-2">
        <span class="min-w-0"><LineName :line="line" /></span>
        <GoalStatus v-if="display" :display="display" />
        <BudgetLineSpentText v-else :line="line" class="min-w-0 truncate text-xs leading-4" />
      </span>
      <BudgetLineBars :line="line" :goal="display" :mode="rowBars" />
    </DefineNameCell>

    <DefineMobileCaption v-slot="{ line, display }">
      <span class="text-muted-foreground mt-1 flex min-w-0 items-center justify-between gap-2 text-xs leading-4">
        <BudgetLineSpentText :line="line" class="truncate" />
        <GoalStatus v-if="display" :display="display" />
      </span>
    </DefineMobileCaption>

    <DefineLineName v-slot="{ line }">
      <span class="flex items-center gap-2 leading-5">
        <span class="min-w-0 truncate text-sm font-semibold">{{ line.name }}</span>
        <span
          v-if="!view.pool && line.assignedSource === 'override'"
          class="text-primary-text bg-primary/10 rounded-full px-1.5 py-0.5 text-[10px] font-medium"
        >
          {{ $t('budgetPlans.grid.overrideBadge') }}
        </span>
        <span
          v-if="line.carryPolicy === 'signed'"
          class="text-muted-foreground bg-muted rounded-full px-1.5 py-0.5 text-[10px] font-medium"
        >
          {{ $t('budgetPlans.grid.carriesDeficit') }}
        </span>
        <span
          v-if="archivedLineIds.has(line.lineId)"
          class="text-muted-foreground bg-muted rounded-full px-1.5 py-0.5 text-[10px] font-medium"
        >
          {{ $t('budgetPlans.grid.archivedBadge') }}
        </span>
      </span>
    </DefineLineName>

    <DefineGroupsHeader>
      <div class="flex min-w-0 items-center gap-1">
        <DesktopOnlyTooltip
          v-if="view.groups.length"
          :content="areAllCollapsed ? $t('budgetPlans.groups.expandAll') : $t('budgetPlans.groups.collapseAll')"
        >
          <Button
            variant="ghost"
            size="icon-sm"
            class="-ml-1.5 size-6"
            :aria-label="areAllCollapsed ? $t('budgetPlans.groups.expandAll') : $t('budgetPlans.groups.collapseAll')"
            :aria-expanded="!areAllCollapsed"
            @click="toggleAllGroups"
          >
            <ChevronDownIcon :class="cn('size-4 transition-transform', areAllCollapsed && '-rotate-90')" />
          </Button>
        </DesktopOnlyTooltip>
        <span class="truncate">{{ $t('budgetPlans.groups.headerLabel') }}</span>
        <DesktopOnlyTooltip :content="$t('budgetPlans.groups.add')">
          <Button
            variant="ghost"
            size="icon-sm"
            class="size-6"
            :aria-label="$t('budgetPlans.groups.add')"
            @click="openGroupDialog({ group: null })"
          >
            <PlusIcon class="size-3.5" />
          </Button>
        </DesktopOnlyTooltip>
      </div>
    </DefineGroupsHeader>

    <DefineGroupControls v-slot="{ group }">
      <div class="flex min-w-0 items-center gap-1">
        <DesktopOnlyTooltip
          :content="
            collapsedIds.has(group.id)
              ? $t('budgetPlans.groups.expand', { name: group.name })
              : $t('budgetPlans.groups.collapse', { name: group.name })
          "
        >
          <Button
            variant="ghost"
            size="icon-sm"
            class="-ml-1.5 size-6 shrink-0"
            :aria-label="
              collapsedIds.has(group.id)
                ? $t('budgetPlans.groups.expand', { name: group.name })
                : $t('budgetPlans.groups.collapse', { name: group.name })
            "
            :aria-expanded="!collapsedIds.has(group.id)"
            @click="toggleGroup({ groupId: group.id })"
          >
            <ChevronDownIcon :class="cn('size-4 transition-transform', collapsedIds.has(group.id) && '-rotate-90')" />
          </Button>
        </DesktopOnlyTooltip>
        <span class="min-w-0 truncate text-xs font-semibold tracking-wide uppercase">{{ group.name }}</span>
        <GroupMenu v-if="narrow" :group="group" :menu-key="`group-card-${group.id}`" />
        <DesktopOnlyTooltip v-else :content="$t('budgetPlans.groups.addLine', { name: group.name })">
          <Button
            variant="ghost"
            size="icon-sm"
            class="size-6 shrink-0"
            :aria-label="$t('budgetPlans.groups.addLine', { name: group.name })"
            @click="emit('addLine', group.id)"
          >
            <PlusIcon class="size-3.5" />
          </Button>
        </DesktopOnlyTooltip>
      </div>
    </DefineGroupControls>

    <DefineGroupMenu v-slot="{ group, menuKey }">
      <DesktopOnlyTooltip :content="$t('budgetPlans.groups.actions')">
        <span class="inline-flex">
          <ResponsiveMenu
            :open="openMenuKey === menuKey"
            @update:open="(open: boolean) => (openMenuKey = open ? menuKey : null)"
          >
            <template #trigger>
              <Button
                variant="ghost"
                size="icon-sm"
                :class="cn(narrow && 'size-6 shrink-0')"
                :aria-label="$t('budgetPlans.groups.actions')"
              >
                <EllipsisIcon class="size-4" />
              </Button>
            </template>

            <Button
              v-if="narrow"
              variant="ghost"
              size="sm"
              class="w-full justify-start"
              @click="pickGroupAction({ group, action: 'addLine' })"
            >
              <PlusIcon class="size-4" />
              {{ $t('budgetPlans.grid.addLine') }}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              class="w-full justify-start"
              @click="pickGroupAction({ group, action: 'edit' })"
            >
              <PencilIcon class="size-4" />
              {{ $t('budgetPlans.groups.edit') }}
            </Button>
            <DesktopOnlyTooltip
              :content="$t('budgetPlans.groups.deleteBlocked')"
              :disabled="!liveGroupIds.has(group.id)"
            >
              <span class="block">
                <Button
                  variant="ghost"
                  size="sm"
                  class="text-destructive-text hover:text-destructive-text w-full justify-start"
                  :disabled="liveGroupIds.has(group.id)"
                  @click="pickGroupAction({ group, action: 'delete' })"
                >
                  <Trash2Icon class="size-4" />
                  {{ $t('budgetPlans.groups.delete') }}
                </Button>
              </span>
            </DesktopOnlyTooltip>
          </ResponsiveMenu>
        </span>
      </DesktopOnlyTooltip>
    </DefineGroupMenu>

    <DefineLineRow v-slot="{ line }">
      <div
        :class="
          cn(
            GRID_ROW_CLASS,
            'group/line border-border hover:bg-accent/40 border-t py-1 select-none',
            selectedSet.has(line.lineId) && 'bg-accent hover:bg-accent',
          )
        "
      >
        <Checkbox
          :model-value="selectedSet.has(line.lineId)"
          :class="CHECKBOX_CLASS"
          :aria-label="$t('budgetPlans.grid.selectLine', { name: line.name })"
          @click="(event: MouseEvent) => emit('toggle', { lineId: line.lineId, range: event.shiftKey })"
        />
        <div class="flex min-w-0 items-center gap-2">
          <GoalButton :line="line" />
          <SelectTrigger :line="line">
            <NameCell :line="line" :display="goalDisplays.get(line.lineId)" />
          </SelectTrigger>
        </div>

        <AssignTrigger :line="line" />

        <span class="text-muted-foreground text-right text-sm tabular-nums">{{
          formatShortBaseCurrency({ amount: line.activity })
        }}</span>
        <span class="text-right">
          <span :class="availableClass({ line })">{{ formatShortBaseCurrency({ amount: line.available }) }}</span>
        </span>

        <span v-if="archivedLineIds.has(line.lineId)" />
        <LineActionsMenu v-else @pick="(action) => pickMenuAction({ line, action })" />
      </div>
    </DefineLineRow>

    <DefineLineCard v-slot="{ line }">
      <div
        :class="
          cn(
            'group/line border-border flex items-center gap-3 border-t px-4 py-2',
            selectedSet.has(line.lineId) && 'bg-accent',
          )
        "
      >
        <Checkbox
          v-if="selectMode"
          :model-value="selectedSet.has(line.lineId)"
          :class="CHECKBOX_CLASS"
          :aria-label="$t('budgetPlans.grid.selectLine', { name: line.name })"
          @click="emit('toggle', { lineId: line.lineId, range: false })"
        />
        <SelectTrigger :line="line" :toggle="selectMode">
          <span class="flex min-w-0 items-center gap-3">
            <span class="min-w-0 flex-1"><LineName :line="line" /></span>
            <span :class="cn(MOBILE_ASSIGNED_CLASS, 'text-muted-foreground text-sm')">
              {{ formatShortBaseCurrency({ amount: line.assigned }) }}
            </span>
            <span :class="MOBILE_AVAILABLE_CLASS">
              <span :class="availableClass({ line })">{{ formatShortBaseCurrency({ amount: line.available }) }}</span>
            </span>
          </span>
          <BudgetLineBars :line="line" :goal="goalDisplays.get(line.lineId)" :mode="rowBars" />
          <MobileCaption :line="line" :display="goalDisplays.get(line.lineId)" />
        </SelectTrigger>
      </div>
    </DefineLineCard>

    <DefineArchivedTrigger>
      <Button
        v-if="archivedLines.length"
        variant="ghost"
        size="sm"
        class="text-muted-foreground h-7 shrink-0 px-2 text-xs"
        aria-haspopup="dialog"
        @click="isArchivedListOpen = true"
      >
        <ArchiveIcon class="size-3.5" />
        {{
          $t('budgetPlans.archivedLines.trigger', {
            count: archivedLines.length,
          })
        }}
      </Button>
    </DefineArchivedTrigger>

    <div
      v-if="!view.lines.length && !view.groups.length"
      class="border-border m-4 flex flex-col items-center gap-3 rounded-lg border border-dashed p-8 text-center"
    >
      <div class="bg-muted text-muted-foreground flex size-12 items-center justify-center rounded-full">
        <ListPlusIcon class="size-6" />
      </div>
      <h2 class="text-lg font-semibold">
        {{ $t('budgetPlans.grid.noLines') }}
      </h2>
      <p class="text-muted-foreground max-w-sm text-sm">
        {{ $t('budgetPlans.grid.noLinesDescription') }}
      </p>
      <template v-if="view.period.isCurrent">
        <div class="flex flex-wrap items-center justify-center gap-2">
          <Button
            variant="soft-primary"
            :disabled="isAddingSuggested"
            @click="isAiReached ? addSuggestedLines({}) : (isSuggestOpen = true)"
          >
            <SparklesIcon class="size-4" />
            {{ $t('budgetPlans.grid.addSuggested') }}
          </Button>
          <AiUsageBadge />
        </div>
        <p v-if="isAiReached" class="text-muted-foreground max-w-sm text-xs">
          {{ $t('budgetPlans.create.askQuestionsNeedsAi') }}
        </p>
      </template>
      <DocsLink path="/budgeting/start-budgeting/" class="text-sm">{{ $t('budgetPlans.docs.howItWorks') }}</DocsLink>
      <ArchivedTrigger />
    </div>

    <template v-else>
      <div v-if="!narrow" class="relative">
        <div
          :class="
            cn(
              GRID_ROW_CLASS,
              'text-muted-foreground bg-card border-border sticky top-[calc(var(--header-height)+2.75rem+var(--strip-h,0))] z-10 -mb-px border-b py-2 text-[11px] font-medium tracking-wide uppercase',
            )
          "
        >
          <Checkbox
            :model-value="stateOf({ lineIds: allLineIds })"
            :class="CHECKBOX_CLASS"
            :disabled="!allLineIds.length"
            :aria-label="$t('budgetPlans.grid.selectAll')"
            @click="emit('toggleMany', allLineIds)"
          />
          <GroupsHeader />
          <span class="text-right">{{ $t('budgetPlans.grid.assigned') }}</span>
          <span class="text-right">{{ $t('budgetPlans.grid.activity') }}</span>
          <span class="text-right">{{ $t('budgetPlans.grid.available') }}</span>
          <span />
        </div>

        <div
          v-if="selectedIds.length > 1"
          class="sticky top-[calc(var(--header-height)+5.75rem+var(--strip-h,0))] z-(--z-over-default) h-0"
        >
          <div
            class="border-border bg-popover text-popover-foreground absolute top-1 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-lg border py-0.5 pr-1 pl-3 text-xs font-medium shadow-md"
          >
            <span class="pr-2 whitespace-nowrap">{{ $t('budgetPlans.grid.selectedCount', selectedIds.length) }}</span>
            <Button
              v-if="archivableSelectedIds.length"
              variant="ghost"
              size="sm"
              class="h-7 px-2 text-xs"
              @click="isArchiveManyOpen = true"
            >
              <ArchiveIcon class="size-3.5" />
              {{ $t('budgetPlans.grid.archiveSelected') }}
            </Button>
            <DesktopOnlyTooltip :content="$t('budgetPlans.grid.clearSelection')">
              <Button
                variant="ghost"
                size="icon-sm"
                class="size-7"
                :aria-label="$t('budgetPlans.grid.clearSelection')"
                @click="emit('clearSelection')"
              >
                <XIcon class="size-3.5" />
              </Button>
            </DesktopOnlyTooltip>
          </div>
        </div>

        <LineRow v-for="line in sections.ungrouped" :key="line.lineId" :line="line" />

        <template v-for="section in sections.groups" :key="section.group.id">
          <div
            :class="cn(GRID_ROW_CLASS, 'border-border bg-muted border-t py-1.5 text-sm font-medium')"
            @contextmenu.prevent="openMenuKey = `group-row-${section.group.id}`"
          >
            <Checkbox
              :model-value="
                stateOf({
                  lineIds: section.lines.map((line) => line.lineId),
                })
              "
              :class="CHECKBOX_CLASS"
              :disabled="!section.lines.length"
              :aria-label="
                $t('budgetPlans.groups.selectLines', {
                  name: section.group.name,
                })
              "
              @click="
                emit(
                  'toggleMany',
                  section.lines.map((line) => line.lineId),
                )
              "
            />
            <GroupControls :group="section.group" />
            <span class="text-right tabular-nums">{{
              formatShortBaseCurrency({ amount: section.totals.assigned })
            }}</span>
            <span class="text-muted-foreground text-right tabular-nums">{{
              formatShortBaseCurrency({ amount: section.totals.activity })
            }}</span>
            <span :class="cn('text-right tabular-nums', amountToneClass({ amount: section.totals.available }))">
              {{ formatShortBaseCurrency({ amount: section.totals.available }) }}
            </span>
            <GroupMenu :group="section.group" :menu-key="`group-row-${section.group.id}`" />
          </div>

          <template v-if="!collapsedIds.has(section.group.id)">
            <LineRow v-for="line in section.lines" :key="line.lineId" :line="line" />
          </template>
        </template>

        <div :class="cn(GRID_ROW_CLASS, 'border-border border-t py-2.5 text-sm font-medium')">
          <span />
          <div class="flex min-w-0 items-center gap-2">
            <span class="text-muted-foreground truncate">
              {{
                $t('budgetPlans.grid.totalWithLines', {
                  count: view.lines.length,
                })
              }}
            </span>
            <ArchivedTrigger />
          </div>
          <span class="text-right tabular-nums">{{
            formatShortBaseCurrency({ amount: view.header.totalAssigned })
          }}</span>
          <span class="text-muted-foreground text-right tabular-nums">{{
            formatShortBaseCurrency({ amount: view.header.totalActivity })
          }}</span>
          <span :class="cn('text-right tabular-nums', amountToneClass({ amount: view.header.totalAvailable }))">
            {{ formatShortBaseCurrency({ amount: view.header.totalAvailable }) }}
          </span>
          <span />
        </div>
      </div>

      <div v-else class="relative">
        <div class="text-muted-foreground flex items-center px-4 py-1 text-[11px] font-medium tracking-wide uppercase">
          <GroupsHeader />
        </div>

        <LineCard v-for="line in sections.ungrouped" :key="line.lineId" :line="line" />

        <template v-for="section in sections.groups" :key="section.group.id">
          <div
            class="border-border bg-muted flex items-center gap-3 border-t px-4 py-1.5 text-sm font-medium"
            @contextmenu.prevent="openMenuKey = `group-card-${section.group.id}`"
          >
            <Checkbox
              v-if="selectMode"
              :model-value="
                stateOf({
                  lineIds: section.lines.map((line) => line.lineId),
                })
              "
              :class="CHECKBOX_CLASS"
              :disabled="!section.lines.length"
              :aria-label="
                $t('budgetPlans.groups.selectLines', {
                  name: section.group.name,
                })
              "
              @click="
                emit(
                  'toggleMany',
                  section.lines.map((line) => line.lineId),
                )
              "
            />
            <span class="min-w-0 flex-1"><GroupControls :group="section.group" /></span>
            <span :class="cn(MOBILE_ASSIGNED_CLASS, 'flex flex-col')">
              <span class="text-muted-foreground text-[10px] font-medium tracking-wide uppercase">
                {{ $t('budgetPlans.grid.assigned') }}
              </span>
              <span>{{ formatShortBaseCurrency({ amount: section.totals.assigned }) }}</span>
            </span>
            <span :class="cn(MOBILE_AVAILABLE_CLASS, 'flex flex-col')">
              <span class="text-muted-foreground text-[10px] font-medium tracking-wide uppercase">
                {{ $t('budgetPlans.grid.available') }}
              </span>
              <span :class="amountToneClass({ amount: section.totals.available })">
                {{ formatShortBaseCurrency({ amount: section.totals.available }) }}
              </span>
            </span>
          </div>

          <template v-if="!collapsedIds.has(section.group.id)">
            <LineCard v-for="line in section.lines" :key="line.lineId" :line="line" />
          </template>
        </template>

        <div v-if="archivedLines.length" class="border-border flex justify-end border-t px-2 py-1">
          <ArchivedTrigger />
        </div>

        <div
          v-if="selectMode"
          class="border-border bg-card sticky bottom-0 z-10 flex flex-wrap items-center gap-2 border-t px-3 py-2"
        >
          <span class="flex min-w-0 flex-1 flex-col">
            <span class="text-muted-foreground text-[11px] font-medium uppercase">
              {{ $t('budgetPlans.grid.selectionAvailable') }}
            </span>
            <span :class="cn('text-base font-bold tabular-nums', amountToneClass({ amount: selectionAvailable }))">
              {{ formatBaseCurrency(selectionAvailable) }}
            </span>
          </span>
          <Button
            variant="outline"
            size="sm"
            :disabled="!archivableSelectedIds.length"
            @click="isArchiveManyOpen = true"
          >
            <ArchiveIcon class="size-4" />
            {{ $t('budgetPlans.grid.archiveSelected') }}
          </Button>
          <Button size="sm" :disabled="!selectedIds.length" @click="emit('openPanel')">
            {{ $t('budgetPlans.panel.breakdown') }}
          </Button>
        </div>
      </div>
    </template>

    <ResponsiveDialog v-model:open="isSuggestOpen">
      <template #title>{{ $t('budgetPlans.suggest.title') }}</template>
      <SuggestionWizard
        v-if="isSuggestOpen"
        :account-ids="accountIds"
        :submit-label="$t('budgetPlans.grid.addSuggested')"
        :is-submitting="isAddingSuggested"
        @back="isSuggestOpen = false"
        @submit="(answers) => addSuggestedLines({ answers })"
      />
    </ResponsiveDialog>

    <ResponsiveAlertDialog
      v-model:open="isArchiveOpen"
      :confirm-label="$t('budgetPlans.grid.archiveLine')"
      confirm-variant="destructive"
      :confirm-disabled="isArchiving"
      @confirm="archiveTargetLine"
    >
      <template #title>{{ $t('budgetPlans.grid.archiveTitle', { name: targetLine?.name }) }}</template>
      <template #description>{{ $t('budgetPlans.grid.archiveDescription') }}</template>
    </ResponsiveAlertDialog>

    <ResponsiveAlertDialog
      v-model:open="isArchiveManyOpen"
      :confirm-label="$t('budgetPlans.grid.archiveSelected')"
      confirm-variant="destructive"
      :confirm-disabled="isArchivingMany"
      @confirm="archiveSelected"
    >
      <template #title>{{ $t('budgetPlans.grid.archiveManyTitle', archivableSelectedIds.length) }}</template>
      <template #description>{{ $t('budgetPlans.grid.archiveManyDescription') }}</template>
    </ResponsiveAlertDialog>

    <DeleteLineDialog
      v-model:open="isDeleteOpen"
      :plan-id="planId"
      :line="targetLine"
      :has-history="targetHasHistory"
      :is-archiving="isArchiving"
      @archive="archiveTargetLine"
    />

    <GroupNameDialog v-model:open="isGroupDialogOpen" :plan-id="planId" :group="targetGroup" />

    <ResponsiveAlertDialog
      v-model:open="isGroupDeleteOpen"
      :confirm-label="$t('budgetPlans.groups.delete')"
      confirm-variant="destructive"
      :confirm-disabled="isDeletingGroup"
      @confirm="deleteTargetGroup"
    >
      <template #title>{{ $t('budgetPlans.groups.deleteTitle', { name: targetGroup?.name }) }}</template>
      <template #description>{{ $t('budgetPlans.groups.deleteDescription') }}</template>
    </ResponsiveAlertDialog>

    <ArchivedLinesDialog v-model:open="isArchivedListOpen" :plan-id="planId" :lines="archivedLines" />

    <GoalEditorDialog
      v-if="goalLine"
      v-model:open="isGoalEditorOpen"
      :plan-id="planId"
      :period-id="view.period.id"
      :unit="unit"
      :line="goalLine"
    />
  </div>
</template>
