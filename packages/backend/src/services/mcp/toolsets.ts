import type { McpOptionalToolset, McpToolset } from '@bt/shared/types';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { registerAcceptSubscriptionCandidate } from './tools/accept-subscription-candidate';
import { registerAcceptTrackerSuggestions } from './tools/accept-tracker-suggestions';
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
import { registerConfirmPlannedTransaction } from './tools/confirm-planned-transaction';
import { registerCreateAccount } from './tools/create-account';
import { registerCreateAttachmentUploadUrl } from './tools/create-attachment-upload-url';
import { registerCreateBudgetPlan } from './tools/create-budget-plan';
import { registerCreateBudgetPlanGroup } from './tools/create-budget-plan-group';
import { registerCreateBudgetPlanLine } from './tools/create-budget-plan-line';
import { registerCreateCategory } from './tools/create-category';
import { registerCreateGoal } from './tools/create-goal';
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
import { registerDeleteAttachment } from './tools/delete-attachment';
import { registerDeleteBudgetPlan } from './tools/delete-budget-plan';
import { registerDeleteBudgetPlanGroup } from './tools/delete-budget-plan-group';
import { registerDeleteBudgetPlanLine } from './tools/delete-budget-plan-line';
import { registerDeleteBudgetPlanLineGoal } from './tools/delete-budget-plan-line-goal';
import { registerDeleteCategory } from './tools/delete-category';
import { registerDeleteExchangeRates } from './tools/delete-exchange-rates';
import { registerDeleteGoal } from './tools/delete-goal';
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
import { registerDismissSubscriptionCandidate } from './tools/dismiss-subscription-candidate';
import { registerDismissTransferSuggestion } from './tools/dismiss-transfer-suggestion';
import { registerExchangePortfolioCurrency } from './tools/exchange-portfolio-currency';
import { registerGetAccount } from './tools/get-account';
import { registerGetAccounts } from './tools/get-accounts';
import { registerGetBalanceHistory } from './tools/get-balance-history';
import { registerGetBankSyncStatus } from './tools/get-bank-sync-status';
import { registerGetBudgetPlanPeriod } from './tools/get-budget-plan-period';
import { registerGetBudgetPlanScheduled } from './tools/get-budget-plan-scheduled';
import { registerGetBudgetPlanSuggestionContext } from './tools/get-budget-plan-suggestion-context';
import { registerGetBudgetPlanTrends } from './tools/get-budget-plan-trends';
import { registerGetCashFlow } from './tools/get-cash-flow';
import { registerGetCategories } from './tools/get-categories';
import { registerGetCategoryTransactionCount } from './tools/get-category-transaction-count';
import { registerGetCumulativeStats } from './tools/get-cumulative-stats';
import { registerGetEarliestTransactionDate } from './tools/get-earliest-transaction-date';
import { registerGetExchangeRate } from './tools/get-exchange-rate';
import { registerGetExpensesForPeriod } from './tools/get-expenses-for-period';
import { registerGetGoals } from './tools/get-goals';
import { registerGetIgnoredPayeeNames } from './tools/get-ignored-payee-names';
import { registerGetImportBatchDeleteStatus } from './tools/get-import-batch-delete-status';
import { registerGetInvestmentContributions } from './tools/get-investment-contributions';
import { registerGetInvestmentTransactions } from './tools/get-investment-transactions';
import { registerGetLoanBalanceHistory } from './tools/get-loan-balance-history';
import { registerGetLoans } from './tools/get-loans';
import { registerGetNetWorthDrivers } from './tools/get-net-worth-drivers';
import { registerGetNetWorthHistory } from './tools/get-net-worth-history';
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
import { registerGetRefundLinks } from './tools/get-refund-links';
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
import { registerGetTrackers } from './tools/get-trackers';
import { registerGetTransactionAutomations } from './tools/get-transaction-automations';
import { registerGetTransactionGroups } from './tools/get-transaction-groups';
import { registerGetTransactionLinks } from './tools/get-transaction-links';
import { registerGetTransactionTemplates } from './tools/get-transaction-templates';
import { registerGetTransactionsById } from './tools/get-transactions-by-id';
import { registerGetTransactionsSummary } from './tools/get-transactions-summary';
import { registerGetTransferRecommendations } from './tools/get-transfer-recommendations';
import { registerGetUpcomingSubscriptionPayments } from './tools/get-upcoming-subscription-payments';
import { registerGetUserCurrencies } from './tools/get-user-currencies';
import { registerGetUserProfile } from './tools/get-user-profile';
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
import { registerMergeDuplicateTransactions } from './tools/merge-duplicate-transactions';
import { registerMergePayees } from './tools/merge-payees';
import { registerPaySubscriptionPeriod } from './tools/pay-subscription-period';
import { registerPreviewSubscriptionPayment } from './tools/preview-subscription-payment';
import { registerPreviewTransactionAutomation } from './tools/preview-transaction-automation';
import { registerRejectTrackerSuggestions } from './tools/reject-tracker-suggestions';
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
import { registerSearchSecurities } from './tools/search-securities';
import { registerSearchTransactions } from './tools/search-transactions';
import { registerSetBudgetPlanAccounts } from './tools/set-budget-plan-accounts';
import { registerSetBudgetPlanAssignment } from './tools/set-budget-plan-assignment';
import { registerSetBudgetPlanLineGoal } from './tools/set-budget-plan-line-goal';
import { registerSetExchangeRates } from './tools/set-exchange-rates';
import { registerSetPortfolioTransferAdjustment } from './tools/set-portfolio-transfer-adjustment';
import { registerSkipSubscriptionPeriod } from './tools/skip-subscription-period';
import { registerSnoozeBudgetPlanLineGoal } from './tools/snooze-budget-plan-line-goal';
import { registerSplitTransaction } from './tools/split-transaction';
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
import { registerUpdateBudgetPlan } from './tools/update-budget-plan';
import { registerUpdateBudgetPlanGroup } from './tools/update-budget-plan-group';
import { registerUpdateBudgetPlanLine } from './tools/update-budget-plan-line';
import { registerUpdateCategory } from './tools/update-category';
import { registerUpdateGoal } from './tools/update-goal';
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

type ToolRegistrar = (server: McpServer) => void;

/**
 * Which tools each toolset registers. Every register function sits in exactly one toolset;
 * `core` is always registered, the rest only when the token carries the toolset's scope.
 *
 * When adding, moving or renaming a tool, also update the tool's `toolset` in
 * packages/frontend/public/.well-known/mcp/server-card.json. The drift tests in
 * ./toolsets-drift.unit.ts and ./server-card-drift.unit.ts fail otherwise.
 */
export const TOOLSET_REGISTRARS: Record<McpToolset, readonly ToolRegistrar[]> = {
  core: [
    registerGetUserProfile,
    registerGetAccounts,
    registerGetAccount,
    registerCreateAccount,
    registerUpdateAccount,
    registerArchiveAccount,
    registerDeleteAccount,
    registerAdjustAccountBalance,
    registerGetBalanceHistory,
    registerGetTotalBalance,
    registerSearchTransactions,
    registerGetTransactionsById,
    registerCreateTransaction,
    registerUpdateTransaction,
    registerDeleteTransaction,
    registerBulkUpdateTransactions,
    registerBulkDeleteTransactions,
    registerSplitTransaction,
    registerDeleteSplit,
    registerLinkTransfer,
    registerUnlinkTransfer,
    registerLinkRefund,
    registerUnlinkRefund,
    registerGetRefunds,
    registerGetRefundLinks,
    registerGetTransactionLinks,
    registerCreateAttachmentUploadUrl,
    registerListTransactionAttachments,
    registerDeleteAttachment,
    registerGetCategories,
    registerCreateCategory,
    registerUpdateCategory,
    registerDeleteCategory,
    registerGetCategoryTransactionCount,
    registerGetTags,
    registerCreateTag,
    registerUpdateTag,
    registerDeleteTag,
    registerAssignTagsToTransaction,
    registerRemoveTagsFromTransaction,
    registerGetPayees,
    registerGetPayee,
    registerCreatePayee,
    registerUpdatePayee,
    registerDeletePayee,
    registerMergePayees,
    registerBulkDeletePayees,
    registerGetCashFlow,
    registerGetExpensesForPeriod,
    registerGetSpendingByCategories,
    registerGetCumulativeStats,
    registerGetTransactionsSummary,
    registerGetNetWorthHistory,
    registerGetNetWorthDrivers,
    registerGetPivotReport,
    registerGetEarliestTransactionDate,
  ],
  subscriptions: [
    registerGetSubscriptions,
    registerGetSubscriptionById,
    registerGetSubscriptionsSummary,
    registerGetUpcomingSubscriptionPayments,
    registerCreateSubscription,
    registerUpdateSubscription,
    registerDeleteSubscription,
    registerToggleSubscriptionActive,
    registerLinkTransactionsToSubscription,
    registerUnlinkTransactionsFromSubscription,
    registerListSubscriptionMatchSuggestions,
    registerDetectSubscriptionCandidates,
    registerListSubscriptionCandidates,
    registerAcceptSubscriptionCandidate,
    registerDismissSubscriptionCandidate,
    registerGetSubscriptionPeriods,
    registerPreviewSubscriptionPayment,
    registerPaySubscriptionPeriod,
    registerSkipSubscriptionPeriod,
    registerRevertSubscriptionPeriod,
    registerUnlinkSubscriptionPeriodTransaction,
    registerGetPlannedSummary,
    registerConfirmPlannedTransaction,
  ],
  'budget-plans': [
    registerListBudgetPlans,
    registerCreateBudgetPlan,
    registerUpdateBudgetPlan,
    registerDeleteBudgetPlan,
    registerRestoreBudgetPlan,
    registerSetBudgetPlanAccounts,
    registerSetBudgetPlanAssignment,
    registerListBudgetPlanPeriods,
    registerGetBudgetPlanPeriod,
    registerGetBudgetPlanScheduled,
    registerGetBudgetPlanTrends,
    registerGetBudgetPlanSuggestionContext,
    registerAddSuggestedBudgetPlanLines,
    registerCreateBudgetPlanGroup,
    registerUpdateBudgetPlanGroup,
    registerDeleteBudgetPlanGroup,
    registerCreateBudgetPlanLine,
    registerUpdateBudgetPlanLine,
    registerArchiveBudgetPlanLine,
    registerDeleteBudgetPlanLine,
    registerSetBudgetPlanLineGoal,
    registerSnoozeBudgetPlanLineGoal,
    registerDeleteBudgetPlanLineGoal,
    registerGetGoals,
    registerCreateGoal,
    registerUpdateGoal,
    registerDeleteGoal,
  ],
  trackers: [
    registerGetTrackers,
    registerGetTracker,
    registerCreateTracker,
    registerUpdateTracker,
    registerArchiveTracker,
    registerDeleteTracker,
    registerCreateTrackerLine,
    registerUpdateTrackerLine,
    registerDeleteTrackerLine,
    registerAddTransactionsToTracker,
    registerRemoveTransactionsFromTracker,
    registerGetTrackerSpendingStats,
    registerListTrackerSuggestions,
    registerAcceptTrackerSuggestions,
    registerRejectTrackerSuggestions,
  ],
  automations: [
    registerGetTransactionAutomations,
    registerCreateTransactionAutomation,
    registerUpdateTransactionAutomation,
    registerDeleteTransactionAutomation,
    registerReorderTransactionAutomations,
    registerPreviewTransactionAutomation,
    registerApplyTransactionAutomation,
    registerCreatePayeeAlias,
    registerDeletePayeeAlias,
    registerGetIgnoredPayeeNames,
    registerIgnorePayeeName,
    registerUnignorePayeeName,
    registerApplyPayeeTagsToTransactions,
    registerGetTagReminders,
    registerCreateTagReminder,
    registerUpdateTagReminder,
    registerDeleteTagReminder,
  ],
  review: [
    registerGetRefundRecommendations,
    registerGetTransferRecommendations,
    registerListTransferSuggestions,
    registerDismissTransferSuggestion,
    registerMergeDuplicateTransactions,
    registerRemoveDuplicateTransactions,
    registerRestoreRemovedTransactions,
    registerGetReconciliationHistory,
    registerListStuckPendingTransactions,
    registerKeepPendingAsBooked,
  ],
  'groups-templates': [
    registerGetTransactionGroups,
    registerCreateTransactionGroup,
    registerUpdateTransactionGroup,
    registerDeleteTransactionGroup,
    registerAddTransactionsToGroup,
    registerRemoveTransactionsFromGroup,
    registerGetTransactionTemplates,
    registerCreateTransactionTemplate,
    registerUpdateTransactionTemplate,
    registerDeleteTransactionTemplate,
  ],
  investments: [
    registerGetPortfolios,
    registerGetPortfolio,
    registerGetPortfoliosOverview,
    registerGetPortfolioSummary,
    registerGetPortfolioBalances,
    registerGetPortfolioHoldings,
    registerCreatePortfolio,
    registerUpdatePortfolio,
    registerDeletePortfolio,
    registerRestorePortfolio,
    registerCreateHolding,
    registerDeleteHolding,
    registerSearchSecurities,
    registerGetSecurityPrices,
    registerGetInvestmentTransactions,
    registerCreateInvestmentTransaction,
    registerUpdateInvestmentTransaction,
    registerDeleteInvestmentTransaction,
    registerCreatePortfolioCashTransaction,
    registerExchangePortfolioCurrency,
    registerTransferAccountToPortfolio,
    registerTransferPortfolioToAccount,
    registerTransferBetweenPortfolios,
    registerListPortfolioTransfers,
    registerDeletePortfolioTransfer,
    registerSetPortfolioTransferAdjustment,
    registerLinkTransactionToPortfolio,
    registerUnlinkTransactionFromPortfolio,
    registerGetInvestmentContributions,
  ],
  ventures: [
    registerListVenturePlatforms,
    registerGetVenturePlatform,
    registerCreateVenturePlatform,
    registerUpdateVenturePlatform,
    registerDeleteVenturePlatform,
    registerListVentureDeals,
    registerGetVentureDeal,
    registerGetVentureDealMetrics,
    registerCreateVentureDeal,
    registerUpdateVentureDeal,
    registerDeleteVentureDeal,
    registerListVentureEvents,
    registerGetVentureEvent,
    registerCreateVentureEvent,
    registerUpdateVentureEvent,
    registerDeleteVentureEvent,
    registerLinkTransactionsToVentureEvent,
    registerReplaceVentureEventLinks,
    registerDeleteVentureEventLink,
    registerGetVentureContributions,
  ],
  'loans-vehicles': [
    registerGetLoans,
    registerCreateLoan,
    registerUpdateLoan,
    registerDeleteLoan,
    registerAddLoanNote,
    registerGetLoanBalanceHistory,
    registerLinkLoanPayments,
    registerUnlinkLoanPayment,
    registerGetVehicles,
    registerCreateVehicle,
    registerUpdateVehicle,
    registerDeleteVehicle,
  ],
  currencies: [
    registerGetUserCurrencies,
    registerAddUserCurrencies,
    registerUpdateUserCurrency,
    registerDeleteUserCurrency,
    registerListSupportedCurrencies,
    registerGetExchangeRate,
    registerSetExchangeRates,
    registerDeleteExchangeRates,
  ],
  imports: [
    registerListImportBatches,
    registerGetImportBatchDeleteStatus,
    registerDeleteImportBatch,
    registerListBankConnections,
    registerGetBankSyncStatus,
    registerUnlinkAccountFromBankConnection,
    registerListShareMembers,
    registerListShareInvitations,
    registerListSharedWithMe,
  ],
};

/** Registers `core` and then each given toolset, in that order. */
export function registerToolsets({
  server,
  toolsets,
}: {
  server: McpServer;
  toolsets: readonly McpOptionalToolset[];
}): void {
  for (const toolset of ['core', ...toolsets] as const) {
    for (const register of TOOLSET_REGISTRARS[toolset]) register(server);
  }
}

let toolNamesByToolset: Record<McpToolset, string[]> | undefined;

/**
 * The tool names each toolset registers, read by running its register functions against a stub
 * that records the names. Tool files call nothing on the server but `registerTool`.
 */
export function getToolNamesByToolset(): Record<McpToolset, string[]> {
  if (!toolNamesByToolset) {
    const entries = Object.entries(TOOLSET_REGISTRARS).map(([toolset, registrars]) => {
      const names: string[] = [];
      const recorder = { registerTool: (name: string) => names.push(name) } as unknown as McpServer;
      for (const register of registrars) register(recorder);
      return [toolset, names] as const;
    });
    toolNamesByToolset = Object.fromEntries(entries) as Record<McpToolset, string[]>;
  }
  return toolNamesByToolset;
}
