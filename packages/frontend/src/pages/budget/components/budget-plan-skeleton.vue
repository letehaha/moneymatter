<script setup lang="ts">
import { cn } from '@/lib/utils';

import { GRID_ROW_CLASS } from '../helpers';

defineProps<{ narrow: boolean }>();

const LINES_PER_GROUP = [3, 2, 2];
const BAR_CLASS = 'bg-muted rounded';
const GROUP_BAR_CLASS = 'bg-muted-foreground/15 rounded';
</script>

<template>
  <div class="animate-pulse" aria-hidden="true">
    <template v-if="narrow">
      <div class="px-3 py-2">
        <div :class="cn(BAR_CLASS, 'h-3 w-20')" />
      </div>
      <template v-for="(lineCount, group) in LINES_PER_GROUP" :key="group">
        <div class="border-border bg-muted flex items-center gap-3 border-t px-3 py-2">
          <div class="grid flex-1 gap-1.5">
            <div :class="cn(GROUP_BAR_CLASS, 'h-3.5 w-28')" />
            <div :class="cn(GROUP_BAR_CLASS, 'h-2.5 w-40')" />
          </div>
          <div :class="cn(GROUP_BAR_CLASS, 'h-3.5 w-16')" />
        </div>
        <div v-for="line in lineCount" :key="line" class="border-border flex items-center gap-3 border-t px-3 py-2">
          <div class="bg-muted size-5 shrink-0 rounded-full" />
          <div class="grid flex-1 gap-1.5">
            <div :class="cn(BAR_CLASS, 'h-3.5 w-28')" />
            <div :class="cn(BAR_CLASS, 'h-2.5 w-44 max-w-full')" />
          </div>
          <div class="bg-muted h-6 w-20 shrink-0 rounded-full" />
        </div>
      </template>
    </template>

    <template v-else>
      <div :class="cn(GRID_ROW_CLASS, 'py-2.5')">
        <div class="bg-muted size-[18px] rounded-[4px]" />
        <div :class="cn(BAR_CLASS, 'h-3 w-24')" />
        <div v-for="column in 3" :key="column" :class="cn(BAR_CLASS, 'ml-auto h-3 w-16')" />
        <span />
      </div>
      <template v-for="(lineCount, group) in LINES_PER_GROUP" :key="group">
        <div :class="cn(GRID_ROW_CLASS, 'border-border bg-muted border-t py-2')">
          <div class="bg-muted-foreground/15 size-[18px] rounded-[4px]" />
          <div :class="cn(GROUP_BAR_CLASS, 'h-3.5 w-32')" />
          <div v-for="column in 3" :key="column" :class="cn(GROUP_BAR_CLASS, 'ml-auto h-3.5 w-16')" />
          <span />
        </div>
        <div v-for="line in lineCount" :key="line" :class="cn(GRID_ROW_CLASS, 'border-border border-t py-2')">
          <div class="bg-muted size-[18px] rounded-[4px]" />
          <div class="grid gap-1.5">
            <div :class="cn(BAR_CLASS, 'h-3.5 w-32')" />
            <div :class="cn(BAR_CLASS, 'h-2.5 w-48 max-w-full')" />
            <div class="bg-muted h-1 rounded-full" />
          </div>
          <div class="bg-muted h-9 rounded-md" />
          <div :class="cn(BAR_CLASS, 'ml-auto h-3.5 w-16')" />
          <div class="bg-muted ml-auto h-6 w-20 rounded-full" />
          <span />
        </div>
      </template>
    </template>
  </div>
</template>
