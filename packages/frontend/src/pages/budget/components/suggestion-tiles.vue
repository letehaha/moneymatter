<script setup lang="ts" generic="T extends string">
import CategoryCircle from '@/components/common/category-circle.vue';
import { Button } from '@/components/lib/ui/button';
import { cn } from '@/lib/utils';
import type { Component } from 'vue';

export interface SuggestionTile<V extends string> {
  value: V;
  label: string;
  hint?: string;
  icon?: Component;
  categoryId?: string;
}

const props = defineProps<{
  items: SuggestionTile<T>[];
  /** An array makes the tiles multi-select. */
  modelValue: T | T[] | undefined;
  columns?: 2 | 3;
}>();
const emit = defineEmits<{ 'update:modelValue': [value: T | T[]] }>();

const isSelected = ({ value }: { value: T }) =>
  Array.isArray(props.modelValue) ? props.modelValue.includes(value) : props.modelValue === value;

const pick = ({ value }: { value: T }) => {
  if (!Array.isArray(props.modelValue)) return emit('update:modelValue', value);
  emit(
    'update:modelValue',
    isSelected({ value }) ? props.modelValue.filter((entry) => entry !== value) : [...props.modelValue, value],
  );
};
</script>

<template>
  <div :class="cn('grid gap-2', columns === 3 ? 'grid-cols-3' : 'grid-cols-2')">
    <Button
      v-for="item in items"
      :key="item.value"
      type="button"
      variant="outline"
      :aria-pressed="isSelected({ value: item.value })"
      :class="
        cn(
          'text-muted-foreground h-auto min-w-0 flex-col gap-1.5 px-2 py-3 text-center text-sm font-medium whitespace-normal',
          isSelected({ value: item.value }) && 'border-primary bg-primary/10 text-primary-text hover:bg-primary/10',
        )
      "
      @click="pick({ value: item.value })"
    >
      <CategoryCircle v-if="item.categoryId" :category-id="item.categoryId" />
      <component :is="item.icon" v-else-if="item.icon" class="size-5" />
      <span class="wrap-break-word">{{ item.label }}</span>
      <span v-if="item.hint" class="text-xs font-normal tabular-nums">{{ item.hint }}</span>
    </Button>
  </div>
</template>
