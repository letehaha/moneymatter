<template>
  <PageWrapper class="flex min-h-full flex-col">
    <!-- Recovery method suggestion banner -->
    <RecoveryMethodBanner />

    <!-- Main period selector - floating on mobile, normal flow on desktop -->
    <div
      v-if="!hasNoAccounts"
      :class="
        cn([
          'bg-background/95 supports-backdrop-filter:bg-background/80 order-last -mx-6 mt-auto border-t py-2 backdrop-blur',
          'z-(--z-navbar)',
          isEditMode && 'max-md:hidden',
          'max-md:right-0 max-md:left-0',
          'sticky max-md:-bottom-px max-md:-mb-8 md:top-(--header-height)',
          'md:order-first md:-mx-6 md:-mt-1 md:mb-2 md:border-t-0 md:px-6 md:py-1',
          isScrolled &&
            'md:bg-card/95 md:supports-backdrop-filter:bg-card/95 dark:md:bg-background/95 dark:md:supports-backdrop-filter:bg-background/80 md:border-b dark:md:border-b-0',
        ])
      "
    >
      <div class="grid grid-cols-[1fr_auto_1fr] items-center">
        <div />
        <PeriodSelector v-model="currentPeriod" :payday="payday" />
        <DashboardEditToolbar
          class="hidden justify-self-end md:flex"
          :is-edit-mode="isEditMode"
          @enter="gridRef?.enterEditMode()"
          @save="gridRef?.saveLayout()"
          @cancel="gridRef?.cancelEdit()"
        />
      </div>
    </div>

    <template v-if="hasNoAccounts">
      <DashboardOnboarding />
    </template>
    <template v-else>
      <!-- Mobile: "Customize" button above grid (hidden during edit mode) -->
      <DashboardEditToolbar
        v-if="!isEditMode"
        class="mb-4 justify-center md:hidden"
        :is-edit-mode="false"
        @enter="gridRef?.enterEditMode()"
      />

      <DashboardGrid ref="gridRef" class="max-md:mb-4" :current-period="currentPeriod" />

      <!-- Mobile: sticky "Done/Cancel" bar at bottom during edit mode -->
      <DashboardEditToolbar
        v-if="gridRef?.isEditMode"
        class="bg-background/90 sticky bottom-0 z-(--z-navbar) -mx-6 -mb-8 justify-center border-t px-6 py-3 backdrop-blur-sm md:hidden"
        :is-edit-mode="true"
        @save="gridRef?.saveLayout()"
        @cancel="gridRef?.cancelEdit()"
      />
    </template>
  </PageWrapper>
</template>

<script lang="ts" setup>
import RecoveryMethodBanner from '@/components/banners/recovery-method-banner.vue';
import PageWrapper from '@/components/common/page-wrapper.vue';
import { SCROLL_AREA_IDS } from '@/components/lib/ui/scroll-area/types';
import DashboardOnboarding from '@/components/widgets/dashboard-onboarding.vue';
import { useUserSettings } from '@/composable/data-queries/user-settings';
import { useScrollAreaContainer } from '@/composable/scroll-area-container';
import { getPayPeriod } from '@/composable/use-period-navigation';
import { cn } from '@/lib/utils';
import { useAccountsStore } from '@/stores';
import { useScroll } from '@vueuse/core';
import { isSameDay, parseISO } from 'date-fns';
import { storeToRefs } from 'pinia';
import { computed, ref, watch } from 'vue';
import { useRoute } from 'vue-router';

import DashboardEditToolbar from './components/dashboard-edit-toolbar.vue';
import DashboardGrid from './components/dashboard-grid.vue';
import PeriodSelector from './components/period-selector.vue';
import { type Period } from './types';

const route = useRoute();

const accountsStore = useAccountsStore();
const { accounts, isAccountsFetched } = storeToRefs(accountsStore);
const hasNoAccounts = computed(() => isAccountsFetched.value && (accounts.value?.length ?? 0) === 0);

defineOptions({
  name: 'page-dashboard',
});

const gridRef = ref<InstanceType<typeof DashboardGrid> | null>(null);
const isEditMode = computed(() => gridRef.value?.isEditMode ?? false);

const scrollContainer = useScrollAreaContainer(SCROLL_AREA_IDS.dashboard);
const { y: scrollY } = useScroll(() => scrollContainer.value?.viewportElement ?? null);
const isScrolled = computed(() => scrollY.value > 0);

const { data: userSettings } = useUserSettings();
const payday = computed(() => userSettings.value?.payday ?? 1);

// Get initial period from URL or default to the current pay period
const getInitialPeriod = (): Period => {
  const { from, to } = route.query;
  if (from && to) {
    return {
      from: parseISO(from as string),
      to: parseISO(to as string),
    };
  }
  return getPayPeriod({ date: new Date(), payday: payday.value });
};

const currentPeriod = ref<Period>(getInitialPeriod());

// Settings can arrive after mount; move the period only if it is still the old default.
watch(payday, (newPayday, oldPayday) => {
  const oldDefault = getPayPeriod({ date: new Date(), payday: oldPayday });
  if (isSameDay(currentPeriod.value.from, oldDefault.from) && isSameDay(currentPeriod.value.to, oldDefault.to)) {
    currentPeriod.value = getPayPeriod({ date: new Date(), payday: newPayday });
  }
});
</script>
