export const PORTFOLIO_TABS = {
  holdings: 'holdings',
  analytics: 'analytics',
  activity: 'activity',
  watchlist: 'watchlist',
} as const;
export type PortfolioTab = (typeof PORTFOLIO_TABS)[keyof typeof PORTFOLIO_TABS];

const TAB_ORDER: PortfolioTab[] = [
  PORTFOLIO_TABS.holdings,
  PORTFOLIO_TABS.analytics,
  PORTFOLIO_TABS.activity,
  PORTFOLIO_TABS.watchlist,
];

/** Tabs the plan covers lead; locked ones move to the end so the user lands on what they can use. */
export const orderPortfolioTabs = ({ isLocked }: { isLocked: (tab: PortfolioTab) => boolean }): PortfolioTab[] => [
  ...TAB_ORDER.filter((tab) => !isLocked(tab)),
  ...TAB_ORDER.filter((tab) => isLocked(tab)),
];

const LEGACY_TAB_ALIASES = new Map<unknown, PortfolioTab>([['cash', PORTFOLIO_TABS.activity]]);

export const parsePortfolioTab = ({ value }: { value: unknown }): PortfolioTab =>
  LEGACY_TAB_ALIASES.get(value) ?? TAB_ORDER.find((tab) => tab === value) ?? PORTFOLIO_TABS.holdings;
