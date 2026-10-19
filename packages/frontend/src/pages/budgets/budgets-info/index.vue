<script setup lang="ts">
import { loadBudgetById } from '@/api/budgets';
import { VUE_QUERY_CACHE_KEYS } from '@/common/const';
import ResourceNotFound from '@/components/common/resource-not-found.vue';
import { useNotificationCenter } from '@/components/notification-center';
import { isNotFoundError } from '@/js/errors';
import { ROUTES_NAMES } from '@/routes/constants';
import { useQuery } from '@tanstack/vue-query';
import { computed, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';

import BudgetDetailSkeleton from './budget-detail-skeleton.vue';
import TrackerDetails from './tracker-details.vue';

const route = useRoute();
const router = useRouter();
const { t } = useI18n();
const { addErrorNotification } = useNotificationCenter();
const currentBudgetId = computed(() => String(route.params.id));

const {
  data: budgetItem,
  isError,
  error,
} = useQuery({
  queryFn: () => loadBudgetById(currentBudgetId.value),
  queryKey: computed(() => [...VUE_QUERY_CACHE_KEYS.budgetsListItem, currentBudgetId.value]),
  staleTime: Infinity,
  retry: false,
});

const isNotFound = computed(() => isError.value && isNotFoundError(error.value));

watch(
  error,
  (latestError) => {
    if (!latestError || isNotFound.value) return;
    addErrorNotification(t('errors.api.unexpectedError'));
    if (!budgetItem.value) router.replace({ name: ROUTES_NAMES.plannedBudgets });
  },
  { immediate: true },
);
</script>

<template>
  <ResourceNotFound
    v-if="isNotFound"
    :title="t('budgets.notFound')"
    :description="t('budgets.notFoundDescription')"
    :link-label="t('budgets.backToList')"
    :link-to="{ name: ROUTES_NAMES.plannedBudgets }"
  />
  <TrackerDetails v-else-if="budgetItem" :key="budgetItem.id" :budget="budgetItem" />
  <BudgetDetailSkeleton v-else />
</template>
