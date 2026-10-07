/**
 * Cache duration constants for Vue Query staleTime and gcTime.
 * Financial data doesn't change frequently, so longer cache times are appropriate.
 */
export const QUERY_CACHE_STALE_TIME = {
  /** 5 minutes - for data that changes infrequently (analytics, stats) */
  ANALYTICS: 5 * 60 * 1000,
} as const;

export const VUE_QUERY_GLOBAL_PREFIXES = Object.freeze({
  // This query might be added to other queries so that on transcation create/edit
  // we can call for invalidating all the queries that include that particular one
  transactionChange: 'global-query-tx-change',

  // When security price is changed, dashboard and many security-related hooks should
  // be invalidated
  securityPriceChange: 'global-query-security-price-change',

  // When bank connection changes (link/unlink/disconnect), all bank connection related
  // queries should be invalidated
  bankConnectionChange: 'global-query-bank-connection-change',

  // When venture deals/events change, combined-balance-history (and other
  // venture-aware queries) need to refresh.
  ventureChange: 'global-query-venture-change',

  currencies: 'currencies',

  notifications: 'notifications',
});

const { transactionChange, securityPriceChange, bankConnectionChange, ventureChange, notifications } =
  VUE_QUERY_GLOBAL_PREFIXES;

export const VUE_QUERY_CACHE_KEYS = Object.freeze({
  // auth
  signupsOpen: ['signups-open'] as const,
  // currencies
  allCurrencies: [VUE_QUERY_GLOBAL_PREFIXES.currencies, 'all'] as const,
  userCurrencies: [VUE_QUERY_GLOBAL_PREFIXES.currencies, 'user'] as const,
  baseCurrency: [VUE_QUERY_GLOBAL_PREFIXES.currencies, 'base'] as const,
  // append the yyyy-MM-dd date when using
  exchangeRatesForDate: [VUE_QUERY_GLOBAL_PREFIXES.currencies, 'rates-for-date'] as const,
  // append from, to, and the yyyy-MM-dd date when using
  exchangeRatePair: [VUE_QUERY_GLOBAL_PREFIXES.currencies, 'rate-pair'] as const,

  // widget balance trend
  widgetBalanceTrend: [transactionChange, securityPriceChange, ventureChange, 'widget-balance-trend'] as const,
  widgetBalanceTrendPrev: [transactionChange, securityPriceChange, ventureChange, 'widget-balance-trend-prev'] as const,
  widgetBalanceTrendPlanned: [transactionChange, 'widget-balance-trend-planned'] as const,
  widgetBalanceTotalBalance: [
    transactionChange,
    securityPriceChange,
    ventureChange,
    'widget-balance-total-balance',
  ] as const,
  widgetBalancePreviousBalance: [
    transactionChange,
    securityPriceChange,
    ventureChange,
    'widget-balance-previous-balance',
  ] as const,

  // widget expenses structure
  widgetExpensesStructureTotal: [transactionChange, 'widget-expenses-structure-total'] as const,
  widgetExpensesStructureCurrentAmount: [transactionChange, 'widget-expenses-structure-current-amount'] as const,
  widgetExpensesStructurePrevAmount: [transactionChange, 'widget-expenses-structure-prev-amount'] as const,

  // widget latest records
  widgetLatestRecords: [transactionChange, 'widget-latest-records'] as const,

  // planned transactions
  plannedSummary: [transactionChange, 'planned-summary'] as const,
  pendingPlannedTransactions: [transactionChange, 'pending-planned-transactions'] as const,

  // widget category spending tracker
  widgetCategorySpendingTracker: [transactionChange, 'widget-category-spending-tracker'] as const,

  // widget cash flow
  widgetCashFlow: [transactionChange, 'widget-cash-flow'] as const,
  widgetCashFlowPrev: [transactionChange, 'widget-cash-flow-prev'] as const,
  widgetCashFlowTrend: [transactionChange, 'widget-cash-flow-trend'] as const,
  widgetTaxes: [transactionChange, 'widget-taxes'] as const,

  // widget net worth
  widgetNetWorth: [transactionChange, securityPriceChange, ventureChange, 'widget-net-worth'] as const,

  // analytics
  analyticsBalanceHistoryTrend: [
    transactionChange,
    securityPriceChange,
    ventureChange,
    'analytics-balance-history-trend',
  ] as const,
  analyticsCashFlow: [transactionChange, 'analytics-cash-flow'] as const,
  // End-of-bucket balance snapshots: security prices and venture valuations move
  // the series without any transaction changing, so all three prefixes invalidate it.
  analyticsNetWorthHistory: [
    transactionChange,
    securityPriceChange,
    ventureChange,
    'analytics-net-worth-history',
  ] as const,
  // Depends on security prices as well as transactions: a price move changes the
  // report's growth series without any transaction being touched.
  analyticsNetWorthDrivers: [transactionChange, securityPriceChange, 'analytics-net-worth-drivers'] as const,
  // Depends on portfolio transfers (which portfolio cash moved in) and on savings
  // transactions — both invalidated through the transaction-change prefix. Security
  // prices never enter this report, so it carries no price prefix.
  analyticsInvestmentContributions: [transactionChange, 'analytics-investment-contributions'] as const,
  analyticsVentureContributions: [transactionChange, 'analytics-venture-contributions'] as const,
  analyticsPivotReport: [transactionChange, 'analytics-pivot-report'] as const,
  fireNetWorthHistory: [transactionChange, securityPriceChange, ventureChange, 'fire-net-worth-history'] as const,
  fireCashFlow: [transactionChange, 'fire-cash-flow'] as const,
  fireVentureContributions: [transactionChange, ventureChange, 'fire-venture-contributions'] as const,
  analyticsCumulative: [transactionChange, 'analytics-cumulative'] as const,
  analyticsSpendingsByCategories: [transactionChange, 'analytics-spendings-by-categories'] as const,
  earliestTransactionDate: [transactionChange, 'earliest-transaction-date'] as const,

  recordsPageRecordsList: [transactionChange, 'records-page-records-list'] as const,

  transactionAttachments: ['transaction-attachments'] as const,

  recordsPageTransactionList: [transactionChange, 'records-page'] as const,

  accountSpecificTransactions: [transactionChange, 'account-transactions'] as const,

  accountTransactionCount: [transactionChange, 'account-transaction-count'] as const,

  allAccounts: [transactionChange, securityPriceChange, 'all-accounts'] as const,

  accountGroupForAccount: ['account-group-for-account'] as const,

  exchangeRates: ['exchange-rates'] as const,
  accountGroups: [transactionChange, 'account-groups'] as const,

  budgetsList: ['budgets-list'] as const,
  budgetsListItem: ['budgets-list-item'] as const,
  budgetTransactionList: [transactionChange, 'budget-transaction-list'] as const,
  budgetAddingTransactionList: [transactionChange, 'budget-adding-transaction-list'] as const,
  budgetStats: [transactionChange, 'budget-stats'] as const,
  budgetSpendingStats: [transactionChange, 'budget-spending-stats'] as const,
  budgetCategoryTransactions: [transactionChange, 'budget-category-transactions'] as const,

  /**
   * Investments
   */

  // portfolios
  portfoliosList: [securityPriceChange, 'portfolios'] as const,
  portfoliosTrashList: [securityPriceChange, 'portfolios-trash'] as const,
  portfolioDetails: [securityPriceChange, 'portfolio-details'] as const,
  portfolioTransfers: [securityPriceChange, 'portfolio-transfers'] as const,
  portfolioSummary: [securityPriceChange, 'portfolio-summary'] as const,
  // Must stay nested under portfolioSummary: invalidating that prefix is what refetches the batch.
  portfolioSummaries: [securityPriceChange, 'portfolio-summary', 'all'] as const,
  portfolioAnnualizedReturns: [securityPriceChange, 'portfolio-annualized-returns'] as const,
  portfolioBalances: [securityPriceChange, 'portfolio-balances'] as const,
  transactionPortfolioLink: [transactionChange, 'transaction-portfolio-link'] as const,

  portfolioInvestmentTransactions: [securityPriceChange, 'portfolio-investment-transactions'] as const,

  // holdings
  holdingsList: [securityPriceChange, 'holdings'] as const,
  holdingTransactions: [securityPriceChange, 'holding-transactions'] as const,

  // transactions import (AI-parsed)
  investmentImportSecuritySearch: ['investment-import', 'security-search'] as const,

  // bank integrations
  bankProviders: [bankConnectionChange, 'bank-providers'] as const,
  bankConnectionDetails: [bankConnectionChange, 'bank-connection-details'] as const,
  bankAvailableExternalAccounts: [bankConnectionChange, 'bank-available-external-accounts'] as const,
  bankConnections: [bankConnectionChange, 'bank-connections'] as const,
  // Shared sync status (header spinner, sidebar reauth badges, per-account status).
  // One cache entry so all consumers dedupe to a single request; SSE pushes updates.
  bankSyncStatus: [bankConnectionChange, 'bank-sync-status'] as const,

  // notifications
  notificationsList: [notifications, 'notifications-list'] as const,
  notificationsUnreadCount: [notifications, 'notifications-unread-count'] as const,

  // subscriptions
  subscriptionsList: [transactionChange, 'subscriptions-list'] as const,
  subscriptionDetails: [transactionChange, 'subscription-details'] as const,
  subscriptionsSummary: [transactionChange, 'subscriptions-summary'] as const,
  recordsUpcomingPayments: [transactionChange, 'records-upcoming-payments'] as const,
  subscriptionCandidates: ['subscription-candidates'] as const,

  // transaction automations
  // transactionChange prefix so matchCount/lastMatchedAt refresh after a sync or import.
  transactionAutomationsList: [transactionChange, 'transaction-automations-list'] as const,

  // transaction groups
  transactionGroupsList: [transactionChange, 'transaction-groups-list'] as const,
  transactionGroupDetail: [transactionChange, 'transaction-group-detail'] as const,

  // optimizations
  bulkTransferScan: [transactionChange, 'bulk-transfer-scan'] as const,

  // vehicles
  vehiclesList: [transactionChange, 'vehicles-list'] as const,
  vehicleDetail: [transactionChange, 'vehicle-detail'] as const,
  vehicleOverrideHistory: [transactionChange, 'vehicle-override-history'] as const,

  // transaction templates
  // No transactionChange prefix: creating or editing a transaction never changes a template.
  transactionTemplatesList: ['transaction-templates-list'] as const,

  // loans
  loansList: [transactionChange, 'loans-list'] as const,
  loanDetail: [transactionChange, 'loan-detail'] as const,
  loanRecentPayments: [transactionChange, 'loan-recent-payments'] as const,
  loanAllPayments: [transactionChange, 'loan-all-payments'] as const,
  loanBalanceHistory: [transactionChange, 'loan-balance-history'] as const,

  // user settings
  userSettings: ['user-settings'] as const,

  // MCP connected apps
  mcpConnectedApps: ['mcp-connected-apps'] as const,

  // AI settings
  aiFeaturesStatus: ['ai-settings', 'features'] as const,
  aiCustomInstructions: ['ai-settings', 'custom-instructions'] as const,
  aiConnections: ['ai-settings', 'connections'] as const,
  aiConnectionModels: ['ai-settings', 'connection-models'] as const,

  // A finished categorization run rewrites categories, so the transactionChange
  // invalidation refreshes the candidate list and its total.
  aiCategorizationCandidates: [transactionChange, 'ai-categorization-candidates'] as const,
  aiCategorizationHistory: [transactionChange, 'ai-categorization-history'] as const,
  // Callers append the run's `categorizedAt` stamp, so each run caches separately.
  aiCategorizationRunTransactions: [transactionChange, 'ai-categorization-run-transactions'] as const,

  reconciliationStuckPending: [transactionChange, 'reconciliation-stuck-pending'] as const,
  reconciliationHistory: [transactionChange, 'reconciliation-history'] as const,

  // A completed import creates transactions, so the transactionChange invalidation
  // refreshes the batch list alongside everything else it creates/moves.
  importBatchesHistory: [transactionChange, 'import-batches-history'] as const,

  // sharing
  shareInvitationsSent: ['share', 'invitations-sent'] as const,
  shareInvitationsReceived: ['share', 'invitations-received'] as const,
  shareMembers: ['share', 'members'] as const,
  sharedWithMe: ['share', 'shared-with-me'] as const,

  // categories
  // Full accessible-categories list (own + every category on an account the caller can
  // read). Backs the categories Pinia store; kept separate from the per-account key.
  categoriesList: ['categories-list'] as const,
  categoriesByAccount: ['categories-by-account'] as const,

  // payees
  payeesList: ['payees-list'] as const,
  payeesLookup: ['payees-lookup'] as const,
  payeesByAccount: ['payees-by-account'] as const,
  payeeById: ['payee-by-id'] as const,
  payeesIgnoredNames: ['payees-ignored-names'] as const,
  payeeTransactionsDialog: [transactionChange, 'payee-tx-dialog'] as const,

  // brand logos – shared by payee + subscription logo pickers.
  // append the search term when using
  brandLogoSearch: ['brand-logo-search'] as const,

  // append the restore jobId when using
  backupRestoreStatus: ['backup-restore-status'] as const,

  // venture
  venturePlatformsList: [ventureChange, 'venture-platforms-list'] as const,
  ventureDealsList: [ventureChange, 'venture-deals-list'] as const,
  ventureDealDetails: [ventureChange, 'venture-deal-details'] as const,
  ventureDealMetrics: [ventureChange, 'venture-deal-metrics'] as const,
  ventureDealEvents: [ventureChange, 'venture-deal-events'] as const,
});
