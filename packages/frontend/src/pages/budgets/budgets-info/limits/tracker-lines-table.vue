<script setup lang="ts">
import ResponsiveAlertDialog from '@/components/common/responsive-alert-dialog.vue';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/common/dropdown-menu';
import { Button } from '@/components/lib/ui/button';
import { useFormatCurrency } from '@/composable/formatters';
import { cn } from '@/lib/utils';
import { BUDGET_TYPES, type BudgetModel, type BudgetStatsResponse, type TrackerLineModel } from '@bt/shared/types';
import { LayersIcon, MoreHorizontalIcon, PencilIcon, PlusIcon, Trash2Icon } from '@lucide/vue';
import { computed, ref } from 'vue';

import CategoryChips from '../../components/category-chips.vue';
import UtilizationBar from '../../components/utilization-bar.vue';
import LineDialog from './line-dialog.vue';
import LineLimitPopover from './line-limit-popover.vue';
import { buildLineRows, buildLinesTotals } from './line-amounts';
import { useTrackerLineMutations } from './use-tracker-line-mutations';

const GRID_CLASS =
  'grid grid-cols-[minmax(0,1fr)_auto_32px] items-center gap-x-3 px-4 @min-[650px]/lines:grid-cols-[minmax(0,2fr)_112px_96px_96px_32px]';

const props = defineProps<{
  budget: BudgetModel;
  stats: BudgetStatsResponse | undefined;
  statsPending?: boolean;
  canManage: boolean;
}>();

const { formatBaseCurrency } = useFormatCurrency();
const { deleteLine } = useTrackerLineMutations({ budgetId: () => props.budget.id });

const rows = computed(() => buildLineRows({ lines: props.budget.lines, stats: props.stats }));
const otherSpent = computed(() => props.stats?.otherSpent ?? 0);
const showOther = computed(() => otherSpent.value > 0);
const totals = computed(() => buildLinesTotals({ rows: rows.value, otherSpent: otherSpent.value }));

const formatSpent = (amount: number) => formatBaseCurrency(amount ? -amount : 0);

const isDialogOpen = ref(false);
const dialogLine = ref<TrackerLineModel | undefined>();
const openDialog = ({ line }: { line?: TrackerLineModel } = {}) => {
  dialogLine.value = line;
  isDialogOpen.value = true;
};

const lineToDelete = ref<TrackerLineModel | null>(null);
const isDeleteOpen = ref(false);
const askDelete = ({ line }: { line: TrackerLineModel }) => {
  lineToDelete.value = line;
  isDeleteOpen.value = true;
};

const handleDelete = async () => {
  if (!lineToDelete.value) return;
  try {
    await deleteLine.mutateAsync({ lineId: lineToDelete.value.id });
    isDeleteOpen.value = false;
  } catch {
    // Error toast is shown by the mutation.
  }
};
</script>

<template>
  <div class="@container/lines">
    <div v-if="rows.length === 0" class="flex flex-col items-center justify-center px-4 py-10 text-center">
      <div class="bg-muted mb-4 flex size-14 items-center justify-center rounded-full">
        <LayersIcon class="text-muted-foreground size-7" />
      </div>
      <h3 class="mb-1 font-medium">
        <template v-if="budget.limitAmount">
          {{ $t('budgets.lines.empty.titleWithLimit', { amount: formatBaseCurrency(budget.limitAmount) }) }}
        </template>
        <template v-else>{{ $t('budgets.lines.empty.title') }}</template>
      </h3>
      <p class="text-muted-foreground max-w-sm text-sm">{{ $t('budgets.lines.empty.description') }}</p>
      <Button v-if="canManage" class="mt-4" @click="openDialog()">
        <PlusIcon class="size-4" />
        {{ $t('budgets.lines.addLine') }}
      </Button>
    </div>

    <div v-else class="text-sm tabular-nums">
      <div
        :class="
          cn(
            GRID_CLASS,
            'text-muted-foreground hidden py-2 text-[10px] font-medium tracking-wider uppercase @min-[650px]/lines:grid',
          )
        "
        aria-hidden="true"
      >
        <span>{{ $t('budgets.lines.columns.line') }}</span>
        <span class="text-right">{{ $t('budgets.lines.columns.limit') }}</span>
        <span class="text-right">{{ $t('budgets.lines.columns.spent') }}</span>
        <span class="text-right">{{ $t('budgets.lines.columns.left') }}</span>
        <span />
      </div>

      <div v-for="row in rows" :key="row.line.id" :class="cn(GRID_CLASS, 'border-border border-t py-2.5')">
        <div class="min-w-0">
          <div class="flex items-baseline justify-between gap-2">
            <span class="truncate font-semibold">{{ row.line.name }}</span>
            <span
              :class="
                cn(
                  'hidden shrink-0 text-xs @min-[650px]/lines:inline',
                  row.isOver ? 'text-app-expense-color' : 'text-muted-foreground',
                )
              "
            >
              <template v-if="!stats">
                <span :class="cn(statsPending && 'animate-pulse')">—</span>
              </template>
              <template v-else-if="row.limit === null">
                {{ $t('budgets.lines.spentOnly', { amount: formatBaseCurrency(row.spent) }) }}
              </template>
              <template v-else-if="row.isOver">
                {{
                  $t('budgets.lines.overUsage', {
                    amount: formatBaseCurrency(-row.left!),
                    spent: formatBaseCurrency(row.spent),
                    limit: formatBaseCurrency(row.limit),
                  })
                }}
              </template>
              <template v-else>
                {{
                  $t('budgets.lines.usage', {
                    percent: Math.round(row.percent!),
                    spent: formatBaseCurrency(row.spent),
                    limit: formatBaseCurrency(row.limit),
                  })
                }}
              </template>
            </span>
          </div>

          <div class="text-muted-foreground mt-0.5 flex min-w-0 text-xs">
            <span class="hidden @min-[650px]/lines:contents">
              <CategoryChips :categories="row.line.categories" />
            </span>
            <span class="contents @min-[650px]/lines:hidden">
              <CategoryChips :categories="row.line.categories" collapsed />
            </span>
          </div>

          <UtilizationBar v-if="stats && row.limit !== null" :rate="row.percent!" class="mt-1.5" />
        </div>

        <div class="hidden justify-end @min-[650px]/lines:flex">
          <LineLimitPopover v-if="canManage" :budget-id="budget.id" :line="row.line">
            <Button
              variant="outline"
              size="sm"
              :aria-label="$t('budgets.lines.editLimitAria', { name: row.line.name })"
              :class="
                cn(
                  'bg-input-background hover:bg-input-background hover:border-ring h-8 w-auto min-w-24 cursor-text justify-end font-normal tabular-nums',
                  row.limit === null ? 'text-muted-foreground hover:text-muted-foreground' : 'hover:text-foreground',
                )
              "
            >
              {{ row.limit === null ? '—' : formatBaseCurrency(row.limit) }}
            </Button>
          </LineLimitPopover>
          <span v-else class="font-semibold">{{ row.limit === null ? '—' : formatBaseCurrency(row.limit) }}</span>
        </div>

        <span class="text-muted-foreground hidden text-right @min-[650px]/lines:block">
          {{ stats ? formatSpent(row.spent) : '—' }}
        </span>

        <div class="text-right">
          <template v-if="stats">
            <div class="text-muted-foreground text-xs @min-[650px]/lines:hidden">{{ formatSpent(row.spent) }}</div>
            <div v-if="row.limit !== null" class="text-muted-foreground text-xs @min-[650px]/lines:hidden">
              {{ $t('budgets.lines.ofLimit', { limit: formatBaseCurrency(row.limit) }) }}
            </div>
          </template>
          <div
            v-if="!stats || row.limit !== null"
            :class="
              cn(
                'font-semibold',
                (!stats || row.left === null) && 'text-muted-foreground',
                stats && row.left !== null && (row.isOver ? 'text-app-expense-color' : 'text-success-text'),
              )
            "
          >
            {{ !stats || row.left === null ? '—' : formatBaseCurrency(row.left) }}
          </div>
        </div>

        <div class="flex justify-end">
          <DropdownMenu v-if="canManage">
            <DropdownMenuTrigger as-child>
              <Button variant="ghost" size="icon-sm" :aria-label="$t('budgets.lines.menu.ariaLabel')">
                <MoreHorizontalIcon class="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" class="w-44">
              <DropdownMenuItem @select="openDialog({ line: row.line })">
                <PencilIcon class="size-4" />
                {{ $t('budgets.lines.menu.edit') }}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                class="text-destructive-text focus:bg-destructive-text/10 focus:text-destructive-text"
                @select="askDelete({ line: row.line })"
              >
                <Trash2Icon class="size-4" />
                {{ $t('budgets.lines.menu.delete') }}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div v-if="showOther" :class="cn(GRID_CLASS, 'border-border text-muted-foreground border-t py-2.5')">
        <div class="flex min-w-0 items-baseline justify-between gap-2">
          <span class="truncate">{{ $t('budgets.lines.other.title') }}</span>
          <span class="hidden shrink-0 text-xs @min-[650px]/lines:inline">{{ $t('budgets.lines.other.hint') }}</span>
        </div>
        <span class="hidden @min-[650px]/lines:block" />
        <span class="hidden text-right @min-[650px]/lines:block">{{ formatSpent(otherSpent) }}</span>
        <span class="text-right @min-[650px]/lines:hidden">{{ formatSpent(otherSpent) }}</span>
        <span class="hidden @min-[650px]/lines:block" />
        <span />
      </div>

      <div :class="cn(GRID_CLASS, 'border-border bg-muted/50 border-t py-2.5 font-bold')">
        <div class="flex min-w-0 items-center gap-3">
          <span class="truncate">{{ $t('budgets.lines.total.title', rows.length) }}</span>
          <Button v-if="canManage" variant="secondary" size="sm" @click="openDialog()">
            <PlusIcon class="size-4" />
            {{ $t('budgets.lines.addLine') }}
          </Button>
        </div>
        <span class="hidden text-right @min-[650px]/lines:block">
          <template v-if="totals.limitSum === null">—</template>
          <template v-else-if="budget.limitAmount">
            {{
              $t('budgets.lines.total.limitOfOverall', {
                sum: formatBaseCurrency(totals.limitSum),
                limit: formatBaseCurrency(budget.limitAmount),
              })
            }}
          </template>
          <template v-else>{{ formatBaseCurrency(totals.limitSum) }}</template>
        </span>
        <span class="hidden text-right @min-[650px]/lines:block">{{ stats ? formatSpent(totals.spent) : '—' }}</span>
        <div class="text-right">
          <template v-if="stats">
            <div class="text-muted-foreground text-xs font-normal @min-[650px]/lines:hidden">
              {{ formatSpent(totals.spent) }}
            </div>
            <div
              v-if="totals.limitSum !== null"
              class="text-muted-foreground text-xs font-normal @min-[650px]/lines:hidden"
            >
              {{ $t('budgets.lines.ofLimit', { limit: formatBaseCurrency(totals.limitSum) }) }}
            </div>
          </template>
          <div
            v-if="!stats || totals.limitSum !== null"
            :class="
              cn(
                (!stats || totals.left === null) && 'text-muted-foreground font-normal',
                stats && totals.left !== null && totals.left < 0 && 'text-app-expense-color',
              )
            "
          >
            {{ !stats || totals.left === null ? '—' : formatBaseCurrency(totals.left) }}
          </div>
        </div>
        <span />
      </div>
    </div>

    <LineDialog
      v-if="canManage"
      v-model:open="isDialogOpen"
      :budget-id="budget.id"
      :line="dialogLine"
      :is-category-tracker="budget.type === BUDGET_TYPES.category"
    />

    <ResponsiveAlertDialog
      v-model:open="isDeleteOpen"
      :confirm-label="$t('common.actions.delete')"
      confirm-variant="destructive"
      :confirm-disabled="deleteLine.isPending.value"
      @confirm="handleDelete"
    >
      <template #title>{{ $t('budgets.lines.delete.title') }}</template>
      <template #description>{{ $t('budgets.lines.delete.description', { name: lineToDelete?.name ?? '' }) }}</template>
    </ResponsiveAlertDialog>
  </div>
</template>
