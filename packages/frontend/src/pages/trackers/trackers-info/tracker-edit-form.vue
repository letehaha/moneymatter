<script setup lang="ts">
import { editTracker } from '@/api/trackers';
import { ALL_LOGO_TABS, type LogoSelection, toLogoPatch, toLogoSelection } from '@/components/common/logo-selection';
import LogoSquareField from '@/components/common/logo-square-field.vue';
import ResponsiveAlertDialog from '@/components/common/responsive-alert-dialog.vue';
import DateField from '@/components/fields/date-field.vue';
import InputField from '@/components/fields/input-field.vue';
import Button from '@/components/lib/ui/button/Button.vue';
import { useNotificationCenter } from '@/components/notification-center';
import { useDateLocale } from '@/composable/use-date-locale';
import { useTrackerAccess } from '@/composable/use-tracker-access';
import type { TrackerModel } from '@bt/shared/types';
import { useMutation } from '@tanstack/vue-query';
import { computed, ref, toRef } from 'vue';
import { useI18n } from 'vue-i18n';

import SmartTrackingFields from '../components/smart-tracking-fields.vue';
import TrackerLogo from '../components/tracker-logo.vue';
import TrackerRulesFields from '../components/tracker-rules-fields.vue';
import {
  reportTrackerError,
  useInvalidateTracker,
  useRefreshSmartTrackingAccess,
} from '../components/use-tracker-actions';
import { parseTrackerDate } from '../tracker-time-status';
import {
  type SmartTrackingValues,
  type TrackerRulesValues,
  buildTrackerPayload,
  buildSmartTrackingPatch,
  buildTrackerDates,
  changesRuleMatches,
  isSmartTrackingIncomplete,
  isTrackerRulesIncomplete,
} from '../build-tracker-payload';
import RejectedTransactionsDialog from './rejected-transactions-dialog.vue';
import { isScanActive } from './smart-tracking/smart-tracking-state';
import { useTrackerSuggestions } from './smart-tracking/use-tracker-suggestions';

const props = defineProps<{ tracker: TrackerModel }>();
const emit = defineEmits<{ saved: []; cancel: [] }>();

const { t } = useI18n();
const invalidateTracker = useInvalidateTracker();
const refreshSmartTrackingAccess = useRefreshSmartTrackingAccess();
const { addSuccessNotification } = useNotificationCenter();

const { formatRelative } = useDateLocale();
const { isOwner } = useTrackerAccess(toRef(() => props.tracker));

const form = ref({
  name: props.tracker.name,
  limitAmount: props.tracker.limitAmount as string | number | null,
  startDate: parseTrackerDate(props.tracker.startDate),
  endDate: parseTrackerDate(props.tracker.endDate),
});
const storedRules: TrackerRulesValues = {
  rulesEnabled: props.tracker.rulesEnabled,
  rulesCleanup: props.tracker.rulesCleanup,
  categoryIds: props.tracker.categories?.map((c) => c.id) ?? [],
  tagIds: props.tracker.tags?.map((tag) => tag.id) ?? [],
};
const rules = ref<TrackerRulesValues>(structuredClone(storedRules));
const rulesCheckedLabel = computed(() =>
  props.tracker.rulesEnabled && props.tracker.rulesSyncedAt
    ? t('budgets.rules.checkedAt', { when: formatRelative(new Date(props.tracker.rulesSyncedAt), new Date()) })
    : null,
);
const storedLogo = toLogoSelection(props.tracker);
const logo = ref<LogoSelection | null>(storedLogo);

const storedSmartTracking: SmartTrackingValues = {
  aiEnabled: props.tracker.aiEnabled,
  aiDescription: props.tracker.aiDescription,
  aiPreWindowDays: props.tracker.aiPreWindowDays,
};
const smartTracking = ref<SmartTrackingValues>({ ...storedSmartTracking });
const showErrors = ref(false);
const { data: suggestions } = useTrackerSuggestions({ trackerId: () => props.tracker.id, enabled: isOwner });
const rejected = computed(() => suggestions.value?.rejected ?? []);
const isRejectedOpen = ref(false);
const isConfirmOpen = ref(false);
const isScanning = computed(() => isScanActive({ status: suggestions.value?.scan.status }));

const { mutate, isPending } = useMutation({
  mutationFn: editTracker,
  onSuccess: (_data, { payload }) => {
    addSuccessNotification(payload.aiEnabled ? t('budgets.smartTracking.turnedOn') : t('budgets.list.updateSuccess'));
    refreshSmartTrackingAccess({ aiEnabled: isOwner.value && smartTracking.value.aiEnabled });
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

const basePayload = computed(() =>
  buildTrackerPayload({
    name: form.value.name,
    limitAmount: form.value.limitAmount,
    startDate: form.value.startDate,
    endDate: form.value.endDate,
  }),
);

const save = () =>
  mutate({
    trackerId: props.tracker.id,
    payload: {
      ...basePayload.value,
      ...(isOwner.value ? rules.value : {}),
      ...toLogoPatch({ selection: logo.value, stored: storedLogo }),
      ...(isOwner.value ? buildSmartTrackingPatch({ values: smartTracking.value, stored: storedSmartTracking }) : {}),
    },
  });

const handleSubmit = () => {
  showErrors.value = true;
  if (isOwner.value && isTrackerRulesIncomplete({ values: rules.value })) return;
  if (isOwner.value && isSmartTrackingIncomplete({ values: smartTracking.value })) return;

  const storedDates = buildTrackerDates({
    startDate: parseTrackerDate(props.tracker.startDate),
    endDate: parseTrackerDate(props.tracker.endDate),
  });
  if (changesRuleMatches({ values: rules.value, stored: storedRules, dates: basePayload.value, storedDates })) {
    isConfirmOpen.value = true;
    return;
  }
  save();
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

    <div class="grid gap-1.5">
      <InputField
        v-model="form.limitAmount"
        :label="$t('budgets.settings.limitLabel')"
        :placeholder="$t('budgets.settings.limitPlaceholder')"
        type="number"
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
      <p class="text-muted-foreground text-xs">
        {{ $t('budgets.details.edit.datesHint') }}
      </p>
    </div>

    <TrackerRulesFields
      v-if="isOwner"
      v-model="rules"
      :is-stored-on="tracker.rulesEnabled"
      :show-errors="showErrors"
      :disabled="isPending"
    >
      <p v-if="rulesCheckedLabel" class="text-muted-foreground text-xs">{{ rulesCheckedLabel }}</p>
      <div v-if="rejected.length" class="flex items-center justify-between gap-3 border-t border-dashed pt-3">
        <span class="text-muted-foreground text-xs">
          {{ $t('budgets.rules.rejected.summary', { count: rejected.length }, rejected.length) }}
        </span>
        <Button type="button" size="sm" variant="ghost-primary" @click="isRejectedOpen = true">
          {{ $t('budgets.rules.rejected.review') }}
        </Button>
      </div>
    </TrackerRulesFields>

    <SmartTrackingFields
      v-if="isOwner"
      v-model="smartTracking"
      :has-start-date="!!form.startDate"
      :is-stored-on="tracker.aiEnabled"
      :is-scanning="isScanning"
      :show-errors="showErrors"
    />

    <div class="flex justify-end gap-2">
      <Button type="button" variant="outline" :disabled="isPending" @click="emit('cancel')">
        {{ $t('common.actions.cancel') }}
      </Button>
      <Button type="submit" :disabled="isPending || !form.name">
        {{ isPending ? $t('common.actions.saving') : $t('common.actions.saveChanges') }}
      </Button>
    </div>

    <ResponsiveAlertDialog
      v-model:open="isConfirmOpen"
      :confirm-label="$t('budgets.rules.confirm.saveAndCheck')"
      :confirm-variant="rules.rulesCleanup ? 'destructive' : 'default'"
      @confirm="save"
    >
      <template #title>{{ $t('budgets.rules.confirm.title') }}</template>
      <template #description>
        {{
          rules.rulesCleanup
            ? $t('budgets.rules.confirm.descriptionWithCleanup')
            : $t('budgets.rules.confirm.description')
        }}
      </template>
    </ResponsiveAlertDialog>

    <RejectedTransactionsDialog v-model:open="isRejectedOpen" :tracker-id="tracker.id" :rejected="rejected" />
  </form>
</template>
