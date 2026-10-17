<script setup lang="ts">
import { loadBudgetStats } from '@/api/budgets';
import { listShareMembers } from '@/api/share';
import { VUE_QUERY_CACHE_KEYS } from '@/common/const';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/common/dropdown-menu';
import ResponsiveAlertDialog from '@/components/common/responsive-alert-dialog.vue';
import ResponsiveDialog from '@/components/common/responsive-dialog.vue';
import Button from '@/components/lib/ui/button/Button.vue';
import Card from '@/components/lib/ui/card/Card.vue';
import PillTabs from '@/components/lib/ui/pill-tabs/pill-tabs.vue';
import { useFormatCurrency } from '@/composable';
import { useBudgetAccess } from '@/composable/use-budget-access';
import { cn } from '@/lib/utils';
import BudgetSharingPanel from '@/pages/budgets/components/budget-sharing-panel.vue';
import { BUDGET_STATUSES, BUDGET_TYPES, type BudgetModel, RESOURCE_TYPES } from '@bt/shared/types';
import { useQuery } from '@tanstack/vue-query';
import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  CopyIcon,
  LayoutListIcon,
  ListXIcon,
  MoreHorizontalIcon,
  PencilIcon,
  TargetIcon,
  Trash2Icon,
  UsersIcon,
} from '@lucide/vue';
import { computed, onMounted, ref, toRef, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';

import { useTrackerActions } from '../components/use-tracker-actions';
import {
  type TrackerTimeStatus,
  formatDateRange,
  getTrackerStatusLabel,
  getTrackerTimeStatus,
} from '../tracker-time-status';
import { utilizationClasses } from '../utilization-classes';
import TrackerLinesTable from './limits/tracker-lines-table.vue';
import { useTrackerLineMutations } from './limits/use-tracker-line-mutations';
import BudgetStatistics from './statistics/budget-statistics.vue';
import { getTrackerLimitSummary } from './tracker-summary';
import TrackerEditForm from './tracker-edit-form.vue';
import TransactionsList from './transactions-list.vue';

type TabValue = 'limits' | 'transactions' | 'statistics';
const TAB_VALUES: TabValue[] = ['limits', 'transactions', 'statistics'];
const MAX_VISIBLE_MEMBERS = 3;

const props = defineProps<{ budget: BudgetModel }>();

const route = useRoute();
const router = useRouter();
const { t } = useI18n();
const { formatBaseCurrency } = useFormatCurrency();
const { archive, unarchive, duplicate, remove } = useTrackerActions();

const budgetId = computed(() => props.budget.id);
const { isOwner, canManage, canWrite, isSharedWithCaller, ownerHandle } = useBudgetAccess(toRef(() => props.budget));

const {
  data: stats,
  isPending: isStatsPending,
  isError: isStatsError,
  refetch: refetchStats,
} = useQuery({
  queryKey: [...VUE_QUERY_CACHE_KEYS.budgetStats, budgetId],
  queryFn: () => loadBudgetStats({ budgetId: budgetId.value }),
  staleTime: 30_000,
});

const { data: membersData } = useQuery({
  queryKey: computed(() => [...VUE_QUERY_CACHE_KEYS.shareMembers, RESOURCE_TYPES.budget, budgetId.value]),
  queryFn: () => listShareMembers({ resourceType: RESOURCE_TYPES.budget, resourceId: budgetId.value }),
  enabled: canManage,
});

const members = computed(() => membersData.value?.members ?? []);
const visibleMembers = computed(() => members.value.slice(0, MAX_VISIBLE_MEMBERS));
const hiddenMembersCount = computed(() => Math.max(0, members.value.length - MAX_VISIBLE_MEMBERS));

const isCategoryTracker = computed(() => props.budget.type === BUDGET_TYPES.category);
const isArchived = computed(() => props.budget.status === BUDGET_STATUSES.archived);
const timeStatus = computed(() =>
  getTrackerTimeStatus({ startDate: props.budget.startDate, endDate: props.budget.endDate }),
);

const STATUS_CHIP_CLASSES: Record<TrackerTimeStatus['kind'], string> = {
  active: 'bg-success-text/10 text-success-text',
  upcoming: 'bg-primary/10 text-primary-text',
  ended: 'bg-muted text-muted-foreground',
  noDates: '',
};

const statusChip = computed(() => {
  const label = getTrackerStatusLabel({ status: timeStatus.value });
  return label ? { text: t(label.key, label.params ?? {}), class: STATUS_CHIP_CLASSES[timeStatus.value.kind] } : null;
});

const summary = computed(() => stats.value?.summary);
const transactionsCount = computed(() => summary.value?.transactionsCount ?? 0);
const transactionsRange = computed(() =>
  formatDateRange({ from: summary.value?.firstTransactionDate, to: summary.value?.lastTransactionDate }),
);

const caption = computed(() => {
  const range = formatDateRange({ from: props.budget.startDate, to: props.budget.endDate }) ?? transactionsRange.value;
  if (!summary.value) return range;
  if (!range && !transactionsCount.value) return t('pages.budgetDetails.noTransactionsYet');
  const count = t('budgets.details.transactionsCount', { count: transactionsCount.value }, transactionsCount.value);
  return range ? `${range} · ${count}` : count;
});

interface StripCell {
  key: string;
  label: string;
  value: string;
  valueClass?: string;
  hint?: string | null;
  isPending?: boolean;
}

const netClass = (amount: number) => (amount < 0 ? 'text-app-expense-color' : 'text-app-income-color');

const STRIP_LABEL_KEYS = {
  limit: 'budgets.details.strip.limit',
  spent: 'budgets.details.strip.spent',
  left: 'budgets.details.strip.left',
  income: 'budgets.details.strip.income',
  expenses: 'budgets.details.strip.expenses',
  net: 'budgets.details.strip.net',
  transactions: 'budgets.details.strip.transactions',
} as const;

const stripCells = computed<StripCell[]>(() => {
  const limitAmount = props.budget.limitAmount;
  const loaded = summary.value;
  if (!loaded) {
    const keys = limitAmount
      ? (['limit', 'spent', 'left', 'income', 'net'] as const)
      : (['income', 'expenses', 'net', 'transactions'] as const);
    return keys.map((key) => ({
      key,
      label: t(STRIP_LABEL_KEYS[key]),
      value: key === 'limit' && limitAmount ? formatBaseCurrency(limitAmount) : '—',
      isPending: key !== 'limit' && isStatsPending.value,
    }));
  }

  const income = loaded.actualIncome;
  const expenses = loaded.actualExpense;
  const balance = loaded.balance;
  const incomeCell: StripCell = {
    key: 'income',
    label: t('budgets.details.strip.income'),
    value: formatBaseCurrency(income),
    valueClass: 'text-app-income-color',
  };
  const netCell: StripCell = {
    key: 'net',
    label: t('budgets.details.strip.net'),
    value: formatBaseCurrency(balance),
    valueClass: netClass(balance),
  };

  if (!limitAmount) {
    return [
      incomeCell,
      {
        key: 'expenses',
        label: t('budgets.details.strip.expenses'),
        value: formatBaseCurrency(expenses),
        valueClass: 'text-app-expense-color',
      },
      netCell,
      {
        key: 'transactions',
        label: t('budgets.details.strip.transactions'),
        value: String(transactionsCount.value),
        hint: transactionsRange.value,
      },
    ];
  }

  const { spent, left, rate, dailyPace } = getTrackerLimitSummary({
    limitAmount,
    summary: loaded,
    timeStatus: timeStatus.value,
  });
  const isOver = left < 0;

  return [
    { key: 'limit', label: t('budgets.details.strip.limit'), value: formatBaseCurrency(limitAmount) },
    {
      key: 'spent',
      label: t('budgets.details.strip.spent'),
      value: formatBaseCurrency(spent),
      valueClass: utilizationClasses({ rate }).text,
      hint: `${Math.round(rate)}%`,
    },
    {
      key: 'left',
      label: isOver ? t('budgets.details.strip.overBy') : t('budgets.details.strip.left'),
      value: formatBaseCurrency(Math.abs(left)),
      valueClass: isOver ? 'text-app-expense-color' : undefined,
      hint: dailyPace === null ? null : t('budgets.details.strip.perDay', { amount: formatBaseCurrency(dailyPace) }),
    },
    incomeCell,
    netCell,
  ];
});

const limitsRequested = ref(route.query.tab === 'limits');
const showLimitsTab = computed(() => props.budget.lines.length > 0 || limitsRequested.value);
const autoOpenAddLine = ref(route.query.addLine === '1');

const queryTab = TAB_VALUES.find((value) => value === route.query.tab);
const activeTab = ref<TabValue>(queryTab ?? (showLimitsTab.value ? 'limits' : 'transactions'));

watch(activeTab, () => {
  autoOpenAddLine.value = false;
});

watch(showLimitsTab, (shown) => {
  if (!shown && activeTab.value === 'limits') activeTab.value = 'transactions';
});

const tabItems = computed(() => {
  const withCount = (label: string, count: number | undefined) => (count ? `${label} ${count}` : label);
  return [
    ...(showLimitsTab.value
      ? [{ value: 'limits', label: withCount(t('budgets.details.tabs.limits'), props.budget.lines.length) }]
      : []),
    { value: 'transactions', label: withCount(t('pages.budgetDetails.tabs.transactions'), transactionsCount.value) },
    { value: 'statistics', label: t('pages.budgetDetails.tabs.statistics') },
  ];
});

const handleSetLimits = () => {
  limitsRequested.value = true;
  activeTab.value = 'limits';
};

const isEditOpen = ref(false);
const isShareOpen = ref(false);
const isDeleteOpen = ref(false);
const isRemoveLimitsOpen = ref(false);

const { deleteAllLines } = useTrackerLineMutations({ budgetId });
const handleRemoveLimits = () =>
  deleteAllLines.mutate(
    { lineIds: props.budget.lines.map((line) => line.id) },
    {
      onSuccess: () => {
        isRemoveLimitsOpen.value = false;
        limitsRequested.value = false;
      },
    },
  );

onMounted(() => {
  const { edit, addLine, ...restQuery } = route.query;
  if (edit === undefined && addLine === undefined) return;
  if (edit === '1' && canManage.value) isEditOpen.value = true;
  router.replace({ query: restQuery });
});

const isArchivePending = computed(() => archive.isPending.value || unarchive.isPending.value);
const toggleArchive = () => (isArchived.value ? unarchive : archive).mutate({ budgetId: budgetId.value });
const handleDelete = () =>
  remove.mutate({ budgetId: budgetId.value, redirect: true }, { onSuccess: () => (isDeleteOpen.value = false) });

const chipClass = 'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap';
</script>

<template>
  <div class="max-w-5xl">
    <Card class="divide-border @container/tracker divide-y overflow-clip">
      <div class="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-3 @md/tracker:px-4">
        <div class="flex min-w-0 items-center gap-3">
          <div class="bg-muted text-muted-foreground flex size-9 shrink-0 items-center justify-center rounded-lg">
            <TargetIcon class="size-4" />
          </div>
          <div class="min-w-0">
            <h1 class="truncate text-lg font-bold @md/tracker:text-xl">{{ budget.name }}</h1>
            <p v-if="caption" class="text-muted-foreground truncate text-xs">{{ caption }}</p>
          </div>
        </div>

        <div class="flex flex-wrap items-center gap-1.5">
          <span v-if="isSharedWithCaller" :class="cn(chipClass, 'bg-primary/10 text-primary-text')">
            <UsersIcon class="size-3" />
            {{ $t('budgets.share.sharedByBadge', { handle: `@${ownerHandle}` }) }}
          </span>
          <span v-if="statusChip" :class="cn(chipClass, statusChip.class)">{{ statusChip.text }}</span>
          <span v-if="isCategoryTracker" :class="cn(chipClass, 'bg-primary/10 text-primary-text')">
            {{ $t('budgets.list.autoTracked') }}
          </span>
          <span v-if="isArchived" :class="cn(chipClass, 'bg-muted text-muted-foreground')">
            <ArchiveIcon class="size-3" />
            {{ $t('budgets.list.archivedLabel') }}
          </span>
        </div>

        <div v-if="canManage" class="ml-auto flex items-center gap-2">
          <Button
            v-if="members.length > 1"
            variant="ghost"
            size="sm"
            class="px-1.5"
            :aria-label="$t('budgets.details.membersLabel', { count: members.length })"
            @click="isShareOpen = true"
          >
            <span class="flex items-center">
              <span
                v-for="(member, index) in visibleMembers"
                :key="member.user.id"
                :class="
                  cn(
                    'bg-primary text-primary-foreground border-card flex size-6 items-center justify-center rounded-full border-2 text-[10px] font-bold uppercase',
                    index > 0 && '-ml-2',
                  )
                "
              >
                {{ member.user.username.charAt(0) }}
              </span>
              <span
                v-if="hiddenMembersCount"
                class="bg-muted text-muted-foreground border-card -ml-2 flex size-6 items-center justify-center rounded-full border-2 text-[10px] font-bold"
              >
                +{{ hiddenMembersCount }}
              </span>
            </span>
          </Button>

          <Button v-if="isArchived" variant="outline" size="sm" :disabled="isArchivePending" @click="toggleArchive()">
            <ArchiveRestoreIcon class="size-4" />
            {{ $t('budgets.list.unarchive') }}
          </Button>
          <Button v-else-if="!showLimitsTab" variant="outline" size="sm" @click="handleSetLimits">
            <LayoutListIcon class="size-4" />
            {{ $t('budgets.details.actions.setLimits') }}
          </Button>

          <Button variant="outline" size="sm" @click="isShareOpen = true">
            <UsersIcon class="size-4" />
            {{ $t('budgets.details.actions.share') }}
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger as-child>
              <Button variant="ghost" size="icon-sm" :aria-label="$t('budgets.details.actions.more')">
                <MoreHorizontalIcon class="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" class="w-48">
              <DropdownMenuItem @select="isEditOpen = true">
                <PencilIcon class="size-4" />
                {{ $t('budgets.list.edit') }}
              </DropdownMenuItem>
              <DropdownMenuItem v-if="budget.lines.length === 0" @select="handleSetLimits">
                <LayoutListIcon class="size-4" />
                {{ $t('budgets.details.actions.setLimits') }}
              </DropdownMenuItem>
              <DropdownMenuItem v-else @select="isRemoveLimitsOpen = true">
                <ListXIcon class="size-4" />
                {{ $t('budgets.details.actions.removeLimits') }}
              </DropdownMenuItem>
              <DropdownMenuItem
                v-if="isOwner"
                :disabled="duplicate.isPending.value"
                @select="duplicate.mutate({ budgetId })"
              >
                <CopyIcon class="size-4" />
                {{ $t('budgets.details.actions.duplicate') }}
              </DropdownMenuItem>
              <DropdownMenuItem :disabled="isArchivePending" @select="toggleArchive()">
                <component :is="isArchived ? ArchiveRestoreIcon : ArchiveIcon" class="size-4" />
                {{ isArchived ? $t('budgets.list.unarchive') : $t('budgets.list.archive') }}
              </DropdownMenuItem>
              <template v-if="isOwner">
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  class="text-destructive-text focus:bg-destructive-text/10 focus:text-destructive-text"
                  @select="isDeleteOpen = true"
                >
                  <Trash2Icon class="size-4" />
                  {{ $t('budgets.list.delete') }}
                </DropdownMenuItem>
              </template>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div
        v-if="isCategoryTracker && budget.categories?.length"
        class="flex flex-wrap items-center gap-1.5 px-3 py-2 @md/tracker:px-4"
      >
        <span class="text-muted-foreground mr-1 text-[11px] font-semibold tracking-wider uppercase">
          {{ $t('budgets.details.tracks') }}
        </span>
        <span
          v-for="category in budget.categories"
          :key="category.id"
          class="bg-muted inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium"
        >
          <span class="size-2 rounded-full" :style="{ backgroundColor: category.color }" />
          {{ category.name }}
        </span>
        <span class="text-muted-foreground ml-auto text-[11px]">{{
          $t('budgets.categoryBudget.autoTrackedInfo')
        }}</span>
      </div>

      <div class="overflow-hidden">
        <div
          :class="
            cn(
              '-mr-px -mb-px grid grid-cols-2',
              stripCells.length === 5 ? '@md/tracker:grid-cols-3 @2xl/tracker:grid-cols-5' : '@2xl/tracker:grid-cols-4',
            )
          "
        >
          <div
            v-for="cell in stripCells"
            :key="cell.key"
            class="border-border min-w-0 border-r border-b px-3 py-3 @md/tracker:px-4"
          >
            <div class="text-muted-foreground text-[10px] font-medium tracking-wider uppercase">{{ cell.label }}</div>
            <div class="mt-0.5 flex flex-wrap items-baseline gap-x-1.5 tabular-nums">
              <span v-if="cell.isPending" class="bg-muted my-1 inline-block h-5 w-16 animate-pulse rounded" />
              <span v-else :class="cn('text-lg font-bold', cell.valueClass)">{{ cell.value }}</span>
              <span v-if="cell.hint" class="text-muted-foreground truncate text-xs font-medium">{{ cell.hint }}</span>
            </div>
          </div>
        </div>
      </div>

      <div v-if="isStatsError" class="flex items-center justify-between gap-3 px-3 py-2 text-sm @md/tracker:px-4">
        <span class="text-destructive-text">{{ $t('budgets.details.statsLoadError') }}</span>
        <Button variant="outline" size="sm" @click="refetchStats()">{{ $t('common.actions.retry') }}</Button>
      </div>

      <div class="px-3 py-2 @md/tracker:px-4">
        <PillTabs v-model="activeTab" :items="tabItems" />
      </div>

      <div>
        <TrackerLinesTable
          v-if="activeTab === 'limits'"
          :budget="budget"
          :stats="stats"
          :stats-pending="isStatsPending"
          :can-manage="canManage"
          :auto-open-add-line="autoOpenAddLine"
        />
        <TransactionsList v-else-if="activeTab === 'transactions'" :budget="budget" :can-write="canWrite" />
        <BudgetStatistics v-else :budget="budget" :stats="stats" />
      </div>
    </Card>

    <ResponsiveDialog v-model:open="isEditOpen">
      <template #title>{{ $t('budgets.manualBudget.editTitle') }}</template>
      <TrackerEditForm v-if="isEditOpen" :budget="budget" @saved="isEditOpen = false" @cancel="isEditOpen = false" />
    </ResponsiveDialog>

    <ResponsiveDialog v-if="canManage" v-model:open="isShareOpen" dialog-content-class="sm:max-w-xl">
      <template #title>{{ $t('budgets.details.shareDialog.title', { name: budget.name }) }}</template>
      <BudgetSharingPanel :budget="budget" hide-header />
    </ResponsiveDialog>

    <ResponsiveAlertDialog
      v-model:open="isDeleteOpen"
      :confirm-label="$t('budgets.list.delete')"
      confirm-variant="destructive"
      :confirm-disabled="remove.isPending.value"
      @confirm="handleDelete"
    >
      <template #title>{{ $t('budgets.list.deleteDialog.title') }}</template>
      <template #description>{{ $t('budgets.list.deleteDialog.description') }}</template>
    </ResponsiveAlertDialog>

    <ResponsiveAlertDialog
      v-model:open="isRemoveLimitsOpen"
      :confirm-label="$t('budgets.details.actions.removeLimits')"
      confirm-variant="destructive"
      :confirm-disabled="deleteAllLines.isPending.value"
      @confirm="handleRemoveLimits"
    >
      <template #title>{{ $t('budgets.details.removeLimitsDialog.title') }}</template>
      <template #description>
        {{ $t('budgets.details.removeLimitsDialog.description', { count: budget.lines.length }, budget.lines.length) }}
      </template>
    </ResponsiveAlertDialog>
  </div>
</template>
