<script lang="ts" setup>
import { cn } from '@/lib/utils';
import { useResizeObserver } from '@vueuse/core';
import { nextTick, onMounted, ref, watch } from 'vue';
import {
  type PillTabItem,
  type PillTabsSize,
  pillTabsContainerVariants,
  pillTabsIndicatorVariants,
  pillTabsTriggerVariants,
} from '.';

const props = withDefaults(
  defineProps<{
    items: PillTabItem[];
    modelValue: string;
    size?: PillTabsSize;
    disabled?: boolean;
    /** Stretch the track to the parent width with equal-width triggers. */
    fullWidth?: boolean;
  }>(),
  { size: 'default', disabled: false, fullWidth: false },
);

const emit = defineEmits<{
  'update:modelValue': [value: string];
}>();

const containerRef = ref<HTMLElement | null>(null);
const indicatorStyle = ref({ left: '0px', width: '0px' });

function updateIndicator() {
  if (!containerRef.value) return;
  const activeBtn = containerRef.value.querySelector<HTMLElement>(`[data-value="${props.modelValue}"]`);
  if (!activeBtn) {
    indicatorStyle.value = { left: '0px', width: '0px' };
    return;
  }

  indicatorStyle.value = {
    left: `${activeBtn.offsetLeft}px`,
    width: `${activeBtn.offsetWidth}px`,
  };
}

onMounted(() => {
  updateIndicator();
});

// Covers mounting inside a hidden panel, where every trigger measures 0 until it is shown.
useResizeObserver(containerRef, updateIndicator);

watch(
  () => props.modelValue,
  () => nextTick(updateIndicator),
);
</script>

<template>
  <div ref="containerRef" :class="cn(pillTabsContainerVariants({ size }), fullWidth && 'flex w-full self-auto')">
    <!-- Sliding indicator -->
    <div :class="cn(pillTabsIndicatorVariants({ size }))" :style="indicatorStyle" />
    <!-- Buttons -->
    <button
      v-for="item in items"
      :key="item.value"
      type="button"
      :data-value="item.value"
      :aria-pressed="modelValue === item.value"
      :disabled="disabled || item.disabled"
      :class="
        cn(
          pillTabsTriggerVariants({ size }),
          modelValue === item.value ? 'text-foreground' : 'text-muted-foreground',
          (disabled || item.disabled) && 'cursor-not-allowed opacity-50',
          fullWidth && 'flex-1',
        )
      "
      @click="emit('update:modelValue', item.value)"
    >
      <component :is="item.icon" v-if="item.icon" :class="cn('mr-1.5 inline size-4 align-[-3px]', item.iconClass)" />
      {{ item.label }}
      <span
        v-if="item.count !== undefined"
        class="bg-foreground/10 text-muted-foreground ml-1.5 inline-flex h-4.5 min-w-4.5 items-center justify-center rounded-full px-1.5 align-[1px] text-xs font-semibold tabular-nums"
      >
        {{ item.count }}
      </span>
    </button>
  </div>
</template>
