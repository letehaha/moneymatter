<script setup lang="ts">
import type { EmbeddedCategoryModel } from '@bt/shared/types';
import { computed } from 'vue';

const props = withDefaults(
  defineProps<{ categories: Pick<EmbeddedCategoryModel, 'id' | 'name' | 'color'>[]; visible?: number }>(),
  { visible: 2 },
);

const shown = computed(() => props.categories.slice(0, props.visible));
const hidden = computed(() => props.categories.slice(props.visible));
</script>

<template>
  <span class="inline-flex min-w-0 items-center gap-2 align-bottom">
    <span v-for="category in shown" :key="category.id" class="inline-flex min-w-0 items-center gap-1">
      <span class="size-[7px] shrink-0 rounded-full" :style="{ backgroundColor: category.color }" />
      <span class="max-w-[80px] truncate" :title="category.name">{{ category.name }}</span>
    </span>
    <span v-if="hidden.length" class="shrink-0" :title="hidden.map((category) => category.name).join(', ')">
      {{ $t('budgets.list.row.moreCategories', { count: hidden.length }) }}
    </span>
  </span>
</template>
