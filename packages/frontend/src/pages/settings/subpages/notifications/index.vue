<template>
  <div class="flex flex-col gap-6">
    <Card v-if="state === 'server-disabled'" class="max-w-4xl" data-testid="push-server-disabled">
      <CardHeader>
        <h2 class="mb-2 text-2xl font-semibold">{{ $t('settings.notifications.serverDisabled.title') }}</h2>
        <p class="text-sm opacity-80">{{ $t('settings.notifications.serverDisabled.description') }}</p>
      </CardHeader>
    </Card>

    <template v-else>
      <p class="max-w-4xl text-sm opacity-80">{{ $t('settings.notifications.description') }}</p>

      <ThisDeviceCard />
      <PushGroupsCard />
      <PushDevicesCard />
    </template>
  </div>
</template>

<script setup lang="ts">
import { Card, CardHeader } from '@/components/lib/ui/card';
import { useWebPush } from '@/composable/use-web-push';
import { onMounted } from 'vue';

import PushDevicesCard from './components/push-devices-card.vue';
import PushGroupsCard from './components/push-groups-card.vue';
import ThisDeviceCard from './components/this-device-card.vue';

const { state, prepare } = useWebPush();

onMounted(() => {
  // Registers the worker so the toggle's click can call `subscribe()` first; failures leave the toggle off.
  void prepare().catch(() => undefined);
});
</script>
