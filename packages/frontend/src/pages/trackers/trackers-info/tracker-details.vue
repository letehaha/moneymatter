<script setup lang="ts">
import { loadTrackerStats } from '@/api/trackers';
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
import { useTrackerAccess } from '@/composable/use-tracker-access';
import { cn } from '@/lib/utils';
import TrackerSharingPanel from '@/pages/trackers/components/tracker-sharing-panel.vue';
import { TRACKER_LIMIT_KINDS, TRACKER_STATUSES, type TrackerModel, RESOURCE_TYPES } from '@bt/shared/types';
import { useQuery } from '@tanstack/vue-query';
import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  CopyIcon,
  LayoutListIcon,
  ListXIcon,
  MoreHorizontalIcon,
  PencilIcon,
  Trash2Icon,
  UsersIcon,
  ShapesIcon,
  TagIcon,
  ZapIcon,
} from '@lucide/vue';
import { computed, ref, toRef, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';

import DeleteTrackerDialog from '../components/delete-tracker-dialog.vue';
import TrackerLogo from '../components/tracker-logo.vue';
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
import RuleChips from './rule-chips.vue';
import { useTrackerScanEvents } from './smart-tracking/use-tracker-suggestions';
import TrackerStatistics from './statistics/tracker-statistics.vue';
import { getTrackerLimitSummary } from './tracker-summary';
import TrackerEditForm from './tracker-edit-form.vue';
import TransactionsList from './transactions-list.vue';

type TabValue = 'limits' | 'transactions' | 'statistics';
const TAB_VALUES: TabValue[] = ['limits', 'transactions', 'statistics'];
const MAX_VISIBLE_MEMBERS = 3;

const props = defineProps<{ tracker: TrackerModel }>();

const route = useRoute();
const router = useRouter();
const { t } = useI18n();
const { formatBaseCurrency } = useFormatCurrency();
const { archive, unarchive, toggleArchive, duplicate } = useTrackerActions();

const trackerId = computed(() => props.tracker.id);
const { isOwner, canManage, canWrite, isSharedWithCaller, ownerHandle } = useTrackerAccess(toRef(() => props.tracker));
useTrackerScanEvents({ trackerId });

const {
  data: stats,
  isPending: isStatsPending,
  isError: isStatsError,
  refetch: refetchStats,
} = useQuery({
  queryKey: [...VUE_QUERY_CACHE_KEYS.trackerStats, trackerId],
  queryFn: () => loadTrackerStats({ trackerId: trackerId.value }),
  staleTime: 30_000,
});

const { data: membersData } = useQuery({
  queryKey: computed(() => [...VUE_QUERY_CACHE_KEYS.shareMembers, RESOURCE_TYPES.tracker, trackerId.value]),
  queryFn: () => listShareMembers({ resourceType: RESOURCE_TYPES.tracker, resourceId: trackerId.value }),
  enabled: canManage,
});

const members = computed(() => membersData.value?.members ?? []);
const visibleMembers = computed(() => members.value.slice(0, MAX_VISIBLE_MEMBERS));
const hiddenMembersCount = computed(() => Math.max(0, members.value.length - MAX_VISIBLE_MEMBERS));

const showRules = computed(
  () => props.tracker.rulesEnabled && !!(props.tracker.categories?.length || props.tracker.tags?.length),
);
const isArchived = computed(() => props.tracker.status === TRACKER_STATUSES.archived);
const timeStatus = computed(() =>
  getTrackerTimeStatus({ startDate: props.tracker.startDate, endDate: props.tracker.endDate }),
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
  const range =
    formatDateRange({ from: props.tracker.startDate, to: props.tracker.endDate }) ?? transactionsRange.value;
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

const LIMIT_STRIP_LABEL_KEYS: Record<
  TRACKER_LIMIT_KINDS,
  { limit: string; spent: string; left: string; over: string }
> = {
  [TRACKER_LIMIT_KINDS.spending]: {
    limit: STRIP_LABEL_KEYS.limit,
    spent: STRIP_LABEL_KEYS.spent,
    left: STRIP_LABEL_KEYS.left,
    over: 'budgets.details.strip.overBy',
  },
  [TRACKER_LIMIT_KINDS.incomeTarget]: {
    limit: 'budgets.limitKind.kinds.income_target.amountLabel',
    spent: 'budgets.details.strip.earned',
    left: 'budgets.details.strip.toGo',
    over: 'budgets.details.strip.aboveTargetBy',
  },
  [TRACKER_LIMIT_KINDS.incomeCap]: {
    limit: 'budgets.limitKind.kinds.income_cap.amountLabel',
    spent: 'budgets.details.strip.earned',
    left: 'budgets.details.strip.headroom',
    over: 'budgets.details.strip.overBy',
  },
};

const stripCells = computed<StripCell[]>(() => {
  const limitAmount = props.tracker.limitAmount;
  const limitKind = props.tracker.limitKind;
  const limitLabels = LIMIT_STRIP_LABEL_KEYS[limitKind];
  const loaded = summary.value;
  if (!loaded) {
    const keys = limitAmount
      ? (['limit', 'spent', 'left', 'income', 'net'] as const)
      : (['income', 'expenses', 'net', 'transactions'] as const);
    return keys.map((key) => ({
      key,
      label: t({ ...STRIP_LABEL_KEYS, ...limitLabels }[key]),
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
    limitKind,
    summary: loaded,
    timeStatus: timeStatus.value,
  });
  const isOver = left < 0;
  const overClass = limitKind === TRACKER_LIMIT_KINDS.incomeTarget ? 'text-success-text' : 'text-app-expense-color';

  return [
    { key: 'limit', label: t(limitLabels.limit), value: formatBaseCurrency(limitAmount) },
    {
      key: 'spent',
      label: t(limitLabels.spent),
      value: formatBaseCurrency(spent),
      valueClass: utilizationClasses({ rate, tracker: props.tracker }).text,
      hint: `${Math.round(rate)}%`,
    },
    {
      key: 'left',
      label: t(isOver ? limitLabels.over : limitLabels.left),
      value: formatBaseCurrency(Math.abs(left)),
      valueClass: isOver ? overClass : undefined,
      hint: dailyPace === null ? null : t('budgets.details.strip.perDay', { amount: formatBaseCurrency(dailyPace) }),
    },
    incomeCell,
    netCell,
  ];
});

const limitsRequested = ref(route.query.tab === 'limits');
const isIncomeKind = computed(() => props.tracker.limitKind !== TRACKER_LIMIT_KINDS.spending);
const showLimitsTab = computed(() => props.tracker.lines.length > 0 || (!isIncomeKind.value && limitsRequested.value));

const queryTab = TAB_VALUES.find((value) => value === route.query.tab);
const activeTab = ref<TabValue>(queryTab ?? (showLimitsTab.value ? 'limits' : 'transactions'));

watch(showLimitsTab, (shown) => {
  if (!shown && activeTab.value === 'limits') activeTab.value = 'transactions';
});

const tabItems = computed(() => {
  const withCount = (label: string, count: number | undefined) => (count ? `${label} ${count}` : label);
  return [
    ...(showLimitsTab.value
      ? [{ value: 'limits', label: withCount(t('budgets.details.tabs.limits'), props.tracker.lines.length) }]
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
const isReviewOpen = ref(false);
const isShareOpen = ref(false);
const isDeleteOpen = ref(false);
const isRemoveLimitsOpen = ref(false);

const { deleteAllLines } = useTrackerLineMutations({ trackerId });
const handleRemoveLimits = () =>
  deleteAllLines.mutate(
    { lineIds: props.tracker.lines.map((line) => line.id) },
    {
      onSuccess: () => {
        isRemoveLimitsOpen.value = false;
        limitsRequested.value = false;
      },
    },
  );

watch(
  () => [route.query.edit, route.query.review],
  ([edit, review]) => {
    if (route.params.id !== props.tracker.id) return;
    if (edit === undefined && review === undefined) return;
    if (edit === '1' && canManage.value) isEditOpen.value = true;
    if (review === '1') {
      activeTab.value = 'transactions';
      isReviewOpen.value = true;
    }
    const restQuery = { ...route.query };
    delete restQuery.edit;
    delete restQuery.review;
    router.replace({ query: restQuery });
  },
  { immediate: true },
);

const isArchivePending = computed(() => archive.isPending.value || unarchive.isPending.value);

const chipClass = 'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap';
</script>

<template>
  <div class="max-w-5xl">
    <Card class="divide-border @container/tracker divide-y overflow-clip">
      <div class="flex items-center gap-3 px-3 py-3 @md/tracker:px-4">
        <div class="flex min-w-0 flex-1 items-center gap-3">
          <TrackerLogo :tracker="tracker" class="size-9 shrink-0 rounded-lg" />
          <div class="min-w-0">
            <div class="flex min-w-0 items-center gap-1.5">
              <h1 class="truncate text-lg font-bold @md/tracker:text-xl">{{ tracker.name }}</h1>
              <span v-if="isSharedWithCaller" :class="cn(chipClass, 'bg-primary/10 text-primary-text shrink-0')">
                <UsersIcon class="size-3" />
                {{ $t('budgets.share.sharedByBadge', { handle: `@${ownerHandle}` }) }}
              </span>
              <span v-if="statusChip" :class="cn(chipClass, statusChip.class, 'shrink-0')">{{ statusChip.text }}</span>
              <span v-if="isArchived" :class="cn(chipClass, 'bg-muted text-muted-foreground shrink-0')">
                <ArchiveIcon class="size-3" />
                {{ $t('budgets.list.archivedLabel') }}
              </span>
            </div>
            <p v-if="caption" class="text-muted-foreground truncate text-xs">{{ caption }}</p>
          </div>
        </div>

        <div v-if="canManage" class="flex shrink-0 items-center gap-2">
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

          <Button
            v-if="isArchived"
            variant="outline"
            size="sm"
            :disabled="isArchivePending"
            @click="toggleArchive({ tracker })"
          >
            <ArchiveRestoreIcon class="size-4" />
            {{ $t('budgets.list.unarchive') }}
          </Button>
          <Button
            v-else-if="!showLimitsTab && !isIncomeKind"
            variant="outline"
            size="sm"
            class="hidden @md/tracker:inline-flex"
            @click="handleSetLimits"
          >
            <LayoutListIcon class="size-4" />
            {{ $t('budgets.details.actions.setLimits') }}
          </Button>

          <Button
            variant="outline"
            size="sm"
            class="px-2 @md/tracker:px-3"
            :aria-label="$t('budgets.details.actions.share')"
            @click="isShareOpen = true"
          >
            <UsersIcon class="size-4" />
            <span class="hidden @md/tracker:inline">{{ $t('budgets.details.actions.share') }}</span>
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
              <DropdownMenuItem v-if="!isIncomeKind && tracker.lines.length === 0" @select="handleSetLimits">
                <LayoutListIcon class="size-4" />
                {{ $t('budgets.details.actions.setLimits') }}
              </DropdownMenuItem>
              <DropdownMenuItem v-else-if="tracker.lines.length" @select="isRemoveLimitsOpen = true">
                <ListXIcon class="size-4" />
                {{ $t('budgets.details.actions.removeLimits') }}
              </DropdownMenuItem>
              <DropdownMenuItem
                v-if="isOwner"
                :disabled="duplicate.isPending.value"
                @select="duplicate.mutate({ trackerId })"
              >
                <CopyIcon class="size-4" />
                {{ $t('budgets.details.actions.duplicate') }}
              </DropdownMenuItem>
              <DropdownMenuItem :disabled="isArchivePending" @select="toggleArchive({ tracker })">
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

      <div v-if="showRules" class="flex flex-wrap items-center gap-1.5 px-3 py-2 @md/tracker:px-4">
        <span
          class="text-muted-foreground mr-1 inline-flex items-center gap-1 text-xs font-semibold tracking-wider uppercase"
        >
          <ZapIcon class="size-3" />
          {{ $t('budgets.details.autoAdds') }}
        </span>
        <RuleChips
          :items="tracker.categories ?? []"
          :count-label="$t('budgets.lines.categoriesCount', tracker.categories?.length ?? 0)"
          :count-icon="ShapesIcon"
        />
        <RuleChips
          :items="tracker.tags ?? []"
          :count-label="$t('budgets.details.tagsCount', tracker.tags?.length ?? 0)"
          :count-icon="TagIcon"
        />
      </div>

      <div class="overflow-hidden">
        <div
          :class="
            cn(
              '-mr-px -mb-px grid grid-cols-1',
              stripCells.length === 5 ? '@md/tracker:grid-cols-3 @2xl/tracker:grid-cols-5' : '@2xl/tracker:grid-cols-4',
            )
          "
        >
          <div
            v-for="cell in stripCells"
            :key="cell.key"
            class="border-border flex min-w-0 items-baseline justify-between gap-3 border-r border-b px-3 py-2 @md/tracker:block @md/tracker:px-4 @md/tracker:py-3"
          >
            <div
              class="text-muted-foreground min-w-0 truncate text-xs font-medium @md/tracker:text-sm @md/tracker:tracking-wide @md/tracker:uppercase"
            >
              {{ cell.label }}
            </div>
            <div
              class="flex shrink-0 flex-wrap items-baseline justify-end gap-x-1.5 tabular-nums @md/tracker:mt-0.5 @md/tracker:justify-start"
            >
              <span v-if="cell.isPending" class="bg-muted my-1 inline-block h-5 w-16 animate-pulse rounded" />
              <span v-else :class="cn('text-base font-bold @md/tracker:text-lg', cell.valueClass)">{{
                cell.value
              }}</span>
              <span
                v-if="cell.hint"
                :class="
                  cn(
                    'text-muted-foreground truncate text-xs font-medium',
                    cell.key === 'transactions' && 'hidden @md/tracker:inline',
                  )
                "
              >
                {{ cell.hint }}
              </span>
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
          :tracker="tracker"
          :stats="stats"
          :stats-pending="isStatsPending"
          :can-manage="canManage"
        />
        <TransactionsList
          v-else-if="activeTab === 'transactions'"
          v-model:review-open="isReviewOpen"
          :tracker="tracker"
          :can-write="canWrite"
          @open-settings="isEditOpen = true"
        />
        <TrackerStatistics v-else :tracker="tracker" :stats="stats" />
      </div>
    </Card>

    <ResponsiveDialog v-model:open="isEditOpen">
      <template #title>{{ $t('budgets.manualBudget.editTitle') }}</template>
      <TrackerEditForm v-if="isEditOpen" :tracker="tracker" @saved="isEditOpen = false" @cancel="isEditOpen = false" />
    </ResponsiveDialog>

    <ResponsiveDialog v-if="canManage" v-model:open="isShareOpen" dialog-content-class="sm:max-w-xl">
      <template #title>{{ $t('budgets.details.shareDialog.title', { name: tracker.name }) }}</template>
      <TrackerSharingPanel :tracker="tracker" />
    </ResponsiveDialog>

    <DeleteTrackerDialog v-model:open="isDeleteOpen" :tracker-id="trackerId" redirect />

    <ResponsiveAlertDialog
      v-model:open="isRemoveLimitsOpen"
      :confirm-label="$t('budgets.details.actions.removeLimits')"
      confirm-variant="destructive"
      :confirm-disabled="deleteAllLines.isPending.value"
      @confirm="handleRemoveLimits"
    >
      <template #title>{{ $t('budgets.details.removeLimitsDialog.title') }}</template>
      <template #description>
        {{
          $t('budgets.details.removeLimitsDialog.description', { count: tracker.lines.length }, tracker.lines.length)
        }}
      </template>
    </ResponsiveAlertDialog>
  </div>
</template>
