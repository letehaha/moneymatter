<script setup lang="ts">
import { loadBudgetPlans } from '@/api/budget-plans';
import { VUE_QUERY_CACHE_KEYS } from '@/common/const';
import PlanRestricted from '@/components/billing/plan-restricted.vue';
import PageWrapper from '@/components/common/page-wrapper.vue';
import { Button } from '@/components/lib/ui/button';
import { Callout } from '@/components/lib/ui/callout';
import { cn } from '@/lib/utils';
import { ROUTES_NAMES } from '@/routes/constants';
import { useUserStore } from '@/stores';
import { FEATURES, PLANS } from '@bt/shared/types';
import { Trash2Icon } from '@lucide/vue';
import { useQuery } from '@tanstack/vue-query';
import { storeToRefs } from 'pinia';
import { computed, ref, watch } from 'vue';
import { useRouter } from 'vue-router';

import BudgetEmptyState from './components/budget-empty-state.vue';
import BudgetPlanSkeleton from './components/budget-plan-skeleton.vue';
import BudgetSidePanelSkeleton from './components/budget-side-panel-skeleton.vue';
import BudgetTrialNotice from './components/budget-trial-notice.vue';
import CreatePlanDialog from './components/create-plan-dialog.vue';
import DeletedPlansDialog from './components/deleted-plans-dialog.vue';
import { useFrameLayout } from './composables/use-panel-layout';
import { trashedPlansOf } from './helpers';

const router = useRouter();
const { entitlements } = storeToRefs(useUserStore());

const isCreateOpen = ref(false);
const isDeletedOpen = ref(false);
const frameRef = ref<HTMLElement | null>(null);
const { panelWidth, isNarrow, isPanelAttached, isPanelTab } = useFrameLayout({ frameRef });

const {
  data: plans,
  isLoading,
  isError,
  isFetching,
  refetch,
} = useQuery({
  queryKey: VUE_QUERY_CACHE_KEYS.budgetPlansList,
  queryFn: loadBudgetPlans,
});

const activePlan = computed(() => plans.value?.find((plan) => !plan.deletedAt));

const trashedPlans = computed(() => trashedPlansOf({ plans: plans.value ?? [] }));

// ponytail: v1 allows a single plan, so the first active one wins; a plan picker replaces this when that changes.
watch(
  activePlan,
  (plan) => {
    if (plan)
      router.replace({
        name: ROUTES_NAMES.budgetPlan,
        params: { planId: plan.id },
      });
  },
  { immediate: true },
);
</script>

<template>
  <PageWrapper class="grid gap-6">
    <div class="flex items-center justify-between gap-4">
      <h1 class="text-2xl font-semibold tracking-tight">{{ $t('budgetPlans.title') }}</h1>
      <Button v-if="trashedPlans.length && !activePlan" variant="outline" size="sm" @click="isDeletedOpen = true">
        <Trash2Icon class="size-4" />
        {{ $t('budgetPlans.trashed.open') }}
        <span class="bg-muted rounded-full px-1.5 text-xs tabular-nums">{{ trashedPlans.length }}</span>
      </Button>
    </div>

    <section
      v-if="isLoading"
      ref="frameRef"
      :class="
        cn(
          'border-border bg-card grid min-w-0 overflow-clip rounded-lg border',
          isPanelAttached && 'grid-cols-[minmax(0,1fr)_var(--panel-width)]',
          isPanelTab && 'grid-cols-[minmax(0,1fr)_2.75rem]',
        )
      "
      :style="{ '--panel-width': `${panelWidth}px` }"
      aria-hidden="true"
    >
      <div class="min-w-0">
        <div class="border-border flex animate-pulse items-center gap-4 border-b px-4 py-2">
          <template v-if="!isNarrow">
            <div v-for="stat in 4" :key="stat" class="grid flex-1 gap-1.5 py-0.5">
              <div class="bg-muted h-2.5 w-16 rounded" />
              <div class="bg-muted h-5 w-24 rounded" />
            </div>
          </template>
          <div class="ml-auto flex gap-2">
            <div v-for="button in isNarrow ? 1 : 3" :key="button" class="bg-muted size-8 rounded-md" />
          </div>
        </div>
        <BudgetPlanSkeleton :narrow="isNarrow" />
      </div>
      <div v-if="isPanelAttached" class="border-border border-l p-4">
        <BudgetSidePanelSkeleton />
      </div>
      <div v-else-if="isPanelTab" class="border-border bg-muted/40 border-l" />
    </section>

    <Callout v-else-if="isError" variant="destructive" class="mx-auto max-w-lg">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <span>{{ $t('budgetPlans.loadError') }}</span>
        <Button size="sm" variant="outline" :disabled="isFetching" @click="refetch()">
          {{ $t('common.actions.retry') }}
        </Button>
      </div>
    </Callout>

    <div v-else-if="!activePlan" class="grid gap-6">
      <PlanRestricted
        :feature="FEATURES.budget_plan"
        :hint="entitlements?.plan === PLANS.early_adopter ? $t('budgetPlans.trialNotice.offer') : undefined"
      >
        <div class="mx-auto w-full max-w-lg empty:hidden">
          <BudgetTrialNotice />
        </div>

        <BudgetEmptyState @start="isCreateOpen = true" />
      </PlanRestricted>
    </div>

    <CreatePlanDialog v-model:open="isCreateOpen" />
    <DeletedPlansDialog v-model:open="isDeletedOpen" :plans="trashedPlans" />
  </PageWrapper>
</template>
