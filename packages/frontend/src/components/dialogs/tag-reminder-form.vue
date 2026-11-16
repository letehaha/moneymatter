<template>
  <form class="mt-4 grid gap-4" @submit.prevent="handleSubmit">
    <!-- Reminder Type -->
    <FieldLabel :label="$t('settings.tags.reminders.form.type')" only-template>
      <Select v-model="form.type">
        <SelectTrigger class="h-auto min-h-10">
          <span v-if="selectedTypeOption" class="flex flex-col items-start">
            <span>{{ selectedTypeOption.label }}</span>
            <span class="text-muted-foreground text-xs">{{ selectedTypeOption.description }}</span>
          </span>
          <SelectValue v-else :placeholder="$t('settings.tags.reminders.form.typePlaceholder')" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem v-for="typeOption in reminderTypes" :key="typeOption.value" :value="typeOption.value">
            <div class="flex flex-col">
              <span>{{ typeOption.label }}</span>
              <span class="text-muted-foreground text-xs">{{ typeOption.description }}</span>
            </div>
          </SelectItem>
        </SelectContent>
      </Select>
    </FieldLabel>

    <!-- Amount Threshold (only for amount_threshold type) -->
    <div v-if="form.type === TAG_REMINDER_TYPES.amountThreshold" class="grid gap-2">
      <InputField
        v-model="form.amountThreshold"
        type="number"
        :label="$t('settings.tags.reminders.form.amountThreshold')"
        :placeholder="$t('settings.tags.reminders.form.amountThresholdPlaceholder')"
        min="0"
        step="0.01"
      />
      <p class="text-muted-foreground text-xs">
        {{ $t('settings.tags.reminders.form.amountThresholdHint') }}
      </p>
    </div>

    <!-- Frequency -->
    <FieldLabel :label="$t('settings.tags.reminders.form.frequency')" only-template>
      <Select v-model="form.frequency">
        <SelectTrigger class="h-auto min-h-10">
          <span v-if="selectedFrequencyOption" class="flex flex-col items-start">
            <span>{{ selectedFrequencyOption.label }}</span>
            <span class="text-muted-foreground text-xs">{{ selectedFrequencyOption.description }}</span>
          </span>
          <SelectValue v-else :placeholder="$t('settings.tags.reminders.form.frequencyPlaceholder')" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem v-for="freqOption in frequencyOptions" :key="freqOption.value" :value="freqOption.value">
            <div class="flex flex-col">
              <span>{{ freqOption.label }}</span>
              <span class="text-muted-foreground text-xs">{{ freqOption.description }}</span>
            </div>
          </SelectItem>
        </SelectContent>
      </Select>
    </FieldLabel>

    <!-- Day of Month (only for monthly/quarterly/yearly) -->
    <FieldLabel v-if="showDayOfMonth" :label="$t('settings.tags.reminders.form.dayOfMonth')" only-template>
      <Select v-model="form.dayOfMonth">
        <SelectTrigger>
          <SelectValue :placeholder="$t('settings.tags.reminders.form.dayOfMonthPlaceholder')" />
        </SelectTrigger>
        <SelectContent class="max-h-48">
          <SelectItem v-for="day in 31" :key="day" :value="String(day)">
            {{ day }}
          </SelectItem>
        </SelectContent>
      </Select>
      <p v-if="Number(form.dayOfMonth) > 28" class="text-muted-foreground mt-1 text-xs">
        {{ $t('settings.tags.reminders.form.dayOfMonthHint') }}
      </p>
    </FieldLabel>

    <!-- Is Enabled -->
    <div class="flex items-center justify-between">
      <span class="text-sm font-medium">{{ $t('settings.tags.reminders.form.isEnabled') }}</span>
      <Switch v-model="form.isEnabled" />
    </div>

    <div class="mt-2 flex items-center" :class="isEditMode ? 'justify-between' : 'justify-end'">
      <AlertDialog v-if="isEditMode">
        <AlertDialogTrigger as-child>
          <Button type="button" variant="destructive" :disabled="isSubmitting">
            {{ $t('common.actions.delete') }}
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{{ $t('settings.tags.reminders.delete.title') }}</AlertDialogTitle>
            <AlertDialogDescription>
              {{ $t('settings.tags.reminders.delete.description') }}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{{ $t('settings.tags.reminders.delete.cancelButton') }}</AlertDialogCancel>
            <AlertDialogAction variant="destructive" @click="handleDelete">
              {{ $t('settings.tags.reminders.delete.deleteButton') }}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Button type="submit" :disabled="isSubmitDisabled">
        {{ $t('settings.tags.reminders.form.saveButton') }}
      </Button>
    </div>
  </form>
</template>

<script setup lang="ts">
import * as tagsApi from '@/api/tags';
import FieldLabel from '@/components/fields/components/field-label.vue';
import InputField from '@/components/fields/input-field.vue';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/lib/ui/alert-dialog';
import { Button } from '@/components/lib/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/lib/ui/select';
import { Switch } from '@/components/lib/ui/switch';
import { useNotificationCenter } from '@/components/notification-center';
import { ApiErrorResponseError } from '@/js/errors';
import { useOnboardingStore } from '@/stores/onboarding';
import {
  TAG_REMINDER_FREQUENCIES,
  TAG_REMINDER_IMMEDIATE,
  TAG_REMINDER_TYPES,
  TagReminderFrequency,
  TagReminderFrequencyOrImmediate,
  TagReminderModel,
  TagReminderType,
} from '@bt/shared/types';
import { computed, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

const props = defineProps<{
  tagId: string;
  reminder?: TagReminderModel;
}>();

const emit = defineEmits<{
  saved: [reminder: TagReminderModel];
  deleted: [];
}>();

const isSubmitting = ref(false);

const { t } = useI18n();
const { addErrorNotification, addSuccessNotification } = useNotificationCenter();

const isEditMode = computed(() => !!props.reminder);

const reminderTypes = computed(() => [
  {
    value: TAG_REMINDER_TYPES.amountThreshold,
    label: t('settings.tags.reminders.types.amountThreshold'),
    description: t('settings.tags.reminders.types.amountThresholdDescription'),
  },
  {
    value: TAG_REMINDER_TYPES.existenceCheck,
    label: t('settings.tags.reminders.types.existenceCheck'),
    description: t('settings.tags.reminders.types.existenceCheckDescription'),
  },
]);

const frequencyOptions = computed(() => [
  {
    value: TAG_REMINDER_IMMEDIATE,
    label: t('settings.tags.reminders.frequencies.immediate'),
    description: t('settings.tags.reminders.frequencies.immediateDescription'),
  },
  {
    value: TAG_REMINDER_FREQUENCIES.daily,
    label: t('settings.tags.reminders.frequencies.daily'),
    description: t('settings.tags.reminders.frequencies.dailyDescription'),
  },
  {
    value: TAG_REMINDER_FREQUENCIES.weekly,
    label: t('settings.tags.reminders.frequencies.weekly'),
    description: t('settings.tags.reminders.frequencies.weeklyDescription'),
  },
  {
    value: TAG_REMINDER_FREQUENCIES.monthly,
    label: t('settings.tags.reminders.frequencies.monthly'),
    description: t('settings.tags.reminders.frequencies.monthlyDescription'),
  },
  {
    value: TAG_REMINDER_FREQUENCIES.quarterly,
    label: t('settings.tags.reminders.frequencies.quarterly'),
    description: t('settings.tags.reminders.frequencies.quarterlyDescription'),
  },
  {
    value: TAG_REMINDER_FREQUENCIES.yearly,
    label: t('settings.tags.reminders.frequencies.yearly'),
    description: t('settings.tags.reminders.frequencies.yearlyDescription'),
  },
]);

const selectedTypeOption = computed(() => reminderTypes.value.find((opt) => opt.value === form.type));

const selectedFrequencyOption = computed(() => frequencyOptions.value.find((opt) => opt.value === form.frequency));

const form = reactive({
  type: TAG_REMINDER_TYPES.amountThreshold as TagReminderType,
  amountThreshold: '',
  frequency: TAG_REMINDER_IMMEDIATE as TagReminderFrequencyOrImmediate,
  dayOfMonth: '1',
  isEnabled: true,
});

const initialValues = reactive({
  type: TAG_REMINDER_TYPES.amountThreshold as TagReminderType,
  amountThreshold: '',
  frequency: TAG_REMINDER_IMMEDIATE as TagReminderFrequencyOrImmediate,
  dayOfMonth: '1',
  isEnabled: true,
});

// Show day of month selector only for monthly/quarterly/yearly
const showDayOfMonth = computed(() => {
  const frequency = form.frequency;
  return (
    frequency === TAG_REMINDER_FREQUENCIES.monthly ||
    frequency === TAG_REMINDER_FREQUENCIES.quarterly ||
    frequency === TAG_REMINDER_FREQUENCIES.yearly
  );
});

const hasChanges = computed(() => {
  return (
    form.type !== initialValues.type ||
    form.amountThreshold !== initialValues.amountThreshold ||
    form.frequency !== initialValues.frequency ||
    form.dayOfMonth !== initialValues.dayOfMonth ||
    form.isEnabled !== initialValues.isEnabled
  );
});

const isSubmitDisabled = computed(() => {
  if (isSubmitting.value) return true;
  if (isEditMode.value && !hasChanges.value) return true;
  if (!form.type) return true;
  if (form.type === TAG_REMINDER_TYPES.amountThreshold && !form.amountThreshold) return true;
  return false;
});

const resetForm = () => {
  form.type = TAG_REMINDER_TYPES.amountThreshold;
  form.amountThreshold = '';
  form.frequency = TAG_REMINDER_IMMEDIATE;
  form.dayOfMonth = '1';
  form.isEnabled = true;
};

const initializeForm = () => {
  if (props.reminder) {
    form.type = props.reminder.type;
    const settings = props.reminder.settings as { amountThreshold?: number } | undefined;
    const displayAmount = settings?.amountThreshold?.toString() || '';
    form.amountThreshold = displayAmount;
    form.frequency = props.reminder.frequency || TAG_REMINDER_IMMEDIATE;
    form.dayOfMonth = props.reminder.dayOfMonth?.toString() || '1';
    form.isEnabled = props.reminder.isEnabled;

    initialValues.type = props.reminder.type;
    initialValues.amountThreshold = displayAmount;
    initialValues.frequency = props.reminder.frequency || TAG_REMINDER_IMMEDIATE;
    initialValues.dayOfMonth = props.reminder.dayOfMonth?.toString() || '1';
    initialValues.isEnabled = props.reminder.isEnabled;
  } else {
    resetForm();
    initialValues.type = TAG_REMINDER_TYPES.amountThreshold;
    initialValues.amountThreshold = '';
    initialValues.frequency = TAG_REMINDER_IMMEDIATE;
    initialValues.dayOfMonth = '1';
    initialValues.isEnabled = true;
  }
};

// Initialize form when reminder prop changes (including on mount)
watch(
  () => props.reminder,
  () => {
    initializeForm();
  },
  { immediate: true },
);

const handleSubmit = async () => {
  if (!form.type) return;

  isSubmitting.value = true;

  try {
    const isImmediate = form.frequency === TAG_REMINDER_IMMEDIATE;
    const frequency = isImmediate ? null : (form.frequency as TagReminderFrequency);

    const dayOfMonth = showDayOfMonth.value ? Number(form.dayOfMonth) : null;

    const payload: tagsApi.CreateTagReminderPayload = {
      type: form.type,
      frequency,
      dayOfMonth,
      settings:
        form.type === TAG_REMINDER_TYPES.amountThreshold ? { amountThreshold: Number(form.amountThreshold) } : {},
      isEnabled: form.isEnabled,
    };

    if (isEditMode.value && props.reminder) {
      const updatedReminder = await tagsApi.updateReminder({
        tagId: props.tagId,
        id: props.reminder.id,
        payload,
      });
      addSuccessNotification(t('settings.tags.reminders.notifications.updateSuccess'));
      emit('saved', updatedReminder);
    } else {
      const newReminder = await tagsApi.createReminder({
        tagId: props.tagId,
        payload,
      });

      // Mark onboarding task as complete
      const onboardingStore = useOnboardingStore();
      onboardingStore.completeTask('setup-tag-reminder');

      addSuccessNotification(t('settings.tags.reminders.notifications.createSuccess'));
      emit('saved', newReminder);
    }
  } catch (err) {
    if (err instanceof ApiErrorResponseError) {
      addErrorNotification(err.data.message || t('settings.tags.reminders.notifications.updateFailed'));
    } else {
      addErrorNotification(
        isEditMode.value
          ? t('settings.tags.reminders.notifications.updateFailed')
          : t('settings.tags.reminders.notifications.createFailed'),
      );
    }
  } finally {
    isSubmitting.value = false;
  }
};

const handleDelete = async () => {
  if (!props.reminder) return;

  isSubmitting.value = true;

  try {
    await tagsApi.deleteReminder({ tagId: props.tagId, id: props.reminder.id });
    addSuccessNotification(t('settings.tags.reminders.notifications.deleteSuccess'));
    emit('deleted');
  } catch (err) {
    if (err instanceof ApiErrorResponseError) {
      addErrorNotification(err.data.message || t('settings.tags.reminders.notifications.deleteFailed'));
    } else {
      addErrorNotification(t('settings.tags.reminders.notifications.deleteFailed'));
    }
  } finally {
    isSubmitting.value = false;
  }
};
</script>
