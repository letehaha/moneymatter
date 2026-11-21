<script setup lang="ts">
import { cn } from '@/lib/utils';
import { reactiveOmit } from '@vueuse/core';
import {
  PopoverContent,
  type PopoverContentEmits,
  type PopoverContentProps,
  PopoverPortal,
  injectPopoverRootContext,
  useForwardPropsEmits,
} from 'reka-ui';
import { type HTMLAttributes, computed, ref, watch } from 'vue';

const props = withDefaults(
  defineProps<
    PopoverContentProps & {
      class?: HTMLAttributes['class'];
      /**
       * Keeps the side resolved on open once the user interacts with the content,
       * so height changes inside it don't flip the popover to the opposite side.
       */
      lockSide?: boolean;
    }
  >(),
  {
    sideOffset: 4,
    class: '',
  },
);
const emits = defineEmits<PopoverContentEmits>();

const forwarded = useForwardPropsEmits(reactiveOmit(props, 'lockSide'), emits);

const rootContext = injectPopoverRootContext();
const lockedSide = ref<PopoverContentProps['side']>();

watch(rootContext.open, (open) => {
  if (open) lockedSide.value = undefined;
});

// Locks on user input rather than on mount: the side is only resolved after floating-ui's async positioning.
const lockCurrentSide = (event: Event) => {
  if (!props.lockSide || lockedSide.value) return;
  lockedSide.value = (event.currentTarget as HTMLElement).dataset.side as PopoverContentProps['side'];
};

const lockedPosition = computed(() => (lockedSide.value ? { side: lockedSide.value, sideFlip: false } : {}));
</script>

<template>
  <PopoverPortal>
    <PopoverContent
      v-bind="{ ...forwarded, ...$attrs, ...lockedPosition }"
      :class="
        cn(
          'bg-popover text-popover-foreground data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 z-(--z-dialog) w-72 rounded-md border p-4 shadow-md outline-hidden',
          props.class,
        )
      "
      @pointerdown.capture="lockCurrentSide"
      @keydown.capture="lockCurrentSide"
    >
      <slot />
    </PopoverContent>
  </PopoverPortal>
</template>
