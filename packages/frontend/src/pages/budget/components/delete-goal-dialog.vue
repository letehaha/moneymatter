<script setup lang="ts">
import { deleteBudgetLineGoal } from '@/api/budget-plans';
import { VUE_QUERY_CACHE_KEYS } from '@/common/const';
import ResponsiveAlertDialog from '@/components/common/responsive-alert-dialog.vue';
import { useInvalidatingMutation } from '@/composable/data-queries/use-invalidating-mutation';
import type { BudgetPlanPeriodViewLine } from '@bt/shared/types';

const props = defineProps<{ planId: string; line: Pick<BudgetPlanPeriodViewLine, 'lineId' | 'name'> }>();

const isOpen = defineModel<boolean>('open', { required: true });

const { isPending, mutate } = useInvalidatingMutation({
  mutationFn: deleteBudgetLineGoal,
  invalidateKeys: [VUE_QUERY_CACHE_KEYS.budgetPlans],
  successKey: 'budgetPlans.goals.deleted',
  errorKey: 'budgetPlans.goals.deleteError',
  onSuccess: () => {
    isOpen.value = false;
  },
});

const confirm = () => {
  if (isPending.value) return;
  mutate({ planId: props.planId, lineId: props.line.lineId });
};
</script>

<template>
  <ResponsiveAlertDialog
    v-model:open="isOpen"
    :confirm-label="$t('budgetPlans.goals.delete')"
    confirm-variant="destructive"
    :confirm-disabled="isPending"
    @confirm="confirm"
  >
    <template #title>{{ $t('budgetPlans.goals.deleteTitle') }}</template>
    <template #description>{{ $t('budgetPlans.goals.deleteDescription', { line: line.name }) }}</template>
  </ResponsiveAlertDialog>
</template>
