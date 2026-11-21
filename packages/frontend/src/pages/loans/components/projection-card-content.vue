<template>
  <div class="space-y-5">
    <div>
      <div class="mb-1.5 flex items-center justify-between text-xs">
        <span class="text-muted-foreground">{{ $t('loans.detail.projection.paidLabel') }}</span>
        <span class="font-medium">{{ paidPercentDisplay }}</span>
      </div>
      <div class="bg-muted h-2 w-full overflow-hidden rounded-full">
        <div
          class="bg-app-income-color h-full rounded-full transition-[width] duration-300"
          :style="{ width: `${progressBarWidth}%` }"
        />
      </div>
      <div class="text-muted-foreground mt-1.5 text-xs">
        {{
          $t('loans.detail.projection.paidOfOriginal', {
            paid: formatCurrency(loan.projection.paidToDate),
            original: formatCurrency(loan.loanDetails.originalPrincipal),
          })
        }}
      </div>
    </div>

    <div
      v-if="loan.projection.warning"
      class="text-app-expense-color bg-app-expense-color/10 rounded px-3 py-2 text-xs"
    >
      {{ $t(`loans.warnings.${loan.projection.warning}`) }}
    </div>

    <div class="grid grid-cols-2 gap-4 text-sm">
      <div>
        <div class="text-muted-foreground text-xs">{{ $t('loans.detail.projection.payoffDate') }}</div>
        <div class="mt-0.5 font-medium">{{ payoffDateDisplay }}</div>
      </div>
      <div>
        <div class="text-muted-foreground text-xs">{{ $t('loans.detail.projection.monthsRemaining') }}</div>
        <div class="mt-0.5 font-medium">{{ monthsRemainingDisplay }}</div>
      </div>
      <div>
        <div class="text-muted-foreground text-xs">{{ $t('loans.detail.projection.totalInterestRemaining') }}</div>
        <div class="mt-0.5 font-medium">{{ formatCurrency(loan.projection.totalInterestRemaining) }}</div>
      </div>
      <div>
        <div class="text-muted-foreground text-xs">{{ $t('loans.detail.projection.nextMonthInterest') }}</div>
        <div class="mt-0.5 font-medium">{{ formatCurrency(loan.projection.monthlyInterest) }}</div>
      </div>
      <div>
        <div class="text-muted-foreground text-xs">{{ $t('loans.detail.projection.nextMonthPrincipal') }}</div>
        <div class="mt-0.5 font-medium">{{ formatCurrency(loan.projection.monthlyPrincipal) }}</div>
      </div>
      <div>
        <div class="text-muted-foreground text-xs">{{ $t('loans.detail.projection.plannedPayment') }}</div>
        <div class="mt-0.5 font-medium">{{ formatCurrency(loan.loanDetails.plannedPayment) }}</div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { LoanApi } from '@/api/loans';
import { useFormatCurrency } from '@/composable/formatters';
import { computed } from 'vue';

import { useLoanProjectionDisplay } from '../composables/use-loan-projection-display';

const props = defineProps<{ loan: LoanApi }>();

const { formatAmountByCurrencyCode } = useFormatCurrency();

const currency = computed(() => props.loan.currencyCode);

const formatCurrency = (amount: number | null) => {
  if (amount === null) return '—';
  return formatAmountByCurrencyCode({ amount, currencyCode: currency.value });
};

const paidPercentDisplay = computed(() => `${props.loan.projection.paidToDatePercent.toFixed(1)}%`);

const { progressBarWidth, monthsRemainingDisplay, payoffDateDisplay } = useLoanProjectionDisplay({
  loan: () => props.loan,
  payoffDateFormat: 'MMM d, yyyy',
});
</script>
