import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import {
  FINANCIAL_DATA_GUIDE_CONTENT,
  FINANCIAL_DATA_GUIDE_DESCRIPTION,
  FINANCIAL_DATA_GUIDE_NAME,
} from './prompts/financial-data-guide';
import { registerAcceptTrackerSuggestions } from './tools/accept-tracker-suggestions';
import { registerAddTransactionsToGroup } from './tools/add-transactions-to-group';
import { registerAddTransactionsToTracker } from './tools/add-transactions-to-tracker';
import { registerAdjustAccountBalance } from './tools/adjust-account-balance';
import { registerArchiveAccount } from './tools/archive-account';
import { registerArchiveTracker } from './tools/archive-tracker';
import { registerAssignTagsToTransaction } from './tools/assign-tags-to-transaction';
import { registerBulkUpdateTransactions } from './tools/bulk-update-transactions';
import { registerCreateAttachmentUploadUrl } from './tools/create-attachment-upload-url';
import { registerCreateCategory } from './tools/create-category';
import { registerCreateGoal } from './tools/create-goal';
import { registerCreateInvestmentTransaction } from './tools/create-investment-transaction';
import { registerCreatePayee } from './tools/create-payee';
import { registerCreatePortfolio } from './tools/create-portfolio';
import { registerCreatePortfolioCashTransaction } from './tools/create-portfolio-cash-transaction';
import { registerCreateSubscription } from './tools/create-subscription';
import { registerCreateTag } from './tools/create-tag';
import { registerCreateTracker } from './tools/create-tracker';
import { registerCreateTrackerLine } from './tools/create-tracker-line';
import { registerCreateTransaction } from './tools/create-transaction';
import { registerCreateTransactionAutomation } from './tools/create-transaction-automation';
import { registerCreateTransactionGroup } from './tools/create-transaction-group';
import { registerDeleteCategory } from './tools/delete-category';
import { registerDeleteGoal } from './tools/delete-goal';
import { registerDeleteInvestmentTransaction } from './tools/delete-investment-transaction';
import { registerDeletePayee } from './tools/delete-payee';
import { registerDeletePortfolio } from './tools/delete-portfolio';
import { registerDeleteSplit } from './tools/delete-split';
import { registerDeleteSubscription } from './tools/delete-subscription';
import { registerDeleteTag } from './tools/delete-tag';
import { registerDeleteTracker } from './tools/delete-tracker';
import { registerDeleteTrackerLine } from './tools/delete-tracker-line';
import { registerDeleteTransaction } from './tools/delete-transaction';
import { registerDeleteTransactionAutomation } from './tools/delete-transaction-automation';
import { registerDeleteTransactionGroup } from './tools/delete-transaction-group';
import { registerDetectSubscriptionCandidates } from './tools/detect-subscription-candidates';
import { registerDismissSubscriptionCandidate } from './tools/dismiss-subscription-candidate';
import { registerGetAccounts } from './tools/get-accounts';
import { registerGetBalanceHistory } from './tools/get-balance-history';
import { registerGetCashFlow } from './tools/get-cash-flow';
import { registerGetCategories } from './tools/get-categories';
import { registerGetExpensesForPeriod } from './tools/get-expenses-for-period';
import { registerGetGoals } from './tools/get-goals';
import { registerGetInvestmentTransactions } from './tools/get-investment-transactions';
import { registerGetPayee } from './tools/get-payee';
import { registerGetPayees } from './tools/get-payees';
import { registerGetPortfolioBalances } from './tools/get-portfolio-balances';
import { registerGetPortfolioHoldings } from './tools/get-portfolio-holdings';
import { registerGetPortfolioSummary } from './tools/get-portfolio-summary';
import { registerGetPortfolios } from './tools/get-portfolios';
import { registerGetSpendingByCategories } from './tools/get-spending-by-categories';
import { registerGetSubscriptionById } from './tools/get-subscription-by-id';
import { registerGetSubscriptions } from './tools/get-subscriptions';
import { registerGetSubscriptionsSummary } from './tools/get-subscriptions-summary';
import { registerGetTags } from './tools/get-tags';
import { registerGetTrackerSpendingStats } from './tools/get-tracker-spending-stats';
import { registerGetTrackers } from './tools/get-trackers';
import { registerGetTransactionAutomations } from './tools/get-transaction-automations';
import { registerGetTransactionGroups } from './tools/get-transaction-groups';
import { registerGetUpcomingSubscriptionPayments } from './tools/get-upcoming-subscription-payments';
import { registerGetUserProfile } from './tools/get-user-profile';
import { registerLinkRefund } from './tools/link-refund';
import { registerLinkTransactionToPortfolio } from './tools/link-transaction-to-portfolio';
import { registerLinkTransactionsToSubscription } from './tools/link-transactions-to-subscription';
import { registerLinkTransfer } from './tools/link-transfer';
import { registerListPortfolioTransfers } from './tools/list-portfolio-transfers';
import { registerListSubscriptionCandidates } from './tools/list-subscription-candidates';
import { registerListTrackerSuggestions } from './tools/list-tracker-suggestions';
import { registerMergePayees } from './tools/merge-payees';
import { registerPreviewTransactionAutomation } from './tools/preview-transaction-automation';
import { registerRejectTrackerSuggestions } from './tools/reject-tracker-suggestions';
import { registerRemoveTagsFromTransaction } from './tools/remove-tags-from-transaction';
import { registerRemoveTransactionsFromGroup } from './tools/remove-transactions-from-group';
import { registerRemoveTransactionsFromTracker } from './tools/remove-transactions-from-tracker';
import { registerReorderTransactionAutomations } from './tools/reorder-transaction-automations';
import { registerSearchSecurities } from './tools/search-securities';
import { registerSearchTransactions } from './tools/search-transactions';
import { registerSplitTransaction } from './tools/split-transaction';
import { registerToggleSubscriptionActive } from './tools/toggle-subscription-active';
import { registerTransferAccountToPortfolio } from './tools/transfer-account-to-portfolio';
import { registerTransferPortfolioToAccount } from './tools/transfer-portfolio-to-account';
import { registerUnlinkRefund } from './tools/unlink-refund';
import { registerUnlinkTransactionFromPortfolio } from './tools/unlink-transaction-from-portfolio';
import { registerUnlinkTransactionsFromSubscription } from './tools/unlink-transactions-from-subscription';
import { registerUnlinkTransfer } from './tools/unlink-transfer';
import { registerUpdateCategory } from './tools/update-category';
import { registerUpdateGoal } from './tools/update-goal';
import { registerUpdateInvestmentTransaction } from './tools/update-investment-transaction';
import { registerUpdatePayee } from './tools/update-payee';
import { registerUpdatePortfolio } from './tools/update-portfolio';
import { registerUpdateSubscription } from './tools/update-subscription';
import { registerUpdateTag } from './tools/update-tag';
import { registerUpdateTracker } from './tools/update-tracker';
import { registerUpdateTrackerLine } from './tools/update-tracker-line';
import { registerUpdateTransaction } from './tools/update-transaction';
import { registerUpdateTransactionAutomation } from './tools/update-transaction-automation';
import { registerUpdateTransactionGroup } from './tools/update-transaction-group';
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
  registerAdjustAccountBalance(server);
  registerArchiveAccount(server);

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

  // Taxonomy (categories + tags)
  registerGetCategories(server);
  registerCreateCategory(server);
  registerUpdateCategory(server);
  registerDeleteCategory(server);
  registerGetTags(server);
  registerCreateTag(server);
  registerUpdateTag(server);
  registerDeleteTag(server);
  registerAssignTagsToTransaction(server);
  registerRemoveTagsFromTransaction(server);

  // Payees
  registerGetPayees(server);
  registerGetPayee(server);
  registerCreatePayee(server);
  registerUpdatePayee(server);
  registerDeletePayee(server);
  registerMergePayees(server);

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

  // Transaction automations (rules engine)
  registerGetTransactionAutomations(server);
  registerPreviewTransactionAutomation(server);
  registerCreateTransactionAutomation(server);
  registerUpdateTransactionAutomation(server);
  registerDeleteTransactionAutomation(server);
  registerReorderTransactionAutomations(server);

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

  return server;
}
