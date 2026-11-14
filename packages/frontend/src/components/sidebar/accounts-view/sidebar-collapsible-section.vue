<script setup lang="ts">
import { Collapsible, CollapsibleContent } from '@/components/lib/ui/collapsible';
import { ChevronRightIcon } from '@lucide/vue';
import { type Component, ref } from 'vue';

defineProps<{
  /** Section icon rendered before the label. */
  icon: Component;
  label: string;
  /** Small count badge after the label; hidden when absent or zero. Overridden by the `trailing` slot. */
  count?: number;
  /** Literal Tailwind sticky offset classes (kept literal so the scanner emits them). */
  topClass?: string;
  bottomClass?: string;
}>();

const open = defineModel<boolean>('open', { required: true });

// The parent owns the scroll viewport, so on expand the header reports its own elements and lets
// the parent scroll it into view once the open animation finishes.
const emit = defineEmits<{
  expand: [{ headerEl: HTMLElement | undefined; wrapperEl: HTMLElement | undefined }];
}>();

const headerRef = ref<HTMLElement>();
const wrapperRef = ref<HTMLElement>();

const onHeaderClick = () => {
  const wasOpen = open.value;
  open.value = !wasOpen;
  if (!wasOpen) emit('expand', { headerEl: headerRef.value, wrapperEl: wrapperRef.value });
};
</script>

<template>
  <button
    ref="headerRef"
    type="button"
    class="bg-card hover:bg-accent sticky z-(--z-over-default) flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm font-semibold transition-colors"
    :class="[topClass, bottomClass]"
    @click="onHeaderClick"
  >
    <ChevronRightIcon :class="['size-4 shrink-0 transition-transform duration-200', { 'rotate-90': open }]" />
    <component :is="icon" class="text-muted-foreground size-4 shrink-0" />
    <span class="min-w-0 truncate">{{ label }}</span>
    <span class="ml-auto shrink-0">
      <slot name="trailing">
        <span v-if="count" class="text-muted-foreground text-xs tabular-nums">
          {{ count }}
        </span>
      </slot>
    </span>
  </button>
  <div ref="wrapperRef">
    <Collapsible v-model:open="open">
      <CollapsibleContent>
        <div class="mt-0.5 mb-2">
          <slot />
        </div>
      </CollapsibleContent>
    </Collapsible>
  </div>
</template>
