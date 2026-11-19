<script setup lang="ts">
import { cn } from '@/lib/utils';
import { DropdownMenuItem, type DropdownMenuItemProps, useForwardProps } from 'reka-ui';

const props = defineProps<DropdownMenuItemProps & { inset?: boolean }>();

const forwardedProps = useForwardProps(props);
</script>

<template>
  <DropdownMenuItem
    v-bind="forwardedProps"
    :class="
      cn(
        'focus:bg-hover focus:text-accent-foreground relative flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-hidden transition-colors select-none data-disabled:pointer-events-none data-disabled:opacity-50',
        inset && 'pl-8',
        $attrs.class ?? '',
      )
    "
  >
    <slot />
  </DropdownMenuItem>
</template>
