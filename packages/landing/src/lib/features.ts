export const FEATURE_GROUPS = [
  {
    title: 'Track money',
    pages: [
      {
        label: 'Bank Sync',
        href: '/features/bank-sync',
        icon: 'landmark',
        summary: 'Get transactions and balances automatically through LunchFlow, SimpleFIN or Akahu.',
      },
      {
        label: 'Import Transactions',
        href: '/features/import-transactions',
        icon: 'download',
        summary: 'Bring your history from CSV, OFX, QFX, YNAB, Wallet, Microsoft Money or PDF statements.',
      },
      {
        label: 'Transaction Management',
        href: '/features/transaction-management',
        icon: 'list',
        summary: 'Search, filter, split and bulk edit transactions, and attach receipts to them.',
      },
      {
        label: 'Categories & Tags',
        href: '/features/categories-and-tags',
        icon: 'tag',
        summary: 'Your own categories and subcategories, plus tags for trips or projects that cut across them.',
      },
      {
        label: 'Payees',
        href: '/features/payees',
        icon: 'store',
        summary: 'See what you spend at each merchant, and merge messy bank names into one.',
      },
      {
        label: 'Automation Rules',
        href: '/features/automation-rules',
        icon: 'zap',
        summary: 'Set the category, tags, payee or note automatically when a transaction matches your conditions.',
      },
      {
        label: 'Subscription Tracker',
        href: '/features/subscription-tracker',
        icon: 'repeat',
        summary: 'Find recurring payments in your history, see what they cost, and get reminded before each charge.',
      },
      {
        label: 'Transfers & Refunds',
        href: '/features/transfers-and-refunds',
        icon: 'arrow-left-right',
        summary: 'Keep transfers out of your spending, and tie each refund to the purchase it returns.',
      },
      {
        label: 'Multi-Currency',
        href: '/features/multi-currency',
        icon: 'globe',
        summary:
          'Keep accounts in different currencies and see one total, with each transaction converted at the rate of its own date.',
      },
    ],
  },
  {
    title: 'Plan and analyze',
    pages: [
      {
        label: 'Budgeting',
        href: '/features/budgeting',
        icon: 'wallet',
        summary: 'Plan by category on your pay schedule, with rollover and goals.',
      },
      {
        label: 'Savings Goals',
        href: '/features/savings-goals',
        icon: 'target',
        summary: 'Split an account across goals and see your pace and finish date for each.',
      },
      {
        label: 'Spending Trackers',
        href: '/features/spending-trackers',
        icon: 'chart-column',
        summary: 'See what a trip, a renovation or any project costs against your limit.',
      },
      {
        label: 'Analytics & Reports',
        href: '/features/analytics-and-reports',
        icon: 'chart-pie',
        summary: 'Spending trends, cash flow, money flow and pivot tables, with no spreadsheet to build.',
      },
      {
        label: 'Dashboard',
        href: '/features/dashboard',
        icon: 'layout-dashboard',
        summary: 'Balances, spending and net worth on one page, with the widgets you choose.',
      },
      {
        label: 'Net Worth Tracker',
        href: '/features/net-worth-tracker',
        icon: 'trending-up',
        summary: 'See cash, investments, vehicles, venture deals and debts on one chart over time.',
      },
      {
        label: 'Investment Tracking',
        href: '/features/investment-tracking',
        icon: 'candlestick-chart',
        summary: 'Follow stocks, ETFs and crypto with cost basis, gains and dividends.',
      },
      {
        label: 'Loan Tracking',
        href: '/features/loan-tracking',
        icon: 'hand-coins',
        summary: 'See when a mortgage or other loan ends and how much interest is still to pay.',
      },
      {
        label: 'Vehicles & Ventures',
        href: '/features/vehicles-and-ventures',
        icon: 'car',
        summary: 'Follow what your car is worth and how your venture deals perform, both counted in your net worth.',
      },
      {
        label: 'FIRE Planner',
        href: '/features/fire-planner',
        icon: 'flame',
        summary: 'See when you could retire early, based on what you actually spend and save.',
      },
    ],
  },
  {
    title: 'AI, sharing and your data',
    pages: [
      {
        label: 'AI Assistants (MCP)',
        href: '/features/mcp-ai-assistants',
        icon: 'bot',
        summary:
          'Ask Claude or ChatGPT about your money through a built-in MCP server, and choose what they may change.',
      },
      {
        label: 'AI Categorization',
        href: '/features/ai-categorization',
        icon: 'sparkles',
        summary: 'AI sorts transactions into your own categories, using the included AI or your own model.',
      },
      {
        label: 'Family Sharing',
        href: '/features/family-sharing',
        icon: 'users',
        summary: "Share one account, a tracker or all your accounts, and set each person's access.",
      },
      {
        label: 'Self-Hosting',
        href: '/features/self-hosting',
        icon: 'server',
        summary: 'Run the whole app on your own server with Docker Compose, for free.',
      },
      {
        label: 'Security & Privacy',
        href: '/features/security-and-privacy',
        icon: 'shield-check',
        summary: 'No ads or data sales, encrypted bank credentials, and control over your logins and sessions.',
      },
      {
        label: 'Export & Backup',
        href: '/features/export-and-backup',
        icon: 'hard-drive-download',
        summary: 'Take your data out as CSV, Excel or JSON, or as a full backup you can restore.',
      },
    ],
  },
];

export const FEATURE_PAGES = FEATURE_GROUPS.flatMap((group) => group.pages);

export const getFeaturePage = ({ slug, href = `/features/${slug}` }: { slug?: string; href?: string }) => {
  const page = FEATURE_PAGES.find((p) => p.href === href);
  if (!page) throw new Error(`Unknown feature page: ${href}`);
  return page;
};
