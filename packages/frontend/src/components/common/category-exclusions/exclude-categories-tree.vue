<template>
  <div>
    <template v-for="node in nodes" :key="node.category.id">
      <button
        type="button"
        class="hover:bg-hover flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm"
        :class="{ 'text-muted-foreground': isExcluded({ categoryId: node.category.id }) }"
        :data-testid="`ec-row-${node.category.id}`"
        @click="emit('toggle', { categoryId: node.category.id })"
      >
        <CategoryCircle
          :category="node.category"
          :class="isExcluded({ categoryId: node.category.id }) && 'opacity-40 grayscale'"
        />

        <span class="min-w-0 flex-1 truncate" :class="{ 'line-through': isExcluded({ categoryId: node.category.id }) }">
          {{ node.category.name }}
        </span>

        <span
          v-if="isExcluded({ categoryId: node.category.id })"
          class="bg-warning-text/15 text-warning-text shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-bold tracking-wide uppercase"
        >
          {{ $t('dialogs.categoryExclusions.excludedTag') }}
        </span>
        <span v-else-if="partialLabel({ categoryId: node.category.id })" class="text-muted-foreground shrink-0 text-xs">
          {{ partialLabel({ categoryId: node.category.id }) }}
        </span>
      </button>

      <ExcludeCategoriesTree
        v-if="node.children.length"
        class="border-border ml-4 border-l pl-3"
        :nodes="node.children"
        :excluded-ids="excludedIds"
        :descendants-by-id="descendantsById"
        @toggle="emit('toggle', $event)"
      />
    </template>
  </div>
</template>

<script lang="ts" setup>
import CategoryCircle from '@/components/common/category-circle.vue';
import { computed } from 'vue';

import type { ExcludableCategoryNode } from './types';

defineOptions({ name: 'ExcludeCategoriesTree' });

const props = defineProps<{
  nodes: ExcludableCategoryNode[];
  excludedIds: string[];
  /** Descendant ids per category, taken from the unfiltered tree so search can't skew the counter. */
  descendantsById: Record<string, string[]>;
}>();

const emit = defineEmits<{
  toggle: [payload: { categoryId: string }];
}>();

const excludedSet = computed(() => new Set(props.excludedIds));

const isExcluded = ({ categoryId }: { categoryId: string }) => excludedSet.value.has(categoryId);

/**
 * `2/5` on a category that is itself still counted but has some subcategories hidden. Without it a
 * partially-hidden branch looks identical to an untouched one.
 */
const partialLabel = ({ categoryId }: { categoryId: string }): string | null => {
  const descendants = props.descendantsById[categoryId];
  if (!descendants?.length) return null;

  const hidden = descendants.filter((id) => excludedSet.value.has(id)).length;
  return hidden > 0 ? `${hidden}/${descendants.length}` : null;
};
</script>
