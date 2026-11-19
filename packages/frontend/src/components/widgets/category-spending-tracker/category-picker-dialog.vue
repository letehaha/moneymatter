<script lang="ts" setup>
import type { FormattedCategory } from '@/common/types';
import CategoryCircle from '@/components/common/category-circle.vue';
import ResponsiveDialog from '@/components/common/responsive-dialog.vue';
import { useCategoriesStore } from '@/stores/categories/categories';
import { CATEGORY_TYPES } from '@bt/shared/types';
import { SearchIcon, XIcon } from '@lucide/vue';
import { storeToRefs } from 'pinia';
import { computed, nextTick, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

const { t } = useI18n();

const props = defineProps<{
  disabledCategoryIds: string[];
}>();

const emit = defineEmits<{
  select: [categoryId: string];
}>();

const open = defineModel<boolean>('open', { default: false });

const { formattedCategories } = storeToRefs(useCategoriesStore());
const searchQuery = ref('');
const inputRef = ref<HTMLInputElement | null>(null);

watch(open, (isOpen) => {
  if (isOpen) {
    searchQuery.value = '';
    nextTick(() => inputRef.value?.focus());
  }
});

interface FlatCategory extends FormattedCategory {
  depth: number;
  rootParentId: string;
  rootParentName: string;
}

const flattenCategories = ({
  categories,
  depth = 0,
  rootParent,
}: {
  categories: FormattedCategory[];
  depth?: number;
  rootParent?: { id: string; name: string };
}): FlatCategory[] => {
  const result: FlatCategory[] = [];

  for (const category of categories) {
    const currentRoot = rootParent ?? { id: category.id, name: category.name };

    result.push({
      ...category,
      depth,
      rootParentId: currentRoot.id,
      rootParentName: currentRoot.name,
    });

    if (category.subCategories?.length > 0) {
      result.push(
        ...flattenCategories({
          categories: category.subCategories,
          depth: depth + 1,
          rootParent: currentRoot,
        }),
      );
    }
  }

  return result;
};

const allFlatCategories = computed(() => {
  const sorted = [...formattedCategories.value].sort((a, b) => {
    if (a.type === CATEGORY_TYPES.internal && b.type !== CATEGORY_TYPES.internal) return 1;
    if (a.type !== CATEGORY_TYPES.internal && b.type === CATEGORY_TYPES.internal) return -1;
    return 0;
  });

  return flattenCategories({ categories: sorted });
});

const isSearching = computed(() => searchQuery.value.length > 0);

const disabledSet = computed(() => new Set(props.disabledCategoryIds));

const filteredItems = computed(() => {
  if (!searchQuery.value) return allFlatCategories.value;

  const query = searchQuery.value.toLowerCase();
  return allFlatCategories.value.filter((category) => category.name.toLowerCase().includes(query));
});

const shouldShowSeparator = ({ item, index }: { item: FlatCategory; index: number }): boolean => {
  if (!isSearching.value) return false;
  if (index === 0) return true;
  return filteredItems.value[index - 1]!.rootParentId !== item.rootParentId;
};

const handleSelect = ({ categoryId }: { categoryId: string }) => {
  emit('select', categoryId);
  open.value = false;
};
</script>

<template>
  <ResponsiveDialog v-model:open="open" dialog-content-class="max-h-[85vh]">
    <template #title>
      {{ t('dashboard.widgets.categoryTracker.selectCategories') }}
    </template>

    <!-- Search -->
    <div
      class="border-input bg-input-background flex h-9 items-center gap-2 rounded-md border px-3 py-2 dark:bg-transparent"
    >
      <SearchIcon class="text-muted-foreground size-4 shrink-0" />
      <input
        ref="inputRef"
        v-model="searchQuery"
        type="text"
        class="min-w-0 flex-1 bg-transparent text-sm outline-none"
        :placeholder="t('fields.categorySelect.searchPlaceholder')"
      />
      <button
        v-if="searchQuery.length"
        class="text-muted-foreground hover:text-foreground shrink-0"
        @click="searchQuery = ''"
      >
        <XIcon class="size-4" />
      </button>
    </div>

    <!-- Category list -->
    <div class="max-h-80 overflow-y-auto">
      <template v-for="(item, index) in filteredItems" :key="item.id">
        <!-- Group separator when searching -->
        <div
          v-if="shouldShowSeparator({ item, index })"
          class="text-muted-foreground flex items-center gap-2 px-2 pt-3 pb-1 text-xs font-medium"
          :class="{ 'pt-1': index === 0 }"
        >
          <span class="shrink-0">{{ item.rootParentName }}</span>
          <div class="bg-border h-px flex-1" />
        </div>

        <button
          class="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors"
          :class="disabledSet.has(item.id) ? 'cursor-not-allowed opacity-40' : 'hover:bg-hover cursor-pointer'"
          :style="{ paddingLeft: `${8 + (isSearching ? 0 : item.depth) * 12}px` }"
          :disabled="disabledSet.has(item.id)"
          @click="handleSelect({ categoryId: item.id })"
        >
          <CategoryCircle :category="item" />
          <span class="min-w-0 truncate">{{ item.name }}</span>
        </button>
      </template>

      <div v-if="filteredItems.length === 0" class="text-muted-foreground p-4 text-center text-sm">
        {{ t('fields.categorySelect.noCategoriesFound') }}
      </div>
    </div>
  </ResponsiveDialog>
</template>
