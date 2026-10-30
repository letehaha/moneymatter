<template>
  <Popover v-model:open="isOpen">
    <PopoverTrigger as-child>
      <Button size="icon-sm" variant="ghost">
        <SettingsIcon class="text-muted-foreground size-4" />
      </Button>
    </PopoverTrigger>
    <PopoverContent class="w-64 overflow-hidden p-0" align="end">
      <SlidingPanels v-model="view" :panels="['main', 'type', 'lookback']">
        <template #main>
          <div class="flex flex-col">
            <header class="border-b px-3 py-2 text-sm font-medium">
              {{ t('dashboard.widgets.subscriptions.settings.title') }}
            </header>

            <div class="flex flex-col p-2">
              <button
                type="button"
                class="hover:bg-accent flex items-center justify-between gap-2 rounded-md px-2 py-2 text-left transition-colors"
                @click="goTo('type')"
              >
                <span class="flex flex-col">
                  <span class="text-sm font-medium">
                    {{ t('dashboard.widgets.subscriptions.settings.show') }}
                  </span>
                  <span class="text-muted-foreground text-xs">
                    {{ t(currentTypeChoice.label) }}
                  </span>
                </span>
                <ChevronRightIcon class="text-muted-foreground size-4" />
              </button>

              <button
                type="button"
                class="hover:bg-accent flex items-center justify-between gap-2 rounded-md px-2 py-2 text-left transition-colors"
                @click="goTo('lookback')"
              >
                <span class="flex flex-col">
                  <span class="text-sm font-medium">
                    {{ t('dashboard.widgets.subscriptions.settings.incomeWindow') }}
                  </span>
                  <span class="text-muted-foreground text-xs">
                    {{ t(currentLookbackChoice.label) }}
                  </span>
                </span>
                <ChevronRightIcon class="text-muted-foreground size-4" />
              </button>

              <div class="flex items-center justify-between gap-2 rounded-md px-2 py-2">
                <span class="text-sm font-medium">
                  {{ t('dashboard.widgets.subscriptions.settings.showStrip') }}
                </span>
                <Switch :model-value="showStrip" @update:model-value="onShowStripToggle" />
              </div>
            </div>
          </div>
        </template>

        <template #type>
          <div class="flex flex-col">
            <header class="flex items-center gap-2 border-b px-2 py-2">
              <Button size="icon-sm" variant="ghost" type="button" @click="goTo('main')">
                <ArrowLeftIcon class="size-4" />
              </Button>
              <span class="text-sm font-medium">
                {{ t('dashboard.widgets.subscriptions.settings.show') }}
              </span>
            </header>

            <div class="flex flex-col p-2">
              <button
                v-for="choice in TYPE_CHOICES"
                :key="choice.value"
                type="button"
                class="hover:bg-accent flex items-center justify-between gap-2 rounded-md px-2 py-2 text-left transition-colors"
                @click="onTypeChange(choice.value)"
              >
                <span class="text-sm">{{ t(choice.label) }}</span>
                <CheckIcon v-if="currentType === choice.value" class="text-primary-text size-4" />
              </button>
            </div>
          </div>
        </template>

        <template #lookback>
          <div class="flex flex-col">
            <header class="flex items-center gap-2 border-b px-2 py-2">
              <Button size="icon-sm" variant="ghost" type="button" @click="goTo('main')">
                <ArrowLeftIcon class="size-4" />
              </Button>
              <span class="flex items-center gap-1 text-sm font-medium">
                {{ t('dashboard.widgets.subscriptions.settings.incomeWindow') }}
                <ResponsiveTooltip
                  :delay-duration="100"
                  :content="t('dashboard.widgets.subscriptions.settings.incomeWindowTooltip')"
                  content-class-name="max-w-60"
                >
                  <InfoIcon class="text-muted-foreground size-3.5 cursor-help" @click.prevent.stop />
                </ResponsiveTooltip>
              </span>
            </header>

            <div class="flex flex-col p-2">
              <button
                v-for="choice in LOOKBACK_CHOICES"
                :key="choice.value"
                type="button"
                class="hover:bg-accent flex items-center justify-between gap-2 rounded-md px-2 py-2 text-left transition-colors"
                @click="onLookbackChange(choice.value)"
              >
                <span class="text-sm">{{ t(choice.label) }}</span>
                <CheckIcon v-if="currentLookback === choice.value" class="text-primary-text size-4" />
              </button>
            </div>
          </div>
        </template>
      </SlidingPanels>
    </PopoverContent>
  </Popover>
</template>

<script lang="ts" setup>
import { DEFAULT_INCOME_LOOKBACK_MONTHS, type IncomeLookbackMonths } from '@/api/subscriptions';
import type { DashboardWidgetConfig } from '@/api/user-settings';
import ResponsiveTooltip from '@/components/common/responsive-tooltip.vue';
import SlidingPanels from '@/components/common/sliding-panels.vue';
import { Button } from '@/components/lib/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/lib/ui/popover';
import { Switch } from '@/components/lib/ui/switch';
import { ArrowLeftIcon, CheckIcon, ChevronRightIcon, InfoIcon, SettingsIcon } from '@lucide/vue';
import type { Ref } from 'vue';
import { computed, inject, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

const TYPE_CHOICES = [
  { value: '', label: 'dashboard.widgets.subscriptions.configTypeAll' },
  {
    value: 'subscription',
    label: 'dashboard.widgets.subscriptions.configTypeSubscriptions',
  },
  { value: 'bill', label: 'dashboard.widgets.subscriptions.configTypeBills' },
  {
    value: 'installment',
    label: 'dashboard.widgets.subscriptions.configTypeInstallments',
  },
] as const;

const LOOKBACK_CHOICES: Array<{ value: IncomeLookbackMonths; label: string }> = [
  {
    value: 1,
    label: 'dashboard.widgets.subscriptions.settings.lookbackOption.1',
  },
  {
    value: 3,
    label: 'dashboard.widgets.subscriptions.settings.lookbackOption.3',
  },
  {
    value: 6,
    label: 'dashboard.widgets.subscriptions.settings.lookbackOption.6',
  },
  {
    value: 12,
    label: 'dashboard.widgets.subscriptions.settings.lookbackOption.12',
  },
];

const { t } = useI18n({ useScope: 'global' });
const widgetConfigRef = inject<Ref<DashboardWidgetConfig> | null>('dashboard-widget-config', null);
const saveWidgetConfig =
  inject<(params: { widgetId: string; config: Record<string, unknown> }) => Promise<void>>(
    'dashboard-save-widget-config',
  );

const isOpen = ref(false);
type View = 'main' | 'type' | 'lookback';
const view = ref<View>('main');

watch(isOpen, (open) => {
  if (!open) {
    setTimeout(() => {
      view.value = 'main';
    }, 320);
  }
});

const currentType = computed(() => {
  const cfg = widgetConfigRef?.value?.config;
  return (cfg?.type as string | undefined) ?? '';
});

const currentTypeChoice = computed(() => TYPE_CHOICES.find((c) => c.value === currentType.value) ?? TYPE_CHOICES[0]);

const currentLookback = computed<IncomeLookbackMonths>(() => {
  const cfg = widgetConfigRef?.value?.config;
  const raw = cfg?.lookbackMonths as number | undefined;
  return raw === 1 || raw === 3 || raw === 6 || raw === 12 ? raw : DEFAULT_INCOME_LOOKBACK_MONTHS;
});

const currentLookbackChoice = computed(
  () => LOOKBACK_CHOICES.find((c) => c.value === currentLookback.value) ?? LOOKBACK_CHOICES[2]!,
);

const showStrip = computed(() => widgetConfigRef?.value?.config?.showStrip !== false);

function goTo(target: View) {
  view.value = target;
}

async function persistConfig(patch: Record<string, unknown>) {
  if (!saveWidgetConfig || !widgetConfigRef?.value) return;
  await saveWidgetConfig({ widgetId: widgetConfigRef.value.widgetId, config: patch });
}

function onTypeChange(value: string) {
  persistConfig({ type: value });
  goTo('main');
}

function onShowStripToggle(value: boolean) {
  persistConfig({ showStrip: value });
}

function onLookbackChange(value: IncomeLookbackMonths) {
  persistConfig({ lookbackMonths: value });
  goTo('main');
}
</script>
