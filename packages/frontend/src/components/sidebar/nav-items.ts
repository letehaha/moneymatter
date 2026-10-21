import type { SidebarNavConfig } from '@/api/user-settings';
import { useUserSettings } from '@/composable/data-queries/user-settings';
import { ROUTES_NAMES } from '@/routes/constants';
import {
  CalculatorIcon,
  CreditCardIcon,
  FlagIcon,
  GroupIcon,
  HandCoinsIcon,
  RepeatIcon,
  RocketIcon,
  TargetIcon,
  TrendingUpIcon,
  WalletIcon,
  WrenchIcon,
  ZapIcon,
} from '@lucide/vue';
import { type Component, computed } from 'vue';

export interface SidebarNavChild {
  routeName: string;
  labelKey: string;
  icon: Component;
  /** Present on links the user can hide; the link shows unless its setting is `false`. */
  settingKey?: keyof SidebarNavConfig;
  /** Sibling detail routes that should also highlight this link; router-link's own isActive misses them. */
  activeRouteNames?: string[];
}

type ToggleableNavChild = SidebarNavChild & { settingKey: keyof SidebarNavConfig };

/** Sub-links of the collapsible nav groups, rendered by both the full nav and the rail flyouts. */
export const SIDEBAR_NAV_CHILDREN = {
  accounts: [
    {
      routeName: ROUTES_NAMES.accounts,
      labelKey: 'navigation.accountsList',
      icon: WalletIcon,
      activeRouteNames: [
        ROUTES_NAMES.account,
        ROUTES_NAMES.accountsVehicleDetails,
        ROUTES_NAMES.accountIntegrationDetails,
      ],
    },
    {
      routeName: ROUTES_NAMES.loans,
      labelKey: 'navigation.loans',
      icon: HandCoinsIcon,
      settingKey: 'loans',
      activeRouteNames: [ROUTES_NAMES.loanDetail],
    },
    {
      routeName: ROUTES_NAMES.investments,
      labelKey: 'navigation.investments',
      icon: TrendingUpIcon,
      settingKey: 'investments',
      activeRouteNames: [ROUTES_NAMES.portfolioDetail, ROUTES_NAMES.portfolioTransactionsImport],
    },
    {
      routeName: ROUTES_NAMES.venture,
      labelKey: 'navigation.venture',
      icon: RocketIcon,
      settingKey: 'venture',
      activeRouteNames: [ROUTES_NAMES.venturePlatformsList, ROUTES_NAMES.ventureDealDetail],
    },
  ],
  transactions: [
    { routeName: ROUTES_NAMES.transactions, labelKey: 'navigation.allTransactions', icon: CreditCardIcon },
    { routeName: ROUTES_NAMES.transactionGroups, labelKey: 'navigation.transactionGroups', icon: GroupIcon },
    {
      routeName: ROUTES_NAMES.optimizations,
      labelKey: 'navigation.optimizations',
      icon: WrenchIcon,
      activeRouteNames: [
        ROUTES_NAMES.optimizationsTransfers,
        ROUTES_NAMES.optimizationsAiCategorization,
        ROUTES_NAMES.optimizationsReconciliation,
      ],
    },
    {
      routeName: ROUTES_NAMES.automations,
      labelKey: 'navigation.automations',
      icon: ZapIcon,
      activeRouteNames: [ROUTES_NAMES.automationCreate, ROUTES_NAMES.automationDetails],
    },
  ],
  planned: [
    {
      routeName: ROUTES_NAMES.budget,
      labelKey: 'navigation.budget',
      icon: CalculatorIcon,
      activeRouteNames: [ROUTES_NAMES.budgetPlan],
    },
    {
      routeName: ROUTES_NAMES.goals,
      labelKey: 'navigation.planned.goals',
      icon: FlagIcon,
      activeRouteNames: [ROUTES_NAMES.goalDetails],
    },
    {
      routeName: ROUTES_NAMES.plannedTrackers,
      labelKey: 'navigation.planned.budgets',
      icon: TargetIcon,
      activeRouteNames: [ROUTES_NAMES.plannedTrackerDetails],
    },
    {
      routeName: ROUTES_NAMES.plannedSubscriptions,
      labelKey: 'navigation.planned.subscriptions',
      icon: RepeatIcon,
      activeRouteNames: [ROUTES_NAMES.plannedSubscriptionDetails],
    },
  ],
} satisfies Record<string, SidebarNavChild[]>;

const ACCOUNTS_NAV_CHILDREN: SidebarNavChild[] = SIDEBAR_NAV_CHILDREN.accounts;

export const TOGGLEABLE_ACCOUNTS_NAV_CHILDREN = ACCOUNTS_NAV_CHILDREN.filter(
  (child): child is ToggleableNavChild => !!child.settingKey,
);

export const useAccountsNavChildren = () => {
  const { data: userSettings } = useUserSettings();

  return computed(() =>
    ACCOUNTS_NAV_CHILDREN.filter(
      (child) => !child.settingKey || userSettings.value?.sidebarNav?.[child.settingKey] !== false,
    ),
  );
};
