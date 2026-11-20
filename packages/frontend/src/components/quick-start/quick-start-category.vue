<script lang="ts" setup>
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/lib/ui/collapsible';
import { cn } from '@/lib/utils';
import type { OnboardingCategory, OnboardingTask } from '@/stores/onboarding';
import {
  BarChart3Icon,
  CheckCircle2Icon,
  ChevronRightIcon,
  FolderIcon,
  LayersIcon,
  Link2Icon,
  RocketIcon,
  SparklesIcon,
  UsersIcon,
} from '@lucide/vue';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

import QuickStartTask from './quick-start-task.vue';

const { t } = useI18n();

const props = defineProps<{
  category: OnboardingCategory;
  isExpanded: boolean;
  completedCount: number;
  isTaskCompleted: (taskId: string) => boolean;
}>();

const emit = defineEmits<{
  toggle: [];
  taskClick: [task: OnboardingTask];
}>();

const isComplete = computed(() => props.completedCount === props.category.tasks.length);

// Icon mapping with colors
const iconConfig = computed(() => {
  const configs: Record<string, { icon: typeof RocketIcon; color: string }> = {
    rocket: { icon: RocketIcon, color: 'text-orange-500' },
    layers: { icon: LayersIcon, color: 'text-blue-500' },
    folder: { icon: FolderIcon, color: 'text-purple-500' },
    link: { icon: Link2Icon, color: 'text-cyan-500' },
    chart: { icon: BarChart3Icon, color: 'text-green-500' },
    sparkles: { icon: SparklesIcon, color: 'text-yellow-500' },
    users: { icon: UsersIcon, color: 'text-pink-500' },
  };
  return configs[props.category.icon] || { icon: RocketIcon, color: 'text-orange-500' };
});
</script>

<template>
  <Collapsible :open="isExpanded" @update:open="emit('toggle')">
    <CollapsibleTrigger as-child>
      <button
        type="button"
        :class="
          cn(
            'flex w-full items-center gap-2 py-2 text-left transition-colors',
            'hover:bg-hover -mx-2 rounded-md px-2',
            isComplete && 'opacity-60',
          )
        "
      >
        <!-- Icon -->
        <CheckCircle2Icon v-if="isComplete" class="text-primary-text size-5 shrink-0" />
        <component :is="iconConfig.icon" v-else :class="cn('size-5 shrink-0', iconConfig.color)" />

        <!-- Title -->
        <span :class="cn('flex-1 text-sm font-medium', isComplete && 'text-muted-foreground')">
          {{ category.title }}
        </span>

        <!-- Progress text -->
        <span class="text-muted-foreground text-xs">
          {{
            t('dashboard.onboarding.quickStart.ui.categoryProgress', {
              completed: completedCount,
              total: category.tasks.length,
            })
          }}
        </span>

        <!-- Chevron -->
        <ChevronRightIcon
          :class="cn('text-muted-foreground size-4 shrink-0 transition-transform', isExpanded && 'rotate-90')"
        />
      </button>
    </CollapsibleTrigger>

    <CollapsibleContent>
      <div class="space-y-0.5 py-1 pl-5">
        <QuickStartTask
          v-for="task in category.tasks"
          :key="task.id"
          :task="task"
          :is-completed="isTaskCompleted(task.id)"
          @click="emit('taskClick', task)"
        />
      </div>
    </CollapsibleContent>
  </Collapsible>
</template>
