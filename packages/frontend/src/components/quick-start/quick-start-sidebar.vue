<script lang="ts" setup>
import { ScrollArea, ScrollBar } from '@/components/lib/ui/scroll-area';
import { SCROLL_AREA_IDS } from '@/components/lib/ui/scroll-area/types';
import { cn } from '@/lib/utils';
import type { OnboardingTask } from '@/stores/onboarding';
import { useOnboardingStore } from '@/stores/onboarding';
import { ChevronLeftIcon } from '@lucide/vue';
import { storeToRefs } from 'pinia';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';

const { t } = useI18n();

import QuickStartCategory from './quick-start-category.vue';
import QuickStartFooter from './quick-start-footer.vue';
import QuickStartHeader from './quick-start-header.vue';

const router = useRouter();
const onboardingStore = useOnboardingStore();

const { isPanelOpen, categories, progressPercentage, completedCount, totalTasks, remainingCount, shouldShowTrigger } =
  storeToRefs(onboardingStore);

const handleToggle = () => {
  if (isPanelOpen.value) {
    onboardingStore.closePanel();
  } else {
    onboardingStore.openPanel();
  }
};

const handleDismiss = () => {
  onboardingStore.dismissPermanently();
};

const handleToggleCategory = (categoryId: string) => {
  onboardingStore.toggleCategory(categoryId);
};

const handleTaskClick = (task: OnboardingTask) => {
  if (task.route) {
    router.push({ name: task.route });
  }
};

// Calculate stroke-dasharray for the circular progress
const circumference = 2 * Math.PI * 15.9155;
const strokeDasharray = (progress: number) => {
  const filled = (progress / 100) * circumference;
  return `${filled} ${circumference}`;
};
</script>

<template>
  <div
    v-if="shouldShowTrigger"
    :class="
      cn('bg-background flex flex-col border-l transition-all duration-300 ease-in-out', isPanelOpen ? 'w-80' : 'w-12')
    "
  >
    <!-- Collapsed state -->
    <button
      v-if="!isPanelOpen"
      type="button"
      class="hover:bg-hover flex h-full w-full flex-col items-center gap-3 py-4 transition-colors"
      @click="handleToggle"
    >
      <!-- Expand chevron -->
      <ChevronLeftIcon class="text-muted-foreground size-4" />

      <!-- Circular progress with count inside -->
      <div class="relative size-9">
        <svg class="size-9 -rotate-90" viewBox="0 0 36 36">
          <!-- Background circle -->
          <circle class="stroke-muted" stroke-width="3" fill="none" cx="18" cy="18" r="15.9155" />
          <!-- Progress circle -->
          <circle
            class="stroke-primary transition-all duration-500 ease-out"
            stroke-width="3"
            stroke-linecap="round"
            fill="none"
            cx="18"
            cy="18"
            r="15.9155"
            :stroke-dasharray="strokeDasharray(progressPercentage)"
          />
        </svg>
        <!-- Remaining count inside circle -->
        <div class="absolute inset-0 flex items-center justify-center">
          <span class="text-primary-text text-xs font-semibold">{{ remainingCount }}</span>
        </div>
      </div>

      <!-- Rotated "Quick Start" text -->
      <span
        class="text-muted-foreground text-xs font-medium whitespace-nowrap"
        style="writing-mode: vertical-rl; text-orientation: mixed"
      >
        {{ t('dashboard.onboarding.quickStart.ui.title') }}
      </span>
    </button>

    <!-- Expanded state -->
    <template v-else>
      <QuickStartHeader
        :progress="progressPercentage"
        :completed-count="completedCount"
        :total-count="totalTasks"
        @close="handleToggle"
      />

      <ScrollArea class="flex-1" :scroll-area-id="SCROLL_AREA_IDS.quickStart">
        <div class="space-y-0.5 px-3 py-2">
          <QuickStartCategory
            v-for="category in categories"
            :key="category.id"
            :category="category"
            :is-expanded="onboardingStore.isCategoryExpanded(category.id)"
            :completed-count="onboardingStore.getCategoryProgress(category.id).completed"
            :is-task-completed="onboardingStore.isTaskCompleted"
            @toggle="handleToggleCategory(category.id)"
            @task-click="handleTaskClick"
          />
        </div>
        <ScrollBar />
      </ScrollArea>

      <QuickStartFooter @dismiss="handleDismiss" />
    </template>
  </div>
</template>
