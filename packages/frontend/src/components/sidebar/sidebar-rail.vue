<script setup lang="ts">
import ResponsiveHoverCard from '@/components/common/responsive-hover-card.vue';
import UiButton from '@/components/lib/ui/button/Button.vue';
import { Card } from '@/components/lib/ui/card';
import { DesktopOnlyTooltip } from '@/components/lib/ui/tooltip';
import { cn } from '@/lib/utils';
import { ROUTES_NAMES } from '@/routes/constants';
import {
  CalendarClockIcon,
  CarIcon,
  ChartColumnIcon,
  CreditCardIcon,
  HandCoinsIcon,
  LayersIcon,
  LayoutDashboardIcon,
  PanelLeftIcon,
  RocketIcon,
  TrendingUpIcon,
} from '@lucide/vue';
import { type Component, computed, provide, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';

import AccountGroupsList from './accounts-view/account-groups-list.vue';
import AccountsList from './accounts-view/accounts-list.vue';
import AccountsSkeleton from './accounts-view/accounts-skeleton.vue';
import GroupTotal from './accounts-view/group-total.vue';
import type { GroupBaseTotal } from './accounts-view/helpers/account-totals';
import { useActiveAccountGroups } from './accounts-view/helpers/use-active-account-groups';
import { useSidebarSectionTotals } from './accounts-view/helpers/use-sidebar-section-totals';
import LoansList from './accounts-view/loans-list.vue';
import PortfoliosList from './accounts-view/portfolios-list.vue';
import VenturesList from './accounts-view/ventures-list.vue';
import {
  SIDEBAR_BUDGET_NAV_ITEM,
  SIDEBAR_NAV_CHILDREN,
  type SidebarNavChild,
  useAccountsNavChildren,
} from './nav-items';
import RailIconTrigger from './rail-icon-trigger.vue';
import { useSidebarNavRoutes } from './use-nav-routes';
import { useSidebarCollapsed } from './use-sidebar-collapsed';
import UserMenu from './user-menu.vue';

const { t } = useI18n();
const route = useRoute();
const { isCollapsed } = useSidebarCollapsed();
const { isAccountsRoute, isTransactionsRoute, isBudgetRoute, isPlannedRoute } = useSidebarNavRoutes();
const accountsNavChildren = useAccountsNavChildren();

const {
  accountGroups,
  isLoading,
  accountsWithoutGroups,
  vehicleAccounts,
  baseCurrencyCode,
  bankAccountsTotal,
  portfoliosTotal,
  isPortfoliosTotalLoading,
  venturesCount,
  carsTotal,
  loansTotal,
  showPortfolios,
  venturesVisible,
  carsVisible,
  loansVisible,
} = useSidebarSectionTotals();

// The account lists inject this context; group open state lives in a module-level localStorage ref
// inside the composable, so this instance and the docked sidebar's stay in sync.
provide('accountGroupsContext', useActiveAccountGroups(accountGroups));

// One flyout at a time, closed on navigation so a clicked account doesn't leave it over the page.
const openFlyoutKey = ref<string | null>(null);
// Only the flyout that still holds the key may clear it. Moving between two icons opens the next
// one before the previous one's close delay elapses, and that late close would shut the new one.
const setFlyoutOpen = ({ key, open }: { key: string; open: boolean }) => {
  if (open) openFlyoutKey.value = key;
  else if (openFlyoutKey.value === key) openFlyoutKey.value = null;
};
watch(
  () => route.fullPath,
  () => {
    openFlyoutKey.value = null;
  },
);

interface RailNavItem {
  routeName: string;
  icon: Component;
  label: string;
  /** Route-group match for the grouped entries; the rest fall back to router-link's own. */
  active?: boolean;
  children?: SidebarNavChild[];
}

const navItems = computed<RailNavItem[]>(() => [
  { routeName: ROUTES_NAMES.home, icon: LayoutDashboardIcon, label: t('navigation.dashboard') },
  {
    routeName: ROUTES_NAMES.accounts,
    icon: LayersIcon,
    label: t('navigation.accounts'),
    active: isAccountsRoute.value,
    children: accountsNavChildren.value.length > 1 ? accountsNavChildren.value : undefined,
  },
  {
    routeName: ROUTES_NAMES.transactions,
    icon: CreditCardIcon,
    label: t('navigation.transactions'),
    active: isTransactionsRoute.value,
    children: SIDEBAR_NAV_CHILDREN.transactions,
  },
  {
    routeName: SIDEBAR_BUDGET_NAV_ITEM.routeName,
    icon: SIDEBAR_BUDGET_NAV_ITEM.icon,
    label: t(SIDEBAR_BUDGET_NAV_ITEM.labelKey),
    active: isBudgetRoute.value,
  },
  {
    routeName: ROUTES_NAMES.planned,
    icon: CalendarClockIcon,
    label: t('navigation.planned.planned'),
    active: isPlannedRoute.value,
    children: SIDEBAR_NAV_CHILDREN.planned,
  },
  { routeName: ROUTES_NAMES.analytics, icon: ChartColumnIcon, label: t('navigation.analytics') },
]);

interface RailSectionItem {
  key: string;
  routeName: string;
  icon: Component;
  label: string;
  visible: boolean;
  loading: boolean;
  total?: GroupBaseTotal;
  count?: number;
}

const sectionItems = computed<RailSectionItem[]>(() => {
  const sections: RailSectionItem[] = [
    {
      key: 'bank',
      routeName: ROUTES_NAMES.accounts,
      icon: LayersIcon,
      label: t('sidebar.accountsView.bankAccounts'),
      visible: true,
      loading: isLoading.value,
      total: bankAccountsTotal.value,
    },
    {
      key: 'portfolios',
      routeName: ROUTES_NAMES.investments,
      icon: TrendingUpIcon,
      label: t('sidebar.accountsView.portfolios'),
      visible: showPortfolios.value,
      loading: isLoading.value || isPortfoliosTotalLoading.value,
      total: portfoliosTotal.value,
    },
    {
      key: 'ventures',
      routeName: ROUTES_NAMES.venture,
      icon: RocketIcon,
      label: t('sidebar.accountsView.ventures'),
      visible: venturesVisible.value,
      loading: false,
      count: venturesCount.value,
    },
    {
      key: 'cars',
      routeName: ROUTES_NAMES.accounts,
      icon: CarIcon,
      label: t('sidebar.accountsView.cars'),
      visible: carsVisible.value,
      loading: isLoading.value,
      total: carsTotal.value,
    },
    {
      key: 'loans',
      routeName: ROUTES_NAMES.loans,
      icon: HandCoinsIcon,
      label: t('sidebar.accountsView.loans'),
      visible: loansVisible.value,
      loading: isLoading.value,
      total: loansTotal.value,
    },
  ];

  return sections.filter((section) => section.visible);
});
</script>

<template>
  <Card class="flex h-full w-16 flex-col rounded-none">
    <div class="flex h-14 shrink-0 items-center justify-center">
      <div
        class="bg-primary/10 text-primary-text flex size-8 items-center justify-center rounded-md text-sm font-semibold"
        aria-hidden="true"
      >
        M
      </div>
    </div>

    <div class="flex min-h-0 grow flex-col gap-3 px-3 pt-0 pb-3">
      <nav class="grid gap-0.5">
        <template v-for="item in navItems" :key="item.routeName">
          <ResponsiveHoverCard
            v-if="item.children"
            :open="openFlyoutKey === item.routeName"
            content-class-name="w-60"
            @update:open="setFlyoutOpen({ key: item.routeName, open: $event })"
          >
            <RailIconTrigger :to="{ name: item.routeName }" :aria-label="item.label">
              <ui-button variant="ghost" as="span" size="icon" :class="cn(item.active && 'bg-primary/10')">
                <component :is="item.icon" :class="cn('size-4 shrink-0', item.active && 'text-primary-text')" />
              </ui-button>
            </RailIconTrigger>

            <template #content>
              <div class="grid gap-0.5">
                <div class="text-muted-foreground px-3 pb-1 text-[11px] font-semibold tracking-wider uppercase">
                  {{ item.label }}
                </div>
                <router-link
                  v-for="child in item.children"
                  :key="child.routeName"
                  v-slot="{ isActive }"
                  :to="{ name: child.routeName }"
                >
                  <ui-button
                    variant="ghost"
                    as="span"
                    size="sm"
                    :class="['w-full justify-start gap-2 px-3', isActive && 'bg-primary/10 text-foreground']"
                  >
                    <component :is="child.icon" :class="['size-4 shrink-0', isActive && 'text-primary-text']" />
                    <span>{{ $t(child.labelKey) }}</span>
                  </ui-button>
                </router-link>
              </div>
            </template>
          </ResponsiveHoverCard>

          <DesktopOnlyTooltip v-else :content="item.label" side="right">
            <router-link v-slot="{ isActive }" :to="{ name: item.routeName }">
              <ui-button
                variant="ghost"
                as="span"
                size="icon"
                :aria-label="item.label"
                :class="cn((item.active ?? isActive) && 'bg-primary/10')"
              >
                <component
                  :is="item.icon"
                  :class="cn('size-4 shrink-0', (item.active ?? isActive) && 'text-primary-text')"
                />
              </ui-button>
            </router-link>
          </DesktopOnlyTooltip>
        </template>
      </nav>

      <div class="bg-border/50 h-px" />

      <div class="grid gap-0.5">
        <ResponsiveHoverCard
          v-for="section in sectionItems"
          :key="section.key"
          :open="openFlyoutKey === section.key"
          content-class-name="w-max min-w-72 max-w-96"
          @update:open="setFlyoutOpen({ key: section.key, open: $event })"
        >
          <RailIconTrigger :to="{ name: section.routeName }" :aria-label="section.label">
            <ui-button variant="ghost" as="span" size="icon">
              <component :is="section.icon" class="text-muted-foreground size-4 shrink-0" />
            </ui-button>
          </RailIconTrigger>

          <template #content>
            <div class="grid grid-cols-[minmax(0,1fr)] gap-1">
              <router-link
                :to="{ name: section.routeName }"
                class="hover:bg-accent flex items-center justify-between gap-2 rounded-md px-2 py-1.5"
              >
                <span class="text-sm font-medium">{{ section.label }}</span>
                <GroupTotal
                  v-if="section.total && baseCurrencyCode"
                  :amount="section.total.total"
                  :currency-code="baseCurrencyCode"
                  :is-approx="section.total.isApprox"
                  :loading="section.loading"
                  emphasis
                />
                <span v-else-if="section.count !== undefined" class="text-muted-foreground text-sm tabular-nums">
                  {{ section.count }}
                </span>
              </router-link>

              <div class="bg-border/50 h-px" />

              <template v-if="section.key === 'bank'">
                <AccountsSkeleton v-if="isLoading" />
                <template v-else>
                  <AccountGroupsList :groups="accountGroups" />
                  <AccountsList :accounts="accountsWithoutGroups" />
                </template>
              </template>
              <PortfoliosList v-else-if="section.key === 'portfolios'" />
              <VenturesList v-else-if="section.key === 'ventures'" />
              <AccountsList v-else-if="section.key === 'cars'" :accounts="vehicleAccounts" />
              <LoansList v-else-if="section.key === 'loans'" />
            </div>
          </template>
        </ResponsiveHoverCard>
      </div>

      <div class="mt-auto grid gap-1">
        <DesktopOnlyTooltip :content="$t('sidebar.expand')" side="right">
          <ui-button variant="ghost" size="icon" :aria-label="$t('sidebar.expand')" @click="isCollapsed = false">
            <PanelLeftIcon class="size-4" />
          </ui-button>
        </DesktopOnlyTooltip>

        <UserMenu compact />
      </div>
    </div>
  </Card>
</template>
