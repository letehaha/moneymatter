<script setup lang="ts">
import { archiveBudgetPlanLine } from '@/api/budget-plans';
import { VUE_QUERY_CACHE_KEYS } from '@/common/const';
import ResponsiveAlertDialog from '@/components/common/responsive-alert-dialog.vue';
import ResponsiveMenu from '@/components/common/responsive-menu.vue';
import { Button } from '@/components/lib/ui/button';
import { DesktopOnlyTooltip } from '@/components/lib/ui/tooltip';
import { useFormatCurrency } from '@/composable';
import { useInvalidatingMutation } from '@/composable/data-queries/use-invalidating-mutation';
import { cn } from '@/lib/utils';
import { useCategoriesStore } from '@/stores';
import type { BudgetPlanLineEntry, BudgetPlanPeriodView, BudgetPlanPeriodViewLine } from '@bt/shared/types';
import { ArchiveIcon, EllipsisIcon, ListPlusIcon } from '@lucide/vue';
import { createReusableTemplate } from '@vueuse/core';
import { storeToRefs } from 'pinia';
import { computed, ref } from 'vue';

import { amountToneClass, progressOf, spentOf } from '../helpers';
import ArchivedLinesDialog from './archived-lines-dialog.vue';
import AssignPopover from './assign-popover.vue';
import DeleteLineDialog from './delete-line-dialog.vue';

const props = defineProps<{
  planId: string;
  view: BudgetPlanPeriodView;
  archivedLines: BudgetPlanLineEntry[];
  historyLineIds: Set<string>;
}>();
const emit = defineEmits<{ edit: [line: BudgetPlanPeriodViewLine] }>();

const GRID_ROW_CLASS = 'grid grid-cols-[minmax(0,1fr)_repeat(3,7rem)_2.5rem] gap-2 px-4';

const [DefineLineMenu, LineMenu] = createReusableTemplate<{ line: BudgetPlanPeriodViewLine; menuKey: string }>();
const [DefineAssignTrigger, AssignTrigger] = createReusableTemplate<{
  line: BudgetPlanPeriodViewLine;
  compact?: boolean;
}>();
const [DefineArchivedTrigger, ArchivedTrigger] = createReusableTemplate();

const { formatBaseCurrency } = useFormatCurrency();
const { categoriesMap } = storeToRefs(useCategoriesStore());

const archivedLineIds = computed(() => new Set(props.archivedLines.map((line) => line.id)));

const isArchiveOpen = ref(false);
const isDeleteOpen = ref(false);
const isArchivedListOpen = ref(false);
// Kept after close so the title does not flash empty while the dialog animates out.
const targetLine = ref<BudgetPlanPeriodViewLine | null>(null);
const targetHasHistory = ref(false);
// Keyed per layout: the table row and the mobile card both render a menu for the same line.
const openMenuKey = ref<string | null>(null);

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
      v-if="!view.lines.length"
      class="border-border flex flex-col items-center gap-3 rounded-lg border border-dashed p-8 text-center"
    >
      <div class="bg-primary/10 text-primary-text flex size-12 items-center justify-center rounded-full">
        <ListPlusIcon class="size-6" />
      </div>
      <h2 class="text-lg font-semibold">{{ $t('budgetPlans.grid.noLines') }}</h2>
      <p class="text-muted-foreground max-w-sm text-sm">{{ $t('budgetPlans.grid.noLinesDescription') }}</p>
      <ArchivedTrigger />
    </div>

    <template v-else>
      <div class="border-border bg-muted/40 hidden overflow-hidden rounded-lg border @2xl/lines:block">
        <div :class="cn(GRID_ROW_CLASS, 'text-muted-foreground py-2 text-xs font-medium')">
          <span>{{ $t('budgetPlans.grid.line') }}</span>
          <span class="text-right">{{ $t('budgetPlans.grid.assigned') }}</span>
          <span class="text-right">{{ $t('budgetPlans.grid.activity') }}</span>
          <span class="text-right">{{ $t('budgetPlans.grid.available') }}</span>
          <span />
        </div>

        <div
          v-for="line in view.lines"
          :key="line.lineId"
          :class="cn(GRID_ROW_CLASS, 'border-border items-center border-t py-2.5')"
        >
          <div class="min-w-0">
            <div class="flex items-center gap-2">
              <span class="min-w-0 truncate font-semibold">{{ line.name }}</span>
              <span
                v-if="line.assignedSource === 'override'"
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
            </div>
            <p class="text-muted-foreground truncate text-xs">{{ categoriesCaption({ line }) }}</p>
          </div>

          <AssignTrigger :line="line" />

          <span class="text-right text-sm tabular-nums">{{ formatBaseCurrency(line.activity) }}</span>
          <span :class="cn('text-right text-sm font-medium tabular-nums', amountToneClass({ amount: line.available }))">
            {{ formatBaseCurrency(line.available) }}
          </span>

          <span v-if="archivedLineIds.has(line.lineId)" />
          <LineMenu v-else :line="line" :menu-key="`row-${line.lineId}`" />
        </div>

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
        <div v-for="line in view.lines" :key="line.lineId" class="border-border bg-muted/40 rounded-lg border p-3">
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0">
              <div class="flex items-center gap-2">
                <p class="min-w-0 truncate font-semibold">{{ line.name }}</p>
                <span
                  v-if="archivedLineIds.has(line.lineId)"
                  class="text-muted-foreground bg-muted rounded-full px-1.5 py-0.5 text-[10px] font-medium"
                >
                  {{ $t('budgetPlans.grid.archivedBadge') }}
                </span>
              </div>
              <p class="text-muted-foreground truncate text-xs">{{ categoriesCaption({ line }) }}</p>
            </div>
            <div class="flex shrink-0 items-center gap-1">
              <span :class="cn('text-lg font-bold tabular-nums', amountToneClass({ amount: line.available }))">
                {{ formatBaseCurrency(line.available) }}
              </span>
              <LineMenu v-if="!archivedLineIds.has(line.lineId)" :line="line" :menu-key="`card-${line.lineId}`" />
            </div>
          </div>

          <div class="bg-muted mt-3 h-1.5 overflow-hidden rounded-full">
            <div
              :class="cn('h-full rounded-full', progressOf({ line }).class)"
              :style="{ width: progressOf({ line }).width }"
            />
          </div>

          <div class="mt-2 flex items-center justify-between gap-3">
            <span class="text-muted-foreground text-xs tabular-nums">
              {{ $t('budgetPlans.grid.spentAmount', { amount: formatBaseCurrency(spentOf({ line })) }) }}
            </span>
            <div class="flex items-center gap-2">
              <span class="text-muted-foreground text-xs">{{ $t('budgetPlans.grid.assigned') }}</span>
              <AssignTrigger :line="line" :compact="true" />
            </div>
          </div>
        </div>

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

    <ArchivedLinesDialog v-model:open="isArchivedListOpen" :plan-id="planId" :lines="archivedLines" />
  </div>
</template>
