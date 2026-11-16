<script lang="ts" setup>
import { buttonVariants } from '@/components/lib/ui/button';
import { cn } from '@/lib/utils';
import { ChevronLeft } from '@lucide/vue';
import { RangeCalendarPrev, type RangeCalendarPrevProps, useForwardProps } from 'reka-ui';
import { type HTMLAttributes, computed } from 'vue';

const props = defineProps<RangeCalendarPrevProps & { class?: HTMLAttributes['class'] }>();

const delegatedProps = computed(() => {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { class: _, ...delegated } = props;

  return delegated;
});

const forwardedProps = useForwardProps(delegatedProps);
</script>

<template>
  <RangeCalendarPrev
    :class="
      cn(
        buttonVariants({ variant: 'outline' }),
        'size-7 bg-transparent p-0 opacity-50 shadow-none hover:opacity-100',
        props.class,
      )
    "
    v-bind="forwardedProps"
  >
    <slot>
      <ChevronLeft class="size-4" />
    </slot>
  </RangeCalendarPrev>
</template>
