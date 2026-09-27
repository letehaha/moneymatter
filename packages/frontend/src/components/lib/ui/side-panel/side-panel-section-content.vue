<script setup lang="ts">
import { CollapsibleContent } from '@/components/lib/ui/collapsible';

// Collapsible content clips its overflow; the padding keeps focus rings visible.
const CONTENT_CLASS = '-mx-1 px-1 pt-3 pb-2';
</script>

<template>
  <CollapsibleContent :class="CONTENT_CLASS">
    <slot />
  </CollapsibleContent>
</template>
