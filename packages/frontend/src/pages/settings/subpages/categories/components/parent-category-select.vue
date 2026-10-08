<template>
  <div class="grid gap-1.5">
    <SelectField
      :model-value="selectedOption"
      :values="options"
      :label-key="optionLabel"
      :value-key="optionValue"
      :label="$t('settings.categories.parentField.label')"
      :placeholder="$t('settings.categories.parentField.placeholder')"
      with-search
      @update:model-value="
        (option) => emit('update:modelValue', option?.kind === 'category' ? option.category.id : null)
      "
    >
      <template #item="{ item, label }">
        <span
          class="flex min-w-0 items-center gap-2"
          :style="{ paddingLeft: `${(item.kind === 'category' && item.depth > 1 ? item.depth - 1 : 0) * 16}px` }"
        >
          <CornerDownRightIcon
            v-if="item.kind === 'category' && item.depth > 1"
            class="text-muted-foreground size-3.5 shrink-0"
          />
          <CategoryCircle v-if="item.kind === 'category'" :category="item.category" />
          <span class="truncate">{{ label }}</span>
        </span>
      </template>
    </SelectField>

    <p class="text-muted-foreground text-xs">{{ $t('settings.categories.parentField.hiddenHint') }}</p>
  </div>
</template>

<script setup lang="ts">
import { type FormattedCategory } from '@/common/types';
import CategoryCircle from '@/components/common/category-circle.vue';
import SelectField from '@/components/fields/select-field.vue';
import { useCategoriesStore } from '@/stores';
import { MAX_CATEGORIES_NESTING, type RecordId } from '@bt/shared/types';
import { CornerDownRightIcon } from '@lucide/vue';
import { storeToRefs } from 'pinia';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

import { type ParentOption, buildParentOptions } from '../parent-options';

const props = defineProps<{
  /** Omit for a category that is being created. */
  category?: FormattedCategory;
  modelValue: RecordId | null;
}>();

const emit = defineEmits<{
  'update:modelValue': [parentId: RecordId | null];
}>();

const { t } = useI18n();
const { formattedCategories } = storeToRefs(useCategoriesStore());

const options = computed<ParentOption[]>(() =>
  buildParentOptions({
    categoryId: props.category?.id ?? null,
    tree: formattedCategories.value,
    maxNesting: MAX_CATEGORIES_NESTING,
  }),
);

const selectedOption = computed<ParentOption | null>(
  () =>
    options.value.find((option) =>
      props.modelValue === null
        ? option.kind === 'top-level'
        : option.kind === 'category' && option.category.id === props.modelValue,
    ) ?? null,
);

const optionLabel = (option: ParentOption) =>
  option.kind === 'category' ? option.category.name : t('settings.categories.topLevel');
const optionValue = (option: ParentOption) => (option.kind === 'category' ? option.category.id : 'top-level');
</script>
