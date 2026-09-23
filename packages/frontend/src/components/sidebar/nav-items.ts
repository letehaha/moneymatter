import type { SidebarNavConfig } from '@/api/user-settings';
import { useUserSettings } from '@/composable/data-queries/user-settings';
import { ROUTES_NAMES } from '@/routes/constants';
import {
  CreditCardIcon,
  GroupIcon,
  HandCoinsIcon,
  RepeatIcon,
  RocketIcon,
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
}

type ToggleableNavChild = SidebarNavChild & { settingKey: keyof SidebarNavConfig };

/** Top-level, ungrouped nav entry for the budget plan screen. */
export const SIDEBAR_BUDGET_NAV_ITEM: SidebarNavChild = {
  routeName: ROUTES_NAMES.budget,
  labelKey: 'navigation.budget',
  icon: WalletIcon,
};

/** Sub-links of the collapsible nav groups, rendered by both the full nav and the rail flyouts. */
export const SIDEBAR_NAV_CHILDREN = {
  accounts: [
    { routeName: ROUTES_NAMES.accounts, labelKey: 'navigation.accountsList', icon: WalletIcon },
    { routeName: ROUTES_NAMES.loans, labelKey: 'navigation.loans', icon: HandCoinsIcon, settingKey: 'loans' },
    {
      routeName: ROUTES_NAMES.investments,
      labelKey: 'navigation.investments',
      icon: TrendingUpIcon,
      settingKey: 'investments',
    },
    { routeName: ROUTES_NAMES.venture, labelKey: 'navigation.venture', icon: RocketIcon, settingKey: 'venture' },
  ],
  transactions: [
    { routeName: ROUTES_NAMES.transactions, labelKey: 'navigation.allTransactions', icon: CreditCardIcon },
    { routeName: ROUTES_NAMES.transactionGroups, labelKey: 'navigation.transactionGroups', icon: GroupIcon },
    { routeName: ROUTES_NAMES.optimizations, labelKey: 'navigation.optimizations', icon: WrenchIcon },
    { routeName: ROUTES_NAMES.automations, labelKey: 'navigation.automations', icon: ZapIcon },
  ],
  planned: [
    { routeName: ROUTES_NAMES.plannedSubscriptions, labelKey: 'navigation.planned.subscriptions', icon: RepeatIcon },
    { routeName: ROUTES_NAMES.plannedBudgets, labelKey: 'navigation.planned.budgets', icon: WalletIcon },
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
