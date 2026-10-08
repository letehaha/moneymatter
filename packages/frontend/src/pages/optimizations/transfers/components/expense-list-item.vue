<script setup lang="ts">
import TransactionRecord from '@/components/transactions-list/transaction-record.vue';
import { cn } from '@/lib/utils';
import type { TransactionModel, BulkTransferScanItem } from '@bt/shared/types';

defineProps<{
  item: BulkTransferScanItem;
  isSelected: boolean;
}>();

defineEmits<{
  select: [];
}>();
</script>

<template>
  <div
    :class="
      cn(
        'flex items-center gap-1 rounded-md transition-colors',
        'hover:bg-accent cursor-pointer',
        isSelected && 'bg-primary/10 ring-primary/20 ring-1',
      )
    "
    @click="$emit('select')"
  >
    <div class="pointer-events-none min-w-0 flex-1">
      <TransactionRecord :tx="item.expense as TransactionModel" :as-button="false" />
    </div>
    <div class="bg-primary/10 text-primary-text mr-2 shrink-0 rounded-full px-2 py-0.5 text-xs font-medium">
      {{ item.matches.length }}
    </div>
  </div>
</template>
