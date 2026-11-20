<template>
  <ResponsiveDialog v-model:open="isOpen">
    <template #trigger>
      <slot />
    </template>

    <template #title>
      {{ isEditMode ? $t('settings.tags.form.editTitle') : $t('settings.tags.form.createTitle') }}
    </template>

    <!-- Tabs for edit mode, simple form for create mode -->
    <template v-if="isEditMode && tag">
      <Tabs v-model="activeTab" class="mt-4 mb-auto">
        <TabsList class="grid w-full grid-cols-2">
          <TabsTrigger value="details">
            {{ $t('settings.tags.tabs.details') }}
          </TabsTrigger>
          <TabsTrigger value="reminders">
            {{ $t('settings.tags.tabs.reminders') }}
            <span
              v-if="reminders.length > 0"
              class="bg-primary/10 text-primary-text ml-1.5 inline-flex size-5 items-center justify-center rounded-full text-xs font-medium"
            >
              {{ reminders.length }}
            </span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="details" class="min-h-100">
          <TagDetailsForm
            :form="form"
            :is-edit-mode="isEditMode"
            :is-submitting="isSubmitting"
            :is-submit-disabled="isSubmitDisabled"
            :tag="tag"
            @submit="handleSubmit"
            @delete="handleDelete"
          />
        </TabsContent>

        <TabsContent value="reminders" class="relative h-100 overflow-auto pb-2">
          <div class="bg-dialog sticky top-0 mb-2 flex items-center justify-end py-2">
            <Button variant="outline" size="sm" class="gap-1.5" @click="openReminderDialog()">
              <PlusIcon class="size-4" />
              {{ $t('settings.tags.reminders.addButton') }}
            </Button>
          </div>

          <div v-if="isLoadingReminders" class="text-muted-foreground py-4 text-center text-sm">
            {{ $t('common.actions.loading') }}
          </div>
          <div v-else-if="reminders.length === 0" class="text-muted-foreground py-8 text-center text-sm">
            {{ $t('settings.tags.reminders.empty') }}
          </div>
          <div v-else class="grid gap-2">
            <div
              v-for="reminder in reminders"
              :key="reminder.id"
              class="hover:bg-hover flex cursor-pointer items-center justify-between gap-3 rounded-md border px-3 py-2 transition-colors"
              @click="openReminderDialog({ reminder })"
            >
              <div class="min-w-0 flex-1">
                <div class="flex items-center gap-2">
                  <span class="font-medium">{{ getReminderTypeLabel(reminder.type) }}</span>
                  <span
                    class="inline-flex items-center rounded-full px-2 py-0.5 text-xs"
                    :class="
                      reminder.isEnabled
                        ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                        : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'
                    "
                  >
                    {{
                      reminder.isEnabled
                        ? $t('settings.tags.reminders.enabled')
                        : $t('settings.tags.reminders.disabled')
                    }}
                  </span>
                </div>
                <p class="text-muted-foreground text-xs">
                  {{ getReminderScheduleLabel(reminder) }}
                  <template v-if="getAmountThreshold(reminder)">
                    &middot; {{ formatBaseCurrency(getAmountThreshold(reminder)!) }}
                  </template>
                </p>
              </div>
              <ChevronRightIcon class="text-muted-foreground size-4 shrink-0" />
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </template>

    <!-- Simple form for create mode (no tabs) -->
    <template v-else>
      <TagDetailsForm
        :form="form"
        :is-edit-mode="isEditMode"
        :is-submitting="isSubmitting"
        :is-submit-disabled="isSubmitDisabled"
        class="mt-4"
        @submit="handleSubmit"
      />
    </template>
  </ResponsiveDialog>

  <!-- Reminder Form Dialog (managed separately to avoid nested dialog issues) -->
  <ResponsiveDialog v-model:open="isReminderDialogOpen">
    <template #title>
      {{
        editingReminder ? $t('settings.tags.reminders.form.editTitle') : $t('settings.tags.reminders.form.createTitle')
      }}
    </template>

    <TagReminderForm
      v-if="tag"
      :tag-id="tag.id"
      :reminder="editingReminder"
      @saved="handleReminderSaved"
      @deleted="handleReminderDeleted"
    />
  </ResponsiveDialog>
</template>

<script setup lang="ts">
import * as tagsApi from '@/api/tags';
import ResponsiveDialog from '@/components/common/responsive-dialog.vue';
import TagDetailsForm from '@/components/dialogs/tag-details-form.vue';
import TagReminderForm from '@/components/dialogs/tag-reminder-form.vue';
import { Button } from '@/components/lib/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/lib/ui/tabs';
import { useNotificationCenter } from '@/components/notification-center';
import { useFormatCurrency } from '@/composable';
import { ApiErrorResponseError } from '@/js/errors';
import { useTagsStore } from '@/stores';
import {
  TAG_REMINDER_FREQUENCIES,
  TAG_REMINDER_TYPES,
  TagModel,
  TagReminderFrequency,
  TagReminderModel,
  TagReminderType,
} from '@bt/shared/types';
import { ChevronRightIcon, PlusIcon } from '@lucide/vue';
import { useVModel } from '@vueuse/core';
import { computed, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

const props = defineProps<{
  tag?: TagModel;
  open?: boolean;
}>();

const emit = defineEmits<{
  saved: [tag: TagModel];
  deleted: [];
  'update:open': [value: boolean];
}>();

const isOpen = useVModel(props, 'open', emit, { passive: true });

const isSubmitting = ref(false);
const activeTab = ref('details');

// Reminder dialog state
const isReminderDialogOpen = ref(false);
const editingReminder = ref<TagReminderModel | undefined>(undefined);

const openReminderDialog = ({ reminder }: { reminder?: TagReminderModel } = {}) => {
  editingReminder.value = reminder;
  isReminderDialogOpen.value = true;
};

const closeReminderDialog = () => {
  isReminderDialogOpen.value = false;
  editingReminder.value = undefined;
};

const { t } = useI18n();
const tagsStore = useTagsStore();
const { addErrorNotification, addSuccessNotification } = useNotificationCenter();
const { formatBaseCurrency } = useFormatCurrency();

const isEditMode = computed(() => !!props.tag);

// Reminders state
const reminders = ref<TagReminderModel[]>([]);
const isLoadingReminders = ref(false);

const loadReminders = async () => {
  if (!props.tag) return;

  isLoadingReminders.value = true;
  try {
    reminders.value = await tagsApi.loadRemindersForTag({ tagId: props.tag.id });
  } catch {
    // Silently fail - reminders are not critical
  } finally {
    isLoadingReminders.value = false;
  }
};

const handleReminderSaved = (reminder: TagReminderModel) => {
  const index = reminders.value.findIndex((r) => r.id === reminder.id);
  if (index !== -1) {
    reminders.value[index] = reminder;
  } else {
    reminders.value.push(reminder);
  }
  closeReminderDialog();
};

const handleReminderDeleted = () => {
  closeReminderDialog();
  loadReminders();
};

const getReminderTypeLabel = (type: TagReminderType) => {
  switch (type) {
    case TAG_REMINDER_TYPES.amountThreshold:
      return t('settings.tags.reminders.types.amountThreshold');
    case TAG_REMINDER_TYPES.existenceCheck:
      return t('settings.tags.reminders.types.existenceCheck');
    default:
      return type;
  }
};

const getReminderScheduleLabel = (reminder: TagReminderModel) => {
  // Real-time reminder (no schedule)
  if (!reminder.frequency) {
    return t('settings.tags.reminders.frequencies.immediate');
  }

  // Scheduled reminder
  return getFrequencyLabel(reminder.frequency);
};

const getFrequencyLabel = (frequency: TagReminderFrequency) => {
  switch (frequency) {
    case TAG_REMINDER_FREQUENCIES.daily:
      return t('settings.tags.reminders.frequencies.daily');
    case TAG_REMINDER_FREQUENCIES.weekly:
      return t('settings.tags.reminders.frequencies.weekly');
    case TAG_REMINDER_FREQUENCIES.monthly:
      return t('settings.tags.reminders.frequencies.monthly');
    case TAG_REMINDER_FREQUENCIES.quarterly:
      return t('settings.tags.reminders.frequencies.quarterly');
    case TAG_REMINDER_FREQUENCIES.yearly:
      return t('settings.tags.reminders.frequencies.yearly');
    default:
      return frequency;
  }
};

const getAmountThreshold = (reminder: TagReminderModel): number | undefined => {
  const settings = reminder.settings as { amountThreshold?: number } | undefined;
  return settings?.amountThreshold;
};

const DEFAULT_TAG_COLOR = '#3b82f6';

const form = reactive({
  name: '',
  color: DEFAULT_TAG_COLOR,
  icon: '',
  description: '',
});

const initialValues = reactive({
  name: '',
  color: DEFAULT_TAG_COLOR,
  icon: '',
  description: '',
});

const hasChanges = computed(() => {
  return (
    form.name !== initialValues.name ||
    form.color !== initialValues.color ||
    form.icon !== initialValues.icon ||
    form.description !== initialValues.description
  );
});

const isSubmitDisabled = computed(() => {
  if (isSubmitting.value) return true;
  if (isEditMode.value && !hasChanges.value) return true;
  if (!isEditMode.value && !form.name.trim()) return true;
  return false;
});

const resetForm = () => {
  form.name = '';
  form.color = DEFAULT_TAG_COLOR;
  form.icon = '';
  form.description = '';
};

const initializeForm = () => {
  if (props.tag) {
    form.name = props.tag.name;
    form.color = props.tag.color;
    form.icon = props.tag.icon || '';
    form.description = props.tag.description || '';

    initialValues.name = props.tag.name;
    initialValues.color = props.tag.color;
    initialValues.icon = props.tag.icon || '';
    initialValues.description = props.tag.description || '';
  } else {
    resetForm();
    initialValues.name = '';
    initialValues.color = DEFAULT_TAG_COLOR;
    initialValues.icon = '';
    initialValues.description = '';
  }
};

watch(
  isOpen,
  (open) => {
    if (open) {
      activeTab.value = 'details';
      initializeForm();
      // Load reminders when editing an existing tag
      if (props.tag) {
        loadReminders();
      } else {
        reminders.value = [];
      }
    }
  },
  { immediate: true },
);

const handleSubmit = async () => {
  if (!form.name.trim()) return;

  isSubmitting.value = true;

  try {
    const payload = {
      name: form.name.trim(),
      color: form.color,
      icon: form.icon.trim() || null,
      description: form.description.trim() || null,
    };

    if (isEditMode.value && props.tag) {
      const updatedTag = await tagsStore.updateTag({ id: props.tag.id, payload });
      addSuccessNotification(t('settings.tags.notifications.updateSuccess'));
      emit('saved', updatedTag);
    } else {
      const newTag = await tagsStore.createTag(payload);
      addSuccessNotification(t('settings.tags.notifications.createSuccess'));
      emit('saved', newTag);
    }

    isOpen.value = false;
  } catch (err) {
    if (err instanceof ApiErrorResponseError) {
      addErrorNotification(err.data.message || t('settings.tags.notifications.updateFailed'));
    } else {
      addErrorNotification(
        isEditMode.value
          ? t('settings.tags.notifications.updateFailed')
          : t('settings.tags.notifications.createFailed'),
      );
    }
  } finally {
    isSubmitting.value = false;
  }
};

const handleDelete = async () => {
  if (!props.tag) return;

  isSubmitting.value = true;

  try {
    await tagsStore.deleteTag({ id: props.tag.id });
    addSuccessNotification(t('settings.tags.notifications.deleteSuccess'));
    emit('deleted');
    isOpen.value = false;
  } catch (err) {
    if (err instanceof ApiErrorResponseError) {
      addErrorNotification(err.data.message || t('settings.tags.notifications.deleteFailed'));
    } else {
      addErrorNotification(t('settings.tags.notifications.deleteFailed'));
    }
  } finally {
    isSubmitting.value = false;
  }
};
</script>
