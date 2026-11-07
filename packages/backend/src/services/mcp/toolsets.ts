import { MCP_CORE_TOOLSET, MCP_OPTIONAL_TOOLSETS, type McpOptionalToolset, type McpToolset } from '@bt/shared/types';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { registerDefinedTool, type ToolDef } from './define-tool';
import { acceptSubscriptionCandidateTool } from './tools/accept-subscription-candidate';
import { acceptTrackerSuggestionsTool } from './tools/accept-tracker-suggestions';
import { addLoanNoteTool } from './tools/add-loan-note';
import { addSuggestedBudgetPlanLinesTool } from './tools/add-suggested-budget-plan-lines';
import { addTransactionsToGroupTool } from './tools/add-transactions-to-group';
import { addTransactionsToTrackerTool } from './tools/add-transactions-to-tracker';
import { addUserCurrenciesTool } from './tools/add-user-currencies';
import { adjustAccountBalanceTool } from './tools/adjust-account-balance';
import { applyPayeeTagsToTransactionsTool } from './tools/apply-payee-tags-to-transactions';
import { applyTransactionAutomationTool } from './tools/apply-transaction-automation';
import { archiveAccountTool } from './tools/archive-account';
import { archiveBudgetPlanLineTool } from './tools/archive-budget-plan-line';
import { archiveTrackerTool } from './tools/archive-tracker';
import { assignTagsToTransactionTool } from './tools/assign-tags-to-transaction';
import { bulkDeletePayeesTool } from './tools/bulk-delete-payees';
import { bulkDeleteTransactionsTool } from './tools/bulk-delete-transactions';
import { bulkUpdateTransactionsTool } from './tools/bulk-update-transactions';
import { confirmPlannedTransactionTool } from './tools/confirm-planned-transaction';
import { createAccountTool } from './tools/create-account';
import { createAttachmentUploadUrlTool } from './tools/create-attachment-upload-url';
import { createBudgetPlanTool } from './tools/create-budget-plan';
import { createBudgetPlanGroupTool } from './tools/create-budget-plan-group';
import { createBudgetPlanLineTool } from './tools/create-budget-plan-line';
import { createCategoryTool } from './tools/create-category';
import { createGoalTool } from './tools/create-goal';
import { createHoldingTool } from './tools/create-holding';
import { createInvestmentTransactionTool } from './tools/create-investment-transaction';
import { createLoanTool } from './tools/create-loan';
import { createPayeeTool } from './tools/create-payee';
import { createPayeeAliasTool } from './tools/create-payee-alias';
import { createPortfolioTool } from './tools/create-portfolio';
import { createPortfolioCashTransactionTool } from './tools/create-portfolio-cash-transaction';
import { createSubscriptionTool } from './tools/create-subscription';
import { createTagTool } from './tools/create-tag';
import { createTagReminderTool } from './tools/create-tag-reminder';
import { createTrackerTool } from './tools/create-tracker';
import { createTrackerLineTool } from './tools/create-tracker-line';
import { createTransactionTool } from './tools/create-transaction';
import { createTransactionAutomationTool } from './tools/create-transaction-automation';
import { createTransactionGroupTool } from './tools/create-transaction-group';
import { createTransactionTemplateTool } from './tools/create-transaction-template';
import { createVehicleTool } from './tools/create-vehicle';
import { createVentureDealTool } from './tools/create-venture-deal';
import { createVentureEventTool } from './tools/create-venture-event';
import { createVenturePlatformTool } from './tools/create-venture-platform';
import { deleteAccountTool } from './tools/delete-account';
import { deleteAttachmentTool } from './tools/delete-attachment';
import { deleteBudgetPlanTool } from './tools/delete-budget-plan';
import { deleteBudgetPlanGroupTool } from './tools/delete-budget-plan-group';
import { deleteBudgetPlanLineTool } from './tools/delete-budget-plan-line';
import { deleteBudgetPlanLineGoalTool } from './tools/delete-budget-plan-line-goal';
import { deleteCategoryTool } from './tools/delete-category';
import { deleteExchangeRatesTool } from './tools/delete-exchange-rates';
import { deleteGoalTool } from './tools/delete-goal';
import { deleteHoldingTool } from './tools/delete-holding';
import { deleteImportBatchTool } from './tools/delete-import-batch';
import { deleteInvestmentTransactionTool } from './tools/delete-investment-transaction';
import { deleteLoanTool } from './tools/delete-loan';
import { deletePayeeTool } from './tools/delete-payee';
import { deletePayeeAliasTool } from './tools/delete-payee-alias';
import { deletePortfolioTool } from './tools/delete-portfolio';
import { deletePortfolioTransferTool } from './tools/delete-portfolio-transfer';
import { deleteSplitTool } from './tools/delete-split';
import { deleteSubscriptionTool } from './tools/delete-subscription';
import { deleteTagTool } from './tools/delete-tag';
import { deleteTagReminderTool } from './tools/delete-tag-reminder';
import { deleteTrackerTool } from './tools/delete-tracker';
import { deleteTrackerLineTool } from './tools/delete-tracker-line';
import { deleteTransactionTool } from './tools/delete-transaction';
import { deleteTransactionAutomationTool } from './tools/delete-transaction-automation';
import { deleteTransactionGroupTool } from './tools/delete-transaction-group';
import { deleteTransactionTemplateTool } from './tools/delete-transaction-template';
import { deleteUserCurrencyTool } from './tools/delete-user-currency';
import { deleteVehicleTool } from './tools/delete-vehicle';
import { deleteVentureDealTool } from './tools/delete-venture-deal';
import { deleteVentureEventTool } from './tools/delete-venture-event';
import { deleteVentureEventLinkTool } from './tools/delete-venture-event-link';
import { deleteVenturePlatformTool } from './tools/delete-venture-platform';
import { detectSubscriptionCandidatesTool } from './tools/detect-subscription-candidates';
import { dismissSubscriptionCandidateTool } from './tools/dismiss-subscription-candidate';
import { dismissTransferSuggestionTool } from './tools/dismiss-transfer-suggestion';
import { exchangePortfolioCurrencyTool } from './tools/exchange-portfolio-currency';
import { getAccountTool } from './tools/get-account';
import { getAccountsTool } from './tools/get-accounts';
import { getBalanceHistoryTool } from './tools/get-balance-history';
import { getBankSyncStatusTool } from './tools/get-bank-sync-status';
import { getBudgetPlanPeriodTool } from './tools/get-budget-plan-period';
import { getBudgetPlanScheduledTool } from './tools/get-budget-plan-scheduled';
import { getBudgetPlanSuggestionContextTool } from './tools/get-budget-plan-suggestion-context';
import { getBudgetPlanTrendsTool } from './tools/get-budget-plan-trends';
import { getCashFlowTool } from './tools/get-cash-flow';
import { getCategoriesTool } from './tools/get-categories';
import { getCategoryTransactionCountTool } from './tools/get-category-transaction-count';
import { getCumulativeStatsTool } from './tools/get-cumulative-stats';
import { getEarliestTransactionDateTool } from './tools/get-earliest-transaction-date';
import { getExchangeRateTool } from './tools/get-exchange-rate';
import { getExpensesForPeriodTool } from './tools/get-expenses-for-period';
import { getGoalsTool } from './tools/get-goals';
import { getIgnoredPayeeNamesTool } from './tools/get-ignored-payee-names';
import { getImportBatchDeleteStatusTool } from './tools/get-import-batch-delete-status';
import { getInvestmentContributionsTool } from './tools/get-investment-contributions';
import { getInvestmentTransactionsTool } from './tools/get-investment-transactions';
import { getLoanBalanceHistoryTool } from './tools/get-loan-balance-history';
import { getLoansTool } from './tools/get-loans';
import { getNetWorthDriversTool } from './tools/get-net-worth-drivers';
import { getNetWorthHistoryTool } from './tools/get-net-worth-history';
import { getPayeeTool } from './tools/get-payee';
import { getPayeesTool } from './tools/get-payees';
import { getPivotReportTool } from './tools/get-pivot-report';
import { getPlannedSummaryTool } from './tools/get-planned-summary';
import { getPortfolioTool } from './tools/get-portfolio';
import { getPortfolioBalancesTool } from './tools/get-portfolio-balances';
import { getPortfolioHoldingsTool } from './tools/get-portfolio-holdings';
import { getPortfolioSummaryTool } from './tools/get-portfolio-summary';
import { getPortfoliosTool } from './tools/get-portfolios';
import { getPortfoliosOverviewTool } from './tools/get-portfolios-overview';
import { getReconciliationHistoryTool } from './tools/get-reconciliation-history';
import { getRefundLinksTool } from './tools/get-refund-links';
import { getRefundRecommendationsTool } from './tools/get-refund-recommendations';
import { getRefundsTool } from './tools/get-refunds';
import { getSecurityPricesTool } from './tools/get-security-prices';
import { getSpendingByCategoriesTool } from './tools/get-spending-by-categories';
import { getSubscriptionByIdTool } from './tools/get-subscription-by-id';
import { getSubscriptionPeriodsTool } from './tools/get-subscription-periods';
import { getSubscriptionsTool } from './tools/get-subscriptions';
import { getSubscriptionsSummaryTool } from './tools/get-subscriptions-summary';
import { getTagRemindersTool } from './tools/get-tag-reminders';
import { getTagsTool } from './tools/get-tags';
import { getTotalBalanceTool } from './tools/get-total-balance';
import { getTrackerTool } from './tools/get-tracker';
import { getTrackerSpendingStatsTool } from './tools/get-tracker-spending-stats';
import { getTrackersTool } from './tools/get-trackers';
import { getTransactionAutomationsTool } from './tools/get-transaction-automations';
import { getTransactionGroupsTool } from './tools/get-transaction-groups';
import { getTransactionLinksTool } from './tools/get-transaction-links';
import { getTransactionTemplatesTool } from './tools/get-transaction-templates';
import { getTransactionsByIdTool } from './tools/get-transactions-by-id';
import { getTransactionsSummaryTool } from './tools/get-transactions-summary';
import { getTransferRecommendationsTool } from './tools/get-transfer-recommendations';
import { getUpcomingSubscriptionPaymentsTool } from './tools/get-upcoming-subscription-payments';
import { getUserCurrenciesTool } from './tools/get-user-currencies';
import { getUserProfileTool } from './tools/get-user-profile';
import { getVehiclesTool } from './tools/get-vehicles';
import { getVentureContributionsTool } from './tools/get-venture-contributions';
import { getVentureDealTool } from './tools/get-venture-deal';
import { getVentureDealMetricsTool } from './tools/get-venture-deal-metrics';
import { getVentureEventTool } from './tools/get-venture-event';
import { getVenturePlatformTool } from './tools/get-venture-platform';
import { ignorePayeeNameTool } from './tools/ignore-payee-name';
import { keepPendingAsBookedTool } from './tools/keep-pending-as-booked';
import { linkLoanPaymentsTool } from './tools/link-loan-payments';
import { linkRefundTool } from './tools/link-refund';
import { linkTransactionToPortfolioTool } from './tools/link-transaction-to-portfolio';
import { linkTransactionsToSubscriptionTool } from './tools/link-transactions-to-subscription';
import { linkTransactionsToVentureEventTool } from './tools/link-transactions-to-venture-event';
import { linkTransferTool } from './tools/link-transfer';
import { listBankConnectionsTool } from './tools/list-bank-connections';
import { listBudgetPlanPeriodsTool } from './tools/list-budget-plan-periods';
import { listBudgetPlansTool } from './tools/list-budget-plans';
import { listImportBatchesTool } from './tools/list-import-batches';
import { listPortfolioTransfersTool } from './tools/list-portfolio-transfers';
import { listShareInvitationsTool } from './tools/list-share-invitations';
import { listShareMembersTool } from './tools/list-share-members';
import { listSharedWithMeTool } from './tools/list-shared-with-me';
import { listStuckPendingTransactionsTool } from './tools/list-stuck-pending-transactions';
import { listSubscriptionCandidatesTool } from './tools/list-subscription-candidates';
import { listSubscriptionMatchSuggestionsTool } from './tools/list-subscription-match-suggestions';
import { listSupportedCurrenciesTool } from './tools/list-supported-currencies';
import { listTrackerSuggestionsTool } from './tools/list-tracker-suggestions';
import { listTransactionAttachmentsTool } from './tools/list-transaction-attachments';
import { listTransferSuggestionsTool } from './tools/list-transfer-suggestions';
import { listVentureDealsTool } from './tools/list-venture-deals';
import { listVentureEventsTool } from './tools/list-venture-events';
import { listVenturePlatformsTool } from './tools/list-venture-platforms';
import { mergeDuplicateTransactionsTool } from './tools/merge-duplicate-transactions';
import { mergePayeesTool } from './tools/merge-payees';
import { paySubscriptionPeriodTool } from './tools/pay-subscription-period';
import { previewSubscriptionPaymentTool } from './tools/preview-subscription-payment';
import { previewTransactionAutomationTool } from './tools/preview-transaction-automation';
import { rejectTrackerSuggestionsTool } from './tools/reject-tracker-suggestions';
import { removeDuplicateTransactionsTool } from './tools/remove-duplicate-transactions';
import { removeTagsFromTransactionTool } from './tools/remove-tags-from-transaction';
import { removeTransactionsFromGroupTool } from './tools/remove-transactions-from-group';
import { removeTransactionsFromTrackerTool } from './tools/remove-transactions-from-tracker';
import { reorderTransactionAutomationsTool } from './tools/reorder-transaction-automations';
import { replaceVentureEventLinksTool } from './tools/replace-venture-event-links';
import { restoreBudgetPlanTool } from './tools/restore-budget-plan';
import { restorePortfolioTool } from './tools/restore-portfolio';
import { restoreRemovedTransactionsTool } from './tools/restore-removed-transactions';
import { revertSubscriptionPeriodTool } from './tools/revert-subscription-period';
import { searchSecuritiesTool } from './tools/search-securities';
import { searchTransactionsTool } from './tools/search-transactions';
import { setBudgetPlanAccountsTool } from './tools/set-budget-plan-accounts';
import { setBudgetPlanAssignmentTool } from './tools/set-budget-plan-assignment';
import { setBudgetPlanLineGoalTool } from './tools/set-budget-plan-line-goal';
import { setExchangeRatesTool } from './tools/set-exchange-rates';
import { setPortfolioTransferAdjustmentTool } from './tools/set-portfolio-transfer-adjustment';
import { skipSubscriptionPeriodTool } from './tools/skip-subscription-period';
import { snoozeBudgetPlanLineGoalTool } from './tools/snooze-budget-plan-line-goal';
import { splitTransactionTool } from './tools/split-transaction';
import { toggleSubscriptionActiveTool } from './tools/toggle-subscription-active';
import { transferAccountToPortfolioTool } from './tools/transfer-account-to-portfolio';
import { transferBetweenPortfoliosTool } from './tools/transfer-between-portfolios';
import { transferPortfolioToAccountTool } from './tools/transfer-portfolio-to-account';
import { unignorePayeeNameTool } from './tools/unignore-payee-name';
import { unlinkAccountFromBankConnectionTool } from './tools/unlink-account-from-bank-connection';
import { unlinkLoanPaymentTool } from './tools/unlink-loan-payment';
import { unlinkRefundTool } from './tools/unlink-refund';
import { unlinkSubscriptionPeriodTransactionTool } from './tools/unlink-subscription-period-transaction';
import { unlinkTransactionFromPortfolioTool } from './tools/unlink-transaction-from-portfolio';
import { unlinkTransactionsFromSubscriptionTool } from './tools/unlink-transactions-from-subscription';
import { unlinkTransferTool } from './tools/unlink-transfer';
import { updateAccountTool } from './tools/update-account';
import { updateBudgetPlanTool } from './tools/update-budget-plan';
import { updateBudgetPlanGroupTool } from './tools/update-budget-plan-group';
import { updateBudgetPlanLineTool } from './tools/update-budget-plan-line';
import { updateCategoryTool } from './tools/update-category';
import { updateGoalTool } from './tools/update-goal';
import { updateInvestmentTransactionTool } from './tools/update-investment-transaction';
import { updateLoanTool } from './tools/update-loan';
import { updatePayeeTool } from './tools/update-payee';
import { updatePortfolioTool } from './tools/update-portfolio';
import { updateSubscriptionTool } from './tools/update-subscription';
import { updateTagTool } from './tools/update-tag';
import { updateTagReminderTool } from './tools/update-tag-reminder';
import { updateTrackerTool } from './tools/update-tracker';
import { updateTrackerLineTool } from './tools/update-tracker-line';
import { updateTransactionTool } from './tools/update-transaction';
import { updateTransactionAutomationTool } from './tools/update-transaction-automation';
import { updateTransactionGroupTool } from './tools/update-transaction-group';
import { updateTransactionTemplateTool } from './tools/update-transaction-template';
import { updateUserCurrencyTool } from './tools/update-user-currency';
import { updateVehicleTool } from './tools/update-vehicle';
import { updateVentureDealTool } from './tools/update-venture-deal';
import { updateVentureEventTool } from './tools/update-venture-event';
import { updateVenturePlatformTool } from './tools/update-venture-platform';

/**
 * Every MCP tool. Each def names its toolset: `core` is always registered, the rest only when the
 * token carries the toolset's scope.
 *
 * After adding, moving or renaming a tool, run `npm run mcp:generate-metadata` to update the
 * server card and the connect-moneymatter skill.
 */
export const ALL_TOOLS: readonly ToolDef[] = [
  acceptSubscriptionCandidateTool,
  acceptTrackerSuggestionsTool,
  addLoanNoteTool,
  addSuggestedBudgetPlanLinesTool,
  addTransactionsToGroupTool,
  addTransactionsToTrackerTool,
  addUserCurrenciesTool,
  adjustAccountBalanceTool,
  applyPayeeTagsToTransactionsTool,
  applyTransactionAutomationTool,
  archiveAccountTool,
  archiveBudgetPlanLineTool,
  archiveTrackerTool,
  assignTagsToTransactionTool,
  bulkDeletePayeesTool,
  bulkDeleteTransactionsTool,
  bulkUpdateTransactionsTool,
  confirmPlannedTransactionTool,
  createAccountTool,
  createAttachmentUploadUrlTool,
  createBudgetPlanGroupTool,
  createBudgetPlanLineTool,
  createBudgetPlanTool,
  createCategoryTool,
  createGoalTool,
  createHoldingTool,
  createInvestmentTransactionTool,
  createLoanTool,
  createPayeeAliasTool,
  createPayeeTool,
  createPortfolioCashTransactionTool,
  createPortfolioTool,
  createSubscriptionTool,
  createTagReminderTool,
  createTagTool,
  createTrackerLineTool,
  createTrackerTool,
  createTransactionAutomationTool,
  createTransactionGroupTool,
  createTransactionTemplateTool,
  createTransactionTool,
  createVehicleTool,
  createVentureDealTool,
  createVentureEventTool,
  createVenturePlatformTool,
  deleteAccountTool,
  deleteAttachmentTool,
  deleteBudgetPlanGroupTool,
  deleteBudgetPlanLineGoalTool,
  deleteBudgetPlanLineTool,
  deleteBudgetPlanTool,
  deleteCategoryTool,
  deleteExchangeRatesTool,
  deleteGoalTool,
  deleteHoldingTool,
  deleteImportBatchTool,
  deleteInvestmentTransactionTool,
  deleteLoanTool,
  deletePayeeAliasTool,
  deletePayeeTool,
  deletePortfolioTransferTool,
  deletePortfolioTool,
  deleteSplitTool,
  deleteSubscriptionTool,
  deleteTagReminderTool,
  deleteTagTool,
  deleteTrackerLineTool,
  deleteTrackerTool,
  deleteTransactionAutomationTool,
  deleteTransactionGroupTool,
  deleteTransactionTemplateTool,
  deleteTransactionTool,
  deleteUserCurrencyTool,
  deleteVehicleTool,
  deleteVentureDealTool,
  deleteVentureEventLinkTool,
  deleteVentureEventTool,
  deleteVenturePlatformTool,
  detectSubscriptionCandidatesTool,
  dismissSubscriptionCandidateTool,
  dismissTransferSuggestionTool,
  exchangePortfolioCurrencyTool,
  getAccountTool,
  getAccountsTool,
  getBalanceHistoryTool,
  getBankSyncStatusTool,
  getBudgetPlanPeriodTool,
  getBudgetPlanScheduledTool,
  getBudgetPlanSuggestionContextTool,
  getBudgetPlanTrendsTool,
  getCashFlowTool,
  getCategoriesTool,
  getCategoryTransactionCountTool,
  getCumulativeStatsTool,
  getEarliestTransactionDateTool,
  getExchangeRateTool,
  getExpensesForPeriodTool,
  getGoalsTool,
  getIgnoredPayeeNamesTool,
  getImportBatchDeleteStatusTool,
  getInvestmentContributionsTool,
  getInvestmentTransactionsTool,
  getLoanBalanceHistoryTool,
  getLoansTool,
  getNetWorthDriversTool,
  getNetWorthHistoryTool,
  getPayeeTool,
  getPayeesTool,
  getPivotReportTool,
  getPlannedSummaryTool,
  getPortfolioBalancesTool,
  getPortfolioHoldingsTool,
  getPortfolioSummaryTool,
  getPortfolioTool,
  getPortfoliosOverviewTool,
  getPortfoliosTool,
  getReconciliationHistoryTool,
  getRefundLinksTool,
  getRefundRecommendationsTool,
  getRefundsTool,
  getSecurityPricesTool,
  getSpendingByCategoriesTool,
  getSubscriptionByIdTool,
  getSubscriptionPeriodsTool,
  getSubscriptionsSummaryTool,
  getSubscriptionsTool,
  getTagRemindersTool,
  getTagsTool,
  getTotalBalanceTool,
  getTrackerSpendingStatsTool,
  getTrackerTool,
  getTrackersTool,
  getTransactionAutomationsTool,
  getTransactionGroupsTool,
  getTransactionLinksTool,
  getTransactionTemplatesTool,
  getTransactionsByIdTool,
  getTransactionsSummaryTool,
  getTransferRecommendationsTool,
  getUpcomingSubscriptionPaymentsTool,
  getUserCurrenciesTool,
  getUserProfileTool,
  getVehiclesTool,
  getVentureContributionsTool,
  getVentureDealMetricsTool,
  getVentureDealTool,
  getVentureEventTool,
  getVenturePlatformTool,
  ignorePayeeNameTool,
  keepPendingAsBookedTool,
  linkLoanPaymentsTool,
  linkRefundTool,
  linkTransactionToPortfolioTool,
  linkTransactionsToSubscriptionTool,
  linkTransactionsToVentureEventTool,
  linkTransferTool,
  listBankConnectionsTool,
  listBudgetPlanPeriodsTool,
  listBudgetPlansTool,
  listImportBatchesTool,
  listPortfolioTransfersTool,
  listShareInvitationsTool,
  listShareMembersTool,
  listSharedWithMeTool,
  listStuckPendingTransactionsTool,
  listSubscriptionCandidatesTool,
  listSubscriptionMatchSuggestionsTool,
  listSupportedCurrenciesTool,
  listTrackerSuggestionsTool,
  listTransactionAttachmentsTool,
  listTransferSuggestionsTool,
  listVentureDealsTool,
  listVentureEventsTool,
  listVenturePlatformsTool,
  mergeDuplicateTransactionsTool,
  mergePayeesTool,
  paySubscriptionPeriodTool,
  previewSubscriptionPaymentTool,
  previewTransactionAutomationTool,
  rejectTrackerSuggestionsTool,
  removeDuplicateTransactionsTool,
  removeTagsFromTransactionTool,
  removeTransactionsFromGroupTool,
  removeTransactionsFromTrackerTool,
  reorderTransactionAutomationsTool,
  replaceVentureEventLinksTool,
  restoreBudgetPlanTool,
  restorePortfolioTool,
  restoreRemovedTransactionsTool,
  revertSubscriptionPeriodTool,
  searchSecuritiesTool,
  searchTransactionsTool,
  setBudgetPlanAccountsTool,
  setBudgetPlanAssignmentTool,
  setBudgetPlanLineGoalTool,
  setExchangeRatesTool,
  setPortfolioTransferAdjustmentTool,
  skipSubscriptionPeriodTool,
  snoozeBudgetPlanLineGoalTool,
  splitTransactionTool,
  toggleSubscriptionActiveTool,
  transferAccountToPortfolioTool,
  transferBetweenPortfoliosTool,
  transferPortfolioToAccountTool,
  unignorePayeeNameTool,
  unlinkAccountFromBankConnectionTool,
  unlinkLoanPaymentTool,
  unlinkRefundTool,
  unlinkSubscriptionPeriodTransactionTool,
  unlinkTransactionFromPortfolioTool,
  unlinkTransactionsFromSubscriptionTool,
  unlinkTransferTool,
  updateAccountTool,
  updateBudgetPlanGroupTool,
  updateBudgetPlanLineTool,
  updateBudgetPlanTool,
  updateCategoryTool,
  updateGoalTool,
  updateInvestmentTransactionTool,
  updateLoanTool,
  updatePayeeTool,
  updatePortfolioTool,
  updateSubscriptionTool,
  updateTagReminderTool,
  updateTagTool,
  updateTrackerLineTool,
  updateTrackerTool,
  updateTransactionAutomationTool,
  updateTransactionGroupTool,
  updateTransactionTemplateTool,
  updateTransactionTool,
  updateUserCurrencyTool,
  updateVehicleTool,
  updateVentureDealTool,
  updateVentureEventTool,
  updateVenturePlatformTool,
];

export const TOOLSET_DESCRIPTIONS: Record<McpToolset, string> = {
  core: 'Accounts, transactions, transfers and refunds, attachments, categories, tags, payees and reports. Always on, needs no scope.',
  subscriptions: 'Recurring payments, their periods and candidates, and planned transactions.',
  'budget-plans': 'Budget plans with their groups, lines and line goals, and savings goals.',
  trackers: 'Spending trackers, their lines and suggestions.',
  automations: 'Transaction rules, payee aliases, ignored payee names and tag reminders.',
  review: 'Refund and transfer matches, duplicate cleanup and stuck pending transactions.',
  'groups-templates': 'Transaction groups and transaction templates.',
  investments: 'Portfolios, holdings, securities, investment transactions and portfolio transfers.',
  ventures: 'Venture platforms, deals and events.',
  'loans-vehicles': 'Loans with their payments and notes, and vehicles.',
  currencies: 'Your currencies and exchange rates.',
  imports: 'Import batches (list, undo) and bank connections (status, unlink an account); sharing is read only.',
};

export const TOOLS_BY_TOOLSET = Object.fromEntries(
  [MCP_CORE_TOOLSET, ...MCP_OPTIONAL_TOOLSETS].map((toolset) => [
    toolset,
    ALL_TOOLS.filter((def) => def.toolset === toolset),
  ]),
) as Record<McpToolset, ToolDef[]>;

/** Registers `core` and then each given toolset, in that order. */
export function registerToolsets({
  server,
  toolsets,
}: {
  server: McpServer;
  toolsets: readonly McpOptionalToolset[];
}): void {
  for (const toolset of [MCP_CORE_TOOLSET, ...toolsets]) {
    for (const def of TOOLS_BY_TOOLSET[toolset]) registerDefinedTool({ server, def });
  }
}

export function getToolNamesByToolset(): Record<McpToolset, string[]> {
  return Object.fromEntries(
    Object.entries(TOOLS_BY_TOOLSET).map(([toolset, defs]) => [toolset, defs.map((def) => def.name)]),
  ) as Record<McpToolset, string[]>;
}
