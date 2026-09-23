<template>
  <div>
    <div
      :class="
        cn(
          'flex items-center gap-2 rounded-md py-1.5 pr-2 transition-colors',
          isBlocked ? 'text-muted-foreground cursor-not-allowed' : 'hover:bg-accent cursor-pointer',
          isSelected(category.id) && 'bg-accent/50',
        )
      "
      :style="{ paddingLeft: `${8 + depth * 16}px` }"
      @click="$emit('toggle', category.id)"
    >
      <Checkbox
        :model-value="isSelected(category.id)"
        :disabled="isBlocked"
        @click.stop
        @update:model-value="$emit('toggle', category.id)"
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
    </div>
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
import Checkbox from '@/components/lib/ui/checkbox/Checkbox.vue';
import { cn } from '@/lib/utils';
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
