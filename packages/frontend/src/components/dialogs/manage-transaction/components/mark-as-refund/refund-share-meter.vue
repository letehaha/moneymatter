<script lang="ts" setup>
import { cn } from '@/lib/utils';

defineProps<{
  /** Segment widths, in percent of the whole bar. */
  segments: number[];
  tone?: 'default' | 'error' | 'warning';
  label: string;
}>();
</script>

<template>
  <div class="flex flex-col gap-2">
    <div class="flex items-center justify-between gap-3">
      <slot />
      <span
        :class="
          cn(
            'text-muted-foreground ml-auto min-w-0 truncate text-sm tabular-nums',
            tone === 'error' && 'text-destructive-text',
            tone === 'warning' && 'text-warning-text',
          )
        "
      >
        {{ label }}
      </span>
    </div>
    <div class="bg-input flex h-1.5 gap-0.5 overflow-hidden rounded-full">
      <div
        v-for="(width, index) in segments"
        :key="index"
        :class="
          cn(
            'h-full shrink-0 transition-all duration-200',
            tone === 'error' ? 'bg-destructive-text' : tone === 'warning' ? 'bg-warning-text' : 'bg-app-income-color',
          )
        "
        :style="{ width: `${Math.min(100, Math.max(0, width))}%` }"
      />
    </div>
  </div>
</template>
