<script setup lang="ts">
import { Button } from '@/components/lib/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/lib/ui/tabs';
import { DesktopOnlyTooltip } from '@/components/lib/ui/tooltip';
import { cn } from '@/lib/utils';
import { ROUTES_NAMES } from '@/routes';
import { ArrowLeftIcon } from '@lucide/vue';
import { useElementSize } from '@vueuse/core';
import { computed, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import HistoryTab from './components/history-tab.vue';
import StuckPendingTab from './components/stuck-pending-tab.vue';
import TransactionsTab from './components/transactions-tab.vue';
import { useStuckPending } from './use-reconciliation';

const TAB = { transactions: 'transactions', stuckPending: 'stuck-pending', history: 'history' } as const;
type Tab = (typeof TAB)[keyof typeof TAB];
const TAB_VALUES = Object.values(TAB) as string[];

const route = useRoute();
const router = useRouter();

const activeTab = computed<Tab>(() =>
  TAB_VALUES.includes(String(route.query.tab)) ? (route.query.tab as Tab) : TAB.transactions,
);

const onTabChange = (value: string | number) => {
  router.replace({ query: { ...route.query, tab: String(value) } });
};

// An inactive TabsContent keeps only the `hidden` attribute, which `display: flex` would override.
const tabContentClass = ({ tab }: { tab: Tab }) =>
  activeTab.value === tab ? 'mt-3 flex min-h-0 flex-1 flex-col' : undefined;

const { data: stuckPending } = useStuckPending();
const stuckPendingCount = computed(() => stuckPending.value?.length ?? 0);

const MOBILE_MODE_MAX_WIDTH_PX = 672;
const pageRef = ref<HTMLElement | null>(null);
const { width: pageWidth } = useElementSize(pageRef);
const isMobileMode = computed(() => pageWidth.value > 0 && pageWidth.value < MOBILE_MODE_MAX_WIDTH_PX);
</script>

<template>
  <div
    ref="pageRef"
    class="flex h-[calc(100dvh-var(--header-height))] min-h-0 flex-col gap-3 overflow-hidden p-4 max-md:h-[calc(100dvh-var(--header-height)-var(--bottom-navbar-height))] md:p-6"
  >
    <div class="flex h-8 shrink-0 items-center gap-2">
      <DesktopOnlyTooltip :content="$t('optimizations.backToOptimizations')">
        <Button variant="ghost" size="icon-sm" class="text-muted-foreground -ml-1 shrink-0" as-child>
          <RouterLink :to="{ name: ROUTES_NAMES.optimizations }" :aria-label="$t('optimizations.backToOptimizations')">
            <ArrowLeftIcon class="size-4" />
          </RouterLink>
        </Button>
      </DesktopOnlyTooltip>

      <h1 class="truncate text-xl font-bold tracking-tight">
        {{ $t('optimizations.reconciliation.title') }}
      </h1>
    </div>

    <Tabs
      :model-value="activeTab"
      :unmount-on-hide="false"
      class="flex min-h-0 flex-1 flex-col"
      @update:model-value="onTabChange"
    >
      <TabsList variant="underline" :class="cn('shrink-0', activeTab !== TAB.transactions && 'max-w-5xl')">
        <TabsTrigger :value="TAB.transactions">{{ $t('optimizations.reconciliation.tabs.transactions') }}</TabsTrigger>
        <TabsTrigger :value="TAB.stuckPending">
          {{ $t('optimizations.reconciliation.tabs.stuckPending') }}
          <span
            v-if="stuckPendingCount > 0"
            class="bg-warning-text/15 text-warning-text rounded-full px-1.5 py-0.5 text-xs font-semibold tabular-nums"
          >
            {{ stuckPendingCount }}
          </span>
        </TabsTrigger>
        <TabsTrigger :value="TAB.history">{{ $t('optimizations.reconciliation.tabs.history') }}</TabsTrigger>
      </TabsList>

      <TabsContent :value="TAB.transactions" :class="tabContentClass({ tab: TAB.transactions })">
        <TransactionsTab :is-mobile-mode="isMobileMode" />
      </TabsContent>

      <TabsContent :value="TAB.stuckPending" :class="tabContentClass({ tab: TAB.stuckPending })">
        <StuckPendingTab :is-mobile-mode="isMobileMode" />
      </TabsContent>

      <TabsContent :value="TAB.history" :class="tabContentClass({ tab: TAB.history })">
        <HistoryTab />
      </TabsContent>
    </Tabs>
  </div>
</template>
