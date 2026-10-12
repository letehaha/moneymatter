<script setup lang="ts">
import { SidePanelSectionSkeleton, SidePanelSections } from '@/components/lib/ui/side-panel';
import { cn } from '@/lib/utils';

import { type PanelSection, usePanelSections } from '../composables/use-panel-sections';

const SECTIONS: { key: PanelSection; labelClass: string; contentClass: string }[] = [
  { key: 'breakdown', labelClass: 'w-20', contentClass: 'h-29' },
  { key: 'coverage', labelClass: 'w-36', contentClass: 'h-34' },
  { key: 'goals', labelClass: 'w-14', contentClass: 'h-37' },
  { key: 'scheduled', labelClass: 'w-20', contentClass: 'h-40' },
  { key: 'trend', labelClass: 'w-28', contentClass: 'h-38' },
  { key: 'pace', labelClass: 'w-12', contentClass: 'h-25' },
];

const openSections = usePanelSections();
</script>

<template>
  <div class="grid animate-pulse gap-4" aria-hidden="true">
    <div>
      <div class="bg-muted my-1 h-4 w-32 rounded" />
      <div class="bg-muted my-0.5 h-3 w-24 rounded" />
    </div>

    <SidePanelSections variant="cards">
      <SidePanelSectionSkeleton
        v-for="section in SECTIONS"
        :key="section.key"
        :open="openSections[section.key]"
        :label-class="section.labelClass"
      >
        <div :class="cn('bg-muted rounded-md', section.contentClass)" />
      </SidePanelSectionSkeleton>
    </SidePanelSections>
  </div>
</template>
