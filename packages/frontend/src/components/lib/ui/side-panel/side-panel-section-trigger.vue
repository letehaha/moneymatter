<script setup lang="ts">
import { Button } from '@/components/lib/ui/button';
import { CollapsibleTrigger } from '@/components/lib/ui/collapsible';
import { cn } from '@/lib/utils';
import { ChevronDownIcon } from '@lucide/vue';
import { type Component, inject } from 'vue';

import { SIDE_PANEL_VARIANT } from './context';

defineProps<{
  icon: Component;
  /** Cards variant: background and text colour of the icon tile. */
  iconClass?: string;
}>();

const isCards = inject(SIDE_PANEL_VARIANT, 'list') === 'cards';
</script>

<template>
  <!-- The hover background bleeds past the column (to the card edges in the cards variant) while the icon tile stays aligned with the content. -->
  <CollapsibleTrigger as-child>
    <Button
      variant="ghost"
      :class="
        cn(
          'group/side-panel-trigger h-auto min-h-11 justify-start gap-3 py-2 text-left whitespace-normal',
          isCards
            ? '-mx-3 w-[calc(100%+1.5rem)] rounded-none px-3 font-semibold focus-visible:ring-inset'
            : '-mx-2 w-[calc(100%+1rem)] px-2',
        )
      "
    >
      <span
        :class="
          cn(
            'flex size-7 shrink-0 items-center justify-center rounded-lg transition-colors',
            isCards
              ? (iconClass ?? 'bg-primary/15 text-primary-text')
              : 'bg-muted text-muted-foreground group-data-[state=open]/side-panel-trigger:bg-primary/15 group-data-[state=open]/side-panel-trigger:text-primary-text',
          )
        "
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
