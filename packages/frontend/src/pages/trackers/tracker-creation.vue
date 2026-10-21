<script setup lang="ts">
import { createTracker } from '@/api/trackers';
import { VUE_QUERY_CACHE_KEYS } from '@/common/const';
import { ALL_LOGO_TABS, type LogoSelection, toOptionalLogoPayload } from '@/components/common/logo-selection';
import LogoSquareField from '@/components/common/logo-square-field.vue';
import CategoryMultiSelectField from '@/components/fields/category-multi-select-field.vue';
import DateField from '@/components/fields/date-field.vue';
import InputField from '@/components/fields/input-field.vue';
import Button from '@/components/lib/ui/button/Button.vue';
import Checkbox from '@/components/lib/ui/checkbox/Checkbox.vue';
import { Label } from '@/components/lib/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/lib/ui/radio-group';
import { useNotificationCenter } from '@/components/notification-center';
import { trackAnalyticsEvent } from '@/lib/posthog';
import { cn } from '@/lib/utils';
import { useOnboardingStore } from '@/stores/onboarding';
import { TRACKER_TYPES } from '@bt/shared/types';
import { useMutation, useQueryClient } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useFormatCurrency } from '@/composable/formatters';
import { useI18n } from 'vue-i18n';

import {
  SMART_TRACKING_DEFAULTS,
  type SmartTrackingValues,
  buildTrackerPayload,
  buildSmartTrackingPatch,
  isSmartTrackingIncomplete,
} from './build-tracker-payload';
import SmartTrackingFields from './components/smart-tracking-fields.vue';
import TrackerLogo from './components/tracker-logo.vue';
import { reportTrackerError, useRefreshSmartTrackingAccess } from './components/use-tracker-actions';

const TRACKER_DEFAULT_VALUES: {
  id: string | null;
  name: string | null;
  status: string | null;
  type: TRACKER_TYPES;
  categoryIds: string[];
  startDate?: Date | null;
  endDate?: Date | null;
  limitAmount?: number | null;
  autoInclude?: boolean;
  logo: LogoSelection | null;
} = {
  id: null,
  name: null,
  status: null,
  type: TRACKER_TYPES.manual,
  categoryIds: [],
  startDate: null,
  endDate: null,
  limitAmount: null,
  autoInclude: false,
  logo: null,
} as const;

const emits = defineEmits(['create-tracker']);
const { t } = useI18n();
const { baseCurrencyDecimals } = useFormatCurrency();
const { addSuccessNotification } = useNotificationCenter();

const queryClient = useQueryClient();
const refreshSmartTrackingAccess = useRefreshSmartTrackingAccess();
const form = ref({ ...TRACKER_DEFAULT_VALUES });
const categoriesFieldTouched = ref(false);
const smartTracking = ref<SmartTrackingValues>({ ...SMART_TRACKING_DEFAULTS });
const showSmartTrackingErrors = ref(false);

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

const isDateExist = computed(() => !!form.value.startDate && !!form.value.endDate);
const isCategoryTracker = computed(() => form.value.type === TRACKER_TYPES.category);
const isCategoryValid = computed(() => !isCategoryTracker.value || form.value.categoryIds.length > 0);
const categoryErrorMessage = computed(() => {
  if (!isCategoryTracker.value) return undefined;
  if (!categoriesFieldTouched.value) return undefined;
  if (form.value.categoryIds.length > 0) return undefined;
  return t('budgets.creation.categoriesRequired');
});
const isSubmitDisabled = computed(() => isMutating.value || !form.value.name || !isCategoryValid.value);

const submit = () => {
  const { name, type, categoryIds, startDate, endDate, limitAmount, autoInclude, logo } = form.value;
  if (!name) return;
  const withSmartTracking = type === TRACKER_TYPES.manual && smartTracking.value.aiEnabled;
  showSmartTrackingErrors.value = true;
  if (withSmartTracking && isSmartTrackingIncomplete({ values: smartTracking.value })) return;
  createTrackerItem({
    ...buildTrackerPayload({ name, limitAmount, startDate, endDate, categoryIds }),
    type,
    autoInclude,
    ...toOptionalLogoPayload({ selection: logo }),
    ...(withSmartTracking ? buildSmartTrackingPatch({ values: smartTracking.value }) : {}),
  });
};

const onCategoriesUpdate = (value: string[]) => {
  form.value.categoryIds = value;
  categoriesFieldTouched.value = true;
};

const onTrackerTypeChange = (type: TRACKER_TYPES) => {
  form.value.type = type;
  // Reset touched state when switching types so user gets a fresh start
  if (type === TRACKER_TYPES.category) {
    categoriesFieldTouched.value = false;
  }
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

    <div>
      <Label class="mb-2 block text-sm font-medium">{{ $t('budgets.creation.typeLabel') }}</Label>
      <RadioGroup
        :model-value="form.type"
        class="grid grid-cols-2 gap-3"
        @update:model-value="(v) => onTrackerTypeChange(v as TRACKER_TYPES)"
      >
        <Label
          :class="
            cn(
              'border-input hover:bg-accent hover:text-accent-foreground flex cursor-pointer flex-col gap-1 rounded-md border p-3 transition-colors',
              form.type === TRACKER_TYPES.manual && 'border-primary bg-primary/5',
            )
          "
        >
          <div class="flex items-center gap-2">
            <RadioGroupItem :value="TRACKER_TYPES.manual" />
            <span class="font-medium">{{ $t('budgets.creation.typeManual') }}</span>
          </div>
          <span class="text-muted-foreground pl-6 text-xs">{{ $t('budgets.creation.typeManualDescription') }}</span>
        </Label>
        <Label
          :class="
            cn(
              'border-input hover:bg-accent hover:text-accent-foreground flex cursor-pointer flex-col gap-1 rounded-md border p-3 transition-colors',
              form.type === TRACKER_TYPES.category && 'border-primary bg-primary/5',
            )
          "
        >
          <div class="flex items-center gap-2">
            <RadioGroupItem :value="TRACKER_TYPES.category" />
            <span class="font-medium">{{ $t('budgets.creation.typeCategory') }}</span>
          </div>
          <span class="text-muted-foreground pl-6 text-xs">{{ $t('budgets.creation.typeCategoryDescription') }}</span>
        </Label>
      </RadioGroup>
    </div>

    <CategoryMultiSelectField
      v-if="isCategoryTracker"
      :model-value="form.categoryIds"
      :label="$t('budgets.creation.categoriesLabel')"
      :error-message="categoryErrorMessage"
      @update:model-value="onCategoriesUpdate"
    />

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

    <div v-if="!isCategoryTracker" class="flex gap-2">
      <label class="flex cursor-pointer items-center gap-2">
        <Checkbox v-model="form.autoInclude" :disabled="!isDateExist" />
        {{ $t('budgets.creation.autoIncludeLabel') }}
      </label>
    </div>

    <div>
      <InputField
        v-model.number="form.limitAmount"
        :decimals="baseCurrencyDecimals"
        :label="$t('budgets.creation.limitLabel')"
        :placeholder="$t('budgets.creation.limitPlaceholder')"
      />
    </div>

    <SmartTrackingFields
      v-if="!isCategoryTracker"
      v-model="smartTracking"
      :has-start-date="!!form.startDate"
      :show-errors="showSmartTrackingErrors"
    />

    <div class="mt-4">
      <Button :disabled="isSubmitDisabled" type="submit">{{ $t('budgets.creation.submitButton') }}</Button>
    </div>
  </form>
</template>
