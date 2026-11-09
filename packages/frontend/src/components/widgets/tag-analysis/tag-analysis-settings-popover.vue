<template>
  <Popover v-model:open="isOpen">
    <PopoverTrigger as-child>
      <Button size="icon-sm" variant="ghost" :aria-label="$t('common.actions.settings')">
        <SettingsIcon class="text-muted-foreground size-4" />
      </Button>
    </PopoverTrigger>
    <PopoverContent class="w-80 overflow-hidden p-0" align="end" lock-side @open-auto-focus.prevent>
      <SlidingPanels v-model="view" :panels="['main', 'targets']">
        <template #main>
          <div class="flex flex-col">
            <header class="border-b px-3 py-2 text-sm font-medium">
              {{ $t('common.actions.settings') }}
            </header>

            <div class="flex flex-col p-2">
              <div class="px-2 py-2">
                <TagSelectField
                  :label="$t('dashboard.widgets.tagAnalysis.settings.tagsLabel')"
                  :placeholder="$t('dashboard.widgets.tagAnalysis.settings.tagsPlaceholder')"
                  :model-value="config.tagIds"
                  @update:model-value="(tagIds) => persist({ patch: { tagIds } })"
                />
              </div>

              <button
                type="button"
                class="hover:bg-accent flex items-center justify-between gap-2 rounded-md px-2 py-2 text-left transition-colors"
                @click="view = 'targets'"
              >
                <span class="flex flex-col">
                  <span class="text-sm font-medium">
                    {{ $t('dashboard.widgets.tagAnalysis.settings.targetsLabel') }}
                  </span>
                  <span class="text-muted-foreground text-xs">{{ targetsSummary }}</span>
                </span>
                <ChevronRightIcon class="text-muted-foreground size-4" />
              </button>

              <div class="flex items-center justify-between gap-2 rounded-md px-2 py-2">
                <span class="text-sm font-medium whitespace-nowrap">
                  {{ $t('dashboard.widgets.tagAnalysis.settings.percentBaseLabel') }}
                </span>
                <PillTabs
                  size="sm"
                  :items="percentBaseItems"
                  :model-value="config.percentBase"
                  @update:model-value="(percentBase) => persist({ patch: { percentBase } })"
                />
              </div>

              <div class="flex items-center justify-between gap-2 rounded-md px-2 py-2">
                <span class="flex flex-col">
                  <span class="text-sm font-medium">
                    {{ $t('dashboard.widgets.tagAnalysis.settings.includeTransfersLabel') }}
                  </span>
                  <span class="text-muted-foreground text-xs">
                    {{ $t('dashboard.widgets.tagAnalysis.settings.includeTransfersDescription') }}
                  </span>
                </span>
                <Switch
                  class="shrink-0"
                  :model-value="includeTransfers"
                  @update:model-value="(value) => setIncludeTransfers({ value: !!value })"
                />
              </div>
            </div>
          </div>
        </template>

        <template #targets>
          <div class="flex flex-col">
            <header class="flex items-center gap-2 border-b px-2 py-2">
              <Button size="icon-sm" variant="ghost" type="button" @click="view = 'main'">
                <ArrowLeftIcon class="size-4" />
              </Button>
              <span class="text-sm font-medium">
                {{ $t('dashboard.widgets.tagAnalysis.settings.targetsLabel') }}
              </span>
            </header>

            <p v-if="selectedTags.length === 0" class="text-muted-foreground px-4 py-6 text-center text-sm">
              {{ $t('dashboard.widgets.tagAnalysis.settings.targetsEmpty') }}
            </p>
            <div v-else class="flex flex-col gap-2 p-3">
              <div v-for="tag in selectedTags" :key="tag.id" class="flex items-center gap-2">
                <span class="size-2.5 shrink-0 rounded-full" :style="{ backgroundColor: tag.color }" />
                <span class="min-w-0 flex-1 truncate text-sm">{{ tag.name }}</span>
                <InputField
                  class="w-24"
                  type="number"
                  only-positive
                  :placeholder="$t('dashboard.widgets.tagAnalysis.settings.targetPlaceholder')"
                  :model-value="draftTargets[tag.id] ?? null"
                  @update:model-value="(value) => onTargetInput({ tagId: tag.id, value })"
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
import InputField from '@/components/fields/input-field.vue';
import TagSelectField from '@/components/fields/tag-select-field.vue';
import { Button } from '@/components/lib/ui/button';
import { type PillTabItem, PillTabs } from '@/components/lib/ui/pill-tabs';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/lib/ui/popover';
import { Switch } from '@/components/lib/ui/switch';
import { useNotificationCenter } from '@/components/notification-center';
import { useWidgetConfigFlag } from '@/components/widgets/use-include-planned-config';
import { useTagsStore } from '@/stores';
import type { TagModel } from '@bt/shared/types';
import { ArrowLeftIcon, ChevronRightIcon, SettingsIcon } from '@lucide/vue';
import { useDebounceFn } from '@vueuse/core';
import { storeToRefs } from 'pinia';
import { type Ref, computed, inject, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

import { readTagAnalysisConfig } from './tag-analysis-config';

const TARGET_SAVE_DEBOUNCE_MS = 600;
const MAX_TARGET_PERCENT = 100;

const { t } = useI18n();
const { addErrorNotification } = useNotificationCenter();
const { tagsMap } = storeToRefs(useTagsStore());

const widgetConfigRef = inject<Ref<DashboardWidgetConfig> | null>('dashboard-widget-config', null);
const saveWidgetConfig =
  inject<(params: { widgetId: string; config: Record<string, unknown> }) => Promise<void>>(
    'dashboard-save-widget-config',
  );

const { isOn: includeTransfers, setFlag: setIncludeTransfers } = useWidgetConfigFlag({
  key: 'includeTransfers',
  saveErrorKey: 'errors.api.unexpectedError',
  defaultValue: false,
});

const isOpen = ref(false);
const config = computed(() => readTagAnalysisConfig({ widgetConfig: widgetConfigRef?.value }));
const selectedTags = computed(() =>
  config.value.tagIds.map((id) => tagsMap.value[id]).filter((tag): tag is TagModel => !!tag),
);

const percentBaseItems = computed<PillTabItem[]>(() => [
  { value: 'tags', label: t('dashboard.widgets.tagAnalysis.settings.percentBaseTags') },
  { value: 'income', label: t('dashboard.widgets.tagAnalysis.settings.percentBaseIncome') },
]);

const view = ref<'main' | 'targets'>('main');
const draftTargets = ref<Record<string, number>>({});
watch(isOpen, (open) => {
  if (open) {
    view.value = 'main';
    draftTargets.value = { ...config.value.targets };
  }
});

const targetsSummary = computed(() => {
  const setCount = selectedTags.value.filter((tag) => draftTargets.value[tag.id] !== undefined).length;
  return setCount === 0
    ? t('dashboard.widgets.tagAnalysis.settings.targetsNoneSet')
    : t('dashboard.widgets.tagAnalysis.settings.targetsSetCount', { set: setCount, total: selectedTags.value.length });
});

const persist = async ({ patch }: { patch: Record<string, unknown> }) => {
  if (!saveWidgetConfig || !widgetConfigRef?.value) return;

  try {
    await saveWidgetConfig({ widgetId: widgetConfigRef.value.widgetId, config: patch });
  } catch {
    addErrorNotification(t('errors.api.unexpectedError'));
  }
};

const persistTargets = useDebounceFn(
  () => persist({ patch: { targets: { ...draftTargets.value } } }),
  TARGET_SAVE_DEBOUNCE_MS,
);

const onTargetInput = ({ tagId, value }: { tagId: string; value: string | number | null }) => {
  const next = { ...draftTargets.value };
  const parsed = value === null || value === '' ? NaN : Number(value);

  if (Number.isFinite(parsed)) next[tagId] = Math.min(Math.max(parsed, 0), MAX_TARGET_PERCENT);
  else delete next[tagId];

  draftTargets.value = next;
  persistTargets();
};
</script>
