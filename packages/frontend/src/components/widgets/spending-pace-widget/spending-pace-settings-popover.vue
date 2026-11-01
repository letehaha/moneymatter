<template>
  <Popover v-model:open="isOpen">
    <PopoverTrigger as-child>
      <Button size="icon-sm" variant="ghost" :aria-label="$t('common.actions.settings')">
        <SettingsIcon class="text-muted-foreground size-4" />
      </Button>
    </PopoverTrigger>
    <PopoverContent class="w-72 overflow-hidden p-0" align="end">
      <SlidingPanels v-model="view" :panels="['main', 'spikes']">
        <template #main>
          <div class="flex flex-col">
            <header class="border-b px-3 py-2 text-sm font-medium">
              {{ $t('common.actions.settings') }}
            </header>

            <div class="flex flex-col p-2">
              <IncludePlannedMenuItem test-id-prefix="sp" :default-value="INCLUDE_PLANNED_DEFAULT" />
              <Button
                variant="ghost"
                class="h-auto w-full justify-between px-2 py-2 text-left font-normal whitespace-normal"
                @click="view = 'spikes'"
              >
                <span class="flex flex-col">
                  <span class="text-sm font-medium">
                    {{ $t('dashboard.widgets.spendingPace.settings.spikes.title') }}
                  </span>
                  <span class="text-muted-foreground text-xs">
                    {{ $t('dashboard.widgets.spendingPace.settings.spikes.summary', { percent: spikePercent }) }}
                  </span>
                </span>
                <ChevronRightIcon class="text-muted-foreground size-4" />
              </Button>
            </div>
          </div>
        </template>

        <template #spikes>
          <div class="flex flex-col">
            <header class="flex items-center gap-2 border-b px-2 py-2">
              <Button
                size="icon-sm"
                variant="ghost"
                type="button"
                :aria-label="$t('common.actions.back')"
                @click="view = 'main'"
              >
                <ArrowLeftIcon class="size-4" />
              </Button>
              <span class="text-sm font-medium">
                {{ $t('dashboard.widgets.spendingPace.settings.spikes.title') }}
              </span>
            </header>

            <div class="flex flex-col gap-2 p-4">
              <InputField
                v-model="draft"
                type="number"
                :min="SPIKE_PERCENT_MIN"
                :max="SPIKE_PERCENT_MAX"
                step="1"
                inputmode="numeric"
                only-positive
                :placeholder="String(DEFAULT_SPIKE_PERCENT)"
                :label="$t('dashboard.widgets.spendingPace.settings.spikes.inputLabel')"
                trailing-icon-css-class="text-muted-foreground px-3 text-sm"
                @change.self="commitDraft"
              >
                <template #iconTrailing>%</template>
              </InputField>
              <p class="text-muted-foreground text-xs">
                {{ $t('dashboard.widgets.spendingPace.settings.spikes.hint') }}
              </p>
            </div>
          </div>
        </template>
      </SlidingPanels>
    </PopoverContent>
  </Popover>
</template>

<script lang="ts" setup>
import SlidingPanels from '@/components/common/sliding-panels.vue';
import InputField from '@/components/fields/input-field.vue';
import { Button } from '@/components/lib/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/lib/ui/popover';
import IncludePlannedMenuItem from '@/components/widgets/components/include-planned-menu-item.vue';
import { ArrowLeftIcon, ChevronRightIcon, SettingsIcon } from '@lucide/vue';
import { ref, watch } from 'vue';

import { DEFAULT_SPIKE_PERCENT, INCLUDE_PLANNED_DEFAULT, SPIKE_PERCENT_MAX, SPIKE_PERCENT_MIN } from './helpers';

const PANEL_TRANSITION_DURATION = 320;

const props = defineProps<{ spikePercent: number }>();
const emit = defineEmits<{ 'update:spikePercent': [value: number] }>();

const isOpen = ref(false);
const view = ref<'main' | 'spikes'>('main');
const draft = ref<string | number | null>(props.spikePercent);

watch(
  () => props.spikePercent,
  (value) => {
    draft.value = value;
  },
);

watch(isOpen, (open) => {
  if (!open) {
    setTimeout(() => {
      view.value = 'main';
    }, PANEL_TRANSITION_DURATION);
  }
});

const commitDraft = () => {
  const value = Math.round(Number(draft.value));
  const isValid = value >= SPIKE_PERCENT_MIN && value <= SPIKE_PERCENT_MAX;
  if (isValid && value !== props.spikePercent) emit('update:spikePercent', value);
  draft.value = isValid ? value : props.spikePercent;
};
</script>
