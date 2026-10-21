import type { PreviewResolverName } from '../../policies/rules';
import { resolveApplyTransactionAutomation } from './automation-apply';
import { resolveBudgetPlanAssignment } from './budget-plan-assignment';
import { resolveBulkDeletePayees } from './bulk-delete-payees';
import { resolveBulkDeleteTransactions, resolveBulkUpdateTransactions } from './bulk-transactions';
import { resolveChangeBaseCurrency } from './change-base-currency';
import { resolveEntityPreview } from './entity';
import { resolveDeleteExchangeRates } from './exchange-rates';
import { resolveIgnorePayeeName } from './ignore-payee-name';
import { resolveDeleteImportBatch } from './import-batch';
import { resolveMergePayees } from './merge-payees';
import { resolveApplyPayeeTags } from './payee-tags';
import { resolveMergeDuplicateTransactions, resolveRemoveDuplicateTransactions } from './reconciliation';
import { resolveRevertSubscriptionPeriod } from './revert-subscription-period';
import { resolveLinkTransactionsToSubscription, resolveUnlinkTransactionsFromSubscription } from './subscription-links';
import type { PreviewResolver } from './types';

/**
 * The resolver registry, a record over the names the policies declare: a name added to
 * `PREVIEW_RESOLVER_NAMES` without a resolver here does not compile, and a resolver without a name
 * does not either.
 */
export const PREVIEW_RESOLVERS: Record<PreviewResolverName, PreviewResolver> = {
  entity: resolveEntityPreview,
  bulkUpdateTransactions: resolveBulkUpdateTransactions,
  bulkDeleteTransactions: resolveBulkDeleteTransactions,
  bulkDeletePayees: resolveBulkDeletePayees,
  mergePayees: resolveMergePayees,
  removeDuplicateTransactions: resolveRemoveDuplicateTransactions,
  mergeDuplicateTransactions: resolveMergeDuplicateTransactions,
  deleteImportBatch: resolveDeleteImportBatch,
  changeBaseCurrency: resolveChangeBaseCurrency,
  deleteExchangeRates: resolveDeleteExchangeRates,
  applyTransactionAutomation: resolveApplyTransactionAutomation,
  applyPayeeTags: resolveApplyPayeeTags,
  ignorePayeeName: resolveIgnorePayeeName,
  revertSubscriptionPeriod: resolveRevertSubscriptionPeriod,
  linkTransactionsToSubscription: resolveLinkTransactionsToSubscription,
  unlinkTransactionsFromSubscription: resolveUnlinkTransactionsFromSubscription,
  budgetPlanAssignment: resolveBudgetPlanAssignment,
};
