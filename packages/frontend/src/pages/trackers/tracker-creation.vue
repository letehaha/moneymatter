<script setup lang="ts">
import { createTracker } from '@/api/trackers';
import { VUE_QUERY_CACHE_KEYS } from '@/common/const';
import { ALL_LOGO_TABS, type LogoSelection, toOptionalLogoPayload } from '@/components/common/logo-selection';
import LogoSquareField from '@/components/common/logo-square-field.vue';
import DateField from '@/components/fields/date-field.vue';
import InputField from '@/components/fields/input-field.vue';
import Button from '@/components/lib/ui/button/Button.vue';
import { useNotificationCenter } from '@/components/notification-center';
import { trackAnalyticsEvent } from '@/lib/posthog';
import { useOnboardingStore } from '@/stores/onboarding';
import { useMutation, useQueryClient } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';

import {
  SMART_TRACKING_DEFAULTS,
  type SmartTrackingValues,
  TRACKER_RULES_DEFAULTS,
  type TrackerRulesValues,
  buildTrackerPayload,
  buildSmartTrackingPatch,
  isSmartTrackingIncomplete,
  isTrackerRulesIncomplete,
} from './build-tracker-payload';
import SmartTrackingFields from './components/smart-tracking-fields.vue';
import TrackerRulesFields from './components/tracker-rules-fields.vue';
import TrackerLogo from './components/tracker-logo.vue';
import { reportTrackerError, useRefreshSmartTrackingAccess } from './components/use-tracker-actions';

const TRACKER_DEFAULT_VALUES: {
  name: string | null;
  startDate?: Date | null;
  endDate?: Date | null;
  limitAmount?: number | null;
  logo: LogoSelection | null;
} = {
  name: null,
  startDate: null,
  endDate: null,
  limitAmount: null,
  logo: null,
} as const;

const emits = defineEmits(['create-tracker']);
const { t } = useI18n();
const { addSuccessNotification } = useNotificationCenter();

const queryClient = useQueryClient();
const refreshSmartTrackingAccess = useRefreshSmartTrackingAccess();
const form = ref({ ...TRACKER_DEFAULT_VALUES });
const rules = ref<TrackerRulesValues>(structuredClone(TRACKER_RULES_DEFAULTS));
const smartTracking = ref<SmartTrackingValues>(structuredClone(SMART_TRACKING_DEFAULTS));
const showErrors = ref(false);

const { isPending: isMutating, mutate: createTrackerItem } = useMutation({
  mutationFn: createTracker,
  onSuccess: (_created, payload) => {
    queryClient.invalidateQueries({ queryKey: VUE_QUERY_CACHE_KEYS.trackersList });
    refreshSmartTrackingAccess({ aiEnabled: payload.aiEnabled });
    trackAnalyticsEvent({ event: 'tracker_created' });

    // Mark onboarding task as complete
    const onboardingStore = useOnboardingStore();
    onboardingStore.completeTask('create-tracker');

    emits('create-tracker');
    addSuccessNotification(payload.aiEnabled ? t('budgets.smartTracking.turnedOn') : t('budgets.creation.success'));
  },
  onError(error) {
    reportTrackerError({ error, fallbackKey: 'budgets.creation.error', context: { source: 'trackerCreate' } });
  },
});

const isSubmitDisabled = computed(() => isMutating.value || !form.value.name);

const submit = () => {
  const { name, startDate, endDate, limitAmount, logo } = form.value;
  if (!name) return;
  showErrors.value = true;
  if (isTrackerRulesIncomplete({ values: rules.value })) return;
  if (isSmartTrackingIncomplete({ values: smartTracking.value })) return;
  createTrackerItem({
    ...buildTrackerPayload({ name, limitAmount, startDate, endDate }),
    ...rules.value,
    ...toOptionalLogoPayload({ selection: logo }),
    ...buildSmartTrackingPatch({ values: smartTracking.value }),
  });
};
</script>

<template>
  <form class="grid gap-4" @submit.prevent="submit">
    <div class="flex items-start gap-3">
      <LogoSquareField
        v-model="form.logo"
        :name-for-search="form.name ?? ''"
        :reset-label="$t('common.logo.remove')"
        :tabs="ALL_LOGO_TABS"
        align="with-labeled-field"
      >
        <template #placeholder>
          <TrackerLogo class="size-10 rounded-lg" />
        </template>
      </LogoSquareField>
      <div class="min-w-0 flex-1">
        <InputField
          v-model="form.name"
          :label="$t('budgets.creation.nameLabel')"
          :placeholder="$t('budgets.creation.namePlaceholder')"
        />
      </div>
    </div>

    <div class="flex justify-between gap-4">
      <DateField
        :model-value="form.startDate ?? undefined"
        :calendar-options="{
          maxDate: form.endDate ?? undefined,
        }"
        mode="date"
        :label="$t('budgets.creation.fromDateLabel')"
        @update:model-value="(v: Date | undefined) => (form.startDate = v ?? null)"
      />
      <DateField
        :model-value="form.endDate ?? undefined"
        :calendar-options="{
          minDate: form.startDate ?? undefined,
        }"
        mode="date"
        :label="$t('budgets.creation.toDateLabel')"
        @update:model-value="(v: Date | undefined) => (form.endDate = v ?? null)"
      />
    </div>

    <div>
      <InputField
        v-model.number="form.limitAmount"
        :label="$t('budgets.creation.limitLabel')"
        :placeholder="$t('budgets.creation.limitPlaceholder')"
      />
    </div>

    <TrackerRulesFields v-model="rules" :show-errors="showErrors" />

    <SmartTrackingFields v-model="smartTracking" :has-start-date="!!form.startDate" :show-errors="showErrors" />

    <div class="mt-4">
      <Button :disabled="isSubmitDisabled" type="submit">{{ $t('budgets.creation.submitButton') }}</Button>
    </div>
  </form>
</template>
