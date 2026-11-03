<script setup lang="ts">
import { cn } from '@/lib/utils';
import { ScrollAreaCorner, ScrollAreaRoot, type ScrollAreaRootProps, ScrollAreaViewport } from 'reka-ui';
import { provide, ref } from 'vue';

import ScrollBar from './ScrollBar.vue';
import { SCROLL_AREA_IDS } from './types';

const props = withDefaults(
  defineProps<
    ScrollAreaRootProps & {
      class?: string;
      viewportClass?: string;
      scrollbarClass?: string;
      scrollY?: () => void;
      scrollAreaId?: SCROLL_AREA_IDS;
      /** Renders a horizontal scrollbar in addition to the vertical one (wide tables). */
      withHorizontalScrollbar?: boolean;
    }
  >(),
  {
    class: '',
    viewportClass: '',
    scrollbarClass: undefined,
    orientation: 'vertical',
    scrollY: undefined,
    withHorizontalScrollbar: false,
  },
);

const viewportRef = ref<typeof ScrollAreaViewport | null>(null);

// Provide the viewport ref using the scrollAreaId as the key, so that
// children can inject it and refer to it. For example virtualized lists.
if (props.scrollAreaId) {
  provide(props.scrollAreaId, viewportRef);
}

defineExpose({ viewportRef });
</script>

<template>
  <ScrollAreaRoot :type="type" :class="cn('relative overflow-hidden', props.class)">
    <ScrollAreaViewport
      ref="viewportRef"
      :class="cn('h-full w-full rounded-[inherit]', props.viewportClass)"
      @scroll="scrollY"
    >
      <slot />
    </ScrollAreaViewport>
    <ScrollBar :class="scrollbarClass" />
    <ScrollBar v-if="withHorizontalScrollbar" orientation="horizontal" />
    <ScrollAreaCorner />
  </ScrollAreaRoot>
</template>
