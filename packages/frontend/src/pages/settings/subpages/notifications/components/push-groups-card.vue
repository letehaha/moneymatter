<template>
  <Card class="max-w-4xl">
    <CardHeader class="border-b">
      <h2 class="mb-2 text-2xl font-semibold">{{ $t('settings.notifications.groups.title') }}</h2>
      <p class="text-sm opacity-80">{{ $t('settings.notifications.groups.description') }}</p>
    </CardHeader>

    <CardContent class="mt-6 flex flex-col gap-4">
      <div
        v-for="group in groups"
        :key="group.key"
        :data-testid="`push-group-${group.key}`"
        class="flex items-center justify-between gap-4"
      >
        <div class="flex min-w-0 items-start gap-3">
          <component :is="group.icon" class="text-muted-foreground mt-0.5 size-4 shrink-0" />
          <div class="min-w-0">
            <p class="text-sm font-medium">{{ $t(`settings.notifications.groups.items.${group.key}.label`) }}</p>
            <p class="text-muted-foreground text-sm">
              {{ $t(`settings.notifications.groups.items.${group.key}.description`) }}
            </p>
          </div>
        </div>

        <Switch
          :model-value="group.enabled"
          :disabled="isLoading"
          :aria-label="$t(`settings.notifications.groups.items.${group.key}.label`)"
          @update:model-value="(value) => toggleGroup({ group: group.key, value: !!value })"
        />
      </div>
    </CardContent>
  </Card>
</template>

<script setup lang="ts">
import { Card, CardContent, CardHeader } from '@/components/lib/ui/card';
import { Switch } from '@/components/lib/ui/switch';
import { PUSH_GROUPS, type PushGroup } from '@bt/shared/types';
import { BellRingIcon, LandmarkIcon, PackageIcon, ServerIcon, UsersIcon } from '@lucide/vue';
import { type Component, computed } from 'vue';

import { usePushGroups } from '../use-push-groups';

// Typed as a Record so a new group fails to compile until it has an icon.
const GROUP_ICONS: Record<PushGroup, Component> = {
  [PUSH_GROUPS.reminders]: BellRingIcon,
  [PUSH_GROUPS.bankSync]: LandmarkIcon,
  [PUSH_GROUPS.sharing]: UsersIcon,
  [PUSH_GROUPS.system]: ServerIcon,
  [PUSH_GROUPS.releases]: PackageIcon,
};

const { isGroupEnabled, toggleGroup, isLoading } = usePushGroups();

const groups = computed(() =>
  (Object.keys(GROUP_ICONS) as PushGroup[]).map((key) => ({
    key,
    icon: GROUP_ICONS[key],
    enabled: isGroupEnabled({ group: key }),
  })),
);
</script>
