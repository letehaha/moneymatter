<template>
  <Popover>
    <PopoverTrigger as-child>
      <Button size="icon-sm" variant="ghost" :aria-label="$t('common.actions.settings')">
        <SettingsIcon class="text-muted-foreground size-4" />
      </Button>
    </PopoverTrigger>

    <PopoverContent class="w-72 overflow-hidden p-0" align="end">
      <div class="flex flex-col">
        <header class="border-b px-3 py-2 text-sm font-medium">
          {{ $t('dashboard.widgets.netWorth.settings.title') }}
        </header>

        <div class="flex flex-col p-2">
          <div class="flex items-center justify-between gap-2 rounded-md px-2 py-2">
            <span class="text-sm font-medium">{{ $t('dashboard.widgets.netWorth.settings.loans') }}</span>
            <Switch
              :model-value="settings.includeLoans"
              :disabled="isUpdating"
              @update:model-value="(value: boolean) => emit('save', { patch: { includeLoans: value } })"
            />
          </div>

          <div class="flex items-center justify-between gap-2 rounded-md px-2 py-2">
            <span class="text-sm font-medium">{{ $t('dashboard.widgets.netWorth.settings.vehicles') }}</span>
            <Switch
              :model-value="settings.includeVehicles"
              :disabled="isUpdating"
              @update:model-value="(value: boolean) => emit('save', { patch: { includeVehicles: value } })"
            />
          </div>

          <div class="flex items-center justify-between gap-2 rounded-md px-2 py-2">
            <span class="text-sm font-medium">{{ $t('dashboard.widgets.netWorth.settings.properties') }}</span>
            <Switch
              :model-value="settings.includeProperties"
              :disabled="isUpdating"
              @update:model-value="(value: boolean) => emit('save', { patch: { includeProperties: value } })"
            />
          </div>

          <div class="flex items-center justify-between gap-2 rounded-md px-2 py-2">
            <span class="text-sm font-medium">{{ $t('dashboard.widgets.netWorth.settings.ventures') }}</span>
            <Switch
              :model-value="settings.includeVentures"
              :disabled="isUpdating"
              @update:model-value="(value: boolean) => emit('save', { patch: { includeVentures: value } })"
            />
          </div>
        </div>
      </div>
    </PopoverContent>
  </Popover>
</template>

<script lang="ts" setup>
import { Button } from '@/components/lib/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/lib/ui/popover';
import { Switch } from '@/components/lib/ui/switch';
import { SettingsIcon } from '@lucide/vue';

import type { NetWorthIncludeSettings } from './helpers';

defineProps<{
  settings: NetWorthIncludeSettings;
  isUpdating: boolean;
}>();

const emit = defineEmits<{
  save: [payload: { patch: Partial<NetWorthIncludeSettings> }];
}>();
</script>
