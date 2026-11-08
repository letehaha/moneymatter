<script setup lang="ts">
import TransactionRecord from '@/components/transactions-list/transaction-record.vue';
import { cn } from '@/lib/utils';
import type { TrashEntry } from '@bt/shared/types';
import { computed } from 'vue';

import { getOtherLeg, getPrimaryTransaction } from '../helpers';

const props = defineProps<{
  entry: TrashEntry;
  /** Left undefined when rows open a sheet instead of toggling a side panel, so `aria-pressed` is omitted. */
  selected?: boolean;
}>();

const emit = defineEmits<{ select: [] }>();

const tx = computed(() => getPrimaryTransaction({ entry: props.entry }));

const select = () => emit('select');
</script>

<template>
  <div
    role="button"
    tabindex="0"
    :aria-pressed="selected"
    :class="
      cn(
        'hover:bg-muted/50 focus-visible:ring-ring flex cursor-pointer items-center gap-2 px-2 py-1 transition-colors focus-visible:ring-2 focus-visible:outline-hidden focus-visible:ring-inset',
        selected && 'bg-primary/10 hover:bg-primary/15 shadow-[inset_3px_0_0_var(--primary)]',
      )
    "
    @click="select"
    @keydown.enter.self="select"
    @keydown.space.self.prevent="select"
  >
    <TransactionRecord
      :tx="tx"
      :opposite-tx="getOtherLeg({ entry })"
      :as-button="false"
      show-account
      class="min-w-0 flex-1 hover:bg-transparent!"
    />
  </div>
</template>
