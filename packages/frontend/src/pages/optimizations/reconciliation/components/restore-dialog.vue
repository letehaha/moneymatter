<script setup lang="ts">
import ResponsiveAlertDialog from '@/components/common/responsive-alert-dialog.vue';
import type { RecordId } from '@bt/shared/types';

defineProps<{ transactionIds: RecordId[]; pending: boolean }>();
const emit = defineEmits<{ confirm: [] }>();
const open = defineModel<boolean>('open', { required: true });
</script>

<template>
  <ResponsiveAlertDialog
    v-model:open="open"
    :confirm-label="$t('optimizations.reconciliation.restoreDialog.confirm')"
    :confirm-disabled="pending"
    @confirm="emit('confirm')"
  >
    <template #title>
      {{
        $t('optimizations.reconciliation.restoreDialog.title', { count: transactionIds.length }, transactionIds.length)
      }}
    </template>
    <template #description>{{ $t('optimizations.reconciliation.restoreDialog.description') }}</template>
  </ResponsiveAlertDialog>
</template>
