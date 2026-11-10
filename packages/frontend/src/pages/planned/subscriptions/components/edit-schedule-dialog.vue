<script setup lang="ts">
import { type SubscriptionDetail, updateSubscription } from '@/api/subscriptions';
import ResponsiveDialog from '@/components/common/responsive-dialog.vue';
import DateField from '@/components/fields/date-field.vue';
import InputField from '@/components/fields/input-field.vue';
import SelectField from '@/components/fields/select-field.vue';
import Button from '@/components/lib/ui/button/Button.vue';
import { Callout } from '@/components/lib/ui/callout';
import { Label } from '@/components/lib/ui/label';
import { Switch } from '@/components/lib/ui/switch';
import { useNotificationCenter } from '@/components/notification-center';
import { useInvalidateSubscriptionQueries } from '@/composable/data-queries/subscriptions';
import { useFormValidation } from '@/composable/form-validator';
import { ApiErrorResponseError } from '@/js/errors';
import { helpers } from '@/js/helpers/validators';
import { cn } from '@/lib/utils';
import {
  MAX_REMIND_BEFORE_PRESETS,
  REMIND_BEFORE_DAYS,
  REMIND_BEFORE_PRESETS,
  type RemindBeforePreset,
  SUBSCRIPTION_FREQUENCIES,
  SUBSCRIPTION_INTERVAL_LIMITS,
  SUBSCRIPTION_INTERVAL_UNITS,
  SUBSCRIPTION_TYPES,
} from '@bt/shared/types';
import { useMutation } from '@tanstack/vue-query';
import { format, parseISO } from 'date-fns';
import { XIcon } from '@lucide/vue';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

import { isIntervalCountValid } from '../utils';
import CustomIntervalFields from './custom-interval-fields.vue';

const props = defineProps<{ subscription: SubscriptionDetail }>();
const open = defineModel<boolean>('open', { default: false });

const { t } = useI18n();
const { addSuccessNotification } = useNotificationCenter();
const invalidateSubscriptionQueries = useInvalidateSubscriptionQueries();

const FREQUENCY_OPTIONS = computed(() => [
  { label: t('planned.subscriptions.frequency.weekly'), value: SUBSCRIPTION_FREQUENCIES.weekly },
  { label: t('planned.subscriptions.frequency.biweekly'), value: SUBSCRIPTION_FREQUENCIES.biweekly },
  { label: t('planned.subscriptions.frequency.monthly'), value: SUBSCRIPTION_FREQUENCIES.monthly },
  { label: t('planned.subscriptions.frequency.quarterly'), value: SUBSCRIPTION_FREQUENCIES.quarterly },
  { label: t('planned.subscriptions.frequency.semiAnnual'), value: SUBSCRIPTION_FREQUENCIES.semiAnnual },
  { label: t('planned.subscriptions.frequency.annual'), value: SUBSCRIPTION_FREQUENCIES.annual },
  { label: t('planned.subscriptions.frequency.custom'), value: SUBSCRIPTION_FREQUENCIES.custom },
]);

// Nearest-to-due first, so the pill row reads as an escalating timeline.
const REMIND_BEFORE_OPTIONS = (Object.values(REMIND_BEFORE_PRESETS) as RemindBeforePreset[]).sort(
  (a, b) => REMIND_BEFORE_DAYS[a] - REMIND_BEFORE_DAYS[b],
);

interface ScheduleForm {
  frequency: SUBSCRIPTION_FREQUENCIES;
  /** Step of a custom frequency; sent only while `frequency` is custom. */
  intervalUnit: SUBSCRIPTION_INTERVAL_UNITS;
  intervalCount: number | null;
  dueDate: Date | null;
  maxOccurrences: number | null;
  startDate: Date | null;
  endDate: Date | null;
  remindBefore: RemindBeforePreset[];
  notifyEmail: boolean;
}

const buildFormState = (): ScheduleForm => ({
  frequency: props.subscription.frequency,
  intervalUnit: props.subscription.intervalUnit ?? SUBSCRIPTION_INTERVAL_UNITS.day,
  intervalCount: props.subscription.intervalCount ?? null,
  // parseISO reads date-only strings as local midnight, so re-formatting with
  // 'yyyy-MM-dd' round-trips exactly; new Date() would parse them as UTC and
  // shift a day west of UTC, which the backend reads as a real reschedule.
  dueDate: props.subscription.dueDate ? parseISO(props.subscription.dueDate) : null,
  maxOccurrences: props.subscription.maxOccurrences ?? null,
  startDate: props.subscription.startDate ? parseISO(props.subscription.startDate) : new Date(),
  endDate: props.subscription.endDate ? parseISO(props.subscription.endDate) : null,
  remindBefore: [...(props.subscription.remindBefore ?? [])],
  notifyEmail: props.subscription.notifyEmail ?? false,
});

const form = ref<ScheduleForm>(buildFormState());
const formError = ref<string | null>(null);

watch(open, (isOpen) => {
  if (!isOpen) return;
  form.value = buildFormState();
  formError.value = null;
});

const isInstallment = computed(() => props.subscription.type === SUBSCRIPTION_TYPES.installment);
const isCustom = computed(() => form.value.frequency === SUBSCRIPTION_FREQUENCIES.custom);

const selectedFrequency = computed(() => FREQUENCY_OPTIONS.value.find((f) => f.value === form.value.frequency) ?? null);

const toggleRemindBefore = ({ preset }: { preset: RemindBeforePreset }) => {
  const selected = form.value.remindBefore;
  if (selected.includes(preset)) {
    form.value.remindBefore = selected.filter((p) => p !== preset);
  } else if (selected.length < MAX_REMIND_BEFORE_PRESETS) {
    form.value.remindBefore = [...selected, preset];
  }
};

const validationRules = computed(() => ({
  intervalCount: {
    validForCustom: helpers.withMessage(
      () =>
        t('planned.subscriptions.form.validationIntervalCount', {
          max: SUBSCRIPTION_INTERVAL_LIMITS.max[form.value.intervalUnit],
        }),
      (value: number | null) =>
        !isCustom.value || isIntervalCountValid({ unit: form.value.intervalUnit, count: value }),
    ),
  },
  dueDate: {
    requiredForInstallment: helpers.withMessage(
      t('planned.subscriptions.form.validationInstallmentRequiresSchedule'),
      (value: Date | null) => {
        if (!isInstallment.value) return true;
        return value != null;
      },
    ),
  },
  maxOccurrences: {
    requiredForInstallment: helpers.withMessage(
      t('planned.subscriptions.form.validationInstallmentRequiresCount'),
      (value: number | null) => {
        if (!isInstallment.value) return true;
        return value != null && value > 0;
      },
    ),
  },
}));

const { isFormValid, getFieldErrorMessage, touchField } = useFormValidation(
  { form },
  computed(() => ({ form: validationRules.value })),
);

const { mutate, isPending } = useMutation({
  mutationFn: (payload: Parameters<typeof updateSubscription>[0]['payload']) =>
    updateSubscription({ id: props.subscription.id, payload }),
  onSuccess: () => {
    invalidateSubscriptionQueries();
    addSuccessNotification(t('planned.subscriptions.updateSuccess'));
    open.value = false;
  },
  onError: (err) => {
    formError.value =
      err instanceof ApiErrorResponseError
        ? (err.data.message ?? t('planned.subscriptions.updateError'))
        : t('planned.subscriptions.updateError');
  },
});

const toIsoDate = ({ date }: { date: Date }) => format(date, 'yyyy-MM-dd');

const handleSubmit = () => {
  if (!isFormValid()) return;
  formError.value = null;

  mutate({
    frequency: form.value.frequency,
    ...(isCustom.value ? { intervalUnit: form.value.intervalUnit, intervalCount: form.value.intervalCount } : {}),
    dueDate: form.value.dueDate ? toIsoDate({ date: form.value.dueDate }) : null,
    maxOccurrences: form.value.maxOccurrences ?? null,
    startDate: form.value.startDate ? toIsoDate({ date: form.value.startDate }) : toIsoDate({ date: new Date() }),
    endDate: form.value.endDate ? toIsoDate({ date: form.value.endDate }) : null,
    remindBefore: form.value.remindBefore,
    notifyEmail: form.value.notifyEmail,
  });
};
</script>

<template>
  <ResponsiveDialog v-model:open="open" dialog-content-class="max-w-lg">
    <template #title>{{ $t('planned.subscriptions.editors.schedule.title') }}</template>
    <template #description>{{ $t('planned.subscriptions.editors.schedule.description') }}</template>

    <form id="edit-subscription-schedule" class="grid gap-4" @submit.prevent="handleSubmit">
      <SelectField
        :model-value="selectedFrequency"
        :values="FREQUENCY_OPTIONS"
        label-key="label"
        value-key="value"
        :label="$t('planned.subscriptions.form.frequencyLabel')"
        :placeholder="$t('planned.subscriptions.editors.schedule.frequencyPlaceholder')"
        @update:model-value="(v: any) => v && (form.frequency = v.value)"
      />

      <CustomIntervalFields
        v-if="isCustom"
        v-model:count="form.intervalCount"
        v-model:unit="form.intervalUnit"
        :count-error-message="getFieldErrorMessage('form.intervalCount')"
        @count-blur="touchField('form.intervalCount')"
      />

      <div class="grid gap-1.5">
        <div class="flex items-end gap-2">
          <DateField
            :model-value="form.dueDate ?? undefined"
            :label="$t('planned.subscriptions.form.dueDateLabel')"
            :error-message="getFieldErrorMessage('form.dueDate')"
            class="min-w-0 flex-1"
            @update:model-value="(v: Date | null) => (form.dueDate = v)"
          />
          <Button
            v-if="form.dueDate && !isInstallment"
            type="button"
            variant="ghost"
            size="sm"
            @click="form.dueDate = null"
          >
            <XIcon class="size-4" />
            {{ $t('planned.subscriptions.editors.schedule.clearDueDate') }}
          </Button>
        </div>
        <p class="text-muted-foreground text-xs">
          {{
            isInstallment
              ? $t('planned.subscriptions.form.installmentScheduleHint')
              : form.dueDate
                ? $t('planned.subscriptions.form.dueDateDescription')
                : $t('planned.subscriptions.editors.schedule.detectionOnlyHint')
          }}
        </p>
      </div>

      <InputField
        :model-value="form.maxOccurrences ?? undefined"
        type="number"
        :label="$t('planned.subscriptions.form.maxOccurrencesLabel')"
        :placeholder="
          isInstallment
            ? $t('planned.subscriptions.form.maxOccurrencesInstallmentPlaceholder')
            : $t('planned.subscriptions.form.maxOccurrencesPlaceholder')
        "
        :error-message="getFieldErrorMessage('form.maxOccurrences')"
        only-positive
        @update:model-value="(v: string | number | null) => (form.maxOccurrences = v ? Number(v) : null)"
        @blur="touchField('form.maxOccurrences')"
      />

      <div class="grid grid-cols-2 gap-3">
        <DateField
          :model-value="form.startDate ?? undefined"
          :calendar-options="{ maxDate: form.endDate ?? undefined }"
          :label="$t('planned.subscriptions.form.startDateLabel')"
          @update:model-value="(v: Date | null) => (form.startDate = v)"
        />
        <DateField
          :model-value="form.endDate ?? undefined"
          :label="$t('planned.subscriptions.form.endDateLabel')"
          @update:model-value="(v: Date | null) => (form.endDate = v)"
        />
      </div>

      <!-- Advance reminders only fire against generated periods, which exist only once a due date is set. -->
      <div v-if="form.dueDate" class="grid gap-2">
        <Label class="text-sm font-medium">{{ $t('planned.subscriptions.form.remindBeforeLabel') }}</Label>
        <div class="flex flex-wrap gap-2">
          <Label
            v-for="preset in REMIND_BEFORE_OPTIONS"
            :key="preset"
            :class="
              cn(
                'border-input flex cursor-pointer items-center rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                form.remindBefore.includes(preset)
                  ? 'border-primary bg-primary/5'
                  : 'hover:bg-accent hover:text-accent-foreground',
                !form.remindBefore.includes(preset) &&
                  form.remindBefore.length >= MAX_REMIND_BEFORE_PRESETS &&
                  'pointer-events-none cursor-not-allowed opacity-50',
              )
            "
          >
            <input
              type="checkbox"
              class="sr-only"
              :checked="form.remindBefore.includes(preset)"
              :disabled="!form.remindBefore.includes(preset) && form.remindBefore.length >= MAX_REMIND_BEFORE_PRESETS"
              @change="toggleRemindBefore({ preset })"
            />
            {{ $t(`planned.subscriptions.form.remindPresets.${preset}`) }}
          </Label>
        </div>
        <p class="text-muted-foreground text-xs">{{ $t('planned.subscriptions.form.remindBeforeHelper') }}</p>

        <label class="mt-1 flex cursor-pointer items-center justify-between gap-3">
          <span class="text-sm">{{ $t('planned.subscriptions.form.notifyEmailLabel') }}</span>
          <Switch v-model="form.notifyEmail" />
        </label>
      </div>

      <Callout v-if="formError" variant="destructive">
        <span>{{ formError }}</span>
      </Callout>
    </form>

    <template #footer>
      <div class="flex justify-end gap-2">
        <Button type="button" variant="outline" :disabled="isPending" @click="open = false">
          {{ $t('planned.subscriptions.cancel') }}
        </Button>
        <Button type="submit" form="edit-subscription-schedule" :disabled="isPending">
          {{ $t('planned.subscriptions.form.update') }}
        </Button>
      </div>
    </template>
  </ResponsiveDialog>
</template>
