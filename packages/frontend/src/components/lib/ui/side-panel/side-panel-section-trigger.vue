<script setup lang="ts">
import { Button } from '@/components/lib/ui/button';
import { CollapsibleTrigger } from '@/components/lib/ui/collapsible';
import { ChevronDownIcon } from '@lucide/vue';
import type { Component } from 'vue';

defineProps<{ icon: Component }>();
</script>

<template>
  <!-- The hover background bleeds past the column while the icon tile stays aligned with the content. -->
  <CollapsibleTrigger as-child>
    <Button
      variant="ghost"
      class="group/side-panel-trigger -mx-2 h-auto min-h-11 w-[calc(100%+1rem)] justify-start gap-3 px-2 py-2 text-left whitespace-normal"
    >
      <span
        class="bg-muted text-muted-foreground group-data-[state=open]/side-panel-trigger:bg-primary/15 group-data-[state=open]/side-panel-trigger:text-primary-text flex size-7 shrink-0 items-center justify-center rounded-lg transition-colors"
      >
        <component :is="icon" class="size-4" />
      </span>
      <span v-if="$slots.summary" class="min-w-0">
        <span class="block"><slot /></span>
        <span class="text-muted-foreground block truncate text-xs font-normal"><slot name="summary" /></span>
      </span>
      <slot v-else />
      <ChevronDownIcon
        class="ml-auto size-4 shrink-0 transition-transform group-data-[state=open]/side-panel-trigger:rotate-180"
      />
    </Button>
  </CollapsibleTrigger>
</template>
