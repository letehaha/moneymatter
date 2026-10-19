<script setup lang="ts">
import Button from '@/components/lib/ui/button/Button.vue';
import { useFormatCurrency } from '@/composable';
import { useBudgetAccess } from '@/composable/use-budget-access';
import { cn } from '@/lib/utils';
import { ROUTES_NAMES } from '@/routes';
import { BUDGET_STATUSES, BUDGET_TYPES, type BudgetModel, type BudgetStatsResponse } from '@bt/shared/types';
import { compact } from 'lodash-es';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

import {
  formatDateRange,
  getTrackerStatusLabel,
  getTrackerTimeStatus,
  shouldSuggestArchive,
} from '../tracker-time-status';
import { utilizationClasses } from '../utilization-classes';
import CategoryChips from './category-chips.vue';
import TrackerLogo from './tracker-logo.vue';
import { TRACKER_ROW_GRID } from './tracker-row-grid';
import TrackerRowMenu from './tracker-row-menu.vue';
import UtilizationBar from './utilization-bar.vue';

const props = defineProps<{
  budget: BudgetModel;
  stats: BudgetStatsResponse['summary'] | null;
  isStatsLoading: boolean;
  isStatsError: boolean;
}>();

const emit = defineEmits<{ 'suggest-archive': [] }>();

const { t } = useI18n();
const { formatShortBaseCurrency } = useFormatCurrency();
const { canManage } = useBudgetAccess(() => props.budget);

const isCategory = computed(() => props.budget.type === BUDGET_TYPES.category);
const isArchived = computed(() => props.budget.status === BUDGET_STATUSES.archived);

const dateRange = computed(() => formatDateRange({ from: props.budget.startDate, to: props.budget.endDate }));

const transactionsLabel = computed(() => {
  if (!props.stats) return null;
  const count = props.stats.transactionsCount;
  return t('budgets.list.row.transactions', { count }, count);
});

const utilizationRate = computed<number | null>(() =>
  props.budget.limitAmount && props.stats ? props.stats.utilizationRate : null,
);

const tone = computed(() => utilizationClasses({ rate: utilizationRate.value ?? 0 }));

const timeStatus = computed(() =>
  isArchived.value ? null : getTrackerTimeStatus({ startDate: props.budget.startDate, endDate: props.budget.endDate }),
);

const statusText = computed(() => {
  const label = timeStatus.value && getTrackerStatusLabel({ status: timeStatus.value });
  return label ? t(label.key, label.params ?? {}) : null;
});

type CaptionPiece = { key: string; text?: string; class?: string; isCategories?: boolean };

const categoriesPiece = computed<CaptionPiece | null>(() =>
  isCategory.value && props.budget.categories?.length ? { key: 'categories', isCategories: true } : null,
);

const desktopCaption = computed(() =>
  compact<CaptionPiece>([
    dateRange.value && { key: 'dates', text: dateRange.value },
    categoriesPiece.value,
    transactionsLabel.value && { key: 'transactions', text: transactionsLabel.value },
  ]),
);

const phoneCaption = computed(() => {
  if (isCategory.value) return compact<CaptionPiece>([categoriesPiece.value]);
  const rate = utilizationRate.value;
  const tail = statusText.value ?? transactionsLabel.value;
  return compact<CaptionPiece>([
    rate !== null && { key: 'rate', text: `${Math.round(rate)}%`, class: tone.value.text },
    !props.budget.limitAmount && { key: 'noLimit', text: t('budgets.list.row.noLimit') },
    tail && { key: 'tail', text: tail },
  ]);
});

const captions = computed(() => [
  { key: 'desktop', class: 'hidden @2xl/trackers:block', pieces: desktopCaption.value },
  { key: 'phone', class: '@2xl/trackers:hidden', pieces: phoneCaption.value },
]);

const showArchiveSuggestion = computed(() => canManage.value && shouldSuggestArchive({ budget: props.budget }));
</script>

<template>
  <div
    :class="
      cn(
        TRACKER_ROW_GRID,
        'hover:bg-foreground/5 has-[a:focus-visible]:bg-foreground/5 relative text-[13px] transition-colors',
        isArchived && 'opacity-60',
      )
    "
  >
    <TrackerLogo :tracker="budget" class="size-7 rounded-[7px]" />

    <div class="min-w-0">
      <div class="flex min-w-0 items-center gap-1.5 font-semibold">
        <RouterLink
          :to="{ name: ROUTES_NAMES.plannedBudgetDetails, params: { id: budget.id } }"
          class="truncate outline-none after:absolute after:inset-0"
        >
          {{ budget.name }}
        </RouterLink>
        <span
          v-if="isCategory"
          class="bg-primary/15 text-primary-text shrink-0 rounded-full px-2 py-px text-[11px] font-semibold"
        >
          {{ $t('budgets.list.row.auto') }}
        </span>
      </div>

      <div
        v-for="caption in captions"
        :key="caption.key"
        :class="cn('text-muted-foreground truncate text-[11px]', caption.class)"
      >
        <template v-for="(piece, index) in caption.pieces" :key="piece.key">
          <template v-if="index > 0"> · </template>
          <CategoryChips v-if="piece.isCategories" :categories="budget.categories ?? []" />
          <span v-else :class="piece.class">{{ piece.text }}</span>
        </template>
      </div>
    </div>

    <div class="hidden min-w-0 @2xl/trackers:block">
      <div v-if="isStatsLoading" class="grid animate-pulse gap-1.5">
        <div class="bg-muted h-3 w-full rounded" />
        <div class="bg-muted h-1.25 rounded-full" />
      </div>
      <span v-else-if="!budget.limitAmount" class="text-muted-foreground text-xs">
        {{ $t('budgets.list.row.noLimit') }}
      </span>
      <span v-else-if="utilizationRate === null" class="text-muted-foreground text-xs">—</span>
      <div v-else class="grid gap-1">
        <div class="text-muted-foreground flex justify-between text-xs">
          <span>{{ $t('budgets.list.used') }}</span>
          <span :class="cn('font-semibold tabular-nums', tone.text)">{{ Math.round(utilizationRate) }}%</span>
        </div>
        <UtilizationBar :rate="utilizationRate" class="h-1.25" />
      </div>
    </div>

    <div class="hidden @2xl/trackers:block">
      <Button
        v-if="showArchiveSuggestion"
        variant="ghost"
        class="border-warning-text text-warning-text hover:bg-warning-text/10 hover:text-warning-text relative z-10 h-auto rounded-full border border-dashed px-2 py-0.5 text-[11px] font-semibold"
        @click="emit('suggest-archive')"
      >
        {{ $t('budgets.list.row.archiveSuggestion') }}
      </Button>
      <span
        v-else-if="statusText && timeStatus?.kind !== 'ended'"
        :class="
          cn(
            'inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap',
            timeStatus?.kind === 'active' ? 'bg-success-text/15 text-success-text' : 'bg-primary/15 text-primary-text',
          )
        "
      >
        {{ statusText }}
      </span>
    </div>

    <div class="text-right">
      <div v-if="isStatsLoading" class="bg-muted ml-auto h-4 w-14 animate-pulse rounded" />
      <span
        v-else-if="stats"
        :class="
          cn(
            'font-semibold whitespace-nowrap tabular-nums',
            stats.balance >= 0 ? 'text-app-income-color' : 'text-app-expense-color',
          )
        "
      >
        {{ formatShortBaseCurrency({ amount: stats.balance }) }}
      </span>
      <span v-else-if="isStatsError" class="text-muted-foreground">—</span>
    </div>

    <TrackerRowMenu :budget="budget" class="relative z-10" />
  </div>
</template>
