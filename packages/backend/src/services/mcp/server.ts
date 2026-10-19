import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import {
  FINANCIAL_DATA_GUIDE_CONTENT,
  FINANCIAL_DATA_GUIDE_DESCRIPTION,
  FINANCIAL_DATA_GUIDE_NAME,
} from './prompts/financial-data-guide';
import { slimToolListing } from './tool-list-slimming';
import { registerAcceptSubscriptionCandidate } from './tools/accept-subscription-candidate';
import { registerAcceptTrackerSuggestions } from './tools/accept-tracker-suggestions';
import { registerAddAccountToGroup } from './tools/add-account-to-group';
import { registerAddLoanNote } from './tools/add-loan-note';
import { registerAddSuggestedBudgetPlanLines } from './tools/add-suggested-budget-plan-lines';
import { registerAddTransactionsToGroup } from './tools/add-transactions-to-group';
import { registerAddTransactionsToTracker } from './tools/add-transactions-to-tracker';
import { registerAddUserCurrencies } from './tools/add-user-currencies';
import { registerAdjustAccountBalance } from './tools/adjust-account-balance';
import { registerApplyPayeeTagsToTransactions } from './tools/apply-payee-tags-to-transactions';
import { registerApplyTransactionAutomation } from './tools/apply-transaction-automation';
import { registerArchiveAccount } from './tools/archive-account';
import { registerArchiveBudgetPlanLine } from './tools/archive-budget-plan-line';
import { registerArchiveTracker } from './tools/archive-tracker';
import { registerAssignTagsToTransaction } from './tools/assign-tags-to-transaction';
import { registerBulkDeletePayees } from './tools/bulk-delete-payees';
import { registerBulkDeleteTransactions } from './tools/bulk-delete-transactions';
import { registerBulkUpdateTransactions } from './tools/bulk-update-transactions';
import { registerChangeBaseCurrency } from './tools/change-base-currency';
import { registerConfirmPlannedTransaction } from './tools/confirm-planned-transaction';
import { registerCreateAccount } from './tools/create-account';
import { registerCreateAccountGroup } from './tools/create-account-group';
import { registerCreateAttachmentUploadUrl } from './tools/create-attachment-upload-url';
import { registerCreateBudgetPlan } from './tools/create-budget-plan';
import { registerCreateBudgetPlanGroup } from './tools/create-budget-plan-group';
import { registerCreateBudgetPlanLine } from './tools/create-budget-plan-line';
import { registerCreateCategory } from './tools/create-category';
import { registerCreateCustomCurrency } from './tools/create-custom-currency';
import { registerCreateHolding } from './tools/create-holding';
import { registerCreateInvestmentTransaction } from './tools/create-investment-transaction';
import { registerCreateLoan } from './tools/create-loan';
import { registerCreatePayee } from './tools/create-payee';
import { registerCreatePayeeAlias } from './tools/create-payee-alias';
import { registerCreatePortfolio } from './tools/create-portfolio';
import { registerCreatePortfolioCashTransaction } from './tools/create-portfolio-cash-transaction';
import { registerCreateSubscription } from './tools/create-subscription';
import { registerCreateTag } from './tools/create-tag';
import { registerCreateTagReminder } from './tools/create-tag-reminder';
import { registerCreateTracker } from './tools/create-tracker';
import { registerCreateTrackerLine } from './tools/create-tracker-line';
import { registerCreateTransaction } from './tools/create-transaction';
import { registerCreateTransactionAutomation } from './tools/create-transaction-automation';
import { registerCreateTransactionGroup } from './tools/create-transaction-group';
import { registerCreateTransactionTemplate } from './tools/create-transaction-template';
import { registerCreateVehicle } from './tools/create-vehicle';
import { registerDeleteAccount } from './tools/delete-account';
import { registerDeleteAccountGroup } from './tools/delete-account-group';
import { registerDeleteAttachment } from './tools/delete-attachment';
import { registerDeleteBudgetPlan } from './tools/delete-budget-plan';
import { registerDeleteBudgetPlanGroup } from './tools/delete-budget-plan-group';
import { registerDeleteBudgetPlanLine } from './tools/delete-budget-plan-line';
import { registerDeleteBudgetPlanLineGoal } from './tools/delete-budget-plan-line-goal';
import { registerDeleteCategory } from './tools/delete-category';
import { registerDeleteCustomCurrency } from './tools/delete-custom-currency';
import { registerDeleteExchangeRates } from './tools/delete-exchange-rates';
import { registerDeleteHolding } from './tools/delete-holding';
import { registerDeleteImportBatch } from './tools/delete-import-batch';
import { registerDeleteInvestmentTransaction } from './tools/delete-investment-transaction';
import { registerDeleteLoan } from './tools/delete-loan';
import { registerDeletePayee } from './tools/delete-payee';
import { registerDeletePayeeAlias } from './tools/delete-payee-alias';
import { registerDeletePortfolio } from './tools/delete-portfolio';
import { registerDeletePortfolioTransfer } from './tools/delete-portfolio-transfer';
import { registerDeleteSplit } from './tools/delete-split';
import { registerDeleteSubscription } from './tools/delete-subscription';
import { registerDeleteTag } from './tools/delete-tag';
import { registerDeleteTagReminder } from './tools/delete-tag-reminder';
import { registerDeleteTracker } from './tools/delete-tracker';
import { registerDeleteTrackerLine } from './tools/delete-tracker-line';
import { registerDeleteTransaction } from './tools/delete-transaction';
import { registerDeleteTransactionAutomation } from './tools/delete-transaction-automation';
import { registerDeleteTransactionGroup } from './tools/delete-transaction-group';
import { registerDeleteTransactionTemplate } from './tools/delete-transaction-template';
import { registerDeleteUserCurrency } from './tools/delete-user-currency';
import { registerDeleteVehicle } from './tools/delete-vehicle';
import { registerDeleteVentureEventLink } from './tools/delete-venture-event-link';
import { registerDetectSubscriptionCandidates } from './tools/detect-subscription-candidates';
import { registerDismissNotification } from './tools/dismiss-notification';
import { registerDismissSubscriptionCandidate } from './tools/dismiss-subscription-candidate';
import { registerDismissTransferSuggestion } from './tools/dismiss-transfer-suggestion';
import { registerExchangePortfolioCurrency } from './tools/exchange-portfolio-currency';
import { registerGetAccount } from './tools/get-account';
import { registerGetAccountGroups } from './tools/get-account-groups';
import { registerGetAccounts } from './tools/get-accounts';
import { registerGetBalanceHistory } from './tools/get-balance-history';
import { registerGetBankSyncStatus } from './tools/get-bank-sync-status';
import { registerGetBaseCurrencyChangeStatus } from './tools/get-base-currency-change-status';
import { registerGetBudgetPlanPeriod } from './tools/get-budget-plan-period';
import { registerGetBudgetPlanScheduled } from './tools/get-budget-plan-scheduled';
import { registerGetBudgetPlanSuggestionContext } from './tools/get-budget-plan-suggestion-context';
import { registerGetBudgetPlanTrends } from './tools/get-budget-plan-trends';
import { registerGetCashFlow } from './tools/get-cash-flow';
import { registerGetCategories } from './tools/get-categories';
import { registerGetCategoryTransactionCount } from './tools/get-category-transaction-count';
import { registerGetCumulativeStats } from './tools/get-cumulative-stats';
import { registerGetCurrencyRateHistory } from './tools/get-currency-rate-history';
import { registerGetEarliestTransactionDate } from './tools/get-earliest-transaction-date';
import { registerGetExchangeRate } from './tools/get-exchange-rate';
import { registerGetExpensesForPeriod } from './tools/get-expenses-for-period';
import { registerGetIgnoredPayeeNames } from './tools/get-ignored-payee-names';
import { registerGetImportBatchDeleteStatus } from './tools/get-import-batch-delete-status';
import { registerGetInvestmentContributions } from './tools/get-investment-contributions';
import { registerGetInvestmentTransactions } from './tools/get-investment-transactions';
import { registerGetLoanBalanceHistory } from './tools/get-loan-balance-history';
import { registerGetLoans } from './tools/get-loans';
import { registerGetNetWorthDrivers } from './tools/get-net-worth-drivers';
import { registerGetNetWorthHistory } from './tools/get-net-worth-history';
import { registerGetNotifications } from './tools/get-notifications';
import { registerGetPayee } from './tools/get-payee';
import { registerGetPayees } from './tools/get-payees';
import { registerGetPivotReport } from './tools/get-pivot-report';
import { registerGetPlannedSummary } from './tools/get-planned-summary';
import { registerGetPortfolio } from './tools/get-portfolio';
import { registerGetPortfolioBalances } from './tools/get-portfolio-balances';
import { registerGetPortfolioHoldings } from './tools/get-portfolio-holdings';
import { registerGetPortfolioSummary } from './tools/get-portfolio-summary';
import { registerGetPortfolios } from './tools/get-portfolios';
import { registerGetPortfoliosOverview } from './tools/get-portfolios-overview';
import { registerGetReconciliationHistory } from './tools/get-reconciliation-history';
import { registerGetRefundRecommendations } from './tools/get-refund-recommendations';
import { registerGetRefunds } from './tools/get-refunds';
import { registerGetSecurityPrices } from './tools/get-security-prices';
import { registerGetSpendingByCategories } from './tools/get-spending-by-categories';
import { registerGetSubscriptionById } from './tools/get-subscription-by-id';
import { registerGetSubscriptionPeriods } from './tools/get-subscription-periods';
import { registerGetSubscriptions } from './tools/get-subscriptions';
import { registerGetSubscriptionsSummary } from './tools/get-subscriptions-summary';
import { registerGetTagReminders } from './tools/get-tag-reminders';
import { registerGetTags } from './tools/get-tags';
import { registerGetTotalBalance } from './tools/get-total-balance';
import { registerGetTracker } from './tools/get-tracker';
import { registerGetTrackerSpendingStats } from './tools/get-tracker-spending-stats';
import { registerGetTrackerTransactions } from './tools/get-tracker-transactions';
import { registerGetTrackers } from './tools/get-trackers';
import { registerGetTransactionAutomations } from './tools/get-transaction-automations';
import { registerGetTransactionGroups } from './tools/get-transaction-groups';
import { registerGetTransactionLinks } from './tools/get-transaction-links';
import { registerGetTransactionTemplates } from './tools/get-transaction-templates';
import { registerGetTransactions } from './tools/get-transactions';
import { registerGetTransactionsSummary } from './tools/get-transactions-summary';
import { registerGetTransferRecommendations } from './tools/get-transfer-recommendations';
import { registerGetUpcomingSubscriptionPayments } from './tools/get-upcoming-subscription-payments';
import { registerGetUserCurrencies } from './tools/get-user-currencies';
import { registerGetUserProfile } from './tools/get-user-profile';
import { registerGetUserSettings } from './tools/get-user-settings';
import { registerGetVehicles } from './tools/get-vehicles';
import { registerGetVentureContributions } from './tools/get-venture-contributions';
import { registerIgnorePayeeName } from './tools/ignore-payee-name';
import { registerKeepPendingAsBooked } from './tools/keep-pending-as-booked';
import { registerLinkLoanPayments } from './tools/link-loan-payments';
import { registerLinkRefund } from './tools/link-refund';
import { registerLinkTransactionToPortfolio } from './tools/link-transaction-to-portfolio';
import { registerLinkTransactionsToSubscription } from './tools/link-transactions-to-subscription';
import { registerLinkTransactionsToVentureEvent } from './tools/link-transactions-to-venture-event';
import { registerLinkTransfer } from './tools/link-transfer';
import { registerListBankConnections } from './tools/list-bank-connections';
import { registerListBudgetPlanPeriods } from './tools/list-budget-plan-periods';
import { registerListBudgetPlans } from './tools/list-budget-plans';
import { registerListCustomCurrencies } from './tools/list-custom-currencies';
import { registerListImportBatches } from './tools/list-import-batches';
import { registerListPortfolioTransfers } from './tools/list-portfolio-transfers';
import { registerListShareInvitations } from './tools/list-share-invitations';
import { registerListShareMembers } from './tools/list-share-members';
import { registerListSharedWithMe } from './tools/list-shared-with-me';
import { registerListStuckPendingTransactions } from './tools/list-stuck-pending-transactions';
import { registerListSubscriptionCandidates } from './tools/list-subscription-candidates';
import { registerListSubscriptionMatchSuggestions } from './tools/list-subscription-match-suggestions';
import { registerListSupportedCurrencies } from './tools/list-supported-currencies';
import { registerListTrackerSuggestions } from './tools/list-tracker-suggestions';
import { registerListTransactionAttachments } from './tools/list-transaction-attachments';
import { registerListTransferSuggestions } from './tools/list-transfer-suggestions';
import { registerMarkNotificationsRead } from './tools/mark-notifications-read';
import { registerMergeDuplicateTransactions } from './tools/merge-duplicate-transactions';
import { registerMergePayees } from './tools/merge-payees';
import { registerMoveAccountGroup } from './tools/move-account-group';
import { registerPaySubscriptionPeriod } from './tools/pay-subscription-period';
import { registerPreviewSubscriptionPayment } from './tools/preview-subscription-payment';
import { registerPreviewTransactionAutomation } from './tools/preview-transaction-automation';
import { registerRejectTrackerSuggestions } from './tools/reject-tracker-suggestions';
import { registerRemoveAccountsFromGroup } from './tools/remove-accounts-from-group';
import { registerRemoveDuplicateTransactions } from './tools/remove-duplicate-transactions';
import { registerRemoveTagsFromTransaction } from './tools/remove-tags-from-transaction';
import { registerRemoveTransactionsFromGroup } from './tools/remove-transactions-from-group';
import { registerRemoveTransactionsFromTracker } from './tools/remove-transactions-from-tracker';
import { registerReorderTransactionAutomations } from './tools/reorder-transaction-automations';
import { registerReplaceVentureEventLinks } from './tools/replace-venture-event-links';
import { registerRestoreBudgetPlan } from './tools/restore-budget-plan';
import { registerRestorePortfolio } from './tools/restore-portfolio';
import { registerRestoreRemovedTransactions } from './tools/restore-removed-transactions';
import { registerRevertSubscriptionPeriod } from './tools/revert-subscription-period';
import { registerSearchCoingeckoCoins } from './tools/search-coingecko-coins';
import { registerSearchSecurities } from './tools/search-securities';
import { registerSearchTransactions } from './tools/search-transactions';
import { registerSetBudgetPlanAccounts } from './tools/set-budget-plan-accounts';
import { registerSetBudgetPlanAssignment } from './tools/set-budget-plan-assignment';
import { registerSetBudgetPlanLayout } from './tools/set-budget-plan-layout';
import { registerSetBudgetPlanLineGoal } from './tools/set-budget-plan-line-goal';
import { registerSetCurrencyRateSource } from './tools/set-currency-rate-source';
import { registerSetExchangeRates } from './tools/set-exchange-rates';
import { registerSetPayeesCategorizationMode } from './tools/set-payees-categorization-mode';
import { registerSetPortfolioTransferAdjustment } from './tools/set-portfolio-transfer-adjustment';
import { registerSkipSubscriptionPeriod } from './tools/skip-subscription-period';
import { registerSnoozeBudgetPlanLineGoal } from './tools/snooze-budget-plan-line-goal';
import { registerSplitTransaction } from './tools/split-transaction';
import { registerTestCurrencyRateSource } from './tools/test-currency-rate-source';
import { registerToggleSubscriptionActive } from './tools/toggle-subscription-active';
import { registerTransferAccountToPortfolio } from './tools/transfer-account-to-portfolio';
import { registerTransferBetweenPortfolios } from './tools/transfer-between-portfolios';
import { registerTransferPortfolioToAccount } from './tools/transfer-portfolio-to-account';
import { registerUnignorePayeeName } from './tools/unignore-payee-name';
import { registerUnlinkAccountFromBankConnection } from './tools/unlink-account-from-bank-connection';
import { registerUnlinkLoanPayment } from './tools/unlink-loan-payment';
import { registerUnlinkRefund } from './tools/unlink-refund';
import { registerUnlinkSubscriptionPeriodTransaction } from './tools/unlink-subscription-period-transaction';
import { registerUnlinkTransactionFromPortfolio } from './tools/unlink-transaction-from-portfolio';
import { registerUnlinkTransactionsFromSubscription } from './tools/unlink-transactions-from-subscription';
import { registerUnlinkTransfer } from './tools/unlink-transfer';
import { registerUpdateAccount } from './tools/update-account';
import { registerUpdateAccountGroup } from './tools/update-account-group';
import { registerUpdateBudgetPlan } from './tools/update-budget-plan';
import { registerUpdateBudgetPlanGroup } from './tools/update-budget-plan-group';
import { registerUpdateBudgetPlanLine } from './tools/update-budget-plan-line';
import { registerUpdateCategory } from './tools/update-category';
import { registerUpdateCustomCurrency } from './tools/update-custom-currency';
import { registerUpdateInvestmentTransaction } from './tools/update-investment-transaction';
import { registerUpdateLoan } from './tools/update-loan';
import { registerUpdatePayee } from './tools/update-payee';
import { registerUpdatePortfolio } from './tools/update-portfolio';
import { registerUpdateSubscription } from './tools/update-subscription';
import { registerUpdateTag } from './tools/update-tag';
import { registerUpdateTagReminder } from './tools/update-tag-reminder';
import { registerUpdateTracker } from './tools/update-tracker';
import { registerUpdateTrackerLine } from './tools/update-tracker-line';
import { registerUpdateTransaction } from './tools/update-transaction';
import { registerUpdateTransactionAutomation } from './tools/update-transaction-automation';
import { registerUpdateTransactionGroup } from './tools/update-transaction-group';
import { registerUpdateTransactionTemplate } from './tools/update-transaction-template';
import { registerUpdateUserCurrency } from './tools/update-user-currency';
import { registerUpdateUserSettings } from './tools/update-user-settings';
import { registerUpdateVehicle } from './tools/update-vehicle';
import {
  registerCreateVentureDeal,
  registerCreateVentureEvent,
  registerCreateVenturePlatform,
  registerDeleteVentureDeal,
  registerDeleteVentureEvent,
  registerDeleteVenturePlatform,
  registerGetVentureDeal,
  registerGetVentureDealMetrics,
  registerGetVentureEvent,
  registerGetVenturePlatform,
  registerListVentureDeals,
  registerListVentureEvents,
  registerListVenturePlatforms,
  registerUpdateVentureDeal,
  registerUpdateVentureEvent,
  registerUpdateVenturePlatform,
} from './tools/venture-tools';

/**
 * Creates a new MCP server instance with all tools and prompts registered.
 * Each MCP session gets its own server instance.
 *
 * When adding, removing, or renaming tools / prompts, also update:
 *   packages/frontend/public/.well-known/mcp/server-card.json
 * The drift test at ./server-card-drift.unit.ts will fail otherwise.
 */
export function createMcpServer(): McpServer {
  const server = new McpServer(
    {
      name: 'MoneyMatter Finance Tracker',
      version: '2.0.0',
    },
    {
      capabilities: {
        logging: {},
      },
    },
  );
  slimToolListing({ server });

  // Register the financial data guide prompt
  server.prompt(FINANCIAL_DATA_GUIDE_NAME, FINANCIAL_DATA_GUIDE_DESCRIPTION, () => ({
    messages: [
      {
        role: 'user',
        content: {
          type: 'text',
          text: FINANCIAL_DATA_GUIDE_CONTENT,
        },
      },
    ],
  }));

  // Profile & accounts
  registerGetUserProfile(server);
  registerGetAccounts(server);
  registerGetAccount(server);
  registerCreateAccount(server);
  registerUpdateAccount(server);
  registerAdjustAccountBalance(server);
  registerArchiveAccount(server);
  registerDeleteAccount(server);
  registerUnlinkAccountFromBankConnection(server);

  // Account groups (nested folders of accounts)
  registerGetAccountGroups(server);
  registerCreateAccountGroup(server);
  registerUpdateAccountGroup(server);
  registerMoveAccountGroup(server);
  registerDeleteAccountGroup(server);
  registerAddAccountToGroup(server);
  registerRemoveAccountsFromGroup(server);

  // Transactions (read + CRUD + splits + refunds + transfer linking)
  registerSearchTransactions(server);
  registerCreateTransaction(server);
  registerCreateAttachmentUploadUrl(server);
  registerUpdateTransaction(server);
  registerDeleteTransaction(server);
  registerBulkUpdateTransactions(server);
  registerSplitTransaction(server);
  registerDeleteSplit(server);
  registerLinkRefund(server);
  registerUnlinkRefund(server);
  registerLinkTransfer(server);
  registerUnlinkTransfer(server);
  registerGetTransactions(server);
  registerGetTransactionsSummary(server);
  registerGetPlannedSummary(server);
  registerConfirmPlannedTransaction(server);
  registerBulkDeleteTransactions(server);
  registerGetTransactionLinks(server);
  registerListTransactionAttachments(server);
  registerDeleteAttachment(server);
  registerGetRefunds(server);
  registerGetRefundRecommendations(server);
  registerGetTransferRecommendations(server);
  registerListTransferSuggestions(server);
  registerDismissTransferSuggestion(server);

  // Reconciliation
  registerGetReconciliationHistory(server);
  registerListStuckPendingTransactions(server);
  registerRemoveDuplicateTransactions(server);
  registerRestoreRemovedTransactions(server);
  registerMergeDuplicateTransactions(server);
  registerKeepPendingAsBooked(server);

  // Taxonomy (categories + tags)
  registerGetCategories(server);
  registerGetCategoryTransactionCount(server);
  registerCreateCategory(server);
  registerUpdateCategory(server);
  registerDeleteCategory(server);
  registerGetTags(server);
  registerCreateTag(server);
  registerUpdateTag(server);
  registerDeleteTag(server);
  registerAssignTagsToTransaction(server);
  registerRemoveTagsFromTransaction(server);
  registerGetTagReminders(server);
  registerCreateTagReminder(server);
  registerUpdateTagReminder(server);
  registerDeleteTagReminder(server);

  // Notifications & settings
  registerGetNotifications(server);
  registerMarkNotificationsRead(server);
  registerDismissNotification(server);
  registerGetUserSettings(server);
  registerUpdateUserSettings(server);

  // Payees
  registerGetPayees(server);
  registerGetPayee(server);
  registerCreatePayee(server);
  registerUpdatePayee(server);
  registerDeletePayee(server);
  registerMergePayees(server);
  registerSetPayeesCategorizationMode(server);
  registerBulkDeletePayees(server);
  registerGetIgnoredPayeeNames(server);
  registerIgnorePayeeName(server);
  registerUnignorePayeeName(server);
  registerApplyPayeeTagsToTransactions(server);
  registerCreatePayeeAlias(server);
  registerDeletePayeeAlias(server);

  // Trackers
  registerGetTrackers(server);
  registerCreateTracker(server);
  registerUpdateTracker(server);
  registerDeleteTracker(server);
  registerArchiveTracker(server);
  registerAddTransactionsToTracker(server);
  registerRemoveTransactionsFromTracker(server);
  registerGetTrackerSpendingStats(server);
  registerCreateTrackerLine(server);
  registerUpdateTrackerLine(server);
  registerDeleteTrackerLine(server);
  registerListTrackerSuggestions(server);
  registerAcceptTrackerSuggestions(server);
  registerRejectTrackerSuggestions(server);
  registerGetTracker(server);
  registerGetTrackerTransactions(server);

  // Analytics
  registerGetSpendingByCategories(server);
  registerGetCashFlow(server);
  registerGetBalanceHistory(server);
  registerGetExpensesForPeriod(server);
  registerGetTotalBalance(server);
  registerGetNetWorthHistory(server);
  registerGetNetWorthDrivers(server);
  registerGetInvestmentContributions(server);
  registerGetVentureContributions(server);
  registerGetPivotReport(server);
  registerGetCumulativeStats(server);
  registerGetEarliestTransactionDate(server);

  // Investments
  registerGetPortfolios(server);
  registerGetPortfolio(server);
  registerGetPortfoliosOverview(server);
  registerGetPortfolioSummary(server);
  registerGetPortfolioHoldings(server);
  registerGetPortfolioBalances(server);
  registerGetInvestmentTransactions(server);
  registerSearchSecurities(server);
  registerGetSecurityPrices(server);
  registerCreateHolding(server);
  registerDeleteHolding(server);
  registerCreatePortfolio(server);
  registerUpdatePortfolio(server);
  registerDeletePortfolio(server);
  registerRestorePortfolio(server);
  registerCreateInvestmentTransaction(server);
  registerUpdateInvestmentTransaction(server);
  registerDeleteInvestmentTransaction(server);

  // Portfolio cash transfers
  registerLinkTransactionToPortfolio(server);
  registerUnlinkTransactionFromPortfolio(server);
  registerTransferAccountToPortfolio(server);
  registerTransferPortfolioToAccount(server);
  registerCreatePortfolioCashTransaction(server);
  registerTransferBetweenPortfolios(server);
  registerExchangePortfolioCurrency(server);
  registerListPortfolioTransfers(server);
  registerSetPortfolioTransferAdjustment(server);
  registerDeletePortfolioTransfer(server);

  // Transaction groups
  registerGetTransactionGroups(server);
  registerCreateTransactionGroup(server);
  registerUpdateTransactionGroup(server);
  registerDeleteTransactionGroup(server);
  registerAddTransactionsToGroup(server);
  registerRemoveTransactionsFromGroup(server);

  // Subscriptions
  registerGetSubscriptions(server);
  registerGetSubscriptionById(server);
  registerCreateSubscription(server);
  registerUpdateSubscription(server);
  registerDeleteSubscription(server);
  registerToggleSubscriptionActive(server);
  registerDetectSubscriptionCandidates(server);
  registerListSubscriptionCandidates(server);
  registerDismissSubscriptionCandidate(server);
  registerLinkTransactionsToSubscription(server);
  registerUnlinkTransactionsFromSubscription(server);
  registerGetUpcomingSubscriptionPayments(server);
  registerGetSubscriptionsSummary(server);
  registerAcceptSubscriptionCandidate(server);
  registerListSubscriptionMatchSuggestions(server);
  registerGetSubscriptionPeriods(server);
  registerPreviewSubscriptionPayment(server);
  registerPaySubscriptionPeriod(server);
  registerSkipSubscriptionPeriod(server);
  registerUnlinkSubscriptionPeriodTransaction(server);
  registerRevertSubscriptionPeriod(server);

  // Transaction automations (rules engine)
  registerGetTransactionAutomations(server);
  registerPreviewTransactionAutomation(server);
  registerCreateTransactionAutomation(server);
  registerUpdateTransactionAutomation(server);
  registerDeleteTransactionAutomation(server);
  registerReorderTransactionAutomations(server);
  registerApplyTransactionAutomation(server);

  // Transaction templates (named presets for new transactions)
  registerGetTransactionTemplates(server);
  registerCreateTransactionTemplate(server);
  registerUpdateTransactionTemplate(server);
  registerDeleteTransactionTemplate(server);

  // Venture investments (platforms, deals, events)
  registerListVenturePlatforms(server);
  registerGetVenturePlatform(server);
  registerCreateVenturePlatform(server);
  registerUpdateVenturePlatform(server);
  registerDeleteVenturePlatform(server);
  registerListVentureDeals(server);
  registerGetVentureDeal(server);
  registerGetVentureDealMetrics(server);
  registerCreateVentureDeal(server);
  registerUpdateVentureDeal(server);
  registerDeleteVentureDeal(server);
  registerListVentureEvents(server);
  registerGetVentureEvent(server);
  registerCreateVentureEvent(server);
  registerUpdateVentureEvent(server);
  registerDeleteVentureEvent(server);
  registerLinkTransactionsToVentureEvent(server);
  registerReplaceVentureEventLinks(server);
  registerDeleteVentureEventLink(server);

  // Currencies
  registerListCustomCurrencies(server);
  registerCreateCustomCurrency(server);
  registerUpdateCustomCurrency(server);
  registerDeleteCustomCurrency(server);
  registerSearchCoingeckoCoins(server);
  registerGetCurrencyRateHistory(server);
  registerSetCurrencyRateSource(server);
  registerTestCurrencyRateSource(server);
  registerSetExchangeRates(server);
  registerDeleteExchangeRates(server);
  registerGetUserCurrencies(server);
  registerListSupportedCurrencies(server);
  registerGetExchangeRate(server);
  registerAddUserCurrencies(server);
  registerUpdateUserCurrency(server);
  registerDeleteUserCurrency(server);
  registerChangeBaseCurrency(server);
  registerGetBaseCurrencyChangeStatus(server);

  // Loans & vehicles
  registerGetLoans(server);
  registerGetLoanBalanceHistory(server);
  registerCreateLoan(server);
  registerUpdateLoan(server);
  registerDeleteLoan(server);
  registerAddLoanNote(server);
  registerLinkLoanPayments(server);
  registerUnlinkLoanPayment(server);
  registerGetVehicles(server);
  registerCreateVehicle(server);
  registerUpdateVehicle(server);
  registerDeleteVehicle(server);

  // Budget plans
  registerListBudgetPlans(server);
  registerGetBudgetPlanSuggestionContext(server);
  registerListBudgetPlanPeriods(server);
  registerGetBudgetPlanPeriod(server);
  registerGetBudgetPlanScheduled(server);
  registerGetBudgetPlanTrends(server);
  registerCreateBudgetPlan(server);
  registerUpdateBudgetPlan(server);
  registerDeleteBudgetPlan(server);
  registerRestoreBudgetPlan(server);
  registerSetBudgetPlanAccounts(server);
  registerCreateBudgetPlanGroup(server);
  registerUpdateBudgetPlanGroup(server);
  registerDeleteBudgetPlanGroup(server);
  registerCreateBudgetPlanLine(server);
  registerUpdateBudgetPlanLine(server);
  registerDeleteBudgetPlanLine(server);
  registerArchiveBudgetPlanLine(server);
  registerAddSuggestedBudgetPlanLines(server);
  registerSetBudgetPlanLayout(server);
  registerSetBudgetPlanLineGoal(server);
  registerDeleteBudgetPlanLineGoal(server);
  registerSnoozeBudgetPlanLineGoal(server);
  registerSetBudgetPlanAssignment(server);

  // Sharing & bank connections (read-only)
  registerListShareInvitations(server);
  registerListShareMembers(server);
  registerListSharedWithMe(server);
  registerListBankConnections(server);
  registerGetBankSyncStatus(server);

  // Imports
  registerListImportBatches(server);
  registerDeleteImportBatch(server);
  registerGetImportBatchDeleteStatus(server);

  return server;
}
