<script setup lang="ts">
import { type ControlSize, controlHeight } from '@/components/lib/ui/control-size';
import { cn } from '@/lib/utils';
import { ChevronDown } from '@lucide/vue';
import { reactiveOmit } from '@vueuse/core';
import { SelectIcon, SelectTrigger, type SelectTriggerProps, useForwardProps } from 'reka-ui';
import { ComputedRef, type HTMLAttributes, inject } from 'vue';

import { PROVIDER_NAME } from './types';

const props = withDefaults(
  defineProps<SelectTriggerProps & { class?: HTMLAttributes['class']; size?: ControlSize }>(),
  { size: 'default' },
);

const delegatedProps = reactiveOmit(props, 'class', 'size');

const forwardedProps = useForwardProps(delegatedProps);
const isOpen = inject<ComputedRef<boolean>>(PROVIDER_NAME);
</script>

<template>
  <SelectTrigger
    v-bind="forwardedProps"
    :class="
      cn(
        'border-input bg-input-background ring-offset-background placeholder:text-muted-foreground focus:ring-ring flex w-full items-center justify-between rounded-md border px-3 py-2 text-start text-sm focus:ring-2 focus:ring-offset-2 focus:outline-hidden disabled:cursor-not-allowed disabled:opacity-50 [&>span]:truncate',
        controlHeight[size],
        props.class,
      )
    "
  >
    <slot />
    <SelectIcon as-child>
      <ChevronDown :class="['size-4 shrink-0 opacity-50', isOpen && 'rotate-180']" />
    </SelectIcon>
  </SelectTrigger>
</template>
