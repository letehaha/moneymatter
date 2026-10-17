<template>
  <Card class="max-w-4xl">
    <CardHeader class="border-b">
      <h2 class="mb-2 text-2xl font-semibold">{{ $t('settings.notifications.thisDevice.title') }}</h2>
      <p class="text-sm opacity-80">{{ $t('settings.notifications.thisDevice.toggleDescription') }}</p>
    </CardHeader>

    <CardContent class="mt-6 flex flex-col gap-4">
      <div v-if="state === 'checking'" class="flex flex-col gap-3" role="status" aria-busy="true">
        <div class="bg-muted h-5 w-1/2 animate-pulse rounded-md" />
        <div class="bg-muted h-4 w-3/4 animate-pulse rounded-md" />
      </div>

      <Callout v-else-if="state === 'unsupported'" variant="info" data-testid="push-state-unsupported">
        {{ $t('settings.notifications.thisDevice.unsupported') }}
      </Callout>

      <Callout v-else-if="state === 'needs-home-screen'" variant="info" data-testid="push-state-needs-home-screen">
        {{ $t('settings.notifications.thisDevice.needsHomeScreen') }}
      </Callout>

      <template v-else-if="TOGGLE_STATES.includes(state)">
        <Callout v-if="state === 'denied'" variant="warning" data-testid="push-state-denied">
          <p>{{ $t('settings.notifications.thisDevice.denied') }}</p>
          <p class="mt-1">{{ $t(`settings.notifications.thisDevice.blockedHint.${blockedHintKey}`) }}</p>
        </Callout>

        <Callout v-if="needsTapAgain" variant="info" data-testid="push-state-tap-again">
          {{ $t('settings.notifications.thisDevice.tapAgain') }}
        </Callout>

        <div class="flex items-center justify-between gap-4">
          <span class="flex items-center gap-2 text-sm">
            <BellIcon class="text-muted-foreground size-4 shrink-0" />
            {{ $t('settings.notifications.thisDevice.toggleLabel') }}
          </span>

          <span class="flex items-center gap-2">
            <Loader2Icon
              v-if="isPending"
              class="text-muted-foreground size-4 animate-spin"
              data-testid="push-pending"
            />
            <Switch
              :model-value="state === 'on'"
              :disabled="isPending || state === 'denied'"
              :aria-label="$t('settings.notifications.thisDevice.toggleLabel')"
              @update:model-value="(value) => (value ? turnOn() : turnOff())"
            />
          </span>
        </div>
      </template>
    </CardContent>
  </Card>
</template>

<script setup lang="ts">
import { getPushBlockedHintKey } from '@/common/utils/push-blocked-hint';
import { Callout } from '@/components/lib/ui/callout';
import { Card, CardContent, CardHeader } from '@/components/lib/ui/card';
import { Switch } from '@/components/lib/ui/switch';
import { useSafariDetection } from '@/composable/detect-safari';
import { type WebPushState, useWebPush } from '@/composable/use-web-push';
import { BellIcon, Loader2Icon } from '@lucide/vue';

import { usePushActions } from '../use-push-actions';

// The states in which this browser can show the toggle; the others are explained above it or by the page.
const TOGGLE_STATES: WebPushState[] = ['off', 'on', 'denied'];

const { state, isPending, needsTapAgain } = useWebPush();
const { turnOn, turnOff } = usePushActions();

const blockedHintKey = getPushBlockedHintKey({
  userAgent: navigator.userAgent,
  isIOS: useSafariDetection().isIOS,
});
</script>
