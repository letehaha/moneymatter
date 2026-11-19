<script setup lang="ts">
import { cn } from '@/lib/utils';
import { TabsTrigger, type TabsTriggerProps } from 'reka-ui';
import { computed, inject } from 'vue';

import { TabsVariantKey, type TabsVariant } from './shared';

const props = defineProps<TabsTriggerProps & { class?: string; variant?: TabsVariant }>();

const injectedVariant = inject(TabsVariantKey, undefined);
const variant = computed<TabsVariant>(() => props.variant ?? injectedVariant?.value ?? 'default');
</script>

<template>
  <TabsTrigger
    v-bind="props"
    :class="
      cn(
        variant === 'underline'
          ? 'text-muted-foreground hover:text-foreground focus-visible:text-foreground data-[state=active]:text-primary-text relative inline-flex items-center gap-2 border-b-2 border-transparent px-1 py-3 text-sm font-medium whitespace-nowrap transition-colors outline-none disabled:pointer-events-none disabled:opacity-50'
          : 'ring-offset-background focus-visible:ring-ring data-[state=active]:text-foreground relative z-1 inline-flex items-center justify-center rounded-sm px-3 py-1.5 text-sm font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50',
        props.class,
      )
    "
  >
    <slot />
  </TabsTrigger>
</template>
