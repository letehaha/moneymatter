<script setup lang="ts">
import ResponsiveAlertDialog from '@/components/common/responsive-alert-dialog.vue';
import { useDeleteGoal } from '@/composable/data-queries/goals';
import type { RecordId } from '@bt/shared/types';

const props = defineProps<{ goalId: RecordId }>();
const open = defineModel<boolean>('open', { required: true });
const emit = defineEmits<{ deleted: [] }>();

const remove = useDeleteGoal();

const confirm = () =>
  remove.mutate(
    { goalId: props.goalId },
    {
      onSuccess: () => {
        open.value = false;
        emit('deleted');
      },
    },
  );
</script>

<template>
  <ResponsiveAlertDialog
    v-model:open="open"
    :confirm-label="$t('goals.actions.delete')"
    confirm-variant="destructive"
    :confirm-disabled="remove.isPending.value"
    @confirm="confirm"
  >
    <template #title>{{ $t('goals.deleteDialog.title') }}</template>
    <template #description>{{ $t('goals.deleteDialog.description') }}</template>
  </ResponsiveAlertDialog>
</template>
