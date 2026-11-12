<template>
  <Teleport to="body" :disabled="!isMounted">
    <Transition name="fade">
      <div
        v-if="isVisible"
        role="status"
        class="bg-background/95 fixed inset-0 z-100 flex flex-col items-center justify-center backdrop-blur-sm"
      >
        <!-- Animated building blocks -->
        <div class="relative mb-8 h-24 w-32">
          <div class="building-animation flex items-end justify-center gap-1">
            <div
              v-for="i in 5"
              :key="i"
              class="bg-primary/80 w-4 rounded-t"
              :class="`brick-${i}`"
              :style="{ animationDelay: `${(i - 1) * 0.15}s` }"
            />
          </div>
        </div>

        <!-- Main message -->
        <h2 class="text-foreground mb-3 text-2xl font-bold">Setting up your demo...</h2>

        <!-- Progress dots -->
        <div class="mt-6 flex gap-2">
          <div
            v-for="i in 3"
            :key="i"
            class="progress-dot bg-primary/60 size-2 rounded-full"
            :style="{ animationDelay: `${(i - 1) * 0.2}s` }"
          />
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';

import { useScrollLock } from '../lib/use-scroll-lock';

const props = defineProps<{
  isVisible: boolean;
}>();

// Disable Teleport during SSR to avoid hydration mismatch
const isMounted = ref(false);
onMounted(() => {
  isMounted.value = true;
});

const { lock: lockScroll, unlock: unlockScroll } = useScrollLock();

watch(
  () => props.isVisible,
  (isVisible) => {
    if (isVisible) lockScroll();
    else unlockScroll();
  },
);
</script>

<style scoped>
/* Building blocks animation */
.building-animation .brick-1,
.building-animation .brick-2,
.building-animation .brick-3,
.building-animation .brick-4,
.building-animation .brick-5 {
  animation: build-up 2s ease-in-out infinite;
}

.building-animation .brick-1 {
  height: 40px;
}
.building-animation .brick-2 {
  height: 60px;
}
.building-animation .brick-3 {
  height: 80px;
}
.building-animation .brick-4 {
  height: 55px;
}
.building-animation .brick-5 {
  height: 35px;
}

@keyframes build-up {
  0%,
  100% {
    transform: scaleY(0.3);
    opacity: 0.5;
  }
  50% {
    transform: scaleY(1);
    opacity: 1;
  }
}

.progress-dot {
  animation: pulse-dot 1.4s ease-in-out infinite;
}

@media (prefers-reduced-motion: reduce) {
  .building-animation [class*='brick-'],
  .progress-dot {
    animation: none;
  }
}

@keyframes pulse-dot {
  0%,
  100% {
    transform: scale(1);
    opacity: 0.6;
  }
  50% {
    transform: scale(1.3);
    opacity: 1;
  }
}

/* Transitions */
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.3s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
