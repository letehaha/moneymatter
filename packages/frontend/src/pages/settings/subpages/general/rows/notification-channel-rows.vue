<template>
  <div class="flex flex-col gap-3">
    <SettingRow
      v-if="category !== 'unrealizedLoss'"
      :label="$t(`settings.notifications.categories.${category}.label`)"
      :description="$t(`settings.notifications.categories.${category}.description`)"
    >
      <Switch :model-value="isOn" :disabled="isPatching" @update:model-value="save({ enabled: $event })" />
    </SettingRow>

    <div v-if="isOn" class="flex flex-wrap gap-x-6 gap-y-2">
      <label
        v-for="channel in channels"
        :key="channel"
        :class="cn('flex cursor-pointer items-center gap-2 text-sm', isLocked(channel) && 'cursor-not-allowed')"
      >
        <Checkbox
          :model-value="isLocked(channel) || channelsOn[channel]"
          :disabled="isPatching || isLocked(channel)"
          @update:model-value="save({ [channel]: $event === true })"
        />
        <span>{{ $t(`settings.notifications.channels.${channel}`) }}</span>
      </label>
    </div>
  </div>
</template>

<script setup lang="ts">
import { Checkbox } from '@/components/lib/ui/checkbox';
import { Switch } from '@/components/lib/ui/switch';
import { useNotificationCenter } from '@/components/notification-center';
import { useUserSettings } from '@/composable/data-queries/user-settings';
import { cn } from '@/lib/utils';
import {
  NOTIFICATION_PREFERENCE_DEFAULTS,
  type NotificationCategory,
  type NotificationChannelPreferences,
  getNotificationChannels,
} from '@bt/shared/types';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

import SettingRow from './setting-row.vue';

type Channel = 'inApp' | 'push' | 'email';

const props = defineProps<{ category: NotificationCategory }>();

const { t } = useI18n();
const { addSuccessNotification } = useNotificationCenter();
const { data: userSettings, patch, isPatching } = useUserSettings();

const resolved = computed<NotificationChannelPreferences>(() => ({
  ...NOTIFICATION_PREFERENCE_DEFAULTS[props.category],
  ...userSettings.value?.notifications?.[props.category],
}));
const channelsOn = computed(() =>
  getNotificationChannels({ category: props.category, preferences: userSettings.value?.notifications }),
);
const channels: Channel[] = ['inApp', 'push', 'email'];
// Always on: a channel the category has no setting for (the invitation email is the invitation itself),
// and in-app while push is on.
const isLocked = (channel: Channel) =>
  !(channel in NOTIFICATION_PREFERENCE_DEFAULTS[props.category]) || (channel === 'inApp' && channelsOn.value.push);
// Loss alerts switch on with their thresholds in `unrealizedLossAlerts`.
const isOn = computed(() =>
  props.category === 'unrealizedLoss'
    ? (userSettings.value?.unrealizedLossAlerts?.enabled ?? false)
    : resolved.value.enabled !== false,
);

const save = (update: NotificationChannelPreferences) =>
  patch(
    { notifications: { [props.category]: update } },
    { onSuccess: () => addSuccessNotification(t('settings.notifications.successNotification')) },
  );
</script>
