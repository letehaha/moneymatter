<template>
  <div>
    <MultiSelectItem
      :value="category.id"
      :disabled="isBlocked"
      class="data-[state=checked]:bg-accent/50 data-disabled:text-muted-foreground gap-2 py-1.5 pr-2 data-disabled:cursor-not-allowed"
      :style="{ paddingLeft: `${8 + depth * 16}px` }"
      @toggle="$emit('toggle', category.id)"
    >
      <Checkbox
        :model-value="isSelected(category.id)"
        :disabled="isBlocked"
        class="pointer-events-none"
        tabindex="-1"
      />
      <CategoryCircle :category="category" class="shrink-0" />
      <span class="flex min-w-0 flex-1 items-baseline gap-1.5">
        <span class="truncate text-sm">{{ category.name }}</span>
        <span v-if="takenByName" class="truncate text-xs">
          {{ $t('fields.categoryMultiSelect.takenBy', { name: takenByName }) }}
        </span>
      </span>
      <span v-if="descendantCount > 0" class="text-muted-foreground text-xs">
        {{ descendantCount }}
      </span>
    </MultiSelectItem>
    <template v-if="category.subCategories?.length && !isSearching">
      <CategoryMultiSelectItem
        v-for="subCategory in category.subCategories"
        :key="subCategory.id"
        :category="subCategory"
        :depth="depth + 1"
        :is-searching="isSearching"
        :is-selected="isSelected"
        :get-descendant-count="getDescendantCount"
        :taken-by="takenBy"
        @toggle="$emit('toggle', $event)"
      />
    </template>
  </div>
</template>

<script setup lang="ts">
import { type FormattedCategory } from '@/common/types';
import CategoryCircle from '@/components/common/category-circle.vue';
import MultiSelectItem from '@/components/fields/multi-select-item.vue';
import Checkbox from '@/components/lib/ui/checkbox/Checkbox.vue';
import { computed } from 'vue';

const props = defineProps<{
  category: FormattedCategory;
  depth: number;
  isSearching: boolean;
  isSelected: (id: string) => boolean;
  getDescendantCount: (category: FormattedCategory) => number;
  takenBy: Record<string, string>;
}>();

defineEmits<{
  toggle: [categoryId: string];
}>();

const descendantCount = computed(() => props.getDescendantCount(props.category));
const takenByName = computed(() => props.takenBy[props.category.id]);
// A selected category that became taken (merge, re-parent) stays removable.
const isBlocked = computed(() => Boolean(takenByName.value) && !props.isSelected(props.category.id));
</script>
