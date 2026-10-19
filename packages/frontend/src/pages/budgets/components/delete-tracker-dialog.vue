<script setup lang="ts">
import ResponsiveAlertDialog from '@/components/common/responsive-alert-dialog.vue';

import { useTrackerActions } from './use-tracker-actions';

const props = defineProps<{ budgetId: string; redirect?: boolean }>();
const open = defineModel<boolean>('open', { required: true });

const { remove } = useTrackerActions();

const confirm = () =>
  remove.mutate({ budgetId: props.budgetId, redirect: props.redirect }, { onSuccess: () => (open.value = false) });
</script>

<template>
  <ResponsiveAlertDialog
    v-model:open="open"
    :confirm-label="$t('budgets.list.delete')"
    confirm-variant="destructive"
    :confirm-disabled="remove.isPending.value"
    @confirm="confirm"
  >
    <template #title>{{ $t('budgets.list.deleteDialog.title') }}</template>
    <template #description>{{ $t('budgets.list.deleteDialog.description') }}</template>
  </ResponsiveAlertDialog>
</template>
