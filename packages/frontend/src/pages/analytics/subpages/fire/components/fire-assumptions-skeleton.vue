<template>
  <div class="@container/fire-aside flex animate-pulse flex-col gap-4" aria-hidden="true">
    <div class="bg-muted my-1 h-3 w-24 rounded" />

    <SidePanelSections>
      <SidePanelSectionSkeleton :open="openSections.spending" label-class="w-48">
        <div class="flex flex-col gap-2">
          <div class="bg-muted h-10 rounded-md md:h-9" />
          <div>
            <div class="bg-muted mt-0.5 mb-1.75 h-3 w-36 rounded" />
            <div class="bg-muted h-10 rounded-md md:h-9.5" />
          </div>
          <div class="bg-muted my-0.5 h-3 w-52 rounded" />
        </div>
      </SidePanelSectionSkeleton>

      <SidePanelSectionSkeleton :open="openSections.contribution" label-class="w-36">
        <div class="flex flex-col gap-2">
          <div class="bg-muted h-10 rounded-md md:h-9" />
          <div class="bg-muted my-0.5 h-3 w-44 rounded" />
        </div>
      </SidePanelSectionSkeleton>

      <SidePanelSectionSkeleton :open="openSections.counts" label-class="w-40">
        <div class="flex flex-col gap-2">
          <div v-for="n in COUNT_ROWS" :key="n" class="flex items-center justify-between gap-3">
            <div class="flex items-center gap-2">
              <div class="bg-muted h-6 w-11 shrink-0 rounded-full" />
              <div class="flex flex-col">
                <div class="bg-muted my-1 h-3 w-24 rounded" />
                <!-- The longest label wraps next to a six-figure amount in the 20rem aside. -->
                <div v-if="n === 2" class="bg-muted my-1 h-3 w-16 rounded @2xs/fire-aside:hidden" />
              </div>
            </div>
            <div class="bg-muted my-1 h-3 w-20 rounded" />
          </div>
          <div class="flex flex-col gap-1 py-0.5">
            <div class="bg-muted h-3 w-full max-w-xl rounded" />
            <div class="bg-muted h-3 w-full rounded @xl/fire-aside:hidden" />
            <div class="bg-muted h-3 w-1/3 rounded @2xs/fire-aside:hidden" />
          </div>
        </div>
      </SidePanelSectionSkeleton>

      <SidePanelSectionSkeleton :open="openSections.return" label-class="w-32">
        <div class="flex flex-col gap-3">
          <div class="bg-muted h-10 rounded-md md:h-9" />
          <div class="flex items-center justify-between gap-2">
            <div class="bg-muted my-1 h-3 w-16 rounded" />
            <div class="bg-muted my-1 h-3 w-40 rounded" />
          </div>
        </div>
      </SidePanelSectionSkeleton>

      <SidePanelSectionSkeleton :open="openSections.withdrawal" label-class="w-28">
        <div class="flex flex-col gap-2">
          <div class="bg-muted h-7.5 rounded-lg" />
          <div class="flex flex-col gap-1 py-0.5">
            <div class="bg-muted h-3 w-full rounded" />
            <div class="bg-muted h-3 w-full rounded" />
            <div class="bg-muted h-3 w-full rounded @xl/fire-aside:hidden" />
            <div class="bg-muted h-3 w-1/2 rounded @xl/fire-aside:hidden" />
          </div>
        </div>
      </SidePanelSectionSkeleton>

      <SidePanelSectionSkeleton :open="openSections.more" label-class="w-12" summary>
        <div class="flex flex-col gap-4">
          <div v-for="n in MORE_FIELDS" :key="n">
            <div class="bg-muted mt-0.5 mb-1.75 h-3 w-36 rounded" />
            <div class="bg-muted h-10 rounded-md md:h-9" />
          </div>
        </div>
      </SidePanelSectionSkeleton>
    </SidePanelSections>
  </div>
</template>

<script setup lang="ts">
import { SidePanelSectionSkeleton, SidePanelSections } from '@/components/lib/ui/side-panel';

import { useAssumptionSections } from '../composables/use-assumption-sections';

const COUNT_ROWS = 5;
const MORE_FIELDS = 5;

const { openSections } = useAssumptionSections();
</script>
