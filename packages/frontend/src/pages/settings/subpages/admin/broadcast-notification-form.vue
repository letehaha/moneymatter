<template>
  <div>
    <h3 class="mb-2 text-lg font-medium">{{ $t('settings.admin.broadcast.title') }}</h3>
    <p class="mb-4 text-sm leading-relaxed">{{ $t('settings.admin.broadcast.description') }}</p>

    <div class="flex flex-col gap-4">
      <InputField
        v-model="form.title"
        :label="$t('settings.admin.broadcast.fields.title')"
        :placeholder="$t('settings.admin.broadcast.fields.titlePlaceholder')"
        maxlength="200"
      />
      <TextareaField
        v-model="form.message"
        :label="$t('settings.admin.broadcast.fields.message')"
        :placeholder="$t('settings.admin.broadcast.fields.messagePlaceholder')"
        maxlength="1000"
        rows="3"
      />
      <InputField
        v-model="form.url"
        :label="$t('settings.admin.broadcast.fields.url')"
        :placeholder="$t('settings.admin.broadcast.fields.urlPlaceholder')"
        :error-message="isUrlValid ? undefined : $t('settings.admin.broadcast.fields.urlError')"
      />
      <FieldLabel :label="$t('settings.admin.broadcast.fields.icon')" only-template>
        <div class="flex flex-wrap gap-2">
          <Button
            v-for="option in iconOptions"
            :key="option.value"
            size="sm"
            :variant="form.icon === option.value ? 'soft-primary' : 'outline'"
            :aria-pressed="form.icon === option.value"
            @click="form.icon = option.value"
          >
            <span
              :class="['flex size-5 items-center justify-center rounded-full', SYSTEM_ICON_VISUALS[option.value].bg]"
            >
              <component :is="SYSTEM_ICON_VISUALS[option.value].icon" class="size-3 text-white" />
            </span>
            {{ option.label }}
          </Button>
        </div>
      </FieldLabel>
      <TextareaField
        v-model="form.recipients"
        :label="$t('settings.admin.broadcast.fields.recipients')"
        :placeholder="$t('settings.admin.broadcast.fields.recipientsPlaceholder')"
        :error-message="recipients ? undefined : $t('settings.admin.broadcast.fields.recipientsError')"
        rows="2"
      />

      <div>
        <Button :disabled="!canSubmit" @click="isConfirmOpen = true">
          {{ $t('settings.admin.broadcast.button') }}
        </Button>
      </div>
    </div>

    <ResponsiveAlertDialog
      v-model:open="isConfirmOpen"
      :confirm-label="$t('settings.admin.broadcast.confirm.button')"
      :confirm-disabled="isSending"
      @confirm="send"
    >
      <template #title>{{ confirmText.title }}</template>
      <template #description>{{ confirmText.description }}</template>
    </ResponsiveAlertDialog>
  </div>
</template>

<script setup lang="ts">
import { broadcastSystemNotification } from '@/api/admin';
import { getErrorMessage } from '@/common/utils/error-message';
import { isHttpsUrl } from '@/common/utils/external-url';
import ResponsiveAlertDialog from '@/components/common/responsive-alert-dialog.vue';
import FieldLabel from '@/components/fields/components/field-label.vue';
import InputField from '@/components/fields/input-field.vue';
import TextareaField from '@/components/fields/textarea-field.vue';
import Button from '@/components/lib/ui/button/Button.vue';
import { NotificationType, useNotificationCenter } from '@/components/notification-center';
import { SYSTEM_ICON_VISUALS } from '@/components/notifications-popover/system-icons';
import { SYSTEM_NOTIFICATION_ICONS, type SystemNotificationIcon } from '@bt/shared/types';
import { computed, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';

import { parseRecipients } from './parse-recipients';

const { t } = useI18n();
const { addNotification } = useNotificationCenter();

const EMPTY_FORM = {
  title: '',
  message: '',
  url: '',
  icon: SYSTEM_NOTIFICATION_ICONS.info as SystemNotificationIcon,
  recipients: '',
};
const form = reactive({ ...EMPTY_FORM });
const isConfirmOpen = ref(false);
const isSending = ref(false);

const iconOptions = computed(() => {
  const labels = {
    info: t('settings.admin.broadcast.icons.info'),
    announcement: t('settings.admin.broadcast.icons.announcement'),
    success: t('settings.admin.broadcast.icons.success'),
    warning: t('settings.admin.broadcast.icons.warning'),
  } satisfies Record<SystemNotificationIcon, string>;
  return Object.values(SYSTEM_NOTIFICATION_ICONS).map((value) => ({ value, label: labels[value] }));
});

const trimmedUrl = computed(() => form.url.trim());
const isUrlValid = computed(() => !trimmedUrl.value || isHttpsUrl(trimmedUrl.value));
const recipients = computed(() => parseRecipients(form.recipients));
const recipientCount = computed(() => (recipients.value?.userIds.length ?? 0) + (recipients.value?.emails.length ?? 0));
const canSubmit = computed(
  () => form.title.trim().length > 0 && isUrlValid.value && recipients.value !== null && !isSending.value,
);

const confirmText = computed(() =>
  recipientCount.value
    ? {
        title: t('settings.admin.broadcast.confirm.titleSelected', { count: recipientCount.value }),
        description: t('settings.admin.broadcast.confirm.descriptionSelected'),
      }
    : {
        title: t('settings.admin.broadcast.confirm.title'),
        description: t('settings.admin.broadcast.confirm.description'),
      },
);

const send = async () => {
  const { userIds = [], emails = [] } = recipients.value ?? {};
  isSending.value = true;
  try {
    const { created } = await broadcastSystemNotification({
      title: form.title.trim(),
      message: form.message.trim() || undefined,
      url: trimmedUrl.value || undefined,
      icon: form.icon,
      userIds: userIds.length ? userIds : undefined,
      emails: emails.length ? emails : undefined,
    });
    if (created) {
      addNotification({
        text: t('settings.admin.broadcast.notifications.success', { count: created }),
        type: NotificationType.success,
      });
      Object.assign(form, EMPTY_FORM);
    } else {
      addNotification({
        text: t('settings.admin.broadcast.notifications.noneCreated'),
        type: NotificationType.warning,
      });
    }
  } catch (error) {
    addNotification({
      text: getErrorMessage(error, t('settings.admin.broadcast.notifications.failed')),
      type: NotificationType.error,
    });
  } finally {
    isSending.value = false;
    isConfirmOpen.value = false;
  }
};
</script>
