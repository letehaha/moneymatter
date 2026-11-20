<script setup lang="ts">
import { loadTrackerById, syncTrackerRules } from '@/api/trackers';
import { VUE_QUERY_CACHE_KEYS } from '@/common/const';
import ResourceNotFound from '@/components/common/resource-not-found.vue';
import { useNotificationCenter } from '@/components/notification-center';
import { ApiErrorResponseError, isNotFoundError } from '@/js/errors';
import { captureException } from '@/lib/sentry';
import { ROUTES_NAMES } from '@/routes/constants';
import { useQuery } from '@tanstack/vue-query';
import { computed, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';

import { useInvalidateTracker } from '../components/use-tracker-actions';
import TrackerDetailSkeleton from './tracker-detail-skeleton.vue';
import TrackerDetails from './tracker-details.vue';

const route = useRoute();
const router = useRouter();
const { t } = useI18n();
const { addErrorNotification } = useNotificationCenter();
const currentTrackerId = computed(() => String(route.params.id));

const {
  data: trackerItem,
  isError,
  error,
} = useQuery({
  queryFn: () => loadTrackerById({ trackerId: currentTrackerId.value }),
  queryKey: computed(() => [...VUE_QUERY_CACHE_KEYS.trackersListItem, currentTrackerId.value]),
  staleTime: Infinity,
  retry: false,
});

const isNotFound = computed(() => isError.value && isNotFoundError(error.value));

// The page's other queries load in parallel, so rules sync on its own and refetch only when links changed.
const invalidateTracker = useInvalidateTracker();
watch(
  () => (trackerItem.value?.rulesEnabled ? trackerItem.value.id : null),
  async (trackerId) => {
    if (!trackerId) return;
    try {
      const { added, removed } = await syncTrackerRules({ trackerId });
      if (added > 0 || removed > 0) await invalidateTracker({ trackerId });
    } catch (syncError) {
      if (!(syncError instanceof ApiErrorResponseError)) {
        captureException({ error: syncError, context: { scope: 'tracker:rules-sync', trackerId } });
      }
    }
  },
  { immediate: true },
);

watch(
  error,
  (latestError) => {
    if (!latestError || isNotFound.value) return;
    addErrorNotification(t('errors.api.unexpectedError'));
    if (!trackerItem.value) router.replace({ name: ROUTES_NAMES.plannedTrackers });
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
    :link-to="{ name: ROUTES_NAMES.plannedTrackers }"
  />
  <TrackerDetails v-else-if="trackerItem" :key="trackerItem.id" :tracker="trackerItem" />
  <TrackerDetailSkeleton v-else />
</template>
