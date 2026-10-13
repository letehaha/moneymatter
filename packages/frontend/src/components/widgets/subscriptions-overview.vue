<script lang="ts" setup>
import {
  DEFAULT_INCOME_LOOKBACK_MONTHS,
  type IncomeLookbackMonths,
  type SubscriptionListItem,
  loadSubscriptionsSummary,
} from '@/api/subscriptions';
import type { DashboardWidgetConfig } from '@/api/user-settings';
import { VUE_QUERY_CACHE_KEYS } from '@/common/const';
import { useExchangeRates } from '@/composable/data-queries/currencies';
import { useSubscriptionsList } from '@/composable/data-queries/subscriptions';
import { useFormatCurrency } from '@/composable/formatters';
import { useAnimatedNumber } from '@/composable/use-animated-number';
import { useCurrencyNotConnectedNotification } from '@/composable/use-currency-not-connected-notification';
import { useDateLocale } from '@/composable/use-date-locale';
import BrandLogo from '@/components/common/brand-logo.vue';
import { buttonVariants } from '@/components/lib/ui/button';
import UiButton from '@/components/lib/ui/button/Button.vue';
import { ScrollArea } from '@/components/lib/ui/scroll-area';
import { DesktopOnlyTooltip } from '@/components/lib/ui/tooltip';
import { cn } from '@/lib/utils';
import { ROUTES_NAMES } from '@/routes/constants';
import { useCurrenciesStore, useRootStore } from '@/stores';
import {
  type SubscriptionDueStatus,
  getSubscriptionDueStatus,
} from '@/pages/planned/subscriptions/subscription-due-status';
import {
  getPercentOfIncomeColorClass,
  getTransactionTypePrefix,
  getTransactionTypeStyles,
  isSubscriptionTypeFilter,
} from '@/pages/planned/subscriptions/utils';
import { useQuery } from '@tanstack/vue-query';
import { useElementVisibility, useNow, useScroll } from '@vueuse/core';
import { parseISO } from 'date-fns';
import { ArrowUpRightIcon, CheckIcon, CircleAlertIcon, CircleCheckIcon, RepeatIcon } from '@lucide/vue';
import { storeToRefs } from 'pinia';
import type { Ref } from 'vue';
import { computed, inject, ref, useTemplateRef } from 'vue';
import { useI18n } from 'vue-i18n';

import SubscriptionMarkPaidDialog from '@/pages/planned/subscriptions/components/subscription-mark-paid-dialog.vue';
import EmptyState from './components/empty-state.vue';
import ErrorState from './components/error-state.vue';
import LoadingState from './components/loading-state.vue';
import SubscriptionsOverviewSettingsPopover from './components/subscriptions-overview-settings-popover.vue';
import UpcomingPaymentsStrip from './components/upcoming-payments-strip.vue';
import WidgetWrapper from './components/widget-wrapper.vue';
import { buildPaymentsStrip } from './upcoming-payments-strip';

const { t } = useI18n();

const { isAppInitialized } = storeToRefs(useRootStore());
const { baseCurrency } = storeToRefs(useCurrenciesStore());
const { formatBaseCurrency, formatAmountByCurrencyCode } = useFormatCurrency();
const { convert, isPlaceholderData: isRatesPlaceholder } = useExchangeRates();
const { format } = useDateLocale();
const widgetConfigRef = inject<Ref<DashboardWidgetConfig> | null>('dashboard-widget-config', null);

const isOnDashboard = computed(() => !!widgetConfigRef?.value);
const widgetType = computed(() => {
  const cfg = widgetConfigRef?.value?.config;
  return (cfg?.type as string) || undefined;
});

const showStrip = computed(() => widgetConfigRef?.value?.config?.showStrip !== false);

const widgetLookbackMonths = computed<IncomeLookbackMonths>(() => {
  const cfg = widgetConfigRef?.value?.config;
  const raw = cfg?.lookbackMonths as number | undefined;
  return raw === 1 || raw === 3 || raw === 6 || raw === 12 ? raw : DEFAULT_INCOME_LOOKBACK_MONTHS;
});

const TITLE_KEYS: Record<string, string> = {
  subscription: 'dashboard.widgets.subscriptions.titleSubscriptions',
  bill: 'dashboard.widgets.subscriptions.titleBills',
  installment: 'dashboard.widgets.subscriptions.titleInstallments',
};
const widgetTitle = computed(() => t(TITLE_KEYS[widgetType.value ?? ''] ?? 'dashboard.widgets.subscriptions.titleAll'));

const percentOfIncomeColorClass = computed(() =>
  getPercentOfIncomeColorClass({
    percent: summary.value?.percentOfIncome,
    type: isSubscriptionTypeFilter(widgetType.value) ? widgetType.value : undefined,
  }),
);

const {
  data: summary,
  isFetching: isSummaryFetching,
  isError: isSummaryError,
  error: summaryError,
  refetch: refetchSummary,
} = useQuery({
  queryKey: computed(() => [
    ...VUE_QUERY_CACHE_KEYS.subscriptionsSummary,
    widgetType.value ?? 'all',
    widgetLookbackMonths.value,
  ]),
  queryFn: () =>
    loadSubscriptionsSummary({
      type: widgetType.value,
      lookbackMonths: widgetLookbackMonths.value,
    }),
  staleTime: Infinity,
  enabled: isAppInitialized,
});

useCurrencyNotConnectedNotification({ error: summaryError });

const {
  list: subscriptions,
  isFetching: isSubscriptionsFetching,
  isPlaceholderData: isSubscriptionsPlaceholder,
  isError: isSubscriptionsError,
  refetch: refetchSubscriptions,
} = useSubscriptionsList({
  filter: computed(() => (widgetType.value ? { isActive: true, type: widgetType.value } : { isActive: true })),
  enabled: isAppInitialized,
});

const isFetching = computed(() => isSummaryFetching.value || isSubscriptionsFetching.value);
const isInitialLoading = computed(
  () => (isFetching.value && !summary.value) || isSubscriptionsPlaceholder.value || isRatesPlaceholder.value,
);
const isError = computed(() => isSummaryError.value || isSubscriptionsError.value);
const retry = () => {
  void refetchSummary();
  void refetchSubscriptions();
};
const totalActiveCount = computed(() => {
  if (!summary.value) return 0;
  return summary.value.activeCount.expense + summary.value.activeCount.income;
});
const isEmpty = computed(() => !summary.value || totalActiveCount.value === 0);

const { displayValue: animatedMonthlyCost } = useAnimatedNumber({
  value: computed(() => summary.value?.estimatedMonthlyCost ?? 0),
});

const { displayValue: animatedMonthlyIncome } = useAnimatedNumber({
  value: computed(() => summary.value?.expectedMonthlyIncome ?? 0),
});

const headlineDisplay = computed(() =>
  summary.value && summary.value.activeCount.expense === 0
    ? `+${formatBaseCurrency(animatedMonthlyIncome.value)}`
    : formatBaseCurrency(animatedMonthlyCost.value),
);

const now = useNow({ interval: 60_000 });

const rows = computed(() =>
  subscriptions.value
    .filter((sub): sub is SubscriptionListItem & { nextDueDate: string } => !!sub.nextDueDate)
    .map((sub) => ({
      sub,
      status: getSubscriptionDueStatus({ subscription: sub, now: now.value }),
    }))
    .sort((a, b) => {
      const aOverdue = a.status === 'overdue';
      const bOverdue = b.status === 'overdue';
      if (aOverdue !== bOverdue) return aOverdue ? -1 : 1;
      return a.sub.nextDueDate.localeCompare(b.sub.nextDueDate);
    }),
);

const dueCount = computed(() => rows.value.filter((row) => row.status).length);

const ROW_TONE_CLASSES: Record<NonNullable<SubscriptionDueStatus>, string> = {
  overdue: 'bg-destructive/10 hover:bg-destructive/15',
  dueSoon: 'bg-warning/10 hover:bg-warning/15',
};

const formatDueDate = ({ dueDate }: { dueDate: string }) => format(parseISO(dueDate), 'MMM d');

const rowHint = ({ status, dueDate }: { status: SubscriptionDueStatus; dueDate: string }) => {
  if (status === 'overdue')
    return t('widgets.subscriptionsOverview.overdueHint', {
      date: formatDueDate({ dueDate }),
    });
  if (status === 'dueSoon') return t('widgets.subscriptionsOverview.dueSoonHint');
  return undefined;
};

const formatRowAmount = ({ sub }: { sub: SubscriptionListItem }) => {
  if (sub.expectedAmount == null) return '—';
  const amount = sub.expectedCurrencyCode
    ? formatAmountByCurrencyCode(sub.expectedAmount, sub.expectedCurrencyCode)
    : formatBaseCurrency(sub.expectedAmount);
  return `${getTransactionTypePrefix(sub.transactionType)}${amount}`;
};

const strip = computed(() =>
  buildPaymentsStrip({
    subscriptions: subscriptions.value,
    now: now.value,
    toBase: ({ amount, currencyCode }) => {
      if (!currencyCode) return amount;
      const base = baseCurrency.value?.currencyCode;
      return base ? convert({ amount, from: currencyCode, to: base }) : null;
    },
  }),
);

const scrollAreaRef = useTemplateRef<InstanceType<typeof ScrollArea>>('scrollAreaRef');
const scrollRef = computed<HTMLElement | null>(() => scrollAreaRef.value?.viewportRef?.viewportElement ?? null);
const headlineRef = useTemplateRef<HTMLElement>('headlineRef');
const { arrivedState } = useScroll(scrollRef);
const isHeadlineVisible = useElementVisibility(headlineRef, {
  scrollTarget: scrollRef,
  initialValue: true,
});
const showHeaderHeadline = computed(() => !!headlineRef.value && !isHeadlineVisible.value);

const markPaidRef = ref<InstanceType<typeof SubscriptionMarkPaidDialog>>();
const isMarkingPaid = computed(() => markPaidRef.value?.isPending ?? false);

function payPeriod({ subscription }: { subscription: SubscriptionListItem }) {
  if (!subscription.currentPeriod) return;
  markPaidRef.value?.triggerPay({
    subscription,
    periodId: subscription.currentPeriod.id,
  });
}
</script>

<template>
  <WidgetWrapper class="max-md:max-h-96" :is-fetching="isFetching">
    <template #title> {{ widgetTitle }} </template>
    <template v-if="isOnDashboard" #action>
      <span
        :aria-hidden="!showHeaderHeadline"
        :class="
          cn(
            'mr-1 text-sm font-semibold tabular-nums transition-opacity',
            showHeaderHeadline ? 'opacity-100' : 'pointer-events-none opacity-0',
          )
        "
      >
        {{ headlineDisplay }}
      </span>

      <DesktopOnlyTooltip v-if="!isEmpty && !isInitialLoading" :content="$t('common.actions.viewAll')">
        <span class="inline-flex">
          <router-link
            :class="
              buttonVariants({
                variant: 'ghost',
                size: 'icon-sm',
                class: 'text-muted-foreground',
              })
            "
            :to="{ name: ROUTES_NAMES.plannedSubscriptions }"
            :aria-label="$t('common.actions.viewAll')"
          >
            <ArrowUpRightIcon class="size-4" />
          </router-link>
        </span>
      </DesktopOnlyTooltip>

      <SubscriptionsOverviewSettingsPopover />
    </template>

    <template v-if="isError">
      <ErrorState :message="$t('widgets.subscriptionsOverview.loadFailed')" @retry="retry" />
    </template>

    <template v-else-if="isInitialLoading">
      <LoadingState />
    </template>

    <template v-else-if="isEmpty && !isFetching">
      <EmptyState>
        <RepeatIcon class="size-32" />
      </EmptyState>
    </template>

    <ScrollArea
      v-else
      ref="scrollAreaRef"
      :class="
        cn(
          '-mx-2 min-h-0 flex-1',
          !arrivedState.bottom && '[mask-image:linear-gradient(to_bottom,black_calc(100%-1.75rem),transparent)]',
        )
      "
      viewport-class="px-2 md:overscroll-contain-if-scrollable"
    >
      <div v-if="summary && totalActiveCount > 0" class="pb-2.5">
        <template v-if="summary.activeCount.expense > 0">
          <p ref="headlineRef" class="flex flex-wrap items-baseline gap-x-2 text-2xl font-bold tracking-tight">
            {{ headlineDisplay }}
            <span v-if="summary.percentOfIncome !== null" :class="[percentOfIncomeColorClass, 'text-sm font-normal']">
              {{
                $t('dashboard.widgets.subscriptions.percentOfIncome', {
                  percent: summary.percentOfIncome,
                })
              }}
            </span>
          </p>
          <p class="text-muted-foreground mt-0.5 text-xs">
            {{
              t('dashboard.widgets.subscriptions.activeSummary', {
                count: summary.activeCount.expense,
              })
            }}
            &middot; ~{{ formatBaseCurrency(summary.projectedYearlyCost)
            }}{{ t('dashboard.widgets.subscriptions.perYear') }}
          </p>
          <i18n-t
            v-if="summary.activeCount.income > 0"
            keypath="dashboard.widgets.subscriptions.incomeSummary"
            tag="p"
            class="text-muted-foreground mt-0.5 text-xs"
          >
            <template #amount>
              <span class="text-app-income-color font-medium">
                +{{ formatBaseCurrency(summary.expectedMonthlyIncome) }}
              </span>
            </template>
            <template #count>{{ summary.activeCount.income }}</template>
          </i18n-t>
        </template>

        <template v-else>
          <p ref="headlineRef" class="text-app-income-color text-2xl font-bold tracking-tight">
            {{ headlineDisplay }}
          </p>
          <p class="text-muted-foreground mt-0.5 text-xs">
            {{
              t('dashboard.widgets.subscriptions.activeSummary', {
                count: summary.activeCount.income,
              })
            }}
          </p>
        </template>
      </div>

      <UpcomingPaymentsStrip v-if="showStrip" :days="strip.days" :total-outflow="strip.totalOutflow" />

      <div
        class="border-border/60 text-muted-foreground flex items-center justify-between gap-2 border-t pt-2 pb-1 text-xs"
      >
        <span class="font-semibold tracking-wide uppercase">{{ $t('widgets.subscriptionsOverview.listTitle') }}</span>
        <span v-if="dueCount > 0" class="text-warning-text inline-flex items-center gap-1 font-medium">
          <CircleAlertIcon class="size-3.5" />
          {{ $t('widgets.subscriptionsOverview.dueCount', { count: dueCount }) }}
        </span>
        <span v-else class="text-app-income-color inline-flex items-center gap-1 font-medium">
          <CircleCheckIcon class="size-3.5" />
          {{ $t('widgets.subscriptionsOverview.nothingDue') }}
        </span>
      </div>

      <div class="-mx-2 flex flex-col gap-0.5">
        <DesktopOnlyTooltip
          v-for="{ sub, status } in rows"
          :key="sub.id"
          :content="rowHint({ status, dueDate: sub.nextDueDate })"
          :disabled="!status"
        >
          <div
            :class="
              cn(
                'relative flex h-9 items-center gap-2.5 rounded-md px-2 transition-colors',
                status ? ROW_TONE_CLASSES[status] : 'hover:bg-muted/50',
              )
            "
          >
            <BrandLogo
              :domain="sub.logoDomain"
              :initials="sub.logoInitials"
              :color="sub.logoColor"
              :name="sub.name"
              class="size-5 shrink-0"
            />
            <router-link
              :to="{
                name: ROUTES_NAMES.plannedSubscriptionDetails,
                params: { id: sub.id },
              }"
              class="min-w-0 flex-1 truncate text-sm font-medium after:absolute after:inset-0"
            >
              {{ sub.name }}
              <span class="text-muted-foreground ml-1 text-xs font-normal">
                {{ formatDueDate({ dueDate: sub.nextDueDate }) }}
              </span>
              <span v-if="status" class="sr-only">{{ rowHint({ status, dueDate: sub.nextDueDate }) }}</span>
            </router-link>
            <span class="text-amount shrink-0 text-sm" :class="getTransactionTypeStyles(sub.transactionType, '')">
              {{ formatRowAmount({ sub }) }}
            </span>
            <UiButton
              v-if="status && sub.currentPeriod"
              variant="soft-success"
              size="icon-sm"
              class="relative z-10 size-6 shrink-0"
              :aria-label="$t('widgets.subscriptionsOverview.payAction')"
              :disabled="isMarkingPaid"
              @click="payPeriod({ subscription: sub })"
            >
              <CheckIcon class="size-3.5" />
            </UiButton>
          </div>
        </DesktopOnlyTooltip>
      </div>
    </ScrollArea>
  </WidgetWrapper>

  <!-- Mark paid dialog — rendered outside WidgetWrapper to avoid stacking context clipping -->
  <SubscriptionMarkPaidDialog ref="markPaidRef" />
</template>
