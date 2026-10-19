<template>
  <Popover v-model:open="isOpen">
    <PopoverTrigger as-child>
      <Button size="icon-sm" variant="ghost">
        <SettingsIcon class="text-muted-foreground size-4" />
      </Button>
    </PopoverTrigger>
    <PopoverContent class="w-72 overflow-hidden p-0" align="end">
      <SlidingPanels v-model="view" :panels="['main', 'spikes', 'components']">
        <template #main>
          <div class="flex flex-col">
            <header class="border-b px-3 py-2 text-sm font-medium">
              {{ t('dashboard.widgets.balanceTrend.settings.title') }}
            </header>

            <div class="flex flex-col p-2">
              <button
                type="button"
                class="hover:bg-accent flex items-center justify-between gap-2 rounded-md px-2 py-2 text-left transition-colors"
                @click="goTo('spikes')"
              >
                <span class="flex flex-col">
                  <span class="text-sm font-medium">
                    {{ t('dashboard.widgets.balanceTrend.settings.spikeMarkers') }}
                  </span>
                  <span class="text-muted-foreground text-xs">
                    {{
                      persistedSettings.enabled
                        ? t('dashboard.widgets.balanceTrend.settings.on')
                        : t('dashboard.widgets.balanceTrend.settings.off')
                    }}
                  </span>
                </span>
                <ChevronRightIcon class="text-muted-foreground size-4" />
              </button>

              <button
                type="button"
                class="hover:bg-accent flex items-center justify-between gap-2 rounded-md px-2 py-2 text-left transition-colors"
                @click="goTo('components')"
              >
                <span class="flex flex-col">
                  <span class="text-sm font-medium">
                    {{ t('dashboard.widgets.balanceTrend.settings.includeInTotal') }}
                  </span>
                  <span class="text-muted-foreground text-xs">
                    {{ includeInTotalSummary }}
                  </span>
                </span>
                <ChevronRightIcon class="text-muted-foreground size-4" />
              </button>

              <div class="flex items-center justify-between gap-2 rounded-md px-2 py-2">
                <div class="flex items-center gap-1">
                  <span class="text-sm font-medium">
                    {{ t('dashboard.widgets.balanceTrend.settings.fitToLatestData') }}
                  </span>
                  <ResponsiveTooltip
                    :delay-duration="100"
                    :content="fitToLatestDataTooltip"
                    content-class-name="max-w-60"
                  >
                    <InfoIcon class="text-muted-foreground size-3.5 cursor-help" @click.prevent.stop />
                  </ResponsiveTooltip>
                </div>
                <Switch
                  class="shrink-0"
                  :model-value="persistedSettings.fitToLatestData"
                  :disabled="isProjectionActive"
                  @update:model-value="onFitToLatestDataToggle"
                />
              </div>

              <div class="flex items-center justify-between gap-2 rounded-md px-2 py-2">
                <span class="max-w-45 text-sm font-medium">
                  {{ t('dashboard.widgets.common.includePlanned') }}

                  <ResponsiveTooltip
                    :delay-duration="100"
                    :content="t('dashboard.widgets.balanceTrend.settings.includePlannedTooltip')"
                    content-class-name="max-w-60"
                  >
                    <InfoIcon
                      class="text-muted-foreground inline size-3.5 -translate-y-px cursor-help"
                      @click.prevent.stop
                    />
                  </ResponsiveTooltip>
                </span>
                <Switch
                  class="shrink-0"
                  data-testid="bt-include-planned-switch"
                  :model-value="persistedSettings.includePlanned"
                  @update:model-value="onIncludePlannedToggle"
                />
              </div>
            </div>
          </div>
        </template>

        <template #components>
          <div class="flex flex-col">
            <header class="flex items-center gap-2 border-b px-2 py-2">
              <Button size="icon-sm" variant="ghost" type="button" @click="goTo('main')">
                <ArrowLeftIcon class="size-4" />
              </Button>
              <span class="text-sm font-medium">
                {{ t('dashboard.widgets.balanceTrend.settings.includeInTotal') }}
              </span>
            </header>

            <div class="flex flex-col p-2">
              <p class="text-muted-foreground mb-2 px-2 text-xs">
                {{ t('dashboard.widgets.balanceTrend.componentsSettings.description') }}
              </p>

              <div class="flex items-center justify-between gap-2 rounded-md px-2 py-2">
                <span class="text-sm font-medium">
                  {{ t('dashboard.widgets.balanceTrend.componentsSettings.vehicles') }}
                </span>
                <Switch
                  :model-value="persistedSettings.includeVehiclesInTotal"
                  @update:model-value="onIncludeVehiclesToggle"
                />
              </div>

              <div class="flex items-center justify-between gap-2 rounded-md px-2 py-2">
                <span class="text-sm font-medium">
                  {{ t('dashboard.widgets.balanceTrend.componentsSettings.properties') }}
                </span>
                <Switch
                  :model-value="persistedSettings.includePropertiesInTotal"
                  @update:model-value="onIncludePropertiesToggle"
                />
              </div>

              <div class="flex items-center justify-between gap-2 rounded-md px-2 py-2">
                <span class="text-sm font-medium">
                  {{ t('dashboard.widgets.balanceTrend.componentsSettings.ventures') }}
                </span>
                <Switch
                  :model-value="persistedSettings.includeVenturesInTotal"
                  @update:model-value="onIncludeVenturesToggle"
                />
              </div>

              <div class="flex items-center justify-between gap-2 rounded-md px-2 py-2">
                <div class="flex items-center gap-1">
                  <span class="text-sm font-medium">
                    {{ t('dashboard.widgets.balanceTrend.componentsSettings.loans') }}
                  </span>
                  <ResponsiveTooltip
                    :delay-duration="100"
                    :content="t('dashboard.widgets.balanceTrend.componentsSettings.loansTooltip')"
                    content-class-name="max-w-60"
                  >
                    <InfoIcon class="text-muted-foreground size-3.5 cursor-help" @click.prevent.stop />
                  </ResponsiveTooltip>
                </div>
                <Switch
                  :model-value="persistedSettings.includeLoansInTotal"
                  @update:model-value="onIncludeLoansToggle"
                />
              </div>
            </div>
          </div>
        </template>

        <template #spikes>
          <div class="flex flex-col">
            <header class="flex items-center gap-2 border-b px-2 py-2">
              <Button size="icon-sm" variant="ghost" type="button" @click="goTo('main')">
                <ArrowLeftIcon class="size-4" />
              </Button>
              <span class="text-sm font-medium">
                {{ t('dashboard.widgets.balanceTrend.settings.spikeMarkers') }}
              </span>
            </header>

            <form class="grid gap-3 p-3" @submit.prevent="saveSpikes">
              <div class="flex items-center justify-between">
                <div class="flex items-center gap-1">
                  <label class="text-sm font-medium">
                    {{ t('dashboard.widgets.balanceTrend.spikeSettings.showMarkers') }}
                  </label>
                  <ResponsiveTooltip
                    :delay-duration="100"
                    :content="t('dashboard.widgets.balanceTrend.spikeSettings.showMarkersTooltip')"
                    content-class-name="max-w-52"
                  >
                    <InfoIcon class="text-muted-foreground size-3.5 cursor-help" @click.prevent.stop />
                  </ResponsiveTooltip>
                </div>
                <Switch v-model:model-value="form.enabled" />
              </div>

              <template v-if="form.enabled">
                <InputField
                  v-model="form.percentThreshold"
                  type="number"
                  :label="t('dashboard.widgets.balanceTrend.spikeSettings.percentThreshold')"
                  :error-message="getFieldErrorMessage('form.percentThreshold')"
                  @blur="touchField('form.percentThreshold')"
                >
                  <template #label-right>
                    <ResponsiveTooltip
                      :delay-duration="100"
                      :content="t('dashboard.widgets.balanceTrend.spikeSettings.percentThresholdTooltip')"
                      content-class-name="max-w-52"
                    >
                      <InfoIcon class="text-muted-foreground size-3.5 cursor-help" @click.prevent.stop />
                    </ResponsiveTooltip>
                  </template>
                </InputField>
                <InputField
                  v-model="form.absoluteThreshold"
                  type="number"
                  :label="
                    t('dashboard.widgets.balanceTrend.spikeSettings.absoluteThreshold', { symbol: getCurrencySymbol() })
                  "
                  :error-message="getFieldErrorMessage('form.absoluteThreshold')"
                  @blur="touchField('form.absoluteThreshold')"
                >
                  <template #label-right>
                    <ResponsiveTooltip
                      :delay-duration="100"
                      :content="t('dashboard.widgets.balanceTrend.spikeSettings.absoluteThresholdTooltip')"
                      content-class-name="max-w-52"
                    >
                      <InfoIcon class="text-muted-foreground size-3.5 cursor-help" @click.prevent.stop />
                    </ResponsiveTooltip>
                  </template>
                </InputField>
                <InputField
                  v-model="form.maxSpikes"
                  type="number"
                  :label="t('dashboard.widgets.balanceTrend.spikeSettings.maxMarkers')"
                  :error-message="getFieldErrorMessage('form.maxSpikes')"
                  @blur="touchField('form.maxSpikes')"
                >
                  <template #label-right>
                    <ResponsiveTooltip
                      :delay-duration="100"
                      :content="t('dashboard.widgets.balanceTrend.spikeSettings.maxMarkersTooltip')"
                      content-class-name="max-w-52"
                    >
                      <InfoIcon class="text-muted-foreground size-3.5 cursor-help" @click.prevent.stop />
                    </ResponsiveTooltip>
                  </template>
                </InputField>
              </template>

              <div class="flex gap-2">
                <Button type="button" variant="outline" size="sm" class="flex-1" @click="resetSpikeDefaults">
                  {{ t('dashboard.widgets.balanceTrend.spikeSettings.resetDefaults') }}
                </Button>
                <Button v-if="isSpikeDirty" type="submit" size="sm" class="flex-1">
                  {{ t('dashboard.widgets.balanceTrend.spikeSettings.accept') }}
                </Button>
              </div>
            </form>
          </div>
        </template>
      </SlidingPanels>
    </PopoverContent>
  </Popover>
</template>

<script lang="ts" setup>
import type { DashboardWidgetConfig } from '@/api/user-settings';
import ResponsiveTooltip from '@/components/common/responsive-tooltip.vue';
import SlidingPanels from '@/components/common/sliding-panels.vue';
import InputField from '@/components/fields/input-field.vue';
import { Button } from '@/components/lib/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/lib/ui/popover';
import { Switch } from '@/components/lib/ui/switch';
import { readIncludePlanned, useIncludePlannedSaveError } from '@/components/widgets/use-include-planned-config';
import { SPIKE_DEFAULTS } from '@/composable/charts/use-spike-detection';
import { useUserSettings } from '@/composable/data-queries/user-settings';
import { useFormValidation } from '@/composable/form-validator';
import { useFormatCurrency } from '@/composable/formatters';
import { between, integer, required } from '@/js/helpers/validators';
import { ArrowLeftIcon, ChevronRightIcon, InfoIcon, SettingsIcon } from '@lucide/vue';
import type { Ref } from 'vue';
import { computed, inject, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

const props = defineProps<{
  /** Whether the chart currently draws a projection, which owns the x-axis end while it does. */
  isProjectionActive: boolean;
}>();

const { t } = useI18n({ useScope: 'global' });
const { getCurrencySymbol } = useFormatCurrency();
const widgetConfigRef = inject<Ref<DashboardWidgetConfig> | null>('dashboard-widget-config', null);
const { data: userSettingsData, mutateAsync: saveUserSettings } = useUserSettings();
const notifyIncludePlannedSaveError = useIncludePlannedSaveError();

const FIT_TO_LATEST_DATA_DEFAULT = true;
const INCLUDE_VEHICLES_DEFAULT = true;
const INCLUDE_PROPERTIES_DEFAULT = true;
const INCLUDE_VENTURES_DEFAULT = true;
const INCLUDE_LOANS_DEFAULT = true;

const persistedSettings = computed(() => {
  const cfg = widgetConfigRef?.value?.config;
  return {
    enabled: (cfg?.spikesEnabled as boolean | undefined) ?? SPIKE_DEFAULTS.enabled,
    percentThreshold: (cfg?.spikePercentThreshold as number | undefined) ?? SPIKE_DEFAULTS.percentThreshold,
    absoluteThreshold: (cfg?.spikeAbsoluteThreshold as number | undefined) ?? SPIKE_DEFAULTS.absoluteThreshold,
    maxSpikes: (cfg?.spikeMaxCount as number | undefined) ?? SPIKE_DEFAULTS.maxSpikes,
    fitToLatestData: (cfg?.fitToLatestData as boolean | undefined) ?? FIT_TO_LATEST_DATA_DEFAULT,
    includeVehiclesInTotal: (cfg?.includeVehiclesInTotal as boolean | undefined) ?? INCLUDE_VEHICLES_DEFAULT,
    includePropertiesInTotal: (cfg?.includePropertiesInTotal as boolean | undefined) ?? INCLUDE_PROPERTIES_DEFAULT,
    includeVenturesInTotal: (cfg?.includeVenturesInTotal as boolean | undefined) ?? INCLUDE_VENTURES_DEFAULT,
    includeLoansInTotal: (cfg?.includeLoansInTotal as boolean | undefined) ?? INCLUDE_LOANS_DEFAULT,
    includePlanned: readIncludePlanned({ config: cfg }),
  };
});

// A drawn projection always extends the chart to the period end, so while one is on
// screen the fit switch is inert and its tooltip says who owns the axis.
const fitToLatestDataTooltip = computed(() =>
  props.isProjectionActive
    ? t('dashboard.widgets.balanceTrend.settings.fitToLatestDataLockedTooltip')
    : t('dashboard.widgets.balanceTrend.settings.fitToLatestDataTooltip'),
);

const includeInTotalSummary = computed(() => {
  const excluded: string[] = [];
  if (!persistedSettings.value.includeVehiclesInTotal) {
    excluded.push(t('dashboard.widgets.balanceTrend.componentsSettings.vehicles'));
  }
  if (!persistedSettings.value.includePropertiesInTotal) {
    excluded.push(t('dashboard.widgets.balanceTrend.componentsSettings.properties'));
  }
  if (!persistedSettings.value.includeVenturesInTotal) {
    excluded.push(t('dashboard.widgets.balanceTrend.componentsSettings.ventures'));
  }
  if (!persistedSettings.value.includeLoansInTotal) {
    excluded.push(t('dashboard.widgets.balanceTrend.componentsSettings.loans'));
  }
  return excluded.length === 0
    ? t('dashboard.widgets.balanceTrend.componentsSettings.allIncluded')
    : t('dashboard.widgets.balanceTrend.componentsSettings.excluding', { items: excluded.join(', ') });
});

const form = reactive({
  enabled: persistedSettings.value.enabled,
  percentThreshold: persistedSettings.value.percentThreshold as number | string,
  absoluteThreshold: persistedSettings.value.absoluteThreshold as number | string,
  maxSpikes: persistedSettings.value.maxSpikes as number | string,
});

watch(persistedSettings, (next) => {
  form.enabled = next.enabled;
  form.percentThreshold = next.percentThreshold;
  form.absoluteThreshold = next.absoluteThreshold;
  form.maxSpikes = next.maxSpikes;
});

const { isFormValid, getFieldErrorMessage, touchField, resetValidation } = useFormValidation(
  { form },
  {
    form: {
      percentThreshold: { required, between: between(1, 50) },
      absoluteThreshold: { required, between: between(1, 10000) },
      maxSpikes: { required, integer, between: between(1, 20) },
    },
  },
  undefined,
  {
    customValidationMessages: {
      between: t('dashboard.widgets.balanceTrend.spikeSettings.validation.outOfRange'),
      integer: t('dashboard.widgets.balanceTrend.spikeSettings.validation.integer'),
    },
  },
);

const isSpikeDirty = computed(() => {
  const p = persistedSettings.value;
  return (
    form.enabled !== p.enabled ||
    Number(form.percentThreshold) !== p.percentThreshold ||
    Number(form.absoluteThreshold) !== p.absoluteThreshold ||
    Number(form.maxSpikes) !== p.maxSpikes
  );
});

const isOpen = ref(false);
type View = 'main' | 'spikes' | 'components';
const view = ref<View>('main');

// Reset to the main view after the popover finishes closing.
watch(isOpen, (open) => {
  if (!open) {
    setTimeout(() => {
      view.value = 'main';
    }, 320);
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

function resetSpikeDefaults() {
  form.enabled = SPIKE_DEFAULTS.enabled;
  form.percentThreshold = SPIKE_DEFAULTS.percentThreshold;
  form.absoluteThreshold = SPIKE_DEFAULTS.absoluteThreshold;
  form.maxSpikes = SPIKE_DEFAULTS.maxSpikes;
  resetValidation();
}

async function saveSpikes() {
  if (!isFormValid()) return;
  if (!isSpikeDirty.value) return;

  await persistConfig({
    spikesEnabled: form.enabled,
    spikePercentThreshold: Number(form.percentThreshold),
    spikeAbsoluteThreshold: Number(form.absoluteThreshold),
    spikeMaxCount: Number(form.maxSpikes),
  });
  resetValidation();
}

function onFitToLatestDataToggle(value: boolean) {
  persistConfig({ fitToLatestData: value });
}

function onIncludeVehiclesToggle(value: boolean) {
  persistConfig({ includeVehiclesInTotal: value });
}

function onIncludePropertiesToggle(value: boolean) {
  persistConfig({ includePropertiesInTotal: value });
}

function onIncludeVenturesToggle(value: boolean) {
  persistConfig({ includeVenturesInTotal: value });
}

function onIncludeLoansToggle(value: boolean) {
  persistConfig({ includeLoansInTotal: value });
}

async function onIncludePlannedToggle(value: boolean) {
  try {
    await persistConfig({ includePlanned: value });
  } catch (error) {
    notifyIncludePlannedSaveError({ error });
  }
}
</script>
