<script setup lang="ts">
import ResponsiveDialog from '@/components/common/responsive-dialog.vue';
import { Button } from '@/components/lib/ui/button';
import { Switch } from '@/components/lib/ui/switch';
import { GripVerticalIcon } from '@lucide/vue';
import { VueDraggable } from 'vue-draggable-plus';

import {
  PANEL_SECTION_TITLES,
  type PanelSection,
  defaultPanelSectionLayout,
  usePanelSectionLayout,
} from '../composables/use-panel-sections';

const isOpen = defineModel<boolean>('open', { required: true });

const layout = usePanelSectionLayout();

const setVisible = ({ key, visible }: { key: PanelSection; visible: boolean }) => {
  const hidden = layout.value.hidden.filter((entry) => entry !== key);
  layout.value = { ...layout.value, hidden: visible ? hidden : [...hidden, key] };
};

const reset = () => {
  layout.value = defaultPanelSectionLayout();
};
</script>

<template>
  <ResponsiveDialog v-model:open="isOpen" dialog-content-class="sm:max-w-md">
    <template #title>{{ $t('budgetPlans.panel.arrange.title') }}</template>
    <template #description>{{ $t('budgetPlans.panel.arrange.description') }}</template>

    <!-- data-vaul-no-drag keeps the mobile drawer from treating a drag as a swipe to close. -->
    <VueDraggable
      v-model="layout.order"
      :animation="200"
      :delay="150"
      delay-on-touch-only
      ghost-class="opacity-40"
      class="flex flex-col gap-0.5"
      data-vaul-no-drag
    >
      <div
        v-for="key in layout.order"
        :key="key"
        class="hover:bg-hover flex min-h-11 cursor-grab items-center gap-3 rounded-md px-2 text-sm"
      >
        <GripVerticalIcon class="text-muted-foreground size-4 shrink-0" />
        <span class="min-w-0 flex-1 truncate">{{ $t(PANEL_SECTION_TITLES[key]) }}</span>
        <Switch
          :model-value="!layout.hidden.includes(key)"
          :aria-label="$t(PANEL_SECTION_TITLES[key])"
          @update:model-value="(visible: boolean) => setVisible({ key, visible })"
        />
      </div>
    </VueDraggable>

    <template #footer>
      <div class="flex justify-end">
        <Button variant="ghost" @click="reset">{{ $t('budgetPlans.panel.arrange.reset') }}</Button>
      </div>
    </template>
  </ResponsiveDialog>
</template>
