<script lang="ts" setup>
import { cn } from '@/lib/utils';
import type { OnboardingTask } from '@/stores/onboarding';
import { CheckIcon, CircleIcon } from '@lucide/vue';

const props = defineProps<{
  task: OnboardingTask;
  isCompleted: boolean;
}>();

const emit = defineEmits<{
  click: [task: OnboardingTask];
}>();

const handleClick = () => {
  if (!props.isCompleted) {
    emit('click', props.task);
  }
};
</script>

<template>
  <button
    type="button"
    :class="
      cn(
        'flex w-full items-center gap-2 rounded py-1.5 pl-2 text-left transition-colors',
        isCompleted ? 'cursor-default' : 'hover:bg-hover cursor-pointer',
      )
    "
    :disabled="isCompleted"
    @click="handleClick"
  >
    <!-- Checkbox circle -->
    <div class="shrink-0">
      <div
        v-if="isCompleted"
        class="bg-primary text-primary-foreground flex size-5 items-center justify-center rounded-full"
      >
        <CheckIcon class="size-3" />
      </div>
      <CircleIcon v-else class="text-muted-foreground/50 size-5" />
    </div>

    <!-- Title and description -->
    <div class="min-w-0 flex-1">
      <span :class="cn('text-sm', isCompleted && 'text-muted-foreground line-through')">
        {{ task.title }}
      </span>
      <p v-if="task.description" class="text-muted-foreground text-xs">
        {{ task.description }}
      </p>
    </div>
  </button>
</template>
