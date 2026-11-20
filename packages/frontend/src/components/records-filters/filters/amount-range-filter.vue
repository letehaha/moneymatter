<template>
  <div :class="['flex', !joined && 'gap-2']">
    <InputField
      :model-value="amountGte"
      type="number"
      only-positive
      :label="compact ? undefined : $t('transactions.filters.amountRange.from')"
      :placeholder="
        compact
          ? $t('transactions.filters.amountRange.compactFrom')
          : $t('transactions.filters.amountRange.placeholderFrom')
      "
      :size="size"
      :class="joined ? 'flex-1 rounded-r-none border-r-0' : 'flex-1'"
      @update:model-value="$emit('update:amount-gte', $event)"
    />
    <InputField
      :model-value="amountLte"
      type="number"
      only-positive
      :label="compact ? undefined : $t('transactions.filters.amountRange.to')"
      :placeholder="
        compact
          ? $t('transactions.filters.amountRange.compactTo')
          : $t('transactions.filters.amountRange.placeholderTo')
      "
      :size="size"
      :class="joined ? 'flex-1 rounded-none border-r-0' : 'flex-1'"
      @update:model-value="$emit('update:amount-lte', $event)"
    />
  </div>
</template>

<script lang="ts" setup>
import InputField from '@/components/fields/input-field.vue';
import { type ControlSize } from '@/components/lib/ui/control-size';
import { type PropType } from 'vue';

defineProps({
  amountGte: {
    type: Number,
    default: null,
  },
  amountLte: {
    type: Number,
    default: null,
  },
  /** Label-less variant for the inline filters toolbar; placeholders carry the meaning instead. */
  compact: {
    type: Boolean,
    default: false,
  },
  /**
   * Fuse min/max into what reads as a single field: no gap, squared inner
   * corners, and the max input's left border doubles as the divider line.
   * The right edge is left open (no border/rounding) for the host to attach
   * a trailing segment — the filter bar's remove button.
   */
  joined: {
    type: Boolean,
    default: false,
  },
  size: {
    type: String as PropType<ControlSize>,
  },
});

defineEmits(['update:amount-gte', 'update:amount-lte']);
</script>
