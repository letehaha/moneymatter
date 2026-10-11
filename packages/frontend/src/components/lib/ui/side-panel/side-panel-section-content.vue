<script setup lang="ts">
import { CollapsibleContent } from '@/components/lib/ui/collapsible';
import { inject } from 'vue';

import { SIDE_PANEL_VARIANT } from './context';

const variant = inject(SIDE_PANEL_VARIANT, 'list');
</script>

<template>
  <!-- Padding sits on an inner element: on the animated one it would be a floor the height can't collapse below.
       Collapsible content clips its overflow; the padding keeps focus rings visible. -->
  <CollapsibleContent class="-mx-1">
    <div class="px-1">
      <div :class="variant === 'cards' ? 'border-border border-t pt-3 pb-3' : 'pt-3 pb-2'">
        <slot />
      </div>
    </div>
  </CollapsibleContent>
</template>
