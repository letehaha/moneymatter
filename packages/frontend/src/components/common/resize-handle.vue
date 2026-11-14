<script setup lang="ts">
import { cn } from '@/lib/utils';

defineProps<{ edge: 'left' | 'right'; label: string }>();
defineEmits<{ start: [event: PointerEvent]; reset: [] }>();
</script>

<template>
  <div
    role="separator"
    aria-orientation="vertical"
    :aria-label="label"
    :class="
      cn(
        'hover:bg-primary/40 active:bg-primary/60 absolute inset-y-0 z-10 w-2 cursor-col-resize touch-none rounded-full transition-colors',
        edge === 'left' ? '-left-1' : '-right-1',
      )
    "
    @pointerdown.left.prevent="$emit('start', $event)"
    @dblclick="$emit('reset')"
  />
</template>
