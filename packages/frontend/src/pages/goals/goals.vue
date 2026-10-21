<script setup lang="ts">
import { config } from '@/common/config';
import PageWrapper from '@/components/common/page-wrapper.vue';
import Button from '@/components/lib/ui/button/Button.vue';
import { useGoals } from '@/composable/data-queries/goals';
import type { GoalModel } from '@bt/shared/types';
import { BookOpenIcon, PlusIcon } from '@lucide/vue';
import { computed, ref } from 'vue';

import GoalFormDialog from './components/goal-form-dialog.vue';
import GoalList from './components/goal-list.vue';
import GoalsAccessCallout from './components/goals-access-callout.vue';
import GoalsFeasibilityBanner from './components/goals-feasibility-banner.vue';
import { useGoalsAccess } from './composables/use-goals-access';

const { data, isError } = useGoals();
const { canWrite } = useGoalsAccess();

const goals = computed(() => data.value ?? []);

const isFormOpen = ref(false);
const editingGoal = ref<GoalModel | undefined>();

const openForm = ({ goal }: { goal?: GoalModel } = {}) => {
  editingGoal.value = goal;
  isFormOpen.value = true;
};
</script>

<template>
  <PageWrapper class="grid max-w-5xl gap-4">
    <div class="@container/goals-header flex items-center justify-between gap-3">
      <div class="min-w-0">
        <div class="flex items-center gap-2">
          <h1 class="text-2xl font-bold tracking-tight">{{ $t('goals.title') }}</h1>
          <Button as-child variant="ghost" size="sm" class="text-muted-foreground">
            <a
              :href="`${config.docsUrl}/goals/overview/`"
              target="_blank"
              rel="noopener noreferrer"
              :aria-label="$t('goals.docs.howItWorks')"
            >
              <BookOpenIcon class="size-4" />
              <span class="hidden @xl/goals-header:inline">{{ $t('goals.docs.howItWorks') }}</span>
            </a>
          </Button>
        </div>
        <p class="text-muted-foreground mt-1 text-sm">{{ $t('goals.description') }}</p>
      </div>
      <Button v-if="canWrite" class="shrink-0" @click="openForm()">
        <PlusIcon class="size-4" />
        {{ $t('goals.newGoal') }}
      </Button>
    </div>

    <GoalsAccessCallout />

    <GoalsFeasibilityBanner v-if="!isError && goals.length" :goals="goals" />

    <GoalList :can-write="canWrite" @create="openForm()" @edit="(goal) => openForm({ goal })" />

    <GoalFormDialog v-model:open="isFormOpen" :goal="editingGoal" />
  </PageWrapper>
</template>
