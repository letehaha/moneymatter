<template>
  <div class="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
    <div class="bg-muted flex size-14 items-center justify-center rounded-full">
      <component :is="icon" class="text-muted-foreground size-7" />
    </div>
    <div class="space-y-1">
      <p class="text-base font-medium">{{ title }}</p>
      <p class="text-muted-foreground mx-auto max-w-md text-sm">{{ description }}</p>
    </div>
    <UiButton class="mt-1" @click="emit('action')">
      <PlusIcon class="size-4" />
      {{ actionLabel }}
    </UiButton>
  </div>
</template>

<script setup lang="ts">
import UiButton from '@/components/lib/ui/button/Button.vue';
import { PlusIcon } from '@lucide/vue';
import type { Component } from 'vue';

// Empty state for analytics reports that need at least one portfolio to have
// anything to show. Copy and icon are per-report; the action points the user at
// where to start.
defineProps<{
  icon: Component;
  title: string;
  description: string;
  actionLabel: string;
}>();

const emit = defineEmits<{
  action: [];
}>();
</script>
