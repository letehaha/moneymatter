<script setup lang="ts">
import { editTracker } from '@/api/trackers';
import { ALL_LOGO_TABS, type LogoSelection, toLogoPatch, toLogoSelection } from '@/components/common/logo-selection';
import LogoSquareField from '@/components/common/logo-square-field.vue';
import CategoryMultiSelectField from '@/components/fields/category-multi-select-field.vue';
import DateField from '@/components/fields/date-field.vue';
import InputField from '@/components/fields/input-field.vue';
import Button from '@/components/lib/ui/button/Button.vue';
import { useNotificationCenter } from '@/components/notification-center';
import { useTrackerAccess } from '@/composable/use-tracker-access';
import { TRACKER_TYPES, type TrackerModel } from '@bt/shared/types';
import { useMutation } from '@tanstack/vue-query';
import { computed, ref, toRef } from 'vue';
import { useFormatCurrency } from '@/composable/formatters';
import { useI18n } from 'vue-i18n';

import SmartTrackingFields from '../components/smart-tracking-fields.vue';
import TrackerLogo from '../components/tracker-logo.vue';
import {
  reportTrackerError,
  useInvalidateTracker,
  useRefreshSmartTrackingAccess,
} from '../components/use-tracker-actions';
import { parseTrackerDate } from '../tracker-time-status';
import {
  type SmartTrackingValues,
  buildTrackerPayload,
  buildSmartTrackingPatch,
  isSmartTrackingIncomplete,
} from '../build-tracker-payload';
import { isScanActive } from './smart-tracking/smart-tracking-state';
import { useTrackerSuggestions } from './smart-tracking/use-tracker-suggestions';

const props = defineProps<{ tracker: TrackerModel }>();
const emit = defineEmits<{ saved: []; cancel: [] }>();

const { t } = useI18n();
const { baseCurrencyDecimals } = useFormatCurrency();
const invalidateTracker = useInvalidateTracker();
const refreshSmartTrackingAccess = useRefreshSmartTrackingAccess();
const { addSuccessNotification } = useNotificationCenter();

const isCategoryTracker = props.tracker.type === TRACKER_TYPES.category;
const { isOwner } = useTrackerAccess(toRef(() => props.tracker));
const showSmartTracking = computed(() => !isCategoryTracker && isOwner.value);

const form = ref({
  name: props.tracker.name,
  limitAmount: props.tracker.limitAmount as string | number | null,
  startDate: parseTrackerDate(props.tracker.startDate),
  endDate: parseTrackerDate(props.tracker.endDate),
  categoryIds: (props.tracker.categories?.map((c) => c.id) ?? []) as string[],
});
const storedLogo = toLogoSelection(props.tracker);
const logo = ref<LogoSelection | null>(storedLogo);

const storedSmartTracking: SmartTrackingValues = {
  aiEnabled: props.tracker.aiEnabled,
  aiDescription: props.tracker.aiDescription,
  aiPreWindowDays: props.tracker.aiPreWindowDays,
};
const smartTracking = ref<SmartTrackingValues>({ ...storedSmartTracking });
const showSmartTrackingErrors = ref(false);
const { data: suggestions } = useTrackerSuggestions({ trackerId: () => props.tracker.id, enabled: showSmartTracking });
const isScanning = computed(() => isScanActive({ status: suggestions.value?.scan.status }));

const { mutate, isPending } = useMutation({
  mutationFn: editTracker,
  onSuccess: (_data, { payload }) => {
    addSuccessNotification(payload.aiEnabled ? t('budgets.smartTracking.turnedOn') : t('budgets.list.updateSuccess'));
    refreshSmartTrackingAccess({ aiEnabled: showSmartTracking.value && smartTracking.value.aiEnabled });
    emit('saved');
    return invalidateTracker({ trackerId: props.tracker.id });
  },
  onError: (error) =>
    reportTrackerError({
      error,
      fallbackKey: 'budgets.list.updateError',
      context: { source: 'trackerEdit', trackerId: props.tracker.id },
    }),
});

const categoriesTouched = ref(false);
const isCategoryMissing = computed(() => isCategoryTracker && form.value.categoryIds.length === 0);
const categoryErrorMessage = computed(() =>
  categoriesTouched.value && isCategoryMissing.value ? t('budgets.creation.categoriesRequired') : undefined,
);
const onCategoriesUpdate = (value: string[]) => {
  form.value.categoryIds = value;
  categoriesTouched.value = true;
};

const dateFields = computed(() => [
  {
    key: 'startDate' as const,
    labelKey: 'budgets.settings.startDateLabel',
    calendarOptions: { maxDate: form.value.endDate ?? undefined },
  },
  {
    key: 'endDate' as const,
    labelKey: 'budgets.settings.endDateLabel',
    calendarOptions: { minDate: form.value.startDate ?? undefined },
  },
]);

const handleSubmit = () => {
  categoriesTouched.value = true;
  showSmartTrackingErrors.value = true;
  if (isCategoryMissing.value) return;
  if (showSmartTracking.value && isSmartTrackingIncomplete({ values: smartTracking.value })) return;
  mutate({
    trackerId: props.tracker.id,
    payload: {
      ...buildTrackerPayload({
        name: form.value.name,
        limitAmount: form.value.limitAmount,
        startDate: form.value.startDate,
        endDate: form.value.endDate,
        categoryIds: isCategoryTracker ? form.value.categoryIds : undefined,
      }),
      ...toLogoPatch({ selection: logo.value, stored: storedLogo }),
      ...(showSmartTracking.value
        ? buildSmartTrackingPatch({ values: smartTracking.value, stored: storedSmartTracking })
        : {}),
    },
  });
};
</script>

<template>
  <form class="grid gap-4" @submit.prevent="handleSubmit">
    <div class="flex items-start gap-3">
      <LogoSquareField
        v-model="logo"
        :name-for-search="form.name"
        :reset-label="$t('common.logo.remove')"
        :tabs="ALL_LOGO_TABS"
        :disabled="isPending"
        align="with-labeled-field"
      >
        <template #placeholder>
          <TrackerLogo class="size-10 rounded-lg" />
        </template>
      </LogoSquareField>
      <div class="min-w-0 flex-1">
        <InputField
          v-model="form.name"
          :label="$t('budgets.settings.nameLabel')"
          :placeholder="$t('budgets.settings.namePlaceholder')"
          :disabled="isPending"
        />
      </div>
    </div>

    <div v-if="isCategoryTracker" class="grid gap-1.5">
      <CategoryMultiSelectField
        :model-value="form.categoryIds"
        :label="$t('budgets.creation.categoriesLabel')"
        :placeholder="$t('budgets.lines.dialog.categoriesPlaceholder')"
        :disabled="isPending"
        :error-message="categoryErrorMessage"
        @update:model-value="onCategoriesUpdate"
      />
      <p class="text-muted-foreground text-xs">{{ $t('budgets.details.edit.categoriesHint') }}</p>
    </div>

    <div class="grid gap-1.5">
      <InputField
        v-model="form.limitAmount"
        :label="$t('budgets.settings.limitLabel')"
        :placeholder="$t('budgets.settings.limitPlaceholder')"
        type="number"
        :decimals="baseCurrencyDecimals"
        only-positive
        :disabled="isPending"
      />
      <p class="text-muted-foreground text-xs">{{ $t('budgets.details.edit.limitHint') }}</p>
    </div>

    <div class="grid gap-1.5">
      <div class="grid grid-cols-2 gap-3">
        <DateField
          v-for="field in dateFields"
          :key="field.key"
          :model-value="form[field.key] ?? undefined"
          :calendar-options="field.calendarOptions"
          mode="date"
          :label="$t(field.labelKey)"
          :disabled="isPending"
          clearable
          @update:model-value="(v: Date | undefined) => (form[field.key] = v ?? null)"
          @clear="form[field.key] = null"
        />
      </div>
      <p v-if="!isCategoryTracker" class="text-muted-foreground text-xs">
        {{ $t('budgets.details.edit.datesHint') }}
      </p>
    </div>

    <SmartTrackingFields
      v-if="showSmartTracking"
      v-model="smartTracking"
      :has-start-date="!!form.startDate"
      :is-stored-on="tracker.aiEnabled"
      :is-scanning="isScanning"
      :show-errors="showSmartTrackingErrors"
    />

    <div class="flex justify-end gap-2">
      <Button type="button" variant="outline" :disabled="isPending" @click="emit('cancel')">
        {{ $t('common.actions.cancel') }}
      </Button>
      <Button type="submit" :disabled="isPending || !form.name || isCategoryMissing">
        {{ isPending ? $t('common.actions.saving') : $t('common.actions.saveChanges') }}
      </Button>
    </div>
  </form>
</template>
