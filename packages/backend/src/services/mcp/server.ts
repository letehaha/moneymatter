import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import {
  FINANCIAL_DATA_GUIDE_CONTENT,
  FINANCIAL_DATA_GUIDE_DESCRIPTION,
  FINANCIAL_DATA_GUIDE_NAME,
} from './prompts/financial-data-guide';
import { registerAcceptBudgetSuggestions } from './tools/accept-budget-suggestions';
import { registerAcceptSubscriptionCandidate } from './tools/accept-subscription-candidate';
import { registerAcceptTrackerSuggestions } from './tools/accept-tracker-suggestions';
import { registerAddAccountToGroup } from './tools/add-account-to-group';
import { registerAddTransactionsToBudget } from './tools/add-transactions-to-budget';
import { registerAddTransactionsToGroup } from './tools/add-transactions-to-group';
import { registerAddTransactionsToTracker } from './tools/add-transactions-to-tracker';
import { registerAddUserCurrencies } from './tools/add-user-currencies';
import { registerAdjustAccountBalance } from './tools/adjust-account-balance';
import { registerApplyPayeeTagsToTransactions } from './tools/apply-payee-tags-to-transactions';
import { registerApplyTransactionAutomation } from './tools/apply-transaction-automation';
import { registerArchiveAccount } from './tools/archive-account';
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
import { registerCreateCategory } from './tools/create-category';
import { registerCreateGoal } from './tools/create-goal';
import { registerCreateInvestmentTransaction } from './tools/create-investment-transaction';
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
import { registerDeleteAccount } from './tools/delete-account';
import { registerDeleteAccountGroup } from './tools/delete-account-group';
import { registerDeleteAttachment } from './tools/delete-attachment';
import { registerDeleteBudget } from './tools/delete-budget';
import { registerDeleteBudgetLine } from './tools/delete-budget-line';
import { registerDeleteCategory } from './tools/delete-category';
import { registerDeleteExchangeRates } from './tools/delete-exchange-rates';
import { registerDeleteGoal } from './tools/delete-goal';
import { registerDeleteInvestmentTransaction } from './tools/delete-investment-transaction';
import { registerDeletePayee } from './tools/delete-payee';
import { registerDeletePayeeAlias } from './tools/delete-payee-alias';
import { registerDeletePortfolio } from './tools/delete-portfolio';
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
import { registerDetectSubscriptionCandidates } from './tools/detect-subscription-candidates';
import { registerDismissNotification } from './tools/dismiss-notification';
import { registerDismissSubscriptionCandidate } from './tools/dismiss-subscription-candidate';
import { registerDismissTransferSuggestion } from './tools/dismiss-transfer-suggestion';
import { registerGetAccount } from './tools/get-account';
import { registerGetAccountGroups } from './tools/get-account-groups';
import { registerGetAccounts } from './tools/get-accounts';
import { registerGetBalanceHistory } from './tools/get-balance-history';
import { registerGetBaseCurrencyChangeStatus } from './tools/get-base-currency-change-status';
import { registerGetBudget } from './tools/get-budget';
import { registerGetBudgetSpendingStats } from './tools/get-budget-spending-stats';
import { registerGetBudgetTransactions } from './tools/get-budget-transactions';
import { registerGetBudgets } from './tools/get-budgets';
import { registerGetCashFlow } from './tools/get-cash-flow';
import { registerGetCategories } from './tools/get-categories';
import { registerGetCategoryTransactionCount } from './tools/get-category-transaction-count';
import { registerGetCurrencyRateHistory } from './tools/get-currency-rate-history';
import { registerGetExchangeRate } from './tools/get-exchange-rate';
import { registerGetExpensesForPeriod } from './tools/get-expenses-for-period';
import { registerGetGoals } from './tools/get-goals';
import { registerGetIgnoredPayeeNames } from './tools/get-ignored-payee-names';
import { registerGetInvestmentTransactions } from './tools/get-investment-transactions';
import { registerGetNotifications } from './tools/get-notifications';
import { registerGetPayee } from './tools/get-payee';
import { registerGetPayees } from './tools/get-payees';
import { registerGetPlannedSummary } from './tools/get-planned-summary';
import { registerGetPortfolioBalances } from './tools/get-portfolio-balances';
import { registerGetPortfolioHoldings } from './tools/get-portfolio-holdings';
import { registerGetPortfolioSummary } from './tools/get-portfolio-summary';
import { registerGetPortfolios } from './tools/get-portfolios';
import { registerGetReconciliationHistory } from './tools/get-reconciliation-history';
import { registerGetRefundRecommendations } from './tools/get-refund-recommendations';
import { registerGetRefunds } from './tools/get-refunds';
import { registerGetSpendingByCategories } from './tools/get-spending-by-categories';
import { registerGetSubscriptionById } from './tools/get-subscription-by-id';
import { registerGetSubscriptionPeriods } from './tools/get-subscription-periods';
import { registerGetSubscriptions } from './tools/get-subscriptions';
import { registerGetSubscriptionsSummary } from './tools/get-subscriptions-summary';
import { registerGetTagReminders } from './tools/get-tag-reminders';
import { registerGetTags } from './tools/get-tags';
import { registerGetTrackerSpendingStats } from './tools/get-tracker-spending-stats';
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
import { registerIgnorePayeeName } from './tools/ignore-payee-name';
import { registerKeepPendingAsBooked } from './tools/keep-pending-as-booked';
import { registerLinkRefund } from './tools/link-refund';
import { registerLinkTransactionToPortfolio } from './tools/link-transaction-to-portfolio';
import { registerLinkTransactionsToSubscription } from './tools/link-transactions-to-subscription';
import { registerLinkTransfer } from './tools/link-transfer';
import { registerListPortfolioTransfers } from './tools/list-portfolio-transfers';
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
import { registerRejectBudgetSuggestions } from './tools/reject-budget-suggestions';
import { registerRejectTrackerSuggestions } from './tools/reject-tracker-suggestions';
import { registerRemoveAccountsFromGroup } from './tools/remove-accounts-from-group';
import { registerRemoveDuplicateTransactions } from './tools/remove-duplicate-transactions';
import { registerRemoveTagsFromTransaction } from './tools/remove-tags-from-transaction';
import { registerRemoveTransactionsFromGroup } from './tools/remove-transactions-from-group';
import { registerRemoveTransactionsFromTracker } from './tools/remove-transactions-from-tracker';
import { registerReorderTransactionAutomations } from './tools/reorder-transaction-automations';
import { registerRestoreRemovedTransactions } from './tools/restore-removed-transactions';
import { registerRevertSubscriptionPeriod } from './tools/revert-subscription-period';
import { registerSearchCoingeckoCoins } from './tools/search-coingecko-coins';
import { registerSearchSecurities } from './tools/search-securities';
import { registerSearchTransactions } from './tools/search-transactions';
import { registerSetExchangeRates } from './tools/set-exchange-rates';
import { registerSetPayeesCategorizationMode } from './tools/set-payees-categorization-mode';
import { registerSkipSubscriptionPeriod } from './tools/skip-subscription-period';
import { registerSplitTransaction } from './tools/split-transaction';
import { registerToggleSubscriptionActive } from './tools/toggle-subscription-active';
import { registerTransferAccountToPortfolio } from './tools/transfer-account-to-portfolio';
import { registerTransferPortfolioToAccount } from './tools/transfer-portfolio-to-account';
import { registerUnignorePayeeName } from './tools/unignore-payee-name';
import { registerUnlinkAccountFromBankConnection } from './tools/unlink-account-from-bank-connection';
import { registerUnlinkRefund } from './tools/unlink-refund';
import { registerUnlinkSubscriptionPeriodTransaction } from './tools/unlink-subscription-period-transaction';
import { registerUnlinkTransactionFromPortfolio } from './tools/unlink-transaction-from-portfolio';
import { registerUnlinkTransactionsFromSubscription } from './tools/unlink-transactions-from-subscription';
import { registerUnlinkTransfer } from './tools/unlink-transfer';
import { registerUpdateAccount } from './tools/update-account';
import { registerUpdateAccountGroup } from './tools/update-account-group';
import { registerUpdateBudget } from './tools/update-budget';
import { registerUpdateBudgetLine } from './tools/update-budget-line';
import { registerUpdateCategory } from './tools/update-category';
import { registerUpdateGoal } from './tools/update-goal';
import { registerUpdateInvestmentTransaction } from './tools/update-investment-transaction';
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
  // Trackers: the tool ids keep the "budget" name
  registerGetBudgets(server);
  registerGetBudget(server);
  registerGetBudgetTransactions(server);
  registerCreateBudget(server);
  registerUpdateBudget(server);
  registerDeleteBudget(server);
  registerArchiveBudget(server);
  registerAddTransactionsToBudget(server);
  registerRemoveTransactionsFromBudget(server);
  registerGetBudgetSpendingStats(server);
  registerCreateBudgetLine(server);
  registerUpdateBudgetLine(server);
  registerDeleteBudgetLine(server);
  registerListBudgetSuggestions(server);
  registerAcceptBudgetSuggestions(server);
  registerRejectBudgetSuggestions(server);

  // Savings goals
  registerGetGoals(server);
  registerCreateGoal(server);
  registerUpdateGoal(server);
  registerDeleteGoal(server);

  // Analytics
  registerGetSpendingByCategories(server);
  registerGetCashFlow(server);
  registerGetBalanceHistory(server);
  registerGetExpensesForPeriod(server);

  // Investments
  registerGetPortfolios(server);
  registerGetPortfolioSummary(server);
  registerGetPortfolioHoldings(server);
  registerGetPortfolioBalances(server);
  registerGetInvestmentTransactions(server);
  registerSearchSecurities(server);
  registerCreatePortfolio(server);
  registerUpdatePortfolio(server);
  registerDeletePortfolio(server);
  registerCreateInvestmentTransaction(server);
  registerUpdateInvestmentTransaction(server);
  registerDeleteInvestmentTransaction(server);

  // Portfolio cash transfers
  registerLinkTransactionToPortfolio(server);
  registerUnlinkTransactionFromPortfolio(server);
  registerTransferAccountToPortfolio(server);
  registerTransferPortfolioToAccount(server);
  registerCreatePortfolioCashTransaction(server);
  registerListPortfolioTransfers(server);

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

  // Exchange rates
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

  return server;
}
