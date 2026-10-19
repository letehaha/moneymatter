<script setup lang="ts">
import ResponsiveDialog from '@/components/common/responsive-dialog.vue';
import Button from '@/components/lib/ui/button/Button.vue';
import { trackAnalyticsEvent } from '@/lib/posthog';
import { PlusIcon } from '@lucide/vue';
import { ref } from 'vue';

import BudgetCreation from './budget-creation.vue';
import BudgetList from './budget-list.vue';

const isOpen = ref(false);
const openModal = () => {
  isOpen.value = true;
  trackAnalyticsEvent({ event: 'budget_creation_opened' });
};
const isModalClosed = () => {
  isOpen.value = false;
};
</script>

<template>
  <div class="max-w-5xl">
    <div class="mb-4 flex items-center justify-between gap-3">
      <div class="min-w-0">
        <h1 class="text-2xl font-bold tracking-tight">{{ $t('budgets.title') }}</h1>
        <p class="text-muted-foreground mt-0.5 text-xs">{{ $t('budgets.description') }}</p>
      </div>
      <Button class="shrink-0" @click="openModal">
        <PlusIcon class="size-4" />
        {{ $t('budgets.newBudget') }}
      </Button>
    </div>

    <BudgetList @create="openModal" />

    <ResponsiveDialog v-model:open="isOpen">
      <template #title> {{ $t('budgets.createBudget') }} </template>
      <BudgetCreation @create-budget="isModalClosed" />
    </ResponsiveDialog>
  </div>
</template>
