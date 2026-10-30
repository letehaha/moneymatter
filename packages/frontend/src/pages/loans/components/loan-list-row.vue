<template>
  <RouterLink
    :to="{ name: ROUTES_NAMES.loanDetail, params: { id: loan.id } }"
    :class="
      cn(
        LOAN_LIST_GRID_COLS,
        'hover:bg-muted/40 focus-visible:ring-ring/40 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-y-3 px-4 py-4',
        'transition-colors focus-visible:ring-2 focus-visible:outline-none @[56rem]/loans-list:py-3.5',
      )
    "
  >
    <div class="flex min-w-0 items-center gap-3">
      <LoanLogo :loan="loan" class="size-9" />
      <div class="min-w-0">
        <div class="flex min-w-0 items-center gap-2">
          <span class="truncate text-sm font-semibold">{{ loan.name }}</span>
          <span
            v-if="loan.projection.isPaidOff"
            class="bg-app-income-color/15 text-app-income-color shrink-0 rounded-full px-2 py-0.5 text-[9px] font-medium tracking-wider uppercase"
          >
            {{ $t('loans.detail.paidOffBadge') }}
          </span>
          <DesktopOnlyTooltip v-if="loan.projection.warning" :content="$t(`loans.warnings.${loan.projection.warning}`)">
            <TriangleAlertIcon class="text-app-expense-color size-3.5 shrink-0" />
          </DesktopOnlyTooltip>
        </div>
        <div class="text-muted-foreground mt-0.5 truncate text-xs">{{ subLine }}</div>
      </div>
    </div>

    <div class="col-span-2 row-start-2 min-w-0 @[56rem]/loans-list:col-span-1 @[56rem]/loans-list:row-start-auto">
      <div class="bg-muted relative h-1.5 overflow-hidden rounded-full">
        <div
          class="from-app-income-color/60 to-app-income-color absolute inset-y-0 left-0 rounded-full bg-linear-to-r"
          :style="{ width: `${progressBarWidth}%` }"
        />
      </div>
      <div class="mt-1.5 flex items-baseline justify-between gap-2 text-[11px]">
        <span class="text-app-income-color font-semibold tabular-nums">{{ paidPercentDisplay }}</span>
        <span v-if="monthsLeftDisplay" class="text-muted-foreground tabular-nums">{{ monthsLeftDisplay }}</span>
      </div>
    </div>

    <div
      class="col-start-2 row-start-1 text-right @[56rem]/loans-list:col-start-auto @[56rem]/loans-list:row-start-auto"
    >
      <div class="text-sm font-semibold tabular-nums">{{ balanceDisplay }}</div>
      <div class="text-muted-foreground mt-0.5 text-[11px] tabular-nums">
        {{ $t('loans.list.ofPrincipal', { amount: originalPrincipalDisplay }) }}
      </div>
    </div>

    <div class="hidden text-right text-sm font-medium tabular-nums @[56rem]/loans-list:block">{{ aprDisplay }}</div>
    <div class="hidden text-right text-sm font-medium tabular-nums @[56rem]/loans-list:block">{{ monthlyDisplay }}</div>
    <div class="hidden text-right text-sm font-medium tabular-nums @[56rem]/loans-list:block">
      {{ payoffDateDisplay }}
    </div>
    <div class="hidden text-right text-sm font-medium tabular-nums @[56rem]/loans-list:block">
      {{ interestRemainingDisplay }}
    </div>

    <ChevronRightIcon class="text-muted-foreground hidden size-3.5 @[56rem]/loans-list:block" aria-hidden="true" />

    <div
      class="text-muted-foreground col-span-2 row-start-3 flex flex-wrap gap-x-5 gap-y-1 text-xs @[56rem]/loans-list:hidden"
    >
      <span>
        {{ $t('loans.list.columns.apr') }}
        <span class="text-foreground font-medium tabular-nums">{{ aprDisplay }}</span>
      </span>
      <span>
        {{ $t('loans.list.columns.monthly') }}
        <span class="text-foreground font-medium tabular-nums">{{ monthlyDisplay }}</span>
      </span>
      <span>
        {{ $t('loans.list.columns.payoff') }}
        <span class="text-foreground font-medium tabular-nums">{{ payoffDateDisplay }}</span>
      </span>
      <span>
        {{ $t('loans.list.columns.interestLeft') }}
        <span class="text-foreground font-medium tabular-nums">{{ interestRemainingDisplay }}</span>
      </span>
    </div>
  </RouterLink>
</template>

<script setup lang="ts">
import type { LoanApi } from '@/api/loans';
import LoanLogo from '@/components/common/loan-logo.vue';
import { DesktopOnlyTooltip } from '@/components/lib/ui/tooltip';
import { useFormatCurrency } from '@/composable/formatters';
import { cn } from '@/lib/utils';
import { ROUTES_NAMES } from '@/routes';
import { ChevronRightIcon, TriangleAlertIcon } from '@lucide/vue';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink } from 'vue-router';

import { useLoanProjectionDisplay } from '../composables/use-loan-projection-display';
import { outstandingAmount } from '../utils/outstanding-amount';
import { LOAN_LIST_GRID_COLS } from './loan-list-grid';

const props = defineProps<{ loan: LoanApi }>();

const { formatAmountByCurrencyCode } = useFormatCurrency();
const { t } = useI18n();

const balanceDisplay = computed(() =>
  formatAmountByCurrencyCode(outstandingAmount({ balance: props.loan.currentBalance }), props.loan.currencyCode),
);

const originalPrincipalDisplay = computed(() =>
  formatAmountByCurrencyCode(props.loan.loanDetails.originalPrincipal, props.loan.currencyCode),
);

const aprDisplay = computed(() => `${props.loan.loanDetails.interestRate.toFixed(2)}%`);

const monthlyDisplay = computed(() => {
  const planned = props.loan.loanDetails.plannedPayment;
  if (planned === null) return '—';
  return formatAmountByCurrencyCode(planned, props.loan.currencyCode);
});

const interestRemainingDisplay = computed(() => {
  const interest = props.loan.projection.totalInterestRemaining;
  if (interest === null) return '—';
  return formatAmountByCurrencyCode(interest, props.loan.currencyCode);
});

const { progressBarWidth, payoffDateDisplay } = useLoanProjectionDisplay({
  loan: () => props.loan,
  payoffDateFormat: 'MMM yyyy',
});

const paidPercentDisplay = computed(() =>
  t('loans.list.paidPercent', { value: props.loan.projection.paidToDatePercent.toFixed(1) }),
);

const monthsLeftDisplay = computed(() => {
  const months = props.loan.projection.monthsRemaining;
  if (months === null || props.loan.projection.isPaidOff) return null;
  return t('loans.list.monthsLeft', { count: months });
});

const subLine = computed(() => {
  const typeLabel = t(`loans.types.${props.loan.loanDetails.loanType}`);
  const lender = props.loan.loanDetails.lenderName;
  return lender ? `${typeLabel} · ${lender}` : `${typeLabel} · ${props.loan.currencyCode}`;
});
</script>
