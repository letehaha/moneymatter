<template>
  <div class="grid gap-3">
    <OperationPills
      :label="$t('transactions.filters.refundsFilter.label')"
      :model-value="refundFilter"
      @update:model-value="$emit('update:refund-filter', $event)"
    />

    <OperationPills
      :label="$t('transactions.filters.transferFilter.label')"
      :model-value="transferFilter"
      @update:model-value="$emit('update:transfer-filter', $event)"
    />

    <OperationPills
      v-if="!hidePlanned"
      :label="$t('transactions.filters.plannedFilter.label')"
      :model-value="plannedFilter"
      @update:model-value="$emit('update:planned-filter', $event)"
    />
  </div>
</template>

<script lang="ts" setup>
import { FILTER_OPERATION } from '@bt/shared/types';

import OperationPills from './operation-pills.vue';

defineProps<{
  refundFilter: FILTER_OPERATION;
  transferFilter: FILTER_OPERATION;
  plannedFilter: FILTER_OPERATION;
  hidePlanned?: boolean;
}>();

defineEmits<{
  'update:refund-filter': [value: FILTER_OPERATION];
  'update:transfer-filter': [value: FILTER_OPERATION];
  'update:planned-filter': [value: FILTER_OPERATION];
}>();
</script>
