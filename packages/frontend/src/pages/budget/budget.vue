<script setup lang="ts">
import { loadBudgetPlans, restoreBudgetPlan } from '@/api/budget-plans';
import { VUE_QUERY_CACHE_KEYS } from '@/common/const';
import PlanRestricted from '@/components/billing/plan-restricted.vue';
import PageWrapper from '@/components/common/page-wrapper.vue';
import { Button } from '@/components/lib/ui/button';
import { Callout } from '@/components/lib/ui/callout';
import { useInvalidatingMutation } from '@/composable/data-queries/use-invalidating-mutation';
import { ROUTES_NAMES } from '@/routes/constants';
import { useCurrenciesStore, useUserStore } from '@/stores';
import { FEATURES, PLANS } from '@bt/shared/types';
import { useQuery } from '@tanstack/vue-query';
import { compareDesc } from 'date-fns';
import { storeToRefs } from 'pinia';
import { computed, ref, watch } from 'vue';
import { useRouter } from 'vue-router';

import BudgetEmptyState from './components/budget-empty-state.vue';
import BudgetTrialNotice from './components/budget-trial-notice.vue';
import CreatePlanDialog from './components/create-plan-dialog.vue';

const router = useRouter();
const { baseCurrency } = storeToRefs(useCurrenciesStore());
const { entitlements } = storeToRefs(useUserStore());

const isCreateOpen = ref(false);

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

// Restore fails once the base currency moved away from the plan's, so the offer is hidden then.
const trashedPlan = computed(() => {
  if (activePlan.value) return undefined;
  const [latest] = (plans.value ?? [])
    .filter((plan) => plan.deletedAt)
    .sort((a, b) => compareDesc(a.deletedAt!, b.deletedAt!));
  return latest && latest.currencyCode === baseCurrency.value?.currencyCode ? latest : undefined;
});

// ponytail: v1 allows a single plan, so the first active one wins; a plan picker replaces this when that changes.
watch(
  activePlan,
  (plan) => {
    if (plan) router.replace({ name: ROUTES_NAMES.budgetPlan, params: { planId: plan.id } });
  },
  { immediate: true },
);

const { isPending: isRestoring, mutate: restore } = useInvalidatingMutation({
  mutationFn: restoreBudgetPlan,
  invalidateKeys: [VUE_QUERY_CACHE_KEYS.budgetPlans],
  successKey: 'budgetPlans.trashed.restored',
  errorKey: 'budgetPlans.trashed.restoreError',
});
</script>

<template>
  <PageWrapper class="grid gap-6">
    <h1 class="text-2xl font-semibold tracking-tight">{{ $t('budgetPlans.title') }}</h1>

    <div v-if="isLoading" class="bg-muted mx-auto h-64 w-full max-w-lg animate-pulse rounded-xl" />

    <Callout v-else-if="isError" variant="destructive" class="mx-auto max-w-lg">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <span>{{ $t('budgetPlans.loadError') }}</span>
        <Button size="sm" variant="outline" :disabled="isFetching" @click="refetch()">
          {{ $t('common.actions.retry') }}
        </Button>
      </div>
    </Callout>

    <div v-else-if="!activePlan" class="mx-auto grid w-full max-w-lg gap-6">
      <PlanRestricted
        :feature="FEATURES.budget_plan"
        :hint="entitlements?.plan === PLANS.early_adopter ? $t('budgetPlans.trialNotice.offer') : undefined"
      >
        <BudgetTrialNotice />

        <Callout v-if="trashedPlan" :title="$t('budgetPlans.trashed.title')">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <span>{{ $t('budgetPlans.trashed.description') }}</span>
            <Button size="sm" variant="outline" :disabled="isRestoring" @click="restore({ planId: trashedPlan.id })">
              {{ $t('budgetPlans.trashed.restore') }}
            </Button>
          </div>
        </Callout>

        <BudgetEmptyState @start="isCreateOpen = true" />
      </PlanRestricted>
    </div>

    <CreatePlanDialog v-model:open="isCreateOpen" />
  </PageWrapper>
</template>
