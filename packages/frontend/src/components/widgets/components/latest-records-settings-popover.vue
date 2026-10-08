<template>
  <Popover v-model:open="isOpen">
    <PopoverTrigger as-child>
      <Button size="icon-sm" variant="ghost" :aria-label="$t('common.actions.settings')">
        <SettingsIcon class="text-muted-foreground size-4" />
      </Button>
    </PopoverTrigger>
    <PopoverContent class="w-72 overflow-hidden p-0" align="end">
      <SlidingPanels v-model="view" :panels="['main', 'exclusions']">
        <template #main>
          <div class="flex flex-col">
            <header class="border-b px-3 py-2 text-sm font-medium">
              {{ $t('common.actions.settings') }}
            </header>

            <div class="flex flex-col p-2">
              <button
                type="button"
                class="hover:bg-accent flex items-center justify-between gap-2 rounded-md px-2 py-2 text-left transition-colors"
                @click="goTo('exclusions')"
              >
                <span class="flex flex-col">
                  <span class="text-sm font-medium">
                    {{ $t('widgets.latestRecords.settings.excludeTitle') }}
                  </span>
                  <span class="text-muted-foreground text-xs">
                    {{ exclusionsSummary }}
                  </span>
                </span>
                <ChevronRightIcon class="text-muted-foreground size-4" />
              </button>

              <div class="flex items-center justify-between gap-2 rounded-md px-2 py-2">
                <span class="text-sm font-medium">{{ $t('widgets.latestRecords.settings.tagsStyleTitle') }}</span>
                <PillTabs
                  size="sm"
                  :items="tagsVariantItems"
                  :model-value="tagsVariant"
                  :disabled="isUpdating"
                  @update:model-value="onTagsVariantChange"
                />
              </div>

              <div class="flex items-center justify-between gap-2 rounded-md px-2 py-2">
                <span class="flex flex-col">
                  <span class="text-sm font-medium">{{ $t('widgets.latestRecords.settings.showAccountTitle') }}</span>
                  <span class="text-muted-foreground text-xs">
                    {{ $t('widgets.latestRecords.settings.showAccountDescription') }}
                  </span>
                </span>
                <Switch
                  data-testid="lr-show-account-switch"
                  :model-value="showAccount"
                  :disabled="isUpdating"
                  @update:model-value="(value) => setShowAccount({ value: !!value })"
                />
              </div>
            </div>
          </div>
        </template>

        <template #exclusions>
          <div class="flex flex-col">
            <header class="flex items-center gap-2 border-b px-2 py-2">
              <Button
                size="icon-sm"
                variant="ghost"
                type="button"
                :aria-label="$t('common.actions.back')"
                @click="goTo('main')"
              >
                <ArrowLeftIcon class="size-4" />
              </Button>
              <span class="text-sm font-medium">
                {{ $t('widgets.latestRecords.settings.excludeTitle') }}
              </span>
            </header>

            <div class="flex flex-col p-2">
              <div class="flex items-center justify-between gap-2 rounded-md px-2 py-2">
                <span class="flex flex-col">
                  <span class="text-sm font-medium">{{
                    $t('transactions.filters.transferNature.commonTransfer')
                  }}</span>
                  <span class="text-muted-foreground text-xs">
                    {{ $t('widgets.latestRecords.settings.excludeTransfersDescription') }}
                  </span>
                </span>
                <Switch
                  :model-value="exclusions.excludeTransfers"
                  :disabled="isUpdating"
                  @update:model-value="(value) => persistConfig({ excludeTransfers: !!value })"
                />
              </div>

              <div class="flex items-center justify-between gap-2 rounded-md px-2 py-2">
                <span class="flex flex-col">
                  <span class="text-sm font-medium">{{ $t('transactions.filters.transferNature.outOfWallet') }}</span>
                  <span class="text-muted-foreground text-xs">
                    {{ $t('widgets.latestRecords.settings.excludeOutOfWalletDescription') }}
                  </span>
                </span>
                <Switch
                  :model-value="exclusions.excludeOutOfWallet"
                  :disabled="isUpdating"
                  @update:model-value="(value) => persistConfig({ excludeOutOfWallet: !!value })"
                />
              </div>

              <div class="flex items-center justify-between gap-2 rounded-md px-2 py-2">
                <span class="flex flex-col">
                  <span class="text-sm font-medium">{{
                    $t('widgets.latestRecords.settings.balanceAdjustmentsTitle')
                  }}</span>
                  <span class="text-muted-foreground text-xs">
                    {{ $t('widgets.latestRecords.settings.excludeBalanceAdjustmentsDescription') }}
                  </span>
                </span>
                <Switch
                  :model-value="exclusions.excludeBalanceAdjustments"
                  :disabled="isUpdating"
                  @update:model-value="(value) => persistConfig({ excludeBalanceAdjustments: !!value })"
                />
              </div>

              <div class="flex items-center justify-between gap-2 rounded-md px-2 py-2">
                <span class="flex flex-col">
                  <span class="text-sm font-medium">{{ $t('widgets.latestRecords.settings.plannedTitle') }}</span>
                  <span class="text-muted-foreground text-xs">
                    {{ $t('widgets.latestRecords.settings.excludePlannedDescription') }}
                  </span>
                </span>
                <Switch
                  data-testid="lr-exclude-planned-switch"
                  :model-value="!includePlanned"
                  :disabled="isUpdating"
                  @update:model-value="onExcludePlannedToggle"
                />
              </div>
            </div>
          </div>
        </template>
      </SlidingPanels>
    </PopoverContent>
  </Popover>
</template>

<script lang="ts" setup>
import type { DashboardWidgetConfig } from '@/api/user-settings';
import SlidingPanels from '@/components/common/sliding-panels.vue';
import { Button } from '@/components/lib/ui/button';
import { PillTabs, type PillTabItem } from '@/components/lib/ui/pill-tabs';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/lib/ui/popover';
import { Switch } from '@/components/lib/ui/switch';
import { useNotificationCenter } from '@/components/notification-center';
import {
  useIncludePlannedConfig,
  useIncludePlannedSaveError,
  useWidgetConfigFlag,
} from '@/components/widgets/use-include-planned-config';
import { useUserSettings } from '@/composable/data-queries/user-settings';
import { ArrowLeftIcon, ChevronRightIcon, SettingsIcon } from '@lucide/vue';
import type { Ref } from 'vue';
import { computed, inject, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

import { readLatestRecordsExclusions, readLatestRecordsTagsVariant } from '../latest-records-config';

const PANEL_TRANSITION_DURATION = 320;

const { t } = useI18n({ useScope: 'global' });
const widgetConfigRef = inject<Ref<DashboardWidgetConfig> | null>('dashboard-widget-config', null);
const { data: userSettingsData, mutateAsync: saveUserSettings, isUpdating } = useUserSettings();

const isOpen = ref(false);
type View = 'main' | 'exclusions';
const view = ref<View>('main');

const exclusions = computed(() => readLatestRecordsExclusions({ widgetConfig: widgetConfigRef?.value }));
const tagsVariant = computed(() => readLatestRecordsTagsVariant({ widgetConfig: widgetConfigRef?.value }));
const { isOn: showAccount, setFlag: setShowAccount } = useWidgetConfigFlag({
  key: 'showAccount',
  saveErrorKey: 'widgets.latestRecords.settings.showAccountSaveError',
});
const tagsVariantItems = computed<PillTabItem[]>(() => [
  { value: 'chips', label: t('widgets.latestRecords.settings.tagsStyleNames') },
  { value: 'rails', label: t('widgets.latestRecords.settings.tagsStyleBars') },
]);
const { includePlanned } = useIncludePlannedConfig();
const notifyIncludePlannedSaveError = useIncludePlannedSaveError();
const { addErrorNotification } = useNotificationCenter();

const exclusionsSummary = computed(() => {
  const excluded: string[] = [];
  if (exclusions.value.excludeTransfers) {
    excluded.push(t('transactions.filters.transferNature.commonTransfer'));
  }
  if (exclusions.value.excludeOutOfWallet) {
    excluded.push(t('transactions.filters.transferNature.outOfWallet'));
  }
  if (exclusions.value.excludeBalanceAdjustments) {
    excluded.push(t('widgets.latestRecords.settings.balanceAdjustmentsTitle'));
  }
  if (!includePlanned.value) {
    excluded.push(t('widgets.latestRecords.settings.plannedTitle'));
  }
  return excluded.length === 0 ? t('widgets.latestRecords.settings.nothingExcluded') : excluded.join(', ');
});

// Reset to the main view after the popover finishes closing.
watch(isOpen, (open) => {
  if (!open) {
    setTimeout(() => {
      view.value = 'main';
    }, PANEL_TRANSITION_DURATION);
  }
});

function goTo(target: View) {
  view.value = target;
}

async function persistConfig(patch: Record<string, unknown>) {
  const settings = userSettingsData.value;
  if (!settings || !widgetConfigRef?.value) return;

  const widgets = [...(settings.dashboard?.widgets ?? [])];
  const idx = widgets.findIndex((w) => w.widgetId === widgetConfigRef.value!.widgetId);
  if (idx === -1) return;

  widgets[idx] = {
    ...widgets[idx]!,
    config: { ...widgets[idx]!.config, ...patch },
  };

  await saveUserSettings({ ...settings, dashboard: { widgets } });
}

async function onTagsVariantChange(value: string) {
  try {
    await persistConfig({ tagsVariant: value });
  } catch {
    addErrorNotification(t('widgets.latestRecords.settings.tagsStyleSaveError'));
  }
}

async function onExcludePlannedToggle(value: boolean) {
  try {
    await persistConfig({ includePlanned: !value });
  } catch (error) {
    notifyIncludePlannedSaveError({ error });
  }
}
</script>
