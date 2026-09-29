<script setup lang="ts">
import ResponsiveAlertDialog from '@/components/common/responsive-alert-dialog.vue';
import type { RecordId } from '@bt/shared/types';

import { useReconciliationActions } from '../use-reconciliation';

const props = defineProps<{ transactionIds: RecordId[] }>();
const open = defineModel<boolean>('open', { required: true });
const emit = defineEmits<{ removed: [] }>();

const { remove } = useReconciliationActions();

const confirm = () => {
  remove.mutate(
    { transactionIds: props.transactionIds },
    {
      onSuccess: () => {
        open.value = false;
        emit('removed');
      },
    },
  );
};
</script>

<template>
  <ResponsiveAlertDialog
    v-model:open="open"
    :confirm-label="$t('optimizations.reconciliation.remove.confirm')"
    confirm-variant="destructive"
    :confirm-disabled="remove.isPending.value"
    @confirm="confirm"
  >
    <template #title>
      {{ $t('optimizations.reconciliation.remove.title', { count: transactionIds.length }, transactionIds.length) }}
    </template>
    <template #description>{{ $t('optimizations.reconciliation.remove.description') }}</template>
  </ResponsiveAlertDialog>
</template>
