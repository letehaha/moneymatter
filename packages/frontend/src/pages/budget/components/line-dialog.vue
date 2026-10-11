<script setup lang="ts">
import { createBudgetPlanLine, updateBudgetPlanLine } from '@/api/budget-plans';
import { VUE_QUERY_CACHE_KEYS } from '@/common/const';
import ResponsiveDialog from '@/components/common/responsive-dialog.vue';
import CategoryMultiSelectField from '@/components/fields/category-multi-select-field.vue';
import InputField from '@/components/fields/input-field.vue';
import SelectField from '@/components/fields/select-field.vue';
import { Button } from '@/components/lib/ui/button';
import { useInvalidatingMutation } from '@/composable/data-queries/use-invalidating-mutation';
import { useCategoriesStore } from '@/stores';
import { BUDGET_PLAN_NAME_MAX_LENGTH, type BudgetPlanLineEntry, type BudgetPlanLineGroup } from '@bt/shared/types';
import { storeToRefs } from 'pinia';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

import { buildTakenCategories, collapseCategoryIds, expandCategoryIds } from '../line-categories';

const props = defineProps<{
  planId: string;
  line?: Pick<BudgetPlanLineEntry, 'id' | 'name' | 'groupId' | 'categoryIds'>;
  lines: BudgetPlanLineEntry[];
  /** The selected past period's lines, given with `activeFrom`: a create is checked against them too. */
  periodLines?: { lineId: string; name: string; categoryIds: string[] }[];
  activeFrom?: string;
  groups: BudgetPlanLineGroup[];
  /** Preselected group for a new line. */
  groupId?: string | null;
  /** Preselected categories for a new line. */
  initialCategoryIds?: string[];
}>();
const isOpen = defineModel<boolean>('open', { required: true });

const { t } = useI18n();
const { categoriesMap, formattedCategories } = storeToRefs(useCategoriesStore());

const NO_GROUP = 'none';

const name = ref('');
const categoryIds = ref<string[]>([]);
const selectedGroupId = ref(NO_GROUP);

const groupOptions = computed(() => [
  { value: NO_GROUP, label: t('budgetPlans.groups.noGroup') },
  ...props.groups.map((group) => ({ value: group.id, label: group.name })),
]);

const takenBy = computed(() =>
  buildTakenCategories({
    lines: [
      ...props.lines.filter((line) => line.activeUntil === null && line.id !== props.line?.id),
      ...(props.line ? [] : (props.periodLines ?? [])),
    ],
    categories: formattedCategories.value,
  }),
);

// Keeps the picker equal to what save stores: a parent with an unchecked child gets unchecked.
const setCategoryIds = ({ value }: { value: string[] }) => {
  const categories = formattedCategories.value;
  categoryIds.value = expandCategoryIds({
    categoryIds: collapseCategoryIds({ categoryIds: value, categories }),
    categories,
  });
};

// A prefilled category can cover children another line already holds; those stay out of a new line.
watch(
  isOpen,
  (open) => {
    if (!open) return;
    const [onlyCategoryId, ...otherCategoryIds] = props.initialCategoryIds ?? [];
    const categoryName = onlyCategoryId && !otherCategoryIds.length ? categoriesMap.value[onlyCategoryId]?.name : '';
    name.value = props.line?.name ?? categoryName?.slice(0, BUDGET_PLAN_NAME_MAX_LENGTH) ?? '';
    selectedGroupId.value = (props.line ? props.line.groupId : props.groupId) ?? NO_GROUP;
    const prefilled = expandCategoryIds({
      categoryIds: props.line?.categoryIds ?? props.initialCategoryIds ?? [],
      categories: formattedCategories.value,
    });
    setCategoryIds({ value: props.line ? prefilled : prefilled.filter((id) => !takenBy.value[id]) });
  },
  { immediate: true },
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

const collapsedIds = computed(() =>
  collapseCategoryIds({ categoryIds: categoryIds.value, categories: formattedCategories.value }),
);

const isPending = computed(() => create.isPending.value || update.isPending.value);
const hasTakenCategory = computed(() => {
  const own = new Set(props.line?.categoryIds);
  return collapsedIds.value.some((id) => takenBy.value[id] && !own.has(id));
});
const isSubmitDisabled = computed(
  () => isPending.value || !name.value.trim() || collapsedIds.value.length === 0 || hasTakenCategory.value,
);

const submit = () => {
  if (isSubmitDisabled.value) return;

  const { line, planId, activeFrom } = props;
  const ids = collapsedIds.value;
  const groupId = selectedGroupId.value === NO_GROUP ? null : selectedGroupId.value;
  if (!line) {
    create.mutate({ planId, payload: { name: name.value.trim(), categoryIds: ids, activeFrom, groupId } });
    return;
  }

  const payload: { name?: string; categoryIds?: string[]; groupId?: string | null } = {};
  if (groupId !== line.groupId) payload.groupId = groupId;
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

      <SelectField
        v-if="groups.length"
        :model-value="groupOptions.find((option) => option.value === selectedGroupId) ?? null"
        :values="groupOptions"
        :label="$t('budgetPlans.groups.lineGroupLabel')"
        :placeholder="$t('budgetPlans.groups.lineGroupPlaceholder')"
        @update:model-value="(option) => (selectedGroupId = option?.value ?? NO_GROUP)"
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
