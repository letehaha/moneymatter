<template>
  <template v-if="category">
    <div
      :class="cn('flex shrink-0 items-center justify-center rounded-full', effectiveIcon ? 'size-6' : 'size-5')"
      :style="{
        backgroundColor: effectiveIcon ? `${category.color}2d` : category.color,
        color: category.color,
      }"
    >
      <TagIcon v-if="effectiveIcon" :name="effectiveIcon" class="size-4" />
    </div>
  </template>
</template>

<script setup lang="ts">
import TagIcon from '@/components/common/icons/tag-icon.vue';
import { cn } from '@/lib/utils';
import { useCategoriesStore } from '@/stores';
import { EmbeddedCategoryModel } from '@bt/shared/types';
import { storeToRefs } from 'pinia';
import { computed } from 'vue';

const props = defineProps<{
  category?: EmbeddedCategoryModel;
  categoryId?: string;
  /**
   * Caller-supplied lookup map for the parent-walk that resolves an inherited icon.
   * Default is the global Pinia store, which only contains the caller's own categories —
   * insufficient when rendering a shared-account category whose parent belongs to the
   * owner's tree (the parent isn't in the recipient's store, so the walk silently fails
   * and the icon disappears). Pass the owner's map to fix that case.
   */
  categoriesMap?: Record<string, EmbeddedCategoryModel>;
}>();

const { categoriesMap: storeCategoriesMap } = storeToRefs(useCategoriesStore());

const lookupMap = computed(() => props.categoriesMap ?? storeCategoriesMap.value);

const category = computed(() => {
  if (props.category) return props.category;
  if (props.categoryId) return lookupMap.value[props.categoryId];
  return null;
});

// Subcategories inherit parent's icon (traverses up the tree)
const effectiveIcon = computed(() => {
  if (!category.value) return null;

  let current: EmbeddedCategoryModel | undefined = category.value;

  while (current) {
    if (current.icon) return current.icon;
    if (!current.parentId) break;
    current = lookupMap.value[current.parentId];
  }

  return null;
});
</script>
