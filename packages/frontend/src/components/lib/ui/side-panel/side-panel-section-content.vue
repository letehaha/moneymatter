<script setup lang="ts">
import { CollapsibleContent } from '@/components/lib/ui/collapsible';
</script>

<template>
  <!-- Padding sits on an inner element: on the animated one it would be a floor the height can't collapse below.
       Collapsible content clips its overflow; the padding keeps focus rings visible. -->
  <CollapsibleContent class="-mx-1">
    <div class="px-1 pt-3 pb-2">
      <slot />
    </div>
  </CollapsibleContent>
</template>
