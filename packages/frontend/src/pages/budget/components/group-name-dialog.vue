<script setup lang="ts">
import { createBudgetLineGroup, updateBudgetLineGroup } from '@/api/budget-plans';
import { VUE_QUERY_CACHE_KEYS } from '@/common/const';
import ResponsiveDialog from '@/components/common/responsive-dialog.vue';
import InputField from '@/components/fields/input-field.vue';
import { Button } from '@/components/lib/ui/button';
import { useInvalidatingMutation } from '@/composable/data-queries/use-invalidating-mutation';
import { BUDGET_PLAN_NAME_MAX_LENGTH, type BudgetPlanLineGroup } from '@bt/shared/types';
import { computed, ref, watch } from 'vue';

const props = defineProps<{
  planId: string;
  /** Renames this group; creates a new one when omitted. */
  group?: BudgetPlanLineGroup | null;
}>();
const isOpen = defineModel<boolean>('open', { required: true });

const name = ref('');

watch(isOpen, (open) => {
  if (open) name.value = props.group?.name ?? '';
});

const close = () => {
  isOpen.value = false;
};

const create = useInvalidatingMutation({
  mutationFn: createBudgetLineGroup,
  invalidateKeys: [VUE_QUERY_CACHE_KEYS.budgetPlans],
  successKey: 'budgetPlans.groups.created',
  errorKey: 'budgetPlans.groups.error',
  onSuccess: close,
});
const update = useInvalidatingMutation({
  mutationFn: updateBudgetLineGroup,
  invalidateKeys: [VUE_QUERY_CACHE_KEYS.budgetPlans],
  successKey: 'budgetPlans.groups.updated',
  errorKey: 'budgetPlans.groups.error',
  onSuccess: close,
});

const isPending = computed(() => create.isPending.value || update.isPending.value);
const isSubmitDisabled = computed(() => isPending.value || !name.value.trim());

const submit = () => {
  if (isSubmitDisabled.value) return;
  const trimmed = name.value.trim();
  if (!props.group) return create.mutate({ planId: props.planId, name: trimmed });
  if (trimmed === props.group.name) return close();
  update.mutate({ planId: props.planId, groupId: props.group.id, name: trimmed });
};
</script>

<template>
  <ResponsiveDialog v-model:open="isOpen">
    <template #title>
      {{ group ? $t('budgetPlans.groups.editTitle') : $t('budgetPlans.groups.createTitle') }}
    </template>

    <form class="grid gap-4" @submit.prevent="submit">
      <InputField
        :model-value="name"
        :label="$t('budgetPlans.groups.nameLabel')"
        :placeholder="$t('budgetPlans.groups.namePlaceholder')"
        :maxlength="BUDGET_PLAN_NAME_MAX_LENGTH"
        @update:model-value="(value) => (name = String(value ?? ''))"
      />

      <Button type="submit" :disabled="isSubmitDisabled">{{ $t('common.actions.save') }}</Button>
    </form>
  </ResponsiveDialog>
</template>
