<template>
  <ResponsiveTooltip
    v-if="transaction.refAmountMissing"
    :content="$t('common.transactions.record.missingRateTooltip')"
    content-class-name="max-w-64"
    :delay-duration="100"
  >
    <span
      class="bg-warning/15 text-warning-text inline-flex shrink-0 cursor-help items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium"
      data-testid="missing-rate-badge"
    >
      <TriangleAlertIcon class="size-3" aria-hidden="true" />
      {{ $t('common.transactions.record.missingRate') }}
    </span>
  </ResponsiveTooltip>
</template>

<script lang="ts" setup>
import ResponsiveTooltip from '@/components/common/responsive-tooltip.vue';
import type { TransactionModel } from '@bt/shared/types';
import { TriangleAlertIcon } from '@lucide/vue';

defineProps<{
  transaction: Pick<TransactionModel, 'refAmountMissing'>;
}>();
</script>
