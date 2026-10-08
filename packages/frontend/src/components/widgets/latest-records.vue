<script lang="ts" setup>
import { type SubscriptionListItem } from '@/api/subscriptions';
import { loadTransactions as apiLoadTransactions } from '@/api/transactions';
import type { DashboardWidgetConfig } from '@/api/user-settings';
import { VUE_QUERY_CACHE_KEYS } from '@/common/const';
import { useSubscriptionsList } from '@/composable/data-queries/subscriptions';
import { useFormatCurrency } from '@/composable/formatters';
import { buttonVariants } from '@/components/lib/ui/button';
import UiButton from '@/components/lib/ui/button/Button.vue';
import BrandLogo from '@/components/common/brand-logo.vue';
import { ScrollArea } from '@/components/lib/ui/scroll-area';
import { DesktopOnlyTooltip } from '@/components/lib/ui/tooltip';
import TransactionsList from '@/components/transactions-list/transactions-list.vue';
import SubscriptionMarkPaidDialog from '@/pages/planned/subscriptions/components/subscription-mark-paid-dialog.vue';
import { ROUTES_NAMES } from '@/routes/constants';
import { useRootStore } from '@/stores';
import { useQuery } from '@tanstack/vue-query';
import { ArrowUpRightIcon, ListIcon } from '@lucide/vue';
import { differenceInCalendarDays, format, isAfter, parseISO } from 'date-fns';
import { SUBSCRIPTION_PERIOD_STATUSES } from '@bt/shared/types';
import { storeToRefs } from 'pinia';
import type { Ref } from 'vue';
import { computed, inject, ref } from 'vue';

import EmptyState from './components/empty-state.vue';
import LatestRecordsSettingsPopover from './components/latest-records-settings-popover.vue';
import LoadingState from './components/loading-state.vue';
import WidgetWrapper from './components/widget-wrapper.vue';
import {
  buildLatestRecordsTransferNatures,
  readLatestRecordsExclusions,
  readLatestRecordsTagsVariant,
} from './latest-records-config';
import { useIncludePlannedConfig, useWidgetConfigFlag } from './use-include-planned-config';

// Days ahead threshold for "upcoming" payments shown in the widget.
const UPCOMING_DAYS_WINDOW = 3;
const MAX_DISPLAY = 20;

const { isAppInitialized } = storeToRefs(useRootStore());
const { formatAmountByCurrencyCode, formatBaseCurrency } = useFormatCurrency();
const widgetConfigRef = inject<Ref<DashboardWidgetConfig> | null>('dashboard-widget-config', null);

// Whether the widget should show the scheduled row. Stored as the string 'true'/'false'
// (config values are always strings in the segmented-button config UI); default true.
const includeScheduled = computed(() => {
  const raw = widgetConfigRef?.value?.config?.includeScheduled;
  // Explicit opt-out only; undefined (first use) defaults to enabled.
  return raw !== 'false';
});

const exclusions = computed(() => readLatestRecordsExclusions({ widgetConfig: widgetConfigRef?.value }));
const transferNatures = computed(() => buildLatestRecordsTransferNatures(exclusions.value));
const excludeBalanceAdjustments = computed(() => exclusions.value.excludeBalanceAdjustments);
const { includePlanned } = useIncludePlannedConfig();
const tagsVariant = computed(() => readLatestRecordsTagsVariant({ widgetConfig: widgetConfigRef?.value }));
const { isOn: showAccount } = useWidgetConfigFlag({
  key: 'showAccount',
  saveErrorKey: 'widgets.latestRecords.settings.showAccountSaveError',
});

const { data: transactions, isFetching: isTxFetching } = useQuery({
  queryKey: [...VUE_QUERY_CACHE_KEYS.widgetLatestRecords, transferNatures, excludeBalanceAdjustments, includePlanned],
  queryFn: () =>
    // `to` keeps future-dated plans out of the page, so a backlog of them can't fill it
    // and blank the widget. Over-fetch accounts for deduplication and grouping.
    apiLoadTransactions({
      limit: 40,
      offset: 0,
      includeSplits: true,
      includeTags: true,
      includeGroups: true,
      transferNatures: transferNatures.value,
      excludeBalanceAdjustments: excludeBalanceAdjustments.value || undefined,
      ...(includePlanned.value ? {} : { isPlanned: false }),
      to: new Date().toISOString(),
    }),
  staleTime: Infinity,
  placeholderData: [],
  enabled: isAppInitialized,
});

// Fetched in parallel with transactions; only active when the toggle is on.
const { data: subscriptions, isFetching: isScheduledFetching } = useSubscriptionsList({
  filter: { isActive: true },
  enabled: computed(() => isAppInitialized.value && includeScheduled.value),
});

// Subscriptions whose current period is overdue or due within the next UPCOMING_DAYS_WINDOW days.
const scheduledItems = computed<SubscriptionListItem[]>(() => {
  if (!includeScheduled.value || !subscriptions.value) return [];
  const today = new Date();
  return subscriptions.value.filter((sub) => {
    const period = sub.currentPeriod;
    if (!period) return false;
    if (period.status === SUBSCRIPTION_PERIOD_STATUSES.overdue) return true;
    if (period.status === SUBSCRIPTION_PERIOD_STATUSES.upcoming) {
      const daysUntilDue = differenceInCalendarDays(parseISO(period.dueDate), today);
      return daysUntilDue >= 0 && daysUntilDue <= UPCOMING_DAYS_WINDOW;
    }
    return false;
  });
});

// Scheduled items sorted: overdue first, then upcoming ascending by dueDate.
const sortedScheduledItems = computed<SubscriptionListItem[]>(() => {
  return [...scheduledItems.value].sort((a, b) => {
    const aOverdue = a.currentPeriod?.status === SUBSCRIPTION_PERIOD_STATUSES.overdue;
    const bOverdue = b.currentPeriod?.status === SUBSCRIPTION_PERIOD_STATUSES.overdue;
    if (aOverdue !== bOverdue) return aOverdue ? -1 : 1;
    const aDate = a.currentPeriod?.dueDate ?? '';
    const bDate = b.currentPeriod?.dueDate ?? '';
    return aDate < bDate ? -1 : aDate > bDate ? 1 : 0;
  });
});

// Planned rows can carry a future date, which would otherwise put money that hasn't
// moved yet at the top of "latest records".
const pastTransactions = computed(() => {
  const now = new Date();
  return (transactions.value ?? []).filter((tx) => !isAfter(new Date(tx.time), now));
});

// Scheduled rows consume slots first; transactions fill whatever remains up to MAX_DISPLAY.
const scheduledRows = computed(() => sortedScheduledItems.value.slice(0, MAX_DISPLAY));
const txMaxDisplay = computed(() => Math.max(0, MAX_DISPLAY - scheduledRows.value.length));

const markPaidDialogRef = ref<InstanceType<typeof SubscriptionMarkPaidDialog> | null>(null);

function handleMarkPaid({ subscription }: { subscription: SubscriptionListItem }) {
  const period = subscription.currentPeriod;
  if (!period) return;
  markPaidDialogRef.value?.triggerPay({
    subscription: {
      id: subscription.id,
      name: subscription.name,
      expectedAmount: subscription.expectedAmount ?? null,
      expectedCurrencyCode: subscription.expectedCurrencyCode ?? null,
      accountId: subscription.accountId ?? null,
    },
    periodId: period.id,
  });
}

function formatDueDate({ dueDate }: { dueDate: string }): string {
  return format(parseISO(dueDate), 'MMM d');
}

const isFetching = computed(() => isTxFetching.value || (includeScheduled.value && isScheduledFetching.value));
const isInitialLoading = computed(() => isTxFetching.value && (transactions.value?.length ?? 0) === 0);
const isDataEmpty = computed(() => !isTxFetching.value && pastTransactions.value.length === 0);
</script>

<template>
  <WidgetWrapper class="max-md:max-h-96" :is-fetching="isFetching">
    <template #title>
      {{ $t('dashboard.widgets.latestTransactions.title') }}
    </template>
    <template #action>
      <DesktopOnlyTooltip
        v-if="!isDataEmpty && !isInitialLoading"
        :content="$t('dashboard.widgets.latestTransactions.showAll')"
      >
        <span class="inline-flex">
          <router-link
            :class="
              buttonVariants({
                variant: 'ghost',
                size: 'icon-sm',
                class: 'text-muted-foreground',
              })
            "
            :to="{ name: ROUTES_NAMES.transactions }"
            :aria-label="$t('dashboard.widgets.latestTransactions.showAll')"
          >
            <ArrowUpRightIcon class="size-4" />
          </router-link>
        </span>
      </DesktopOnlyTooltip>

      <LatestRecordsSettingsPopover />
    </template>

    <template v-if="isInitialLoading">
      <LoadingState />
    </template>
    <template v-else-if="isDataEmpty">
      <EmptyState>
        <ListIcon class="size-32" />
      </EmptyState>
    </template>
    <ScrollArea v-else class="-mx-2 min-h-0 flex-1" viewport-class="px-2 md:overscroll-contain">
      <!-- Scheduled payment rows: one row per item, overdue first, sorted by dueDate -->
      <template v-if="includeScheduled && scheduledRows.length > 0">
        <div
          v-for="sub in scheduledRows"
          :key="sub.id"
          class="bg-muted/40 mb-1.5 flex items-center gap-2.5 rounded-md px-3 py-2"
        >
          <BrandLogo
            :domain="sub.logoDomain ?? null"
            :initials="sub.logoInitials ?? null"
            :color="sub.logoColor ?? null"
            :name="sub.name"
            class="size-5 shrink-0"
          />
          <div class="min-w-0 flex-1">
            <p class="truncate text-sm leading-tight font-medium">
              {{ sub.name }}
            </p>
            <p class="text-muted-foreground overflow-hidden text-xs text-ellipsis whitespace-nowrap">
              <span v-if="sub.currentPeriod?.status === 'overdue'" class="text-app-expense-color font-medium">
                {{ $t('widgets.latestRecords.overdueBadge') }}
              </span>
              <span v-else class="text-warning-text font-medium">
                {{ $t('widgets.latestRecords.scheduledBadge') }}
              </span>
              <span v-if="sub.currentPeriod">
                &nbsp;&middot;&nbsp;{{ formatDueDate({ dueDate: sub.currentPeriod.dueDate }) }}
              </span>
            </p>
          </div>
          <div class="flex shrink-0 items-center gap-1.5">
            <span class="text-sm font-medium">
              <template v-if="sub.expectedCurrencyCode && sub.expectedAmount != null">
                {{ formatAmountByCurrencyCode(sub.expectedAmount, sub.expectedCurrencyCode) }}
              </template>
              <template v-else-if="sub.expectedAmount != null">
                {{ formatBaseCurrency(sub.expectedAmount) }}
              </template>
            </span>
            <UiButton
              size="sm"
              variant="outline"
              class="h-7 shrink-0 px-2 text-xs"
              @click="handleMarkPaid({ subscription: sub })"
            >
              {{ $t('widgets.latestRecords.payAction') }}
            </UiButton>
          </div>
        </div>
      </template>

      <TransactionsList
        v-if="txMaxDisplay > 0"
        raw-list
        :paginate="false"
        class="gap-0.5!"
        :transactions="pastTransactions"
        :max-display="txMaxDisplay"
        :tags-variant="tagsVariant"
        :show-account="showAccount"
      />
    </ScrollArea>

    <!-- Mark-paid dialog: rendered once, opened imperatively via triggerPay() -->
    <SubscriptionMarkPaidDialog ref="markPaidDialogRef" />
  </WidgetWrapper>
</template>
