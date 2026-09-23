<script setup lang="ts">
import { createBudgetPlanLine, updateBudgetPlanLine } from '@/api/budget-plans';
import { VUE_QUERY_CACHE_KEYS } from '@/common/const';
import ResponsiveDialog from '@/components/common/responsive-dialog.vue';
import CategoryMultiSelectField from '@/components/fields/category-multi-select-field.vue';
import InputField from '@/components/fields/input-field.vue';
import { Button } from '@/components/lib/ui/button';
import { useInvalidatingMutation } from '@/composable/data-queries/use-invalidating-mutation';
import { useCategoriesStore } from '@/stores';
import { BUDGET_PLAN_NAME_MAX_LENGTH, type BudgetPlanLineEntry } from '@bt/shared/types';
import { storeToRefs } from 'pinia';
import { computed, ref, watch } from 'vue';

import { buildTakenCategories, collapseCategoryIds, expandCategoryIds } from '../line-categories';

const props = defineProps<{
  planId: string;
  line?: BudgetPlanLineEntry;
  lines: BudgetPlanLineEntry[];
  /** The selected past period's lines, given with `activeFrom`: a create is checked against them too. */
  periodLines?: { lineId: string; name: string; categoryIds: string[] }[];
  activeFrom?: string;
}>();
const isOpen = defineModel<boolean>('open', { required: true });

const { formattedCategories } = storeToRefs(useCategoriesStore());

const name = ref('');
const categoryIds = ref<string[]>([]);

watch(
  isOpen,
  (open) => {
    if (!open) return;
    name.value = props.line?.name ?? '';
    categoryIds.value = expandCategoryIds({
      categoryIds: props.line?.categoryIds ?? [],
      categories: formattedCategories.value,
    });
  },
  { immediate: true },
);

const takenBy = computed(() =>
  buildTakenCategories({
    lines: [
      ...props.lines.filter((line) => line.activeUntil === null && line.id !== props.line?.id),
      ...(props.line ? [] : (props.periodLines ?? [])),
    ],
    categories: formattedCategories.value,
  }),
);

const close = () => {
  isOpen.value = false;
};

const create = useInvalidatingMutation({
  mutationFn: createBudgetPlanLine,
  invalidateKeys: [VUE_QUERY_CACHE_KEYS.budgetPlans],
  successKey: 'budgetPlans.line.created',
  errorKey: 'budgetPlans.line.error',
  onSuccess: close,
});
const update = useInvalidatingMutation({
  mutationFn: updateBudgetPlanLine,
  invalidateKeys: [VUE_QUERY_CACHE_KEYS.budgetPlans],
  successKey: 'budgetPlans.line.updated',
  errorKey: 'budgetPlans.line.error',
  onSuccess: close,
});

// Keeps the picker equal to what save stores: a parent with an unchecked child gets unchecked.
const setCategoryIds = ({ value }: { value: string[] }) => {
  const categories = formattedCategories.value;
  categoryIds.value = expandCategoryIds({
    categoryIds: collapseCategoryIds({ categoryIds: value, categories }),
    categories,
  });
};

const collapsedIds = computed(() =>
  collapseCategoryIds({ categoryIds: categoryIds.value, categories: formattedCategories.value }),
);

const isPending = computed(() => create.isPending.value || update.isPending.value);
const isSubmitDisabled = computed(() => isPending.value || !name.value.trim() || collapsedIds.value.length === 0);

const submit = () => {
  if (isSubmitDisabled.value) return;

  const { line, planId, activeFrom } = props;
  const ids = collapsedIds.value;
  if (!line) {
    create.mutate({ planId, payload: { name: name.value.trim(), categoryIds: ids, activeFrom } });
    return;
  }

  const payload: { name?: string; categoryIds?: string[] } = {};
  if (name.value.trim() !== line.name) payload.name = name.value.trim();
  const storedIds = new Set(line.categoryIds);
  if (ids.length !== storedIds.size || ids.some((id) => !storedIds.has(id))) {
    payload.categoryIds = ids;
  }

  if (!Object.keys(payload).length) {
    close();
    return;
  }
  update.mutate({ planId, lineId: line.id, payload });
};
</script>

<template>
  <ResponsiveDialog v-model:open="isOpen">
    <template #title>{{ line ? $t('budgetPlans.line.editTitle') : $t('budgetPlans.line.createTitle') }}</template>

    <form class="grid gap-4" @submit.prevent="submit">
      <InputField
        :model-value="name"
        :label="$t('budgetPlans.line.nameLabel')"
        :placeholder="$t('budgetPlans.line.namePlaceholder')"
        :maxlength="BUDGET_PLAN_NAME_MAX_LENGTH"
        @update:model-value="(value) => (name = String(value ?? ''))"
      />

      <CategoryMultiSelectField
        :model-value="categoryIds"
        :label="$t('budgetPlans.line.categoriesLabel')"
        :placeholder="$t('budgetPlans.line.categoriesPlaceholder')"
        :taken-by="takenBy"
        :chip-ids="collapsedIds"
        @update:model-value="(value) => setCategoryIds({ value })"
      />

      <Button type="submit" :disabled="isSubmitDisabled">{{ $t('common.actions.save') }}</Button>
    </form>
  </ResponsiveDialog>
</template>
