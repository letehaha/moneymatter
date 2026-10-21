<script setup lang="ts">
import { type SubscriptionListItem, deleteSubscription, toggleSubscriptionActive } from '@/api/subscriptions';
import ResponsiveAlertDialog from '@/components/common/responsive-alert-dialog.vue';
import Button from '@/components/lib/ui/button/Button.vue';
import { PillTabs } from '@/components/lib/ui/pill-tabs';
import { DesktopOnlyTooltip } from '@/components/lib/ui/tooltip';
import { useNotificationCenter } from '@/components/notification-center';
import { provideChatPageContext } from '@/composable/chat/use-chat-page-context';
import { useInvalidateSubscriptionQueries, useSubscriptionsList } from '@/composable/data-queries/subscriptions';
import { type Period } from '@/composable/use-period-navigation';
import { ROUTES_NAMES } from '@/routes';
import { SUBSCRIPTION_TYPES } from '@bt/shared/types';
import { useLocalStorage, useNow } from '@vueuse/core';
import { addYears, endOfMonth, format, isWithinInterval, parseISO, startOfDay } from 'date-fns';
import { CircleAlertIcon, PlusIcon, RepeatIcon, SearchIcon } from '@lucide/vue';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';

import DiscoverCandidatesDialog from './components/discover-candidates-dialog.vue';
import QuickAddSubscriptionDialog from './components/quick-add-subscription-dialog.vue';
import SubscriptionRow from './components/subscription-list-item.vue';
import SubscriptionMarkPaidDialog from './components/subscription-mark-paid-dialog.vue';
import SubscriptionsPeriodSelector from './components/subscriptions-period-selector.vue';
import SubscriptionsSortSelect from './components/subscriptions-sort-select.vue';
import SubscriptionsSummary from './components/subscriptions-summary.vue';
import { type SubscriptionGroup, groupSubscriptions } from './group-subscriptions';
import {
  ALL_TYPES_FILTER,
  DEFAULT_SUBSCRIPTION_SORT,
  SUBSCRIPTION_SORT_STORAGE_KEY,
  type SubscriptionSortKey,
  type SubscriptionTypeFilter,
  isSubscriptionSortKey,
  isSubscriptionTypeFilter,
} from './utils';

const { t } = useI18n();
const router = useRouter();
const invalidateSubscriptionQueries = useInvalidateSubscriptionQueries();
const { addSuccessNotification, addErrorNotification } = useNotificationCenter();

const isCreateDialogOpen = ref(false);
const isDiscoverDialogOpen = ref(false);
const deleteTarget = ref<SubscriptionListItem | null>(null);
const activeFilter = ref<SubscriptionTypeFilter>(ALL_TYPES_FILTER);

const setActiveFilter = (value: string) => {
  if (isSubscriptionTypeFilter(value)) activeFilter.value = value;
};

// Single clock for the page: grouping and every row read the same value, so a
// tick past midnight moves them together instead of drifting apart.
const now = useNow({ interval: 60_000 });

const ALL_TIME_END = endOfMonth(addYears(startOfDay(now.value), 10));
const periodFilter = ref<Period>({
  from: startOfDay(now.value),
  to: ALL_TIME_END,
});

const isPeriodFilterActive = computed(() => periodFilter.value.to.getTime() !== ALL_TIME_END.getTime());

const sortBy = useLocalStorage<SubscriptionSortKey>(SUBSCRIPTION_SORT_STORAGE_KEY, DEFAULT_SUBSCRIPTION_SORT);
// Guard against a stale/invalid value persisted by an older build.
if (!isSubscriptionSortKey(sortBy.value)) sortBy.value = DEFAULT_SUBSCRIPTION_SORT;

// Full list (active + inactive) — a separate cache entry from the active-only
// widgets. The server returns it already sorted, so `sortBy` is part of the
// cache key; type/period filtering is client-side below.
const {
  data: subscriptions,
  isPlaceholderData,
  isError,
  refetch,
} = useSubscriptionsList({
  filter: computed(() => ({ sortBy: sortBy.value })),
});

// The chat sees the list as it is narrowed and sorted right now.
provideChatPageContext(() => ({
  filters: {
    sortBy: sortBy.value,
    ...(activeFilter.value !== ALL_TYPES_FILTER ? { type: activeFilter.value } : {}),
  },
  ...(isPeriodFilterActive.value
    ? {
        period: {
          from: format(periodFilter.value.from, 'yyyy-MM-dd'),
          to: format(periodFilter.value.to, 'yyyy-MM-dd'),
        },
      }
    : {}),
}));

const filteredSubscriptions = computed(() => {
  if (!subscriptions.value) return [];

  let result = subscriptions.value;

  if (activeFilter.value !== ALL_TYPES_FILTER) {
    result = result.filter((s) => s.type === activeFilter.value);
  }

  if (isPeriodFilterActive.value) {
    const interval = { start: periodFilter.value.from, end: periodFilter.value.to };
    result = result.filter((s) => {
      if (!s.nextDueDate) return false;
      return isWithinInterval(parseISO(s.nextDueDate), interval);
    });
  }

  return result;
});

const filterItems = computed(() => [
  { value: ALL_TYPES_FILTER, label: t('planned.subscriptions.summary.filterAll') },
  { value: SUBSCRIPTION_TYPES.subscription, label: t('planned.subscriptions.summary.filterSubscriptions') },
  { value: SUBSCRIPTION_TYPES.bill, label: t('planned.subscriptions.summary.filterBills') },
  { value: SUBSCRIPTION_TYPES.installment, label: t('planned.subscriptions.summary.filterInstallments') },
]);

const handleToggleActive = async ({ subscription }: { subscription: SubscriptionListItem }) => {
  try {
    await toggleSubscriptionActive({ id: subscription.id, isActive: !subscription.isActive });
    invalidateSubscriptionQueries();
  } catch {
    addErrorNotification(t('planned.subscriptions.toggleError'));
  }
};

const confirmDelete = async () => {
  if (!deleteTarget.value) return;
  try {
    await deleteSubscription({ id: deleteTarget.value.id });
    invalidateSubscriptionQueries();
    addSuccessNotification(t('planned.subscriptions.deleteSuccess'));
  } catch {
    addErrorNotification(t('planned.subscriptions.deleteError'));
  } finally {
    deleteTarget.value = null;
  }
};

const groups = computed(() =>
  groupSubscriptions({ subscriptions: filteredSubscriptions.value, sortBy: sortBy.value, now: now.value }),
);

const hasLoadError = computed(() => isError.value && !subscriptions.value?.length);

const groupLabel = ({ group }: { group: SubscriptionGroup }): string =>
  t(group.labelKey, { count: group.items.length });

const navigateToDetail = ({ subscription, hash }: { subscription: SubscriptionListItem; hash?: string }) => {
  router.push({
    name: ROUTES_NAMES.plannedSubscriptionDetails,
    params: { id: subscription.id },
    hash,
  });
};

// --- Quick mark-paid from the list (scheduled subscriptions that have an open period) ---
const markPaidRef = ref<InstanceType<typeof SubscriptionMarkPaidDialog>>();
const isMarkingPaid = computed(() => markPaidRef.value?.isPending ?? false);

function payPeriod({ subscription }: { subscription: SubscriptionListItem }) {
  if (!subscription.currentPeriod) return;
  markPaidRef.value?.triggerPay({ subscription, periodId: subscription.currentPeriod.id });
}
</script>

<template>
  <div>
    <!-- Page Header -->
    <div class="mb-4 flex flex-wrap items-center justify-between gap-2 sm:mb-6 sm:gap-4">
      <div>
        <h1 class="text-xl font-semibold tracking-tight sm:text-2xl">{{ $t('planned.subscriptions.title') }}</h1>
        <p class="text-muted-foreground mt-1 hidden text-sm sm:block">{{ $t('planned.subscriptions.description') }}</p>
      </div>
      <div class="flex shrink-0 gap-2">
        <DesktopOnlyTooltip :content="$t('planned.subscriptions.candidates.discover')">
          <Button
            variant="outline"
            size="sm"
            :aria-label="$t('planned.subscriptions.candidates.discover')"
            @click="isDiscoverDialogOpen = true"
          >
            <SearchIcon class="size-4" />
            <span class="hidden sm:inline">{{ $t('planned.subscriptions.candidates.discover') }}</span>
          </Button>
        </DesktopOnlyTooltip>
        <Button size="sm" @click="isCreateDialogOpen = true">
          <PlusIcon class="size-4" />
          <span class="sm:hidden">{{ $t('planned.subscriptions.addSubscriptionShort') }}</span>
          <span class="hidden sm:inline">{{ $t('planned.subscriptions.addSubscription') }}</span>
        </Button>
      </div>
    </div>

    <!-- Filter Tabs + Period + Sort -->
    <div class="mb-3 flex flex-col gap-3 sm:mb-4 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
      <PillTabs :model-value="activeFilter" :items="filterItems" @update:model-value="setActiveFilter" />
      <div class="flex flex-wrap items-center justify-between gap-2">
        <SubscriptionsPeriodSelector v-model="periodFilter" />
        <SubscriptionsSortSelect v-model="sortBy" />
      </div>
    </div>

    <SubscriptionsSummary :active-filter="activeFilter" class="mb-3 sm:mb-6" />

    <!-- Loading Skeleton -->
    <div v-if="isPlaceholderData" class="animate-pulse">
      <div class="bg-muted mb-2 ml-1 h-3 w-24 rounded" />
      <div class="divide-border border-border bg-card divide-y rounded-lg border">
        <div v-for="i in 5" :key="i" class="flex items-center gap-2.5 px-4 py-3">
          <div class="bg-muted size-8 shrink-0 rounded-full" />
          <div class="flex min-w-0 flex-col gap-1.5">
            <div class="bg-muted h-4 w-36 rounded" />
            <div class="bg-muted h-3 w-24 rounded" />
          </div>
          <div class="bg-muted ml-auto h-4 w-20 rounded" />
        </div>
      </div>
    </div>

    <!-- Error State -->
    <div v-else-if="hasLoadError" class="flex flex-col items-center justify-center py-12 text-center">
      <div class="bg-muted mb-4 flex size-16 items-center justify-center rounded-full">
        <CircleAlertIcon class="text-destructive-text size-8" />
      </div>
      <h3 class="mb-1 font-medium">{{ $t('planned.subscriptions.errorState.title') }}</h3>
      <p class="text-muted-foreground max-w-sm text-sm">
        {{ $t('planned.subscriptions.errorState.description') }}
      </p>
      <Button variant="outline" class="mt-4" @click="refetch()">
        {{ $t('planned.subscriptions.errorState.retry') }}
      </Button>
    </div>

    <!-- Subscription List -->
    <div v-else-if="filteredSubscriptions.length" class="flex flex-col gap-6">
      <div v-for="group in groups" :key="group.key">
        <h2 class="text-muted-foreground mb-2 px-1 text-xs font-medium tracking-wide uppercase">
          {{ groupLabel({ group }) }}
        </h2>
        <div class="divide-border border-border bg-card @container divide-y rounded-lg border">
          <SubscriptionRow
            v-for="subscription in group.items"
            :key="subscription.id"
            :subscription="subscription"
            :is-marking-paid="isMarkingPaid"
            :now="now"
            @select="navigateToDetail({ subscription: $event })"
            @select-linked="navigateToDetail({ subscription: $event, hash: '#linked-transactions' })"
            @pay="payPeriod({ subscription: $event })"
            @toggle-active="handleToggleActive({ subscription: $event })"
            @delete="deleteTarget = $event"
          />
        </div>
      </div>
    </div>

    <!-- Empty State -->
    <div v-else class="flex flex-col items-center justify-center py-12 text-center">
      <div class="bg-muted mb-4 flex size-16 items-center justify-center rounded-full">
        <RepeatIcon class="text-muted-foreground size-8" />
      </div>
      <h3 class="mb-1 font-medium">{{ $t('planned.subscriptions.emptyState.title') }}</h3>
      <p class="text-muted-foreground max-w-sm text-sm">
        {{ $t('planned.subscriptions.emptyState.description') }}
      </p>
      <Button class="mt-4" @click="isCreateDialogOpen = true">
        <PlusIcon class="size-4" />
        {{ $t('planned.subscriptions.addSubscription') }}
      </Button>
    </div>

    <!-- Create Dialog -->
    <QuickAddSubscriptionDialog v-model:open="isCreateDialogOpen" />

    <!-- Delete Confirmation -->
    <ResponsiveAlertDialog
      :open="!!deleteTarget"
      confirm-variant="destructive"
      :confirm-label="$t('planned.subscriptions.deleteConfirm')"
      @confirm="confirmDelete"
      @cancel="deleteTarget = null"
      @update:open="(v: boolean) => !v && (deleteTarget = null)"
    >
      <template #title>{{ $t('planned.subscriptions.deleteConfirmTitle') }}</template>
      <template #description>{{ $t('planned.subscriptions.deleteConfirmDescription') }}</template>
    </ResponsiveAlertDialog>

    <!-- Discover Candidates Dialog -->
    <DiscoverCandidatesDialog v-model:open="isDiscoverDialogOpen" />

    <!-- Quick mark-paid flow (books instantly for same-currency, opens dialog for cross-currency) -->
    <SubscriptionMarkPaidDialog ref="markPaidRef" />
  </div>
</template>
