<script setup lang="ts">
import { ScrollArea } from '@/components/lib/ui/scroll-area';
import { cn } from '@/lib/utils';

defineProps<{ viewportClass?: string }>();
</script>

<template>
  <aside class="border-border bg-card sticky top-[calc(var(--header-height)+1rem)] rounded-lg border">
    <ScrollArea :viewport-class="cn('max-h-[calc(100dvh-var(--header-height)-2rem)] p-4', viewportClass)">
      <slot />
    </ScrollArea>
  </aside>
</template>
