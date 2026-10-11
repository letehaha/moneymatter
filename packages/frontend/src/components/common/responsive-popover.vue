<script lang="ts" setup>
import * as Drawer from '@/components/lib/ui/drawer';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/lib/ui/popover';
import { CUSTOM_BREAKPOINTS, useWindowBreakpoints } from '@/composable/window-breakpoints';
import { createReusableTemplate, useVModel } from '@vueuse/core';
import type { HTMLAttributes } from 'vue';

const [UseTemplate, SlotContent] = createReusableTemplate();
const isMobile = useWindowBreakpoints(CUSTOM_BREAKPOINTS.uiMobile);

const props = withDefaults(
  defineProps<{
    open?: boolean;
    /** Drawer heading and the popover's accessible name. */
    title: string;
    /** Popover variant only; the drawer always spans the screen width. */
    contentClass?: HTMLAttributes['class'];
    align?: 'start' | 'center' | 'end';
  }>(),
  { open: undefined, contentClass: undefined, align: 'center' },
);

const emit = defineEmits<{ 'update:open': [value: boolean] }>();

const isOpen = useVModel(props, 'open', emit, { passive: true });
</script>

<template>
  <UseTemplate>
    <slot />
  </UseTemplate>

  <Drawer.Drawer v-if="isMobile" v-model:open="isOpen">
    <Drawer.DrawerTrigger as-child>
      <slot name="trigger" />
    </Drawer.DrawerTrigger>
    <Drawer.DrawerContent class="px-4 pb-4">
      <Drawer.DrawerTitle class="pt-4 pb-2 text-base font-medium">{{ title }}</Drawer.DrawerTitle>
      <SlotContent />
    </Drawer.DrawerContent>
  </Drawer.Drawer>

  <Popover v-else v-model:open="isOpen">
    <PopoverTrigger as-child>
      <slot name="trigger" />
    </PopoverTrigger>
    <PopoverContent :align="align" :class="contentClass" :aria-label="title">
      <SlotContent />
    </PopoverContent>
  </Popover>
</template>
