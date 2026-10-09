<template>
  <div class="flex flex-col items-center gap-2">
    <button
      :disabled="isDemoLoading"
      class="border-primary/50 text-primary hover:bg-primary/10 flex w-full items-center justify-center gap-2 rounded-xl border-2 px-8 py-3.5 text-base font-semibold transition-all disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
      @click="handleTryDemo"
    >
      <!-- PlayCircle icon -->
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        class="size-5"
      >
        <circle cx="12" cy="12" r="10" />
        <polygon points="10 8 16 12 10 16 10 8" />
      </svg>
      Try Demo
    </button>
    <span v-if="errorMessage" class="text-destructive-text max-w-xs text-center text-xs" role="alert">
      {{ errorMessage }}
    </span>
    <span v-else class="text-muted-foreground text-xs">No signup required &bull; Sample data</span>
  </div>

  <DemoLoadingOverlay :is-visible="isDemoLoading" />
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';

import type { DemoStartLocation } from '../lib/posthog';
import { startDemo } from '../lib/start-demo';
import DemoLoadingOverlay from './demo-loading-overlay.vue';

const props = withDefaults(defineProps<{ location?: DemoStartLocation; autoStart?: boolean }>(), {
  location: 'hero',
  autoStart: false,
});

const isDemoLoading = ref(false);
const errorMessage = ref('');

async function handleTryDemo() {
  if (isDemoLoading.value) return;

  isDemoLoading.value = true;
  errorMessage.value = '';

  await startDemo({
    location: props.location,
    // An auto-started page left in history would start another demo on Back.
    replaceHistory: props.autoStart,
    onError: ({ message }) => {
      errorMessage.value = message;
      isDemoLoading.value = false;
    },
  });
}

// A bfcache restore replays the state the page had when the demo redirected away.
function handlePageShow(event: PageTransitionEvent) {
  if (!event.persisted) return;

  isDemoLoading.value = false;
  errorMessage.value = '';
}

onMounted(() => {
  window.addEventListener('pageshow', handlePageShow);
  if (props.autoStart) handleTryDemo();
});

onBeforeUnmount(() => {
  window.removeEventListener('pageshow', handlePageShow);
});
</script>
