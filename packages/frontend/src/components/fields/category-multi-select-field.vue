<template>
  <div class="w-full">
    <FieldLabel :label="label" only-template>
      <Popover v-model:open="isOpen">
        <PopoverTrigger as-child>
          <button
            type="button"
            :disabled="disabled"
            :class="
              cn(
                'border-input bg-input-background ring-offset-background flex min-h-10 w-full items-center gap-2 rounded-md border px-3 py-2 text-sm md:min-h-9',
                'focus-visible:ring-ring focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-hidden',
                disabled && 'cursor-not-allowed opacity-50',
              )
            "
          >
            <div v-if="selectedCategories.length === 0" class="text-muted-foreground flex-1 text-left">
              {{ placeholderText }}
            </div>
            <div v-else class="flex max-h-18 flex-1 flex-wrap gap-1 overflow-y-auto">
              <span
                v-for="category in selectedCategories"
                :key="category.id"
                class="group relative inline-flex cursor-pointer items-center justify-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium text-white transition-opacity hover:opacity-80"
                :style="{ backgroundColor: category.color }"
                @click.stop="toggleCategory(category.id)"
              >
                <XIcon class="absolute hidden size-3 group-hover:block" />
                <span class="inline-flex items-center gap-1 group-hover:invisible">
                  {{ category.name }}
                </span>
              </span>
            </div>
            <ChevronsUpDownIcon class="text-muted-foreground size-4 shrink-0" />
          </button>
        </PopoverTrigger>
        <PopoverContent class="w-80 p-0" align="start">
          <div class="border-border border-b p-2">
            <div
              class="border-input bg-input-background flex h-9 w-full items-center gap-2 rounded-md border px-3 text-sm"
            >
              <SearchIcon class="text-muted-foreground size-4" />
              <input
                v-model="searchQuery"
                type="text"
                class="min-w-0 flex-1 bg-transparent outline-none"
                :placeholder="$t('fields.categoryMultiSelect.searchPlaceholder')"
              />
              <button
                v-if="searchQuery.length"
                type="button"
                class="text-muted-foreground hover:text-foreground shrink-0"
                @click="searchQuery = ''"
              >
                <XIcon class="size-4" />
              </button>
            </div>
          </div>
          <div class="max-h-75 overflow-auto p-2">
            <div v-if="filteredCategories.length === 0" class="text-muted-foreground py-4 text-center text-sm">
              {{ $t('fields.categoryMultiSelect.noCategoriesFound') }}
            </div>
            <div v-else class="space-y-1">
              <CategoryItem
                v-for="category in filteredCategories"
                :key="category.id"
                :category="category"
                :depth="0"
                :is-searching="isSearching"
                :is-selected="isSelected"
                :get-descendant-count="getDescendantCount"
                @toggle="toggleCategory"
              />
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </FieldLabel>
    <FieldError :error-message="errorMessage" />
  </div>
</template>

<script setup lang="ts">
import { type FormattedCategory } from '@/common/types';
import { collectDescendantIds } from '@/components/common/combobox-categories.helpers';
import FieldError from '@/components/fields/components/field-error.vue';
import FieldLabel from '@/components/fields/components/field-label.vue';
import CategoryItem from '@/components/fields/category-multi-select-item.vue';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/lib/ui/popover';
import { cn } from '@/lib/utils';
import { useCategoriesStore } from '@/stores';
import { CATEGORY_TYPES } from '@bt/shared/types';
import { ChevronsUpDownIcon, SearchIcon, XIcon } from '@lucide/vue';
import { storeToRefs } from 'pinia';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';

const props = withDefaults(
  defineProps<{
    label?: string;
    modelValue?: string[];
    placeholder?: string;
    errorMessage?: string;
    disabled?: boolean;
  }>(),
  {
    label: undefined,
    modelValue: () => [],
    placeholder: undefined,
    errorMessage: undefined,
  },
);

const emit = defineEmits<{
  'update:model-value': [value: string[]];
}>();

const { t } = useI18n();
const categoriesStore = useCategoriesStore();
const { formattedCategories, categoriesMap } = storeToRefs(categoriesStore);

const isOpen = ref(false);
const searchQuery = ref('');

const isSearching = computed(() => searchQuery.value.length > 0);

const placeholderText = computed(() => props.placeholder ?? t('fields.categoryMultiSelect.placeholder'));

const selectedCategoryIds = computed(() => new Set(props.modelValue ?? []));

const selectedCategories = computed(() => {
  const ids = props.modelValue ?? [];
  return ids.map((id) => categoriesMap.value[id]).filter((cat): cat is FormattedCategory => cat !== undefined);
});

const availableCategories = computed(() => {
  return formattedCategories.value.filter((c) => c.type !== CATEGORY_TYPES.internal);
});

/**
 * Generic recursive category search. Finds the first category matching the predicate.
 */
const findCategory = (
  categories: FormattedCategory[],
  predicate: (cat: FormattedCategory) => boolean,
): FormattedCategory | undefined => {
  for (const category of categories) {
    if (predicate(category)) return category;
    if (category.subCategories?.length) {
      const found = findCategory(category.subCategories, predicate);
      if (found) return found;
    }
  }
  return undefined;
};

/**
 * Recursively searches for categories matching the query at any depth.
 * Only searches children when parent doesn't match to avoid duplicate results.
 */
const findMatchingCategories = (categories: FormattedCategory[], query: string): FormattedCategory[] => {
  const results: FormattedCategory[] = [];

  for (const category of categories) {
    if (category.name.toLowerCase().includes(query)) {
      results.push(category);
    } else if (category.subCategories?.length) {
      results.push(...findMatchingCategories(category.subCategories, query));
    }
  }

  return results;
};

const filteredCategories = computed(() => {
  if (!searchQuery.value) {
    return availableCategories.value;
  }

  const query = searchQuery.value.toLowerCase();
  return findMatchingCategories(availableCategories.value, query);
});

const isSelected = (categoryId: string) => selectedCategoryIds.value.has(categoryId);

const getDescendantCount = (category: FormattedCategory): number => collectDescendantIds({ category }).length;

const toggleCategory = (categoryId: string) => {
  const currentIds = new Set(props.modelValue ?? []);
  const category = categoriesMap.value[categoryId];

  if (!category) return;

  // Find the category in the formatted structure to get its descendants
  const formattedCategory = findCategory(availableCategories.value, (cat) => cat.id === categoryId);
  const descendantIds = formattedCategory ? collectDescendantIds({ category: formattedCategory }) : [];

  if (currentIds.has(categoryId)) {
    // Uncheck: remove this category and all its descendants
    currentIds.delete(categoryId);
    for (const id of descendantIds) {
      currentIds.delete(id);
    }
  } else {
    // Check: add this category and all its descendants
    currentIds.add(categoryId);
    for (const id of descendantIds) {
      currentIds.add(id);
    }
  }

  emit('update:model-value', Array.from(currentIds));
};
</script>
