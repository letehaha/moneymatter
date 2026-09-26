<script setup lang="ts">
import { addSuggestedBudgetLines, archiveBudgetPlanLine, deleteBudgetLineGroup } from '@/api/budget-plans';
import { VUE_QUERY_CACHE_KEYS } from '@/common/const';
import DocsLink from '@/components/common/docs-link.vue';
import ResponsiveAlertDialog from '@/components/common/responsive-alert-dialog.vue';
import ResponsiveMenu from '@/components/common/responsive-menu.vue';
import { Button } from '@/components/lib/ui/button';
import { DesktopOnlyTooltip } from '@/components/lib/ui/tooltip';
import { useNotificationCenter } from '@/components/notification-center';
import { useFormatCurrency } from '@/composable';
import { useInvalidatingMutation } from '@/composable/data-queries/use-invalidating-mutation';
import { cn } from '@/lib/utils';
import { useCategoriesStore } from '@/stores';
import type {
  BudgetPlanLineEntry,
  BudgetPlanLineGroup,
  BudgetPlanPeriodView,
  BudgetPlanPeriodViewLine,
} from '@bt/shared/types';
import {
  ArchiveIcon,
  CheckIcon,
  ChevronDownIcon,
  EllipsisIcon,
  ListPlusIcon,
  MoonIcon,
  PlusIcon,
  SparklesIcon,
  TargetIcon,
} from '@lucide/vue';
import { createReusableTemplate } from '@vueuse/core';
import { storeToRefs } from 'pinia';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';

import { useCollapsedGroups } from '../composables/use-collapsed-groups';
import type { RowBarMode } from '../composables/use-grid-display-options';
import { useGoalText } from '../composables/use-goal-text';
import {
  type GoalPeriodUnit,
  amountToneClass,
  goalCaption,
  goalStatusDisplay,
  groupLines,
  spentOf,
  sumLineTotals,
} from '../helpers';
import ArchivedLinesDialog from './archived-lines-dialog.vue';
import AssignPopover from './assign-popover.vue';
import BudgetLineBars from './budget-line-bars.vue';
import DeleteLineDialog from './delete-line-dialog.vue';
import GoalEditorDialog from './goal-editor-dialog.vue';
import GoalPeekPopover from './goal-peek-popover.vue';
import GroupNameDialog from './group-name-dialog.vue';

type GoalDisplay = ReturnType<typeof goalStatusDisplay> & { caption: ReturnType<typeof goalCaption> };

const props = defineProps<{
  planId: string;
  view: BudgetPlanPeriodView;
  archivedLines: BudgetPlanLineEntry[];
  historyLineIds: Set<string>;
  selectedLineId: string | null;
  /** Groups that still hold a live line and so cannot be deleted. */
  liveGroupIds: Set<string>;
  unit: GoalPeriodUnit;
  rowBars: RowBarMode;
  compactRows: boolean;
}>();
const emit = defineEmits<{
  edit: [line: BudgetPlanPeriodViewLine];
  select: [lineId: string];
  addLine: [groupId: string | null];
}>();

const GRID_ROW_CLASS = 'grid grid-cols-[minmax(0,1fr)_repeat(3,7rem)_2.5rem] gap-2 px-4';

const [DefineLineMenu, LineMenu] = createReusableTemplate<{ line: BudgetPlanPeriodViewLine; menuKey: string }>();
const [DefineAssignTrigger, AssignTrigger] = createReusableTemplate<{
  line: BudgetPlanPeriodViewLine;
  compact?: boolean;
}>();
const [DefineArchivedTrigger, ArchivedTrigger] = createReusableTemplate();
const [DefineGroupsHeader, GroupsHeader] = createReusableTemplate();
const [DefineGroupControls, GroupControls] = createReusableTemplate<{ group: BudgetPlanLineGroup }>();
const [DefineGroupMenu, GroupMenu] = createReusableTemplate<{ group: BudgetPlanLineGroup; menuKey: string }>();
const [DefineLineRow, LineRow] = createReusableTemplate<{ line: BudgetPlanPeriodViewLine }>();
const [DefineLineCard, LineCard] = createReusableTemplate<{ line: BudgetPlanPeriodViewLine }>();
const [DefineSelectTrigger, SelectTrigger] = createReusableTemplate<{ line: BudgetPlanPeriodViewLine }>();
const [DefineGoalButton, GoalButton] = createReusableTemplate<{ line: BudgetPlanPeriodViewLine }>();
const [DefineLineName, LineName] = createReusableTemplate<{ line: BudgetPlanPeriodViewLine }>();
const [DefineGoalCaption, GoalCaption] = createReusableTemplate<{
  line: BudgetPlanPeriodViewLine;
  display?: GoalDisplay;
}>();

const { t } = useI18n();
const { addSuccessNotification, addInfoNotification } = useNotificationCenter();
const { formatBaseCurrency } = useFormatCurrency();
const { goalText } = useGoalText();
const { categoriesMap } = storeToRefs(useCategoriesStore());

const archivedLineIds = computed(() => new Set(props.archivedLines.map((line) => line.id)));

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

const availableClass = ({ line }: { line: BudgetPlanPeriodViewLine }) =>
  goalDisplays.value.get(line.lineId)?.kind === 'underfunded'
    ? 'bg-warning/15 text-warning-text rounded-full px-2 py-0.5'
    : amountToneClass({ amount: line.available });

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
// Keyed per layout: the table row and the mobile card both render a menu for the same line.
const openMenuKey = ref<string | null>(null);

const sections = computed(() => {
  const { ungrouped, groups } = groupLines({ lines: props.view.lines, groups: props.view.groups });
  return {
    ungrouped,
    groups: groups.map((section) => ({ ...section, totals: sumLineTotals({ lines: section.lines }) })),
  };
});

const { collapsedIds, setCollapsed, toggleGroup } = useCollapsedGroups({ planId: () => props.planId });
const areAllCollapsed = computed(
  () => props.view.groups.length > 0 && props.view.groups.every((group) => collapsedIds.value.has(group.id)),
);
const toggleAllGroups = () =>
  setCollapsed({ groupIds: props.view.groups.map((group) => group.id), collapsed: !areAllCollapsed.value });

const isGroupDialogOpen = ref(false);
const isGroupDeleteOpen = ref(false);
const targetGroup = ref<BudgetPlanLineGroup | null>(null);

const openGroupDialog = ({ group }: { group: BudgetPlanLineGroup | null }) => {
  targetGroup.value = group;
  isGroupDialogOpen.value = true;
};

const pickGroupAction = ({ group, action }: { group: BudgetPlanLineGroup; action: 'edit' | 'delete' }) => {
  openMenuKey.value = null;
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

const categoriesCaption = ({ line }: { line: BudgetPlanPeriodViewLine }) =>
  line.categoryIds
    .map((id) => categoriesMap.value[id]?.name)
    .filter(Boolean)
    .join(' · ');

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
  openMenuKey.value = null;
  if (action === 'edit') return emit('edit', line);
  targetLine.value = line;
  targetHasHistory.value = props.historyLineIds.has(line.lineId);
  if (action === 'archive') isArchiveOpen.value = true;
  else isDeleteOpen.value = true;
};

const { isPending: isAddingSuggested, mutate: addSuggested } = useInvalidatingMutation({
  mutationFn: addSuggestedBudgetLines,
  invalidateKeys: [VUE_QUERY_CACHE_KEYS.budgetPlans],
  errorKey: 'budgetPlans.line.error',
});

const addSuggestedLines = () => {
  if (isAddingSuggested.value) return;
  addSuggested(
    { planId: props.planId },
    {
      onSuccess: ({ created }) =>
        created
          ? addSuccessNotification(t('budgetPlans.grid.suggestedAdded', created))
          : addInfoNotification(t('budgetPlans.grid.noSuggestions')),
    },
  );
};

const archiveTargetLine = () => {
  if (!targetLine.value || isArchiving.value) return;
  archive({ planId: props.planId, lineId: targetLine.value.lineId });
};
</script>

<template>
  <div class="@container/lines">
    <DefineLineMenu v-slot="{ line, menuKey }">
      <DesktopOnlyTooltip :content="$t('budgetPlans.grid.lineActions')">
        <span class="inline-flex">
          <ResponsiveMenu
            :open="openMenuKey === menuKey"
            @update:open="(open: boolean) => (openMenuKey = open ? menuKey : null)"
          >
            <template #trigger>
              <Button variant="ghost" size="icon-sm" :aria-label="$t('budgetPlans.grid.lineActions')">
                <EllipsisIcon class="size-4" />
              </Button>
            </template>

            <Button
              variant="ghost"
              size="sm"
              class="w-full justify-start"
              @click="pickMenuAction({ line, action: 'edit' })"
            >
              {{ $t('budgetPlans.grid.editLine') }}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              class="w-full justify-start"
              @click="pickMenuAction({ line, action: 'archive' })"
            >
              {{ $t('budgetPlans.grid.archiveLine') }}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              class="text-destructive-text hover:text-destructive-text w-full justify-start"
              @click="pickMenuAction({ line, action: 'delete' })"
            >
              {{ $t('budgetPlans.grid.deleteLine') }}
            </Button>
          </ResponsiveMenu>
        </span>
      </DesktopOnlyTooltip>
    </DefineLineMenu>

    <DefineAssignTrigger v-slot="{ line, compact }">
      <AssignPopover :plan-id="planId" :period-id="view.period.id" :line="line">
        <Button
          variant="outline"
          size="sm"
          :aria-label="
            $t('budgetPlans.grid.assignAmountFor', { name: line.name, amount: formatBaseCurrency(line.assigned) })
          "
          :class="
            cn(
              'bg-input-background hover:bg-input-background hover:border-ring w-full cursor-text justify-end px-2.5 font-normal tabular-nums',
              line.assigned === 0 ? 'text-muted-foreground hover:text-muted-foreground' : 'hover:text-foreground',
              compact && 'h-8 w-auto min-w-24',
            )
          "
        >
          {{ formatBaseCurrency(line.assigned) }}
        </Button>
      </AssignPopover>
    </DefineAssignTrigger>

    <DefineSelectTrigger v-slot="{ line, $slots }">
      <Button
        variant="ghost"
        :aria-pressed="selectedLineId === line.lineId"
        :class="
          cn(
            '-mx-2 h-auto min-w-0 flex-1 flex-col items-stretch gap-0 px-2 text-left font-normal',
            compactRows ? 'py-0.5' : 'py-1',
          )
        "
        @click="emit('select', line.lineId)"
      >
        <component :is="$slots.default" />
      </Button>
    </DefineSelectTrigger>

    <DefineGoalButton v-slot="{ line }">
      <span class="mt-0.5 flex size-6 shrink-0 items-center justify-center">
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

    <DefineGoalCaption v-slot="{ line, display }">
      <span class="flex min-w-0 items-center justify-between gap-2 text-xs">
        <span class="text-muted-foreground truncate">{{ categoriesCaption({ line }) }}</span>
        <span v-if="display" :class="cn('flex shrink-0 items-center gap-1 tabular-nums', display.textClass)">
          <CheckIcon v-if="display.caption.icon === 'check'" class="size-3" />
          <MoonIcon v-else-if="display.caption.icon === 'moon'" class="size-3" />
          {{ goalText({ part: display.caption.part }) }}
        </span>
        <span v-else class="text-muted-foreground shrink-0 tabular-nums">
          {{
            $t('budgetPlans.grid.spentOf', {
              spent: formatBaseCurrency(spentOf({ line })),
              total: formatBaseCurrency(line.carriedIn + line.assigned),
            })
          }}
        </span>
      </span>
      <BudgetLineBars :line="line" :goal="display" :mode="rowBars" :compact="compactRows" />
    </DefineGoalCaption>

    <DefineLineName v-slot="{ line }">
      <span class="flex items-center gap-2">
        <span class="min-w-0 truncate font-semibold">{{ line.name }}</span>
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
        <span class="truncate tracking-wide uppercase">{{ $t('budgetPlans.groups.headerLabel') }}</span>
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
        <span class="min-w-0 truncate text-xs font-semibold tracking-wide uppercase">{{ group.name }}</span>
        <DesktopOnlyTooltip :content="$t('budgetPlans.groups.addLine', { name: group.name })">
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
              <Button variant="ghost" size="icon-sm" :aria-label="$t('budgetPlans.groups.actions')">
                <EllipsisIcon class="size-4" />
              </Button>
            </template>

            <Button
              variant="ghost"
              size="sm"
              class="w-full justify-start"
              @click="pickGroupAction({ group, action: 'edit' })"
            >
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
            'group/line border-border items-center border-t',
            compactRows ? 'py-1' : 'py-2.5',
            selectedLineId === line.lineId && 'bg-accent',
          )
        "
      >
        <div class="flex min-w-0 items-start gap-2">
          <GoalButton :line="line" />
          <SelectTrigger :line="line">
            <LineName :line="line" />
            <GoalCaption :line="line" :display="goalDisplays.get(line.lineId)" />
          </SelectTrigger>
        </div>

        <AssignTrigger :line="line" />

        <span class="text-right text-sm tabular-nums">{{ formatBaseCurrency(line.activity) }}</span>
        <span class="text-right">
          <span :class="cn('text-sm font-medium tabular-nums', availableClass({ line }))">
            {{ formatBaseCurrency(line.available) }}
          </span>
        </span>

        <span v-if="archivedLineIds.has(line.lineId)" />
        <LineMenu v-else :line="line" :menu-key="`row-${line.lineId}`" />
      </div>
    </DefineLineRow>

    <DefineLineCard v-slot="{ line }">
      <div
        :class="
          cn(
            'group/line border-border bg-muted/40 rounded-lg border',
            compactRows ? 'p-2' : 'p-3',
            selectedLineId === line.lineId && 'border-primary',
          )
        "
      >
        <div class="flex items-start justify-between gap-3">
          <div class="flex min-w-0 flex-1 items-start gap-2">
            <GoalButton :line="line" />
            <SelectTrigger :line="line">
              <LineName :line="line" />
              <GoalCaption :line="line" :display="goalDisplays.get(line.lineId)" />
            </SelectTrigger>
          </div>
          <div class="flex shrink-0 items-center gap-1">
            <span :class="cn('text-lg font-bold tabular-nums', availableClass({ line }))">
              {{ formatBaseCurrency(line.available) }}
            </span>
            <LineMenu v-if="!archivedLineIds.has(line.lineId)" :line="line" :menu-key="`card-${line.lineId}`" />
          </div>
        </div>

        <div :class="cn('flex items-center justify-between gap-3', compactRows ? 'mt-1' : 'mt-2')">
          <span v-if="line.goal" class="text-muted-foreground text-xs tabular-nums">
            {{ $t('budgetPlans.grid.spentAmount', { amount: formatBaseCurrency(spentOf({ line })) }) }}
          </span>
          <div class="ml-auto flex items-center gap-2">
            <span class="text-muted-foreground text-xs">{{ $t('budgetPlans.grid.assigned') }}</span>
            <AssignTrigger :line="line" :compact="true" />
          </div>
        </div>
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
        {{ $t('budgetPlans.archivedLines.trigger', { count: archivedLines.length }) }}
      </Button>
    </DefineArchivedTrigger>

    <div
      v-if="!view.lines.length && !view.groups.length"
      class="border-border flex flex-col items-center gap-3 rounded-lg border border-dashed p-8 text-center"
    >
      <div class="bg-primary/10 text-primary-text flex size-12 items-center justify-center rounded-full">
        <ListPlusIcon class="size-6" />
      </div>
      <h2 class="text-lg font-semibold">{{ $t('budgetPlans.grid.noLines') }}</h2>
      <p class="text-muted-foreground max-w-sm text-sm">{{ $t('budgetPlans.grid.noLinesDescription') }}</p>
      <Button
        v-if="view.period.isCurrent"
        variant="soft-primary"
        :disabled="isAddingSuggested"
        @click="addSuggestedLines"
      >
        <SparklesIcon class="size-4" />
        {{ $t('budgetPlans.grid.addSuggested') }}
      </Button>
      <DocsLink path="/budgeting/start-budgeting/" class="text-sm">{{ $t('budgetPlans.docs.howItWorks') }}</DocsLink>
      <ArchivedTrigger />
    </div>

    <template v-else>
      <div class="border-border bg-muted/40 hidden overflow-hidden rounded-lg border @2xl/lines:block">
        <div :class="cn(GRID_ROW_CLASS, 'text-muted-foreground items-center py-2 text-xs font-medium')">
          <GroupsHeader />
          <span class="text-right">{{ $t('budgetPlans.grid.assigned') }}</span>
          <span class="text-right">{{ $t('budgetPlans.grid.activity') }}</span>
          <span class="text-right">{{ $t('budgetPlans.grid.available') }}</span>
          <span />
        </div>

        <LineRow v-for="line in sections.ungrouped" :key="line.lineId" :line="line" />

        <template v-for="section in sections.groups" :key="section.group.id">
          <div
            :class="cn(GRID_ROW_CLASS, 'border-border bg-muted items-center border-t py-1.5 text-sm font-medium')"
            @contextmenu.prevent="openMenuKey = `group-row-${section.group.id}`"
          >
            <GroupControls :group="section.group" />
            <span class="text-right tabular-nums">{{ formatBaseCurrency(section.totals.assigned) }}</span>
            <span class="text-right tabular-nums">{{ formatBaseCurrency(section.totals.activity) }}</span>
            <span :class="cn('text-right tabular-nums', amountToneClass({ amount: section.totals.available }))">
              {{ formatBaseCurrency(section.totals.available) }}
            </span>
            <GroupMenu :group="section.group" :menu-key="`group-row-${section.group.id}`" />
          </div>

          <template v-if="!collapsedIds.has(section.group.id)">
            <LineRow v-for="line in section.lines" :key="line.lineId" :line="line" />
          </template>
        </template>

        <div :class="cn(GRID_ROW_CLASS, 'border-border items-center border-t py-2.5 text-sm font-medium')">
          <div class="flex min-w-0 items-center gap-2">
            <span class="text-muted-foreground truncate">
              {{ $t('budgetPlans.grid.totalWithLines', { count: view.lines.length }) }}
            </span>
            <ArchivedTrigger />
          </div>
          <span class="text-right tabular-nums">{{ formatBaseCurrency(view.header.totalAssigned) }}</span>
          <span class="text-right tabular-nums">{{ formatBaseCurrency(view.header.totalActivity) }}</span>
          <span :class="cn('text-right tabular-nums', amountToneClass({ amount: view.header.totalAvailable }))">
            {{ formatBaseCurrency(view.header.totalAvailable) }}
          </span>
          <span />
        </div>
      </div>

      <div class="grid gap-2 @2xl/lines:hidden">
        <div class="text-muted-foreground px-1 text-xs font-medium">
          <GroupsHeader />
        </div>

        <LineCard v-for="line in sections.ungrouped" :key="line.lineId" :line="line" />

        <template v-for="section in sections.groups" :key="section.group.id">
          <div
            class="bg-muted mt-2 rounded-lg px-3 py-2"
            @contextmenu.prevent="openMenuKey = `group-card-${section.group.id}`"
          >
            <div class="flex items-center justify-between gap-2">
              <GroupControls :group="section.group" />
              <GroupMenu :group="section.group" :menu-key="`group-card-${section.group.id}`" />
            </div>
            <dl class="mt-1 grid grid-cols-3 gap-2 text-xs">
              <div>
                <dt class="text-muted-foreground">{{ $t('budgetPlans.grid.assigned') }}</dt>
                <dd class="font-medium tabular-nums">{{ formatBaseCurrency(section.totals.assigned) }}</dd>
              </div>
              <div>
                <dt class="text-muted-foreground">{{ $t('budgetPlans.grid.activity') }}</dt>
                <dd class="font-medium tabular-nums">{{ formatBaseCurrency(section.totals.activity) }}</dd>
              </div>
              <div>
                <dt class="text-muted-foreground">{{ $t('budgetPlans.grid.available') }}</dt>
                <dd :class="cn('font-medium tabular-nums', amountToneClass({ amount: section.totals.available }))">
                  {{ formatBaseCurrency(section.totals.available) }}
                </dd>
              </div>
            </dl>
          </div>

          <template v-if="!collapsedIds.has(section.group.id)">
            <LineCard v-for="line in section.lines" :key="line.lineId" :line="line" />
          </template>
        </template>

        <div v-if="archivedLines.length" class="flex justify-end">
          <ArchivedTrigger />
        </div>
      </div>
    </template>

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
