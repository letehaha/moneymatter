<script lang="ts" setup>
import TransactionsList from '@/components/transactions-list/transactions-list.vue';
import { usePendingPlannedTransactions } from '@/composable/data-queries/planned-transactions';
import { useFormatCurrency } from '@/composable/formatters';
import { useAnimatedNumber } from '@/composable/use-animated-number';
import { useBaseBalanceTotals } from '@/composable/use-base-balance-totals';
import {
  selectProjectedTotalAccounts,
  usePlannedDateLabel,
  useProjectedBalance,
} from '@/composable/use-projected-balance';
import { ScrollArea } from '@/components/lib/ui/scroll-area';
import { cn } from '@/lib/utils';
import { useAccountsStore } from '@/stores';
import { CalendarClockIcon } from '@lucide/vue';
import { useElementVisibility, useScroll } from '@vueuse/core';
import { storeToRefs } from 'pinia';
import { computed, useTemplateRef } from 'vue';

import EmptyState from './components/empty-state.vue';
import ErrorState from './components/error-state.vue';
import LoadingState from './components/loading-state.vue';
import WidgetWrapper from './components/widget-wrapper.vue';

defineOptions({ name: 'planned-overview-widget' });

const { accounts, isAccountsFetched } = storeToRefs(useAccountsStore());
const { formatBaseCurrency } = useFormatCurrency();
const { sumBaseBalance } = useBaseBalanceTotals();
const { formatPlannedDate } = usePlannedDateLabel();
const { aggregateFor, isFetching, isFetched, isError: isSummaryError, refetch: refetchSummary } = useProjectedBalance();
const {
  plans,
  isFetching: isPlansFetching,
  isPending: isPlansPending,
  isError: isPlansError,
  refetch: refetchPlans,
} = usePendingPlannedTransactions();

const scopedAccounts = computed(() => selectProjectedTotalAccounts({ accounts: accounts.value ?? [] }));
const planned = computed(() =>
  aggregateFor({
    accountIds: scopedAccounts.value.map((account) => account.id),
  }),
);

const realTotal = computed(() => sumBaseBalance({ accounts: scopedAccounts.value }));
const projectedTotal = computed(() => realTotal.value.total + planned.value.refPlannedDelta);

const { displayValue: animatedProjectedTotal } = useAnimatedNumber({
  value: projectedTotal,
});

const projectedDisplay = computed(
  () => `${realTotal.value.isApprox ? '≈ ' : ''}${formatBaseCurrency(animatedProjectedTotal.value)}`,
);
const deltaDisplay = computed(() => {
  const delta = planned.value.refPlannedDelta;
  return `${delta > 0 ? '+' : ''}${formatBaseCurrency(delta)}`;
});
const deltaColorClass = computed(() =>
  planned.value.refPlannedDelta < 0 ? 'text-app-expense-color' : 'text-app-income-color',
);
const latestPlannedDisplay = computed(() => formatPlannedDate({ time: planned.value.latestTime }));

// Ascending time, so plans whose match window has already run out lead the list.
const sortedPlans = computed(() =>
  [...plans.value].sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime()),
);

const isError = computed(() => isSummaryError.value || isPlansError.value);
const isInitialLoading = computed(() => !isFetched.value || !isAccountsFetched.value || isPlansPending.value);
const isEmpty = computed(() => planned.value.count === 0);

const scrollAreaRef = useTemplateRef<InstanceType<typeof ScrollArea>>('scrollAreaRef');
const scrollRef = computed<HTMLElement | null>(() => scrollAreaRef.value?.viewportRef?.viewportElement ?? null);
const balanceRef = useTemplateRef<HTMLElement>('balanceRef');
const { arrivedState } = useScroll(scrollRef);
const isBalanceVisible = useElementVisibility(balanceRef, {
  scrollTarget: scrollRef,
  initialValue: true,
});
const showHeaderBalance = computed(() => !!balanceRef.value && !isBalanceVisible.value);

const retry = () => {
  void refetchSummary();
  void refetchPlans();
};
</script>

<template>
  <WidgetWrapper class="max-md:max-h-96" :is-fetching="isFetching || isPlansFetching">
    <template #title>{{ $t('dashboard.widgets.plannedOverview.title') }}</template>
    <template #action>
      <span
        :aria-hidden="!showHeaderBalance"
        :class="
          cn(
            'text-sm font-semibold tabular-nums transition-opacity',
            showHeaderBalance ? 'opacity-100' : 'pointer-events-none opacity-0',
          )
        "
      >
        {{ projectedDisplay }}
      </span>
    </template>

    <template v-if="isError">
      <ErrorState :message="$t('dashboard.widgets.plannedOverview.loadFailed')" @retry="retry" />
    </template>

    <template v-else-if="isInitialLoading">
      <LoadingState />
    </template>

    <template v-else-if="isEmpty">
      <EmptyState>
        <CalendarClockIcon class="size-32" />
      </EmptyState>
    </template>

    <template v-else>
      <ScrollArea
        ref="scrollAreaRef"
        :class="
          cn(
            '-mx-2 min-h-0 flex-1',
            !arrivedState.bottom && '[mask-image:linear-gradient(to_bottom,black_calc(100%-1.75rem),transparent)]',
          )
        "
        viewport-class="px-2 md:overscroll-contain-if-scrollable"
      >
        <div class="pb-2.5">
          <p ref="balanceRef" class="text-2xl font-bold tracking-tight tabular-nums">
            {{ projectedDisplay }}
          </p>
          <div class="mt-0.5 flex flex-wrap items-baseline justify-between gap-x-2.5 text-xs">
            <span class="text-muted-foreground">
              {{
                $t('dashboard.widgets.plannedOverview.projectedBy', {
                  date: latestPlannedDisplay,
                })
              }}
            </span>
            <span class="text-amount" :class="deltaColorClass">{{ deltaDisplay }}</span>
          </div>
        </div>

        <p
          class="border-border/60 text-muted-foreground border-t pt-2 pb-1 text-xs font-semibold tracking-wide uppercase"
        >
          {{
            $t('dashboard.widgets.plannedOverview.upcoming', {
              count: planned.count,
            })
          }}
        </p>

        <TransactionsList
          raw-list
          compact
          hide-planned-marker
          :paginate="false"
          class="gap-0.5!"
          :transactions="sortedPlans"
        />
      </ScrollArea>
    </template>
  </WidgetWrapper>
</template>
