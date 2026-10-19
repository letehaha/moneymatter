<script setup lang="ts">
import ResponsiveTooltip from '@/components/common/responsive-tooltip.vue';
import type { EmbeddedCategoryModel } from '@bt/shared/types';
import { computed } from 'vue';

const props = defineProps<{
  categories: Pick<EmbeddedCategoryModel, 'id' | 'name' | 'color'>[];
  collapsed?: boolean;
}>();

const VISIBLE_CATEGORIES = 2;

const visibleCount = computed(() => (props.collapsed ? 0 : VISIBLE_CATEGORIES));
const shown = computed(() => props.categories.slice(0, visibleCount.value));
const hidden = computed(() => props.categories.slice(visibleCount.value));
</script>

<template>
  <span class="inline-flex min-w-0 items-center gap-2 align-bottom">
    <span v-for="category in shown" :key="category.id" class="inline-flex min-w-0 items-center gap-1">
      <span class="size-[7px] shrink-0 rounded-full" :style="{ backgroundColor: category.color }" />
      <span class="max-w-[80px] truncate" :title="category.name">{{ category.name }}</span>
    </span>
    <ResponsiveTooltip v-if="hidden.length" content-class-name="max-w-64" :delay-duration="100">
      <span class="shrink-0 cursor-help">
        {{
          collapsed
            ? $t('budgets.lines.categoriesCount', hidden.length)
            : $t('budgets.list.row.moreCategories', { count: hidden.length })
        }}
      </span>
      <template #content>
        <div class="flex flex-col gap-1">
          <span v-for="category in hidden" :key="category.id" class="flex items-center gap-2 text-xs">
            <span class="size-2 shrink-0 rounded-full" :style="{ backgroundColor: category.color }" />
            {{ category.name }}
          </span>
        </div>
      </template>
    </ResponsiveTooltip>
  </span>
</template>
