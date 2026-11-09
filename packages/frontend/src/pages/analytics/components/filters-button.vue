<template>
  <div>
    <ResponsiveMenu v-model:open="isOpen" popover-class="w-80 max-w-none p-3">
      <template #trigger>
        <Button
          :variant="activeCount ? 'soft-primary' : 'secondary'"
          size="sm"
          :aria-label="label"
          class="shrink-0 gap-1.5"
        >
          <SlidersHorizontalIcon class="size-4" />
          <span :class="labelClass">{{ label }}</span>
          <span
            v-if="activeCount"
            class="bg-primary text-primary-foreground inline-flex size-4.5 items-center justify-center rounded-full text-[10px] font-medium"
          >
            {{ activeCount }}
          </span>
        </Button>
      </template>

      <slot />
    </ResponsiveMenu>
  </div>
</template>

<script setup lang="ts">
import ResponsiveMenu from '@/components/common/responsive-menu.vue';
import { Button } from '@/components/lib/ui/button';
import { SlidersHorizontalIcon } from '@lucide/vue';
import { ref } from 'vue';

withDefaults(
  defineProps<{
    label: string;
    activeCount?: number;
    labelClass?: string;
  }>(),
  { activeCount: 0, labelClass: 'hidden @sm:inline' },
);

const isOpen = ref(false);
</script>
