<script setup lang="ts">
import ResponsiveTooltip from '@/components/common/responsive-tooltip.vue';
import SlidingPanels from '@/components/common/sliding-panels.vue';
import { Button } from '@/components/lib/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/lib/ui/popover';
import { Switch } from '@/components/lib/ui/switch';
import { TOGGLEABLE_SIDEBAR_SECTIONS, useSidebarSections } from '@/composable/use-sidebar-sections';
import { ArrowLeftIcon, ChevronRightIcon, InfoIcon, LayersIcon, SettingsIcon } from '@lucide/vue';
import { ref, watch } from 'vue';

import { useHideZeroBalances } from './accounts-view/helpers/use-hide-zero-balances';

const { sidebarSections, toggleSection, isUpdating } = useSidebarSections();
const { hideZeroBalances, setHideZeroBalances, isUpdating: isUpdatingHideZeroBalances } = useHideZeroBalances();

const isOpen = ref(false);
type View = 'main' | 'sections';
const view = ref<View>('main');

// Reset to the main panel after the popover finishes its close animation, so it
// reopens at the top level instead of wherever the user last drilled to.
watch(isOpen, (open) => {
  if (!open) {
    setTimeout(() => {
      view.value = 'main';
    }, 320);
  }
});

const goTo = (target: View) => {
  view.value = target;
};
</script>

<template>
  <Popover v-model:open="isOpen">
    <PopoverTrigger as-child>
      <Button size="icon-sm" variant="secondary" :aria-label="$t('sidebar.settings.title')">
        <SettingsIcon class="size-3.5" />
      </Button>
    </PopoverTrigger>
    <PopoverContent class="w-64 overflow-hidden p-0" align="end">
      <SlidingPanels v-model="view" :panels="['main', 'sections']">
        <template #main>
          <div class="flex flex-col">
            <header class="border-b px-3 py-2 text-sm font-medium">
              {{ $t('sidebar.settings.title') }}
            </header>

            <div class="flex flex-col p-2">
              <div class="flex items-center justify-between gap-2 rounded-md px-2 py-2">
                <span class="flex flex-col">
                  <span class="text-sm font-medium">{{ $t('sidebar.settings.hideZeroBalances.label') }}</span>
                  <span class="text-muted-foreground text-xs">
                    {{ $t('sidebar.settings.hideZeroBalances.description') }}
                  </span>
                </span>
                <Switch
                  :model-value="hideZeroBalances"
                  :disabled="isUpdatingHideZeroBalances"
                  @update:model-value="(v) => setHideZeroBalances(!!v)"
                />
              </div>

              <button
                type="button"
                class="hover:bg-hover flex items-center justify-between gap-2 rounded-md px-2 py-2 text-left transition-colors"
                @click="goTo('sections')"
              >
                <span class="flex flex-col">
                  <span class="text-sm font-medium">{{ $t('sidebar.settings.sections.label') }}</span>
                  <span class="text-muted-foreground text-xs">
                    {{ $t('sidebar.settings.sections.description') }}
                  </span>
                </span>
                <ChevronRightIcon class="text-muted-foreground size-4 shrink-0" />
              </button>
            </div>
          </div>
        </template>

        <template #sections>
          <div class="flex flex-col">
            <header class="flex items-center gap-2 border-b px-2 py-2">
              <Button size="icon-sm" variant="ghost" type="button" @click="goTo('main')">
                <ArrowLeftIcon class="size-4" />
              </Button>
              <span class="text-sm font-medium">{{ $t('sidebar.settings.sections.label') }}</span>
            </header>

            <div class="flex flex-col p-2">
              <div class="flex items-center justify-between gap-2 rounded-md px-2 py-2">
                <span class="flex items-center gap-2 text-sm font-medium">
                  <LayersIcon class="text-muted-foreground size-4 shrink-0" />
                  {{ $t('sidebar.accountsView.bankAccounts') }}
                </span>
                <ResponsiveTooltip :content="$t('sidebar.settings.sections.alwaysVisibleTooltip')">
                  <span class="text-muted-foreground flex cursor-help items-center gap-2">
                    <InfoIcon class="size-4" />
                    <Switch :model-value="true" disabled />
                  </span>
                </ResponsiveTooltip>
              </div>

              <div
                v-for="section in TOGGLEABLE_SIDEBAR_SECTIONS"
                :key="section.key"
                class="flex items-center justify-between gap-2 rounded-md px-2 py-2"
              >
                <span class="flex items-center gap-2 text-sm font-medium">
                  <component :is="section.icon" class="text-muted-foreground size-4 shrink-0" />
                  {{ $t(section.labelKey) }}
                </span>
                <Switch
                  :model-value="sidebarSections[section.key]"
                  :disabled="isUpdating"
                  @update:model-value="(v) => toggleSection(section.key, !!v)"
                />
              </div>
            </div>
          </div>
        </template>
      </SlidingPanels>
    </PopoverContent>
  </Popover>
</template>
