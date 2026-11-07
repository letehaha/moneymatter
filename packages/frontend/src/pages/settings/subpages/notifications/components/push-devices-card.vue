<template>
  <Card class="max-w-4xl">
    <CardHeader class="border-b">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 class="mb-2 text-2xl font-semibold">{{ $t('settings.notifications.devices.title') }}</h2>
          <p class="text-sm opacity-80">{{ $t('settings.notifications.devices.description') }}</p>
        </div>

        <Button
          v-if="devices?.length"
          variant="outline"
          size="sm"
          data-testid="push-test"
          :disabled="isSendingTest"
          @click="sendTest"
        >
          <Loader2Icon v-if="isSendingTest" class="size-4 animate-spin" />
          <SendIcon v-else class="size-4" />
          {{ $t('settings.notifications.devices.test.button') }}
        </Button>
      </div>
    </CardHeader>

    <CardContent class="mt-6">
      <div v-if="isLoading" class="flex flex-col gap-3" role="status" aria-busy="true">
        <div class="bg-muted h-14 animate-pulse rounded-lg" />
        <div class="bg-muted h-14 animate-pulse rounded-lg" />
      </div>

      <ul v-else-if="devices?.length" class="flex flex-col gap-3">
        <li
          v-for="device in devices"
          :key="device.id"
          :data-testid="`push-device-${device.id}`"
          :class="
            cn(
              'border-border flex items-center justify-between gap-3 rounded-lg border p-3',
              isThisDevice({ endpointHash: device.endpointHash }) && 'border-primary/50 bg-primary/5',
            )
          "
        >
          <div class="flex min-w-0 items-center gap-3">
            <div class="bg-muted flex size-10 shrink-0 items-center justify-center rounded-lg">
              <component :is="getDeviceIcon({ label: device.deviceLabel })" class="text-muted-foreground size-5" />
            </div>

            <div class="min-w-0">
              <div class="flex flex-wrap items-center gap-2">
                <p class="truncate font-medium">
                  {{ device.deviceLabel || $t('settings.notifications.devices.unnamed') }}
                </p>
                <span
                  v-if="isThisDevice({ endpointHash: device.endpointHash })"
                  class="bg-primary/10 text-primary-text rounded-full px-2 py-0.5 text-xs font-medium"
                >
                  {{ $t('settings.notifications.devices.thisDeviceBadge') }}
                </span>
              </div>
              <p class="text-muted-foreground text-sm">{{ describeLastSuccess({ device }) }}</p>
            </div>
          </div>

          <DesktopOnlyTooltip :content="$t('settings.notifications.devices.remove')">
            <Button
              variant="ghost-destructive"
              size="icon-sm"
              :data-testid="`push-device-remove-${device.id}`"
              :aria-label="$t('settings.notifications.devices.remove')"
              @click="askToRemove({ device })"
            >
              <Trash2Icon class="size-4" />
            </Button>
          </DesktopOnlyTooltip>
        </li>
      </ul>

      <div v-else class="flex flex-col items-center gap-3 py-8 text-center">
        <div class="bg-muted flex size-12 items-center justify-center rounded-full">
          <BellOffIcon class="text-muted-foreground size-6" />
        </div>
        <h3 class="text-lg font-medium">{{ $t('settings.notifications.devices.empty.title') }}</h3>
        <p class="text-muted-foreground max-w-sm text-sm">
          {{ $t('settings.notifications.devices.empty.description') }}
        </p>
        <Button v-if="state === 'off'" data-testid="push-empty-enable" @click="turnOn">
          <BellIcon class="size-4" />
          {{ $t('settings.notifications.devices.empty.action') }}
        </Button>
      </div>
    </CardContent>
  </Card>

  <ResponsiveAlertDialog
    v-model:open="isRemoveOpen"
    confirm-variant="destructive"
    :confirm-label="$t('settings.notifications.devices.removeDialog.confirm')"
    :confirm-disabled="isRemoving"
    @confirm="confirmRemove"
  >
    <template #title>{{ $t('settings.notifications.devices.removeDialog.title') }}</template>
    <template #description>
      <p>
        {{
          $t('settings.notifications.devices.removeDialog.description', {
            device: deviceToRemove?.deviceLabel || $t('settings.notifications.devices.unnamed'),
          })
        }}
      </p>
      <p v-if="isRemovingThisDevice" class="mt-2">
        {{ $t('settings.notifications.devices.removeDialog.thisDeviceNote') }}
      </p>
    </template>
  </ResponsiveAlertDialog>
</template>

<script setup lang="ts">
import ResponsiveAlertDialog from '@/components/common/responsive-alert-dialog.vue';
import { Button } from '@/components/lib/ui/button';
import { Card, CardContent, CardHeader } from '@/components/lib/ui/card';
import { DesktopOnlyTooltip } from '@/components/lib/ui/tooltip';
import { useNotificationCenter } from '@/components/notification-center';
import { useRemovePushDevice, usePushDevices, useSendTestPush } from '@/composable/data-queries/web-push';
import { useDateLocale } from '@/composable/use-date-locale';
import { useWebPush } from '@/composable/use-web-push';
import { cn } from '@/lib/utils';
import type { PushDeviceDto } from '@bt/shared/types';
import { BellIcon, BellOffIcon, Loader2Icon, MonitorIcon, SendIcon, SmartphoneIcon, Trash2Icon } from '@lucide/vue';
import { type Component, computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';

import { usePushActions } from '../use-push-actions';

const MOBILE_LABEL_PATTERN = /iphone|ipad|android|home screen/i;

const { t } = useI18n();
const { formatDistanceToNow } = useDateLocale();
const { addSuccessNotification, addErrorNotification, addWarningNotification } = useNotificationCenter();
const { state, disable, isThisDevice } = useWebPush();
const { turnOn } = usePushActions();
const { devices, isLoading, invalidate } = usePushDevices();
const removeDevice = useRemovePushDevice();
const sendTestPush = useSendTestPush();

const isSendingTest = sendTestPush.isPending;

const deviceToRemove = ref<PushDeviceDto | null>(null);
const isRemoveOpen = ref(false);
const isRemoving = ref(false);

const isRemovingThisDevice = computed(
  () => !!deviceToRemove.value && isThisDevice({ endpointHash: deviceToRemove.value.endpointHash }),
);

const getDeviceIcon = ({ label }: { label: string | null }): Component =>
  label && MOBILE_LABEL_PATTERN.test(label) ? SmartphoneIcon : MonitorIcon;

const describeLastSuccess = ({ device }: { device: PushDeviceDto }): string =>
  device.lastSuccessAt
    ? t('settings.notifications.devices.lastSuccess', {
        time: formatDistanceToNow(new Date(device.lastSuccessAt), { addSuffix: true }),
      })
    : t('settings.notifications.devices.never');

const askToRemove = ({ device }: { device: PushDeviceDto }) => {
  deviceToRemove.value = device;
  isRemoveOpen.value = true;
};

const confirmRemove = async () => {
  const device = deviceToRemove.value;
  if (!device) return;

  isRemoving.value = true;

  try {
    if (isThisDevice({ endpointHash: device.endpointHash })) {
      // Leaves the browser subscription and the server row together.
      await disable();
      await invalidate();
    } else {
      await removeDevice.mutateAsync({ id: device.id });
    }

    addSuccessNotification(t('settings.notifications.devices.toasts.removed'));
  } catch {
    addErrorNotification(t('settings.notifications.devices.toasts.removeFailed'));
  } finally {
    isRemoving.value = false;
    isRemoveOpen.value = false;
  }
};

const sendTest = async () => {
  try {
    const { sent, failed, removed } = await sendTestPush.mutateAsync();
    const message = t('settings.notifications.devices.test.result', { sent, failed, removed });

    if (sent > 0 && failed === 0) addSuccessNotification(message);
    else addWarningNotification(message);
  } catch {
    // The API client already shows the error, including the rate-limit answer.
  }
};
</script>
