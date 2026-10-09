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
          'sticky md:top-(--header-height)',
          isSafariMobile
            ? isPWA
              ? 'max-md:bottom-[calc(var(--bottom-navbar-height)-env(safe-area-inset-bottom)-1px)]'
              : 'max-md:bottom-[calc(var(--bottom-navbar-height-content-rect)-env(safe-area-inset-bottom)-1px)]'
            : 'max-md:bottom-[calc(env(safe-area-inset-bottom)-1px)]',
          'md:order-first md:mx-0 md:-mt-1 md:mb-2 md:border-t-0 md:py-1',
        ])
      "
    >
      <div class="grid grid-cols-[1fr_auto_1fr] items-center">
        <div />
        <PeriodSelector v-model="currentPeriod" />
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

      <DashboardGrid ref="gridRef" :current-period="currentPeriod" />

      <!-- Mobile: sticky "Done/Cancel" bar at bottom during edit mode -->
      <DashboardEditToolbar
        v-if="gridRef?.isEditMode"
        class="bg-background/90 sticky bottom-0 z-(--z-navbar) -mx-6 justify-center border-t px-6 py-3 backdrop-blur-sm md:hidden"
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
import DashboardOnboarding from '@/components/widgets/dashboard-onboarding.vue';
import { useSafariDetection } from '@/composable/detect-safari';
import { cn } from '@/lib/utils';
import { useAccountsStore } from '@/stores';
import { endOfMonth, parseISO, startOfMonth } from 'date-fns';
import { storeToRefs } from 'pinia';
import { computed, ref } from 'vue';
import { useRoute } from 'vue-router';

import DashboardEditToolbar from './components/dashboard-edit-toolbar.vue';
import DashboardGrid from './components/dashboard-grid.vue';
import PeriodSelector from './components/period-selector.vue';
import { type Period } from './types';

const { isSafariMobile, isPWA } = useSafariDetection();

const route = useRoute();

const accountsStore = useAccountsStore();
const { accounts, isAccountsFetched } = storeToRefs(accountsStore);
const hasNoAccounts = computed(() => isAccountsFetched.value && (accounts.value?.length ?? 0) === 0);

defineOptions({
  name: 'page-dashboard',
});

const gridRef = ref<InstanceType<typeof DashboardGrid> | null>(null);
const isEditMode = computed(() => gridRef.value?.isEditMode ?? false);

// Get initial period from URL or default to current month
const getInitialPeriod = (): Period => {
  const { from, to } = route.query;
  if (from && to) {
    return {
      from: parseISO(from as string),
      to: parseISO(to as string),
    };
  }
  return {
    from: startOfMonth(new Date()),
    to: endOfMonth(new Date()),
  };
};

const currentPeriod = ref<Period>(getInitialPeriod());
</script>
