<template>
  <PageWrapper>
    <ResourceNotFound
      v-if="isNotFound"
      :title="$t('portfolioDetail.notFoundTitle')"
      :description="$t('portfolioDetail.notFoundDescription')"
      :link-label="$t('portfolioDetail.backToInvestments')"
      :link-to="{ name: ROUTES_NAMES.investments }"
    />

    <template v-else>
      <div
        ref="headerRef"
        data-testid="portfolio-header"
        class="@container/portfolio-header mb-6 flex items-center gap-3"
      >
        <DesktopOnlyTooltip :content="$t('portfolioDetail.backToInvestments')">
          <UiButton as-child variant="ghost" size="icon-sm" class="-ml-2 shrink-0">
            <router-link :to="{ name: ROUTES_NAMES.investments }" :aria-label="$t('portfolioDetail.backToInvestments')">
              <ChevronLeftIcon class="size-4" />
            </router-link>
          </UiButton>
        </DesktopOnlyTooltip>

        <EditableEntityLogo
          v-if="portfolio"
          :entity="portfolio"
          flow="portfolioLogo"
          :save="saveLogo"
          class="size-10 shrink-0"
        >
          <PortfolioLogo :portfolio="portfolio" class="size-full" />
        </EditableEntityLogo>
        <div v-else-if="isLoading" class="bg-muted size-10 shrink-0 animate-pulse rounded-lg" />

        <div class="min-w-0 flex-1">
          <div v-if="portfolio" class="flex min-w-0 items-center gap-2">
            <h1 class="truncate text-xl font-semibold tracking-tight @min-[512px]/portfolio-header:text-2xl">
              {{ portfolio.name }}
            </h1>
            <ExternalUrlLinkButton
              :url="portfolio.externalUrl"
              :label="$t('portfolioDetail.actions.openExternalUrl')"
            />
          </div>
          <h1
            v-else-if="isLoading"
            class="truncate text-xl font-semibold tracking-tight @min-[512px]/portfolio-header:text-2xl"
          >
            {{ $t('portfolioDetail.loading') }}
          </h1>
          <p v-if="portfolio" class="text-muted-foreground truncate text-sm">{{ $t('portfolioDetail.subtitle') }}</p>
        </div>

        <div v-if="portfolio" class="flex shrink-0 items-center gap-2">
          <div class="hidden items-center gap-2 @min-[512px]/portfolio-header:flex">
            <UiButton variant="outline" size="sm" @click="isTransferOpen = true">
              <ArrowRightLeftIcon class="size-4" />
              {{ $t('portfolioDetail.actions.transfer') }}
            </UiButton>
            <UiButton variant="outline" size="sm" @click="isEditOpen = true">
              <PencilIcon class="size-4" />
              {{ $t('portfolioDetail.actions.edit') }}
            </UiButton>
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger as-child>
              <span class="inline-flex">
                <DesktopOnlyTooltip :content="$t('common.actions.more')">
                  <UiButton variant="outline" size="icon-sm" :aria-label="$t('common.actions.more')">
                    <EllipsisIcon class="size-4" />
                  </UiButton>
                </DesktopOnlyTooltip>
              </span>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" class="min-w-56">
              <template v-if="isCompactHeader">
                <DropdownMenuItem @click="isTransferOpen = true">
                  <ArrowRightLeftIcon class="size-4" />
                  {{ $t('portfolioDetail.actions.transfer') }}
                </DropdownMenuItem>
                <DropdownMenuItem @click="isEditOpen = true">
                  <PencilIcon class="size-4" />
                  {{ $t('portfolioDetail.actions.edit') }}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
              </template>
              <DropdownMenuItem class="text-destructive-text" @click="isDeleteOpen = true">
                <Trash2Icon class="size-4" />
                {{ $t('portfolioDetail.actions.delete') }}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <PortfolioTransferDialog v-model:open="isTransferOpen" :portfolio="portfolio" context="portfolio" />
          <EditPortfolioDialog v-model:open="isEditOpen" :portfolio="portfolio" @updated="refetch" />
          <DeletePortfolioDialog v-model:open="isDeleteOpen" :portfolio-id="portfolio.id" @deleted="handleDeletion" />
        </div>
      </div>

      <!-- Main Content -->
      <div v-if="portfolio" class="grid gap-6">
        <PortfolioHero :portfolio-id="portfolioId" />

        <Tabs
          ref="tabsRef"
          :model-value="activeTab"
          class="min-h-[calc(var(--app-viewport-height)-var(--app-header-height)-2rem)] scroll-mt-(--app-header-height) md:min-h-[calc(var(--app-viewport-height)-var(--app-header-height)-1rem)]"
          @update:model-value="onTabChange"
        >
          <TabsList
            variant="underline"
            class="bg-background sticky top-(--app-header-height) z-20 -mx-4 px-4 md:-mx-6 md:px-6"
          >
            <TabsTrigger v-for="tab in orderedTabs" :key="tab" :value="tab">
              {{ tabLabels[tab] }}
              <span v-if="tab === PORTFOLIO_TABS.holdings && holdings" class="text-muted-foreground tabular-nums">
                {{ holdings.length }}
              </span>
              <span
                v-if="showPlusBadge && TAB_FEATURES[tab]"
                class="bg-muted text-muted-foreground rounded px-1.5 py-0.5 text-xs font-bold tracking-wide uppercase"
              >
                {{ $t('portfolioDetail.tabs.plusBadge') }}
              </span>
            </TabsTrigger>
          </TabsList>

          <TabsContent :value="PORTFOLIO_TABS.holdings" class="mt-4">
            <div class="grid gap-4">
              <HoldingsSummary :portfolio-id="portfolioId" :portfolio-name="portfolio.name" />
              <PortfolioCashSection :portfolio="portfolio" />
            </div>
          </TabsContent>
          <TabsContent :value="PORTFOLIO_TABS.analytics" class="mt-4">
            <FeatureTrialGate
              :feature="FEATURES.portfolio_analytics"
              :description="$t('portfolioDetail.tabs.analyticsGateDescription')"
            >
              <PortfolioAnalyticsTab :portfolio-id="portfolioId" />
            </FeatureTrialGate>
          </TabsContent>
          <TabsContent :value="PORTFOLIO_TABS.activity" class="mt-4">
            <PortfolioActivityTab :portfolio-id="portfolioId" />
          </TabsContent>
          <TabsContent :value="PORTFOLIO_TABS.watchlist" class="mt-4">
            <FeatureTrialGate
              :feature="FEATURES.watchlist"
              :description="$t('portfolioDetail.tabs.watchlistGateDescription')"
            >
              <PortfolioWatchlistTab :portfolio-id="portfolioId" :portfolio="portfolio" />
            </FeatureTrialGate>
          </TabsContent>
        </Tabs>
      </div>

      <!-- Loading State -->
      <div v-else-if="isLoading" class="py-12 text-center">
        <div
          class="border-primary/20 mb-4 inline-flex size-12 items-center justify-center rounded-full border-2 border-t-transparent"
        >
          <div class="bg-primary/20 size-6 animate-pulse rounded"></div>
        </div>
        <p class="text-muted-foreground">{{ $t('portfolioDetail.loadingDetails') }}</p>
      </div>

      <!-- Error State -->
      <div v-else-if="error" class="py-12 text-center">
        <div class="bg-destructive/10 mb-4 inline-flex size-12 items-center justify-center rounded-full">
          <AlertCircleIcon class="text-destructive-text size-6" />
        </div>
        <p class="text-destructive-text mb-4">{{ $t('portfolioDetail.loadError') }}</p>
        <UiButton @click="refetch">{{ $t('portfolioDetail.tryAgain') }}</UiButton>
      </div>
    </template>
  </PageWrapper>
</template>

<script setup lang="ts">
import FeatureTrialGate from '@/components/billing/feature-trial-gate.vue';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/common/dropdown-menu';
import EditableEntityLogo from '@/components/common/editable-entity-logo.vue';
import ExternalUrlLinkButton from '@/components/common/external-url-link-button.vue';
import PageWrapper from '@/components/common/page-wrapper.vue';
import PortfolioLogo from '@/components/common/portfolio-logo.vue';
import ResourceNotFound from '@/components/common/resource-not-found.vue';
import DeletePortfolioDialog from '@/components/dialogs/delete-portfolio-dialog.vue';
import EditPortfolioDialog from '@/components/dialogs/edit-portfolio-dialog.vue';
import PortfolioTransferDialog from '@/components/dialogs/portfolio-transfer-dialog.vue';
import UiButton from '@/components/lib/ui/button/Button.vue';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/lib/ui/tabs';
import { SCROLL_AREA_IDS } from '@/components/lib/ui/scroll-area/types';
import { DesktopOnlyTooltip } from '@/components/lib/ui/tooltip';
import { useHoldings } from '@/composable/data-queries/holdings';
import { usePortfolio, useUpdatePortfolio } from '@/composable/data-queries/portfolios';
import { useScrollAreaContainer } from '@/composable/scroll-area-container';
import { isResourceMissingError } from '@/js/errors';
import { ROUTES_NAMES } from '@/routes/constants';
import { useUserStore } from '@/stores';
import { FEATURES, type Feature, type NonImageLogoPayload } from '@bt/shared/types';
import { useElementSize } from '@vueuse/core';
import {
  AlertCircleIcon,
  ArrowRightLeftIcon,
  ChevronLeftIcon,
  EllipsisIcon,
  PencilIcon,
  Trash2Icon,
} from '@lucide/vue';
import { computed, nextTick, ref, useTemplateRef } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';

import PortfolioActivityTab from './components/activity/portfolio-activity-tab.vue';
import PortfolioAnalyticsTab from './components/analytics/portfolio-analytics-tab.vue';
import HoldingsSummary from './components/holdings-summary.vue';
import PortfolioCashSection from './components/portfolio-cash-section.vue';
import PortfolioHero from './components/portfolio-hero/portfolio-hero.vue';
import PortfolioWatchlistTab from './components/watchlist/portfolio-watchlist-tab.vue';
import { PORTFOLIO_TABS, type PortfolioTab, orderPortfolioTabs, parsePortfolioTab } from './portfolio-tabs';

const route = useRoute();
const router = useRouter();
const { t } = useI18n();
const userStore = useUserStore();
const portfolioId = computed(() => String(route.params.portfolioId));

const { data: portfolio, isLoading, isError, error, refetch } = usePortfolio(portfolioId, { retry: false });
const { data: holdings } = useHoldings(portfolioId);

const updatePortfolio = useUpdatePortfolio();
const saveLogo = ({ payload }: { payload: NonImageLogoPayload }) =>
  updatePortfolio.mutateAsync({ portfolioId: portfolioId.value, ...payload });

const isNotFound = computed(() => isError.value && isResourceMissingError(error.value));
const isDeleteOpen = ref(false);
const isTransferOpen = ref(false);
const isEditOpen = ref(false);

// Matches the header's `@min-[512px]` query; the menu renders in a portal, outside that container.
const COMPACT_HEADER_PX = 512;
const headerRef = useTemplateRef<HTMLElement>('headerRef');
const { width: headerWidth } = useElementSize(headerRef);
const isCompactHeader = computed(() => headerWidth.value < COMPACT_HEADER_PX);

const handleDeletion = () => {
  router.push({ name: ROUTES_NAMES.investments });
};

const TAB_FEATURES: Partial<Record<PortfolioTab, Feature>> = {
  [PORTFOLIO_TABS.analytics]: FEATURES.portfolio_analytics,
  [PORTFOLIO_TABS.watchlist]: FEATURES.watchlist,
};

const tabLabels = computed<Record<PortfolioTab, string>>(() => ({
  holdings: t('portfolioDetail.tabs.holdings'),
  analytics: t('portfolioDetail.tabs.analytics'),
  activity: t('portfolioDetail.tabs.activity'),
  watchlist: t('portfolioDetail.tabs.watchlist'),
}));

const orderedTabs = computed(() =>
  orderPortfolioTabs({
    isLocked: (tab) => {
      const feature = TAB_FEATURES[tab];
      return feature !== undefined && userStore.isFeatureGated(feature);
    },
  }),
);

const showPlusBadge = computed(() => userStore.canSeeBilling && userStore.entitlements !== null && !userStore.hasPlus);

const activeTab = computed(() => parsePortfolioTab({ value: route.query.tab }));
const tabsRef = useTemplateRef<InstanceType<typeof Tabs>>('tabsRef');
const scrollContainer = useScrollAreaContainer(SCROLL_AREA_IDS.dashboard);

// The dashboard layout resets scroll on every route change, query included, so the offset is
// restored before pinning the tabs to the top.
const onTabChange = async (value: string | number) => {
  const viewport: HTMLElement | undefined = scrollContainer.value?.viewportElement;
  const tabsEl: HTMLElement | undefined = tabsRef.value?.$el;
  const scrollTop = viewport?.scrollTop ?? 0;
  const pinTabs = Boolean(tabsEl && tabsEl.getBoundingClientRect().top < window.innerHeight / 2);

  await router.replace({ query: { ...route.query, tab: String(value) } });
  await nextTick();

  if (viewport) viewport.scrollTop = scrollTop;
  if (pinTabs) tabsEl?.scrollIntoView({ block: 'start', behavior: 'smooth' });
};
</script>
