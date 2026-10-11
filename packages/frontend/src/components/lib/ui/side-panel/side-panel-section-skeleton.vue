<script setup lang="ts">
import { cn } from '@/lib/utils';
import { inject } from 'vue';

import { SIDE_PANEL_VARIANT } from './context';

defineProps<{ open: boolean; labelClass: string; summary?: boolean }>();

const isCards = inject(SIDE_PANEL_VARIANT, 'list') === 'cards';
</script>

<template>
  <div>
    <div class="flex min-h-11 items-center gap-3 py-2">
      <div class="bg-muted size-7 shrink-0 rounded-lg" />
      <div v-if="summary" class="flex flex-col">
        <div :class="cn('bg-muted my-1 h-3 rounded', labelClass)" />
        <div class="bg-muted my-0.5 h-3 w-40 rounded" />
      </div>
      <div v-else :class="cn('bg-muted h-3 rounded', labelClass)" />
      <div class="bg-muted ml-auto size-4 shrink-0 rounded" />
    </div>
    <div v-if="open" :class="isCards ? 'border-border border-t py-3' : 'pt-3 pb-2'">
      <slot />
    </div>
  </div>
</template>
