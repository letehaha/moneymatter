<script setup lang="ts">
import { cn } from '@/lib/utils';
import { Check } from '@lucide/vue';
import { SelectItem, SelectItemIndicator, type SelectItemProps, SelectItemText, useForwardProps } from 'reka-ui';
import { type HTMLAttributes, computed } from 'vue';

const props = defineProps<SelectItemProps & { class?: HTMLAttributes['class'] }>();

const delegatedProps = computed(() => {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { class: _, ...delegated } = props;

  return delegated;
});

const forwardedProps = useForwardProps(delegatedProps);
</script>

<template>
  <SelectItem
    v-bind="forwardedProps"
    :class="
      cn(
        'focus:bg-hover focus:text-accent-foreground data-[state=checked]:bg-primary/10 data-[state=checked]:focus:bg-primary/15 relative flex w-full cursor-default items-center rounded-sm py-1.5 pr-2 pl-8 text-sm outline-hidden select-none data-disabled:pointer-events-none data-disabled:opacity-50',
        props.class,
      )
    "
  >
    <span class="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
      <SelectItemIndicator>
        <Check class="size-4" />
      </SelectItemIndicator>
    </span>

    <!-- flex-1 lets slotted rows pin trailing content (e.g. a currency chip) to the item's right edge. -->
    <SelectItemText class="min-w-0 flex-1">
      <slot />
    </SelectItemText>
  </SelectItem>
</template>
