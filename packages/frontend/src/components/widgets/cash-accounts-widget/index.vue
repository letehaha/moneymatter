<script setup lang="ts">
import { getBalanceHistory, getExpensesAmountForPeriod } from '@/api';
import { VUE_QUERY_CACHE_KEYS } from '@/common/const';
import { computeAccountDisplayBalances } from '@/common/utils/account-balance';
import AccountLogo from '@/components/common/account-logo.vue';
import ResponsiveTooltip from '@/components/common/responsive-tooltip.vue';
import { buttonVariants } from '@/components/lib/ui/button';
import { ScrollArea } from '@/components/lib/ui/scroll-area';
import { DesktopOnlyTooltip } from '@/components/lib/ui/tooltip';
import { useEarliestTransactionDate } from '@/composable/data-queries/earliest-transaction-date';
import { useFormatCurrency } from '@/composable/formatters';
import { useBaseBalanceTotals } from '@/composable/use-base-balance-totals';
import { captureException } from '@/lib/sentry';
import { cn } from '@/lib/utils';
import { ROUTES_NAMES } from '@/routes/constants';
import { useAccountsStore, useRootStore } from '@/stores';
import { ArrowUpRightIcon, ShieldCheckIcon, WalletIcon } from '@lucide/vue';
import { useQuery } from '@tanstack/vue-query';
import { useElementVisibility, useScroll } from '@vueuse/core';
import { format, subMonths } from 'date-fns';
import { storeToRefs } from 'pinia';
import { computed, useTemplateRef, watch } from 'vue';

import { formatBalanceDeltaPercent } from '../balance-trend-delta';
import EmptyState from '../components/empty-state.vue';
import ErrorState from '../components/error-state.vue';
import LoadingState from '../components/loading-state.vue';
import WidgetWrapper from '../components/widget-wrapper.vue';
import { computeRunwayMonths, computeRunwayWindow, isCashAccount, sumBalancesOnDate } from './helpers';

const RUNWAY_TIERS = [
  { minMonths: 0, className: 'text-app-expense-color', labelKey: 'dashboard.widgets.cashAccounts.runwayHint.critical' },
  { minMonths: 1, className: 'text-warning-text', labelKey: 'dashboard.widgets.cashAccounts.runwayHint.low' },
  { minMonths: 3, className: 'text-app-income-color', labelKey: 'dashboard.widgets.cashAccounts.runwayHint.good' },
] as const;

const { isAppInitialized } = storeToRefs(useRootStore());
const accountsStore = useAccountsStore();
const { activeAccounts, isAccountsFetched, isAccountsError } = storeToRefs(accountsStore);
const { baseCurrencyCode, includeCreditLimit, sumBaseBalance } = useBaseBalanceTotals();
const { formatBaseCurrency, formatAccountAmount, formatCompactAmount } = useFormatCurrency();

const cashAccounts = computed(() => activeAccounts.value.filter((account) => isCashAccount({ account })));

const rows = computed(() =>
  cashAccounts.value
    .map((account) => ({
      account,
      ...computeAccountDisplayBalances({
        currentBalance: account.currentBalance,
        refCurrentBalance: account.refCurrentBalance,
        creditLimit: account.creditLimit,
        refCreditLimit: account.refCreditLimit,
        includeCreditLimit: includeCreditLimit.value,
      }),
    }))
    .filter((row) => row.displayBalance !== 0)
    .sort((a, b) => b.displayRefBalance - a.displayRefBalance),
);

const totalCash = computed(() => sumBaseBalance({ accounts: cashAccounts.value }).total);
const compactTotal = computed(() => formatCompactAmount(totalCash.value, baseCurrencyCode.value ?? ''));

const monthAgo = subMonths(new Date(), 1);
const {
  data: prevBalanceRows,
  isFetching: isPrevFetching,
  error: prevBalancesError,
} = useQuery({
  queryKey: [...VUE_QUERY_CACHE_KEYS.widgetCashAccountsPrevBalances, format(monthAgo, 'yyyy-MM-dd')],
  queryFn: () => getBalanceHistory({ from: monthAgo, to: monthAgo }),
  staleTime: Infinity,
  enabled: isAppInitialized,
});

watch(prevBalancesError, (value) => {
  if (value) captureException({ error: value, context: { scope: 'cash-accounts-widget:prev-balances' } });
});

const monthDelta = computed(() => {
  if (!prevBalanceRows.value) return null;
  const prevTotal = sumBalancesOnDate({
    rows: prevBalanceRows.value,
    accounts: cashAccounts.value,
    includeCreditLimit: includeCreditLimit.value,
  });
  const amount = totalCash.value - prevTotal;
  return { amount, percent: prevTotal > 0 ? (amount / prevTotal) * 100 : null };
});

const { earliestDate, error: earliestDateError } = useEarliestTransactionDate();
watch(earliestDateError, (value) => {
  if (value) captureException({ error: value, context: { scope: 'cash-accounts-widget:earliest-date' } });
});

const runwayWindow = computed(() => computeRunwayWindow({ now: new Date(), earliestDate: earliestDate.value }));

const {
  data: windowExpenses,
  isFetching: isExpensesFetching,
  error: expensesError,
} = useQuery({
  queryKey: [...VUE_QUERY_CACHE_KEYS.widgetCashAccountsExpenses, runwayWindow],
  queryFn: () =>
    getExpensesAmountForPeriod({
      from: runwayWindow.value?.from,
      to: runwayWindow.value?.to,
      excludePlanned: true,
    }),
  staleTime: Infinity,
  enabled: computed(() => isAppInitialized.value && !!runwayWindow.value),
});

watch(expensesError, (value) => {
  if (value) captureException({ error: value, context: { scope: 'cash-accounts-widget:runway-expenses' } });
});

const runwayMonths = computed(() =>
  runwayWindow.value && windowExpenses.value !== undefined
    ? computeRunwayMonths({
        totalCash: totalCash.value,
        totalExpenses: windowExpenses.value,
        months: runwayWindow.value.months,
      })
    : null,
);

const runwayTier = computed(() => RUNWAY_TIERS.findLast((tier) => (runwayMonths.value ?? 0) >= tier.minMonths));

const isInitialLoading = computed(() => !isAccountsFetched.value || !baseCurrencyCode.value);
const isEmpty = computed(() => isAccountsFetched.value && rows.value.length === 0);

const scrollAreaRef = useTemplateRef<InstanceType<typeof ScrollArea>>('scrollAreaRef');
const scrollRef = computed<HTMLElement | null>(() => scrollAreaRef.value?.viewportRef?.viewportElement ?? null);
const headlineRef = useTemplateRef<HTMLElement>('headlineRef');
const { arrivedState, measure } = useScroll(scrollRef);
// useScroll measures on mount and on scroll only, and the scroll area mounts after the data arrives.
watch([scrollRef, rows], () => measure(), { flush: 'post' });
const isHeadlineVisible = useElementVisibility(headlineRef, {
  scrollTarget: scrollRef,
  initialValue: true,
});
const showHeaderHeadline = computed(() => !!headlineRef.value && !isHeadlineVisible.value);
</script>

<template>
  <WidgetWrapper class="max-md:max-h-96" :is-fetching="isInitialLoading || isPrevFetching || isExpensesFetching">
    <template #title>{{ $t('dashboard.widgets.registry.cashAccounts.name') }}</template>
    <template #action>
      <span
        :aria-hidden="!showHeaderHeadline"
        :class="
          cn(
            'mr-1 flex items-center gap-1.5 text-sm font-semibold tabular-nums transition-opacity',
            showHeaderHeadline ? 'opacity-100' : 'pointer-events-none opacity-0',
          )
        "
      >
        <ShieldCheckIcon v-if="runwayMonths !== null" :class="cn('size-4 shrink-0', runwayTier?.className)" />
        {{ compactTotal }}
      </span>

      <DesktopOnlyTooltip :content="$t('common.actions.viewAll')">
        <span class="inline-flex">
          <router-link
            :class="buttonVariants({ variant: 'ghost', size: 'icon-sm', class: 'text-muted-foreground' })"
            :to="{ name: ROUTES_NAMES.accounts }"
            :aria-label="$t('common.actions.viewAll')"
          >
            <ArrowUpRightIcon class="size-4" />
          </router-link>
        </span>
      </DesktopOnlyTooltip>
    </template>

    <template v-if="isInitialLoading">
      <LoadingState />
    </template>

    <template v-else-if="isAccountsError">
      <ErrorState :message="$t('dashboard.widgets.cashAccounts.loadFailed')" @retry="accountsStore.refetchAccounts()" />
    </template>

    <template v-else-if="isEmpty">
      <EmptyState>
        <WalletIcon class="size-32" />
      </EmptyState>
    </template>

    <ScrollArea
      v-else
      ref="scrollAreaRef"
      :class="
        cn(
          '-mx-2 min-h-0 flex-1',
          !arrivedState.bottom && 'mask-[linear-gradient(to_bottom,black_calc(100%-1.75rem),transparent)]',
        )
      "
      viewport-class="px-2 md:overscroll-contain-if-scrollable"
    >
      <div class="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3 gap-y-1 pb-3">
        <DesktopOnlyTooltip :content="formatBaseCurrency(totalCash)">
          <p
            ref="headlineRef"
            class="col-start-1 row-start-1 justify-self-start text-2xl font-bold tracking-tight tabular-nums"
          >
            {{ compactTotal }}
          </p>
        </DesktopOnlyTooltip>

        <p v-if="monthDelta" class="col-start-1 row-start-2 text-xs">
          <span
            :class="
              cn(
                'font-semibold tabular-nums',
                monthDelta.amount >= 0 ? 'text-app-income-color' : 'text-app-expense-color',
              )
            "
          >
            {{ monthDelta.amount >= 0 ? '+' : '' }}{{ formatBaseCurrency(monthDelta.amount) }}
            <template v-if="monthDelta.percent !== null">
              ({{ formatBalanceDeltaPercent({ percent: monthDelta.percent }) }})
            </template>
          </span>
          <span class="text-muted-foreground ml-1">{{ $t('dashboard.widgets.cashAccounts.vsLastMonth') }}</span>
        </p>

        <div
          v-if="runwayMonths !== null"
          class="col-start-2 row-span-2 row-start-1 flex items-center gap-2 self-center"
        >
          <ResponsiveTooltip :delay-duration="100" content-class-name="max-w-80">
            <span class="inline-flex shrink-0 cursor-help">
              <ShieldCheckIcon :class="cn('size-9', runwayTier?.className)" />
            </span>
            <template #content>
              <div class="flex flex-col gap-2 text-sm">
                <p>{{ $t('dashboard.widgets.cashAccounts.runwayHint.description') }}</p>
                <ul class="flex flex-col gap-1">
                  <li
                    v-for="tier in RUNWAY_TIERS"
                    :key="tier.labelKey"
                    class="flex items-center gap-2 whitespace-nowrap"
                  >
                    <ShieldCheckIcon :class="cn('size-4 shrink-0', tier.className)" />
                    {{ $t(tier.labelKey) }}
                  </li>
                </ul>
              </div>
            </template>
          </ResponsiveTooltip>
          <div class="flex flex-col">
            <p class="text-xl leading-tight font-bold tabular-nums">
              ~{{ runwayMonths.toFixed(1) }}
              <span class="text-muted-foreground text-sm font-medium">
                {{ $t('dashboard.widgets.cashAccounts.runwayUnit') }}
              </span>
            </p>
            <p class="text-muted-foreground text-xs">{{ $t('dashboard.widgets.cashAccounts.runwayLabel') }}</p>
          </div>
        </div>
      </div>

      <div class="-mx-2 flex flex-col gap-0.5">
        <router-link
          v-for="row in rows"
          :key="row.account.id"
          :to="{ name: ROUTES_NAMES.account, params: { id: row.account.id } }"
          class="hover:bg-hover flex items-center gap-2.5 rounded-md px-2 py-1.5 transition-colors"
        >
          <AccountLogo :account="row.account" class="size-6 shrink-0 rounded-md" />
          <span class="min-w-0 flex-1 truncate text-sm font-medium">{{ row.account.name }}</span>
          <span class="flex shrink-0 flex-col items-end">
            <span :class="cn('text-amount text-sm', row.displayRefBalance < 0 && 'text-destructive-text')">
              {{ formatBaseCurrency(row.displayRefBalance) }}
            </span>
            <span v-if="row.account.currencyCode !== baseCurrencyCode" class="text-muted-foreground text-xs">
              {{ formatAccountAmount({ amount: row.displayBalance, account: row.account }) }}
            </span>
          </span>
        </router-link>
      </div>
    </ScrollArea>
  </WidgetWrapper>
</template>
