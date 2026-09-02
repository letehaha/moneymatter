<script setup lang="ts">
import CreateAccountGroupDialog from '@/components/dialogs/account-groups/create-account-group-dialog.vue';
import CreateAccountDialog from '@/components/dialogs/create-account-dialog.vue';
import CreatePortfolioDialog from '@/components/dialogs/create-portfolio-dialog.vue';
import Button from '@/components/lib/ui/button/Button.vue';
import * as Popover from '@/components/lib/ui/popover';
import { ScrollArea } from '@/components/lib/ui/scroll-area';
import { SCROLL_AREA_IDS } from '@/components/lib/ui/scroll-area/types';
import { waitForAnimationEnd } from '@/composable/wait-for-animation-end';
import { ROUTES_NAMES } from '@/routes/constants';
import {
  CarIcon,
  ChevronsUpDownIcon,
  HandCoinsIcon,
  HomeIcon,
  LayersIcon,
  PlusIcon,
  RocketIcon,
  TrendingUpIcon,
} from '@lucide/vue';
import { useLocalStorage } from '@vueuse/core';
import { computed, nextTick, provide, ref, watch } from 'vue';
import { useRoute } from 'vue-router';

import SidebarSettingsPopover from '../sidebar-settings-popover.vue';
import { useSidebarNavCollapse } from '../use-nav-collapse';
import AccountGroupsList from './account-groups-list.vue';
import AccountsList from './accounts-list.vue';
import AccountsSkeleton from './accounts-skeleton.vue';
import GroupTotal from './group-total.vue';
import { computeStickyOffsets } from './helpers/sticky-offsets';
import { useActiveAccountGroups } from './helpers/use-active-account-groups';
import { useSidebarSectionTotals } from './helpers/use-sidebar-section-totals';
import LoansList from './loans-list.vue';
import PortfoliosList from './portfolios-list.vue';
import SidebarCollapsibleSection from './sidebar-collapsible-section.vue';
import VenturesList from './ventures-list.vue';

const {
  accountGroups,
  isLoading,
  accountsWithoutGroups,
  vehicleAccounts,
  propertyAccounts,
  baseCurrencyCode,
  bankAccountsTotal,
  portfoliosTotal,
  isPortfoliosTotalLoading,
  venturesCount,
  carsTotal,
  propertiesTotal,
  loansTotal,
  showPortfolios,
  venturesVisible,
  carsVisible,
  propertiesVisible,
  loansVisible,
} = useSidebarSectionTotals();

const accountGroupsContext = useActiveAccountGroups(accountGroups);
provide('accountGroupsContext', accountGroupsContext);

const isPopoverOpen = ref(false);
const { hasAnyOpen, collapseAll } = useSidebarNavCollapse();

const isBankAccountsOpen = useLocalStorage('sidebar:accounts-bank-open', true);
const isPortfoliosOpen = useLocalStorage('sidebar:accounts-portfolios-open', true);
const isVenturesOpen = useLocalStorage('sidebar:accounts-ventures-open', true);
const isCarsOpen = useLocalStorage('sidebar:accounts-cars-open', true);
const isPropertiesOpen = useLocalStorage('sidebar:accounts-properties-open', true);
const isLoansOpen = useLocalStorage('sidebar:accounts-loans-open', true);

type SidebarSection = 'bank' | 'portfolios' | 'ventures' | 'cars' | 'properties' | 'loans';

// Ordered, top-to-bottom section list. `orderedVisibleSections` drops the ones hidden by user
// prefs or emptiness (zero-count ventures/cars/properties/loans auto-hide); `computeStickyOffsets`
// turns that order into per-section stacked sticky-header offsets. Bank is always first and
// rendered with a plain `top-0` and no bottom, so its computed entry is only used to count
// sections above.
const SIDEBAR_SECTIONS = [
  'bank',
  'portfolios',
  'ventures',
  'cars',
  'properties',
  'loans',
] as const satisfies readonly SidebarSection[];

const orderedVisibleSections = computed<SidebarSection[]>(() =>
  (
    [
      { key: 'bank', visible: true },
      { key: 'portfolios', visible: showPortfolios.value },
      { key: 'ventures', visible: venturesVisible.value },
      { key: 'cars', visible: carsVisible.value },
      { key: 'properties', visible: propertiesVisible.value },
      { key: 'loans', visible: loansVisible.value },
    ] as const
  )
    .filter((section) => section.visible)
    .map((section) => section.key),
);

const stickyOffsets = computed(() =>
  computeStickyOffsets({ allKeys: SIDEBAR_SECTIONS, visibleInOrder: orderedVisibleSections.value }),
);

const route = useRoute();
const isPortfolioRoute = computed(
  () => route.name === ROUTES_NAMES.portfolioDetail || route.name === ROUTES_NAMES.portfolioTransactionsImport,
);
watch(
  isPortfolioRoute,
  (val) => {
    if (val) isPortfoliosOpen.value = true;
  },
  { immediate: true },
);

const isVentureRoute = computed(
  () =>
    route.name === ROUTES_NAMES.venture ||
    route.name === ROUTES_NAMES.venturePlatformsList ||
    route.name === ROUTES_NAMES.ventureDealDetail,
);
watch(
  isVentureRoute,
  (val) => {
    if (val) isVenturesOpen.value = true;
  },
  { immediate: true },
);

const isLoanRoute = computed(() => route.name === ROUTES_NAMES.loanDetail);
watch(
  isLoanRoute,
  (val) => {
    if (val) isLoansOpen.value = true;
  },
  { immediate: true },
);

const scrollAreaRef = ref<InstanceType<typeof ScrollArea> | null>(null);

const scrollSectionIntoView = async (sectionEl: HTMLElement | undefined) => {
  if (!sectionEl) return;
  await nextTick();
  const viewport = scrollAreaRef.value?.viewportRef?.viewportElement;
  if (!viewport) return;
  const sectionRect = sectionEl.getBoundingClientRect();
  const viewportRect = viewport.getBoundingClientRect();
  const top = sectionRect.top - viewportRect.top + viewport.scrollTop;
  viewport.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
};

// When a section expands, wait for its open animation to settle, then bring its header into view.
const onSectionExpand = async ({ headerEl, wrapperEl }: { headerEl?: HTMLElement; wrapperEl?: HTMLElement }) => {
  await waitForAnimationEnd(wrapperEl, 'collapsible-down');
  await scrollSectionIntoView(headerEl);
};
</script>

<template>
  <div class="flex min-h-25 flex-1 flex-col gap-1.5 overflow-y-hidden">
    <div class="flex items-center justify-between px-1">
      <button
        type="button"
        class="text-muted-foreground -mx-1 flex items-center gap-1 rounded px-1 py-0.5 transition-colors"
        :class="hasAnyOpen ? 'cursor-pointer' : 'cursor-default'"
        :disabled="!hasAnyOpen"
        :aria-label="$t('sidebar.accountsView.collapseNavigation')"
        @click="collapseAll"
      >
        <span class="text-[11px] font-semibold tracking-wider uppercase">
          {{ $t('sidebar.accountsView.title') }}
        </span>
        <ChevronsUpDownIcon v-if="hasAnyOpen" class="size-3" />
      </button>

      <div class="flex items-center gap-1">
        <SidebarSettingsPopover />

        <Popover.Popover :open="isPopoverOpen" @update:open="isPopoverOpen = $event">
          <Popover.PopoverTrigger as-child>
            <Button size="icon-sm" variant="secondary">
              <PlusIcon :class="['size-3.5 transition-transform', isPopoverOpen && '-rotate-45']" />
            </Button>
          </Popover.PopoverTrigger>
          <Popover.PopoverContent side="bottom" align="end">
            <div class="grid gap-2">
              <CreateAccountDialog @created="isPopoverOpen = false">
                <Button type="button" size="sm" variant="secondary">
                  {{ $t('sidebar.accountsView.newAccount') }}
                </Button>
              </CreateAccountDialog>

              <CreateAccountGroupDialog @created="isPopoverOpen = false">
                <Button type="button" size="sm" variant="secondary">
                  {{ $t('sidebar.accountsView.newAccountsGroup') }}
                </Button>
              </CreateAccountGroupDialog>

              <CreatePortfolioDialog @created="isPopoverOpen = false">
                <Button type="button" size="sm" variant="secondary">
                  {{ $t('sidebar.accountsView.newPortfolio') }}
                </Button>
              </CreatePortfolioDialog>
            </div>
          </Popover.PopoverContent>
        </Popover.Popover>
      </div>
    </div>

    <ScrollArea ref="scrollAreaRef" :scroll-area-id="SCROLL_AREA_IDS.sidebarAccounts" class="flex-1">
      <template v-if="isLoading">
        <AccountsSkeleton />
      </template>
      <template v-else>
        <SidebarCollapsibleSection
          v-model:open="isBankAccountsOpen"
          :icon="LayersIcon"
          :label="$t('sidebar.accountsView.bankAccounts')"
          top-class="top-0"
          @expand="onSectionExpand"
        >
          <template v-if="baseCurrencyCode" #trailing>
            <GroupTotal
              :amount="bankAccountsTotal.total"
              :currency-code="baseCurrencyCode"
              :is-approx="bankAccountsTotal.isApprox"
              emphasis
            />
          </template>
          <AccountGroupsList :groups="accountGroups" />
          <AccountsList :accounts="accountsWithoutGroups" />
        </SidebarCollapsibleSection>

        <SidebarCollapsibleSection
          v-if="showPortfolios"
          v-model:open="isPortfoliosOpen"
          :icon="TrendingUpIcon"
          :label="$t('sidebar.accountsView.portfolios')"
          :top-class="stickyOffsets.portfolios.top"
          :bottom-class="stickyOffsets.portfolios.bottom"
          @expand="onSectionExpand"
        >
          <template v-if="baseCurrencyCode" #trailing>
            <GroupTotal
              :amount="portfoliosTotal.total"
              :currency-code="baseCurrencyCode"
              :is-approx="portfoliosTotal.isApprox"
              :loading="isPortfoliosTotalLoading"
              emphasis
            />
          </template>
          <PortfoliosList />
        </SidebarCollapsibleSection>

        <SidebarCollapsibleSection
          v-if="venturesVisible"
          v-model:open="isVenturesOpen"
          :icon="RocketIcon"
          :label="$t('sidebar.accountsView.ventures')"
          :count="venturesCount"
          :top-class="stickyOffsets.ventures.top"
          :bottom-class="stickyOffsets.ventures.bottom"
          @expand="onSectionExpand"
        >
          <VenturesList />
        </SidebarCollapsibleSection>

        <SidebarCollapsibleSection
          v-if="carsVisible"
          v-model:open="isCarsOpen"
          :icon="CarIcon"
          :label="$t('sidebar.accountsView.cars')"
          :top-class="stickyOffsets.cars.top"
          :bottom-class="stickyOffsets.cars.bottom"
          @expand="onSectionExpand"
        >
          <template v-if="baseCurrencyCode" #trailing>
            <GroupTotal
              :amount="carsTotal.total"
              :currency-code="baseCurrencyCode"
              :is-approx="carsTotal.isApprox"
              emphasis
            />
          </template>
          <AccountsList :accounts="vehicleAccounts" />
        </SidebarCollapsibleSection>

        <SidebarCollapsibleSection
          v-if="propertiesVisible"
          v-model:open="isPropertiesOpen"
          :icon="HomeIcon"
          :label="$t('sidebar.accountsView.properties')"
          :top-class="stickyOffsets.properties.top"
          :bottom-class="stickyOffsets.properties.bottom"
          @expand="onSectionExpand"
        >
          <template v-if="baseCurrencyCode" #trailing>
            <GroupTotal
              :amount="propertiesTotal.total"
              :currency-code="baseCurrencyCode"
              :is-approx="propertiesTotal.isApprox"
              emphasis
            />
          </template>
          <AccountsList :accounts="propertyAccounts" />
        </SidebarCollapsibleSection>

        <SidebarCollapsibleSection
          v-if="loansVisible"
          v-model:open="isLoansOpen"
          :icon="HandCoinsIcon"
          :label="$t('sidebar.accountsView.loans')"
          :top-class="stickyOffsets.loans.top"
          :bottom-class="stickyOffsets.loans.bottom"
          @expand="onSectionExpand"
        >
          <template v-if="baseCurrencyCode" #trailing>
            <GroupTotal
              :amount="loansTotal.total"
              :currency-code="baseCurrencyCode"
              :is-approx="loansTotal.isApprox"
              emphasis
            />
          </template>
          <LoansList />
        </SidebarCollapsibleSection>
      </template>
    </ScrollArea>
  </div>
</template>
