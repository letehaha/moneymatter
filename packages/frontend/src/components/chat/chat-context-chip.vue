<script setup lang="ts">
import { Button } from '@/components/lib/ui/button';
import { MapPinIcon, XIcon } from '@lucide/vue';

defineProps<{
  /** The text of the thread's page context; null when the thread has none. */
  label: string | null;
  /** The page the user is on differs from the thread's: offer to switch, never switch by itself. */
  canUseCurrentPage: boolean;
}>();

const emit = defineEmits<{ remove: []; 'use-current-page': [] }>();
</script>

<template>
  <div v-if="label || canUseCurrentPage" class="flex min-w-0 flex-wrap items-center gap-1.5">
    <span
      v-if="label"
      class="bg-muted text-foreground inline-flex max-w-full min-w-0 items-center gap-1 rounded-full py-0.5 pr-1 pl-2.5 text-xs"
      data-testid="context-chip"
    >
      <MapPinIcon class="text-muted-foreground size-3 shrink-0" aria-hidden="true" />
      <span class="truncate" :title="label">{{ $t('chat.composer.context.label', { label }) }}</span>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        class="size-5 shrink-0 rounded-full"
        data-testid="context-remove"
        :aria-label="$t('chat.composer.context.remove')"
        @click="emit('remove')"
      >
        <XIcon class="size-3" aria-hidden="true" />
      </Button>
    </span>
    <Button
      v-if="canUseCurrentPage"
      type="button"
      variant="ghost"
      size="sm"
      class="h-6 px-2 text-xs"
      data-testid="context-use-page"
      @click="emit('use-current-page')"
    >
      {{ $t('chat.composer.context.useThisPage') }}
    </Button>
  </div>
</template>
