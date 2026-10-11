<script setup lang="ts">
import { cn } from '@/lib/utils';
import { provide } from 'vue';

import { SIDE_PANEL_VARIANT, type SidePanelVariant } from './context';

const props = withDefaults(defineProps<{ variant?: SidePanelVariant }>(), { variant: 'list' });

provide(SIDE_PANEL_VARIANT, props.variant);
</script>

<template>
  <div
    :class="
      cn(
        'flex flex-col',
        variant === 'cards'
          ? '*:border-border *:bg-muted/40 gap-2.5 *:overflow-hidden *:rounded-xl *:border *:px-3'
          : 'divide-border divide-y *:py-1',
      )
    "
  >
    <slot />
  </div>
</template>
