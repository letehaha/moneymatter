<template>
  <div
    ref="containerRef"
    :class="
      cn(
        'flex min-h-[calc(100dvh-var(--header-height)-var(--bottom-navbar-height))] flex-col p-4 sm:flex-row',
        isTransitionReady && 'transition-all duration-200',
        isCollapsed && !isCompactLayout ? 'md:pr-6 md:pl-2' : 'md:px-6',
        isMobileView
          ? 'min-h-[calc(100dvh-var(--header-height)-var(--bottom-navbar-height))]'
          : 'min-h-[calc(100dvh-var(--header-height))]',
        (isOnChildRoute || !isCompactLayout) && 'pt-4',
        isCollapsed && !isCompactLayout ? 'gap-2' : 'gap-6',
      )
    "
  >
    <!-- Sidebar Navigation (wide: always visible, compact: only on root) -->
    <nav
      v-if="!isOnChildRoute || !isCompactLayout"
      :class="[
        'border-border bg-card dark:bg-card/50 shadow-card shrink-0 rounded-lg border backdrop-blur-sm dark:shadow-none',
        isTransitionReady && !isResizing && 'transition-all duration-200',
        isCompactLayout ? 'w-full' : isCollapsed && 'w-14',
        !isCompactLayout && 'sticky top-[calc(var(--header-height)+1rem)] self-start',
      ]"
      :style="isCompactLayout || isCollapsed ? undefined : { width: `${navWidth}px` }"
    >
      <ResizeHandle
        v-if="!isCompactLayout && !isCollapsed"
        edge="right"
        :label="$t('sidebar.resize')"
        @start="startResize"
        @reset="resetWidth"
      />
      <ScrollArea :class="navMaxHeight" :viewport-class="cn('p-2', navMaxHeight)">
        <ul class="flex flex-col gap-1 overflow-hidden">
          <!-- Collapse toggle (only on wide layout) -->
          <li v-if="!isCompactLayout" class="border-border mb-1 border-b pb-1">
            <button
              :class="
                cn(
                  'text-muted-foreground flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors',
                  'hover:bg-accent hover:text-foreground',
                )
              "
              @click="isCollapsed = !isCollapsed"
            >
              <PanelLeftCloseIcon v-if="!isCollapsed" class="size-4 shrink-0" />
              <PanelLeftOpenIcon v-else class="size-4 shrink-0" />
              <span
                :class="[
                  'whitespace-nowrap transition-opacity duration-200',
                  isCollapsed ? 'opacity-0' : 'opacity-100',
                ]"
              >
                {{ $t('analytics.navigation.collapse') }}
              </span>
            </button>
          </li>

          <template v-for="section in sections" :key="section.key">
            <!-- Section header: uppercase label on the expanded/compact layouts, a bare
               divider when collapsed to icons so the grouping still reads. -->
            <li v-if="section.title" class="mt-2">
              <div v-if="isCollapsed && !isCompactLayout" class="border-border mx-1 border-t" />
              <div v-else class="border-border border-t pt-3">
                <span class="text-muted-foreground px-3 text-xs font-medium tracking-wider uppercase">
                  {{ section.title }}
                </span>
              </div>
            </li>

            <li v-for="tab in section.tabs" :key="tab.name">
              <DesktopOnlyTooltip :content="tab.label" :disabled="!isCollapsed || isCompactLayout" side="right">
                <router-link
                  :to="tab.to"
                  :class="
                    cn(
                      'text-foreground dark:text-muted-foreground flex items-center gap-2 rounded-md px-3 py-2 whitespace-nowrap transition-colors',
                      'hover:bg-accent hover:text-foreground',
                      '[&.router-link-exact-active]:bg-primary/10 dark:[&.router-link-exact-active]:bg-accent [&.router-link-exact-active]:text-foreground',
                      isCompactLayout ? 'text-sm md:gap-4 md:text-base' : 'text-sm',
                    )
                  "
                >
                  <component :is="tab.icon" :class="cn('size-4 shrink-0', isCompactLayout && 'md:size-5')" />
                  <span
                    :class="[
                      'min-w-0 truncate transition-opacity duration-200',
                      isCollapsed && !isCompactLayout ? 'opacity-0' : 'opacity-100',
                    ]"
                  >
                    {{ tab.label }}
                  </span>
                  <ChevronRightIcon v-if="isCompactLayout" class="text-muted-foreground ml-auto size-4" />
                </router-link>
              </DesktopOnlyTooltip>
            </li>
          </template>
        </ul>
      </ScrollArea>
    </nav>

    <!-- Content Area (wide: always visible, compact: only on child routes) -->
    <div v-if="isOnChildRoute || !isCompactLayout" class="min-w-0 flex-1">
      <div v-if="activeTab" class="@container mb-4 flex items-start justify-between gap-3">
        <div class="min-w-0">
          <div class="flex items-center gap-1.5">
            <router-link
              v-if="isCompactLayout"
              :to="{ name: ROUTES_NAMES.analytics }"
              :aria-label="$t('analytics.backToAnalytics')"
              class="text-muted-foreground hover:text-foreground -ml-1 flex size-5 shrink-0 items-center justify-center rounded-md"
            >
              <ChevronLeftIcon class="size-5" />
            </router-link>
            <h1 :class="cn('font-semibold', isCompactLayout ? 'text-base' : 'text-lg')">{{ activeTab.label }}</h1>
          </div>
          <p :class="cn('text-muted-foreground', isCompactLayout ? 'mt-0.5 text-xs leading-snug' : 'text-sm')">
            {{ activeTab.description }}
            <DocsLink v-if="activeTab.docsPath" :path="activeTab.docsPath" />
          </p>
        </div>
        <div :id="ANALYTICS_HEADER_ACTIONS_ID" class="shrink-0" />
      </div>

      <router-view />
    </div>
  </div>
</template>

<script setup lang="ts">
import ResizeHandle from '@/components/common/resize-handle.vue';
import DocsLink from '@/components/common/docs-link.vue';
import { ScrollArea } from '@/components/lib/ui/scroll-area';
import { DesktopOnlyTooltip } from '@/components/lib/ui/tooltip';
import { useAfterMountTransition } from '@/composable/use-after-mount-transition';
import { SUB_NAV_WIDTH, useResizableWidth } from '@/composable/use-resizable-width';
import { CUSTOM_BREAKPOINTS, useWindowBreakpoints } from '@/composable/window-breakpoints';
import { cn } from '@/lib/utils';
import { ROUTES_NAMES } from '@/routes';
import { useElementSize, useLocalStorage } from '@vueuse/core';
import {
  CalculatorIcon,
  ChartAreaIcon,
  ChartLineIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  DollarSignIcon,
  FlameIcon,
  PanelLeftCloseIcon,
  PanelLeftOpenIcon,
  PiggyBankIcon,
  TableIcon,
  TrendingUpIcon,
} from '@lucide/vue';
import { type Component, computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';

import { ANALYTICS_HEADER_ACTIONS_ID } from './utils';

interface Tab {
  name: string;
  label: string;
  description: string;
  docsPath?: string;
  to: { name: string };
  icon: Component;
}

interface NavSection {
  key: string;
  // Absent on the first, general-analytics group: it needs no heading.
  title?: string;
  tabs: Tab[];
}

const route = useRoute();
const router = useRouter();
const { t } = useI18n();

const containerRef = ref<HTMLElement | null>(null);
const { width: containerWidth } = useElementSize(containerRef);

const isMobileView = useWindowBreakpoints(CUSTOM_BREAKPOINTS.uiMobile, {
  wait: 50,
});

const isCompactLayout = computed(() => containerWidth.value < 920);
const navMaxHeight = computed(() => (isCompactLayout.value ? '' : 'max-h-[calc(100dvh-var(--header-height)-2rem)]'));
const isCollapsed = useLocalStorage('analytics-sidebar-collapsed', false);
const {
  width: navWidth,
  isResizing,
  startResize,
  resetWidth,
} = useResizableWidth({
  storageKey: 'analytics-sidebar-width',
  ...SUB_NAV_WIDTH,
  edge: 'right',
});

const isTransitionReady = useAfterMountTransition();

const isOnChildRoute = computed(() => route.name !== ROUTES_NAMES.analytics);

const activeTab = computed(() =>
  sections.value.flatMap((section) => section.tabs).find((tab) => tab.to.name === route.name),
);

// On wide layout, redirect to cash-flow if on root analytics
watch(
  [isCompactLayout, () => route.name],
  ([compact, routeName]) => {
    if (!compact && routeName === ROUTES_NAMES.analytics) {
      router.replace({ name: ROUTES_NAMES.analyticsTrendsComparison });
    }
  },
  { immediate: true },
);

const sections = computed<NavSection[]>(() => [
  {
    key: 'general',
    tabs: [
      {
        name: 'trends-comparison',
        label: t('analytics.navigation.trendsComparison'),
        description: t('analytics.trends.subtitle'),
        docsPath: '/stats/analytics-reports/#trends-comparison',
        to: { name: ROUTES_NAMES.analyticsTrendsComparison },
        icon: TrendingUpIcon,
      },
      {
        name: 'cash-flow',
        label: t('analytics.navigation.cashFlow'),
        description: t('analytics.cashFlow.subtitle'),
        docsPath: '/stats/analytics-reports/#cash-flow',
        to: { name: ROUTES_NAMES.analyticsCashFlow },
        icon: DollarSignIcon,
      },
      {
        name: 'net-worth-history',
        label: t('analytics.navigation.netWorthHistory'),
        description: t('netWorthHistory.subtitle'),
        docsPath: '/stats/analytics-reports/#net-worth-history',
        to: { name: ROUTES_NAMES.analyticsNetWorthHistory },
        icon: ChartLineIcon,
      },
      {
        name: 'pivot-report',
        label: t('analytics.navigation.pivotReport'),
        description: t('pivotReport.subtitle'),
        docsPath: '/stats/analytics-reports/#pivot',
        to: { name: ROUTES_NAMES.analyticsPivotReport },
        icon: TableIcon,
      },
    ],
  },
  {
    key: 'investments',
    title: t('analytics.navigation.sections.investments'),
    tabs: [
      {
        name: 'net-worth-drivers',
        label: t('analytics.navigation.netWorthDrivers'),
        description: t('netWorthDrivers.subtitle'),
        to: { name: ROUTES_NAMES.analyticsNetWorthDrivers },
        icon: ChartAreaIcon,
      },
      {
        name: 'investment-contributions',
        label: t('analytics.navigation.investmentContributions'),
        description: t('investmentContributions.subtitle'),
        to: { name: ROUTES_NAMES.analyticsInvestmentContributions },
        icon: PiggyBankIcon,
      },
      {
        name: 'investment-calculator',
        label: t('analytics.navigation.investmentCalculator'),
        description: t('analytics.investmentCalculator.subtitle'),
        to: { name: ROUTES_NAMES.analyticsInvestmentCalculator },
        icon: CalculatorIcon,
      },
      {
        name: 'fire',
        label: t('analytics.navigation.fire'),
        description: t('analytics.fire.subtitle'),
        to: { name: ROUTES_NAMES.analyticsFire },
        icon: FlameIcon,
      },
    ],
  },
]);
</script>
