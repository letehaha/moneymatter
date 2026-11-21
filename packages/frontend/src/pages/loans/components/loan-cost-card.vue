<template>
  <Card class="@container/loan-cost">
    <CardHeader class="pb-3">
      <div class="text-base font-semibold">{{ $t('loans.detail.paidOff.cost.title') }}</div>
    </CardHeader>
    <CardContent>
      <div class="text-3xl font-semibold tracking-tight">{{ formatCurrency(costSplit.total) }}</div>
      <div class="text-muted-foreground mt-1 text-xs">{{ $t('loans.detail.paidOff.cost.totalLabel') }}</div>

      <!-- Split bar: principal vs. estimated interest, proportional, with a 2px gap between segments. -->
      <div class="mt-5 flex h-2.5 w-full gap-0.5 overflow-hidden">
        <div class="bg-loan-principal h-full rounded-full" :style="{ width: `${costSplit.principalPercent}%` }" />
        <div
          v-if="costSplit.hasInterest"
          class="bg-loan-interest h-full rounded-full"
          :style="{ width: `${costSplit.interestPercent}%` }"
        />
      </div>

      <div class="mt-4 grid grid-cols-1 gap-3 @sm/loan-cost:grid-cols-2">
        <div class="flex items-center gap-2">
          <span class="bg-loan-principal size-2.5 shrink-0 rounded-full" aria-hidden="true" />
          <div class="min-w-0">
            <div class="text-muted-foreground text-xs">{{ $t('loans.detail.paidOff.cost.principal') }}</div>
            <div class="text-sm font-medium tabular-nums">{{ formatCurrency(costSplit.principal) }}</div>
          </div>
        </div>
        <div class="flex items-center gap-2">
          <span class="bg-loan-interest size-2.5 shrink-0 rounded-full" aria-hidden="true" />
          <div class="min-w-0">
            <div class="text-muted-foreground text-xs">{{ $t('loans.detail.paidOff.cost.interest') }}</div>
            <div class="text-sm font-medium tabular-nums">{{ interestDisplay }}</div>
          </div>
        </div>
      </div>

      <p class="text-muted-foreground mt-4 text-xs">{{ $t('loans.detail.paidOff.cost.estimateFootnote') }}</p>
      <p v-if="costSplit.interestToPrincipalRatio !== null" class="text-muted-foreground mt-1 text-xs">
        {{
          $t('loans.detail.paidOff.cost.effectiveCost', {
            percent: $n(costSplit.interestToPrincipalRatio, { style: 'percent', maximumFractionDigits: 1 }),
          })
        }}
      </p>
    </CardContent>
  </Card>
</template>

<script setup lang="ts">
import type { LoanApi } from '@/api/loans';
import { Card, CardContent, CardHeader } from '@/components/lib/ui/card';
import { useFormatCurrency } from '@/composable/formatters';
import { computed } from 'vue';

import { getLoanCostSplit } from '../utils/paid-off-stats';

const props = defineProps<{ loan: LoanApi }>();

const { formatAmountByCurrencyCode } = useFormatCurrency();

const formatCurrency = (amount: number) =>
  formatAmountByCurrencyCode({ amount, currencyCode: props.loan.currencyCode });

const costSplit = computed(() =>
  getLoanCostSplit({
    principal: props.loan.loanDetails.originalPrincipal,
    estimatedInterest: props.loan.projection.estimatedInterestPaid,
  }),
);

const interestDisplay = computed(() => (costSplit.value.hasInterest ? formatCurrency(costSplit.value.interest) : '—'));
</script>
