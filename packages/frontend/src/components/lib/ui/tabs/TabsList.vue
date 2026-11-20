<script setup lang="ts">
import { controlHeight } from '@/components/lib/ui/control-size';
import { cn } from '@/lib/utils';
import { reactiveOmit } from '@vueuse/core';
import { TabsIndicator, TabsList, type TabsListProps } from 'reka-ui';
import { computed, provide } from 'vue';

import { TabsVariantKey, type TabsVariant } from './shared';

const props = defineProps<TabsListProps & { class?: string; variant?: TabsVariant; indicatorClass?: string }>();
const delegatedProps = reactiveOmit(props, 'class', 'variant', 'indicatorClass');

const variant = computed<TabsVariant>(() => props.variant ?? 'default');
provide(TabsVariantKey, variant);
</script>

<template>
  <TabsList
    v-bind="delegatedProps"
    :class="
      cn(
        variant === 'underline'
          ? 'border-border no-scrollbar relative flex w-full items-center gap-4 overflow-x-auto border-b'
          : `bg-muted text-muted-foreground relative inline-flex ${controlHeight.default} items-center justify-center rounded-md p-1`,
        props.class,
      )
    "
  >
    <slot />
    <TabsIndicator
      :class="
        cn(
          'pointer-events-none absolute left-0 transition-[width,transform] duration-200 ease-out motion-reduce:transition-none',
          variant === 'underline'
            ? 'bg-primary -bottom-px h-0.5'
            : 'bg-card dark:bg-background inset-y-1 rounded-[inherit] shadow-sm',
          props.indicatorClass,
        )
      "
      :style="{
        width: 'var(--reka-tabs-indicator-size)',
        transform: 'translateX(var(--reka-tabs-indicator-position))',
      }"
    />
  </TabsList>
</template>
