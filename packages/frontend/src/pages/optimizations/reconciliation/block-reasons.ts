import { isExternalTransaction } from '@/composable/use-bulk-transaction-actions';
import {
  RECONCILIATION_MERGE_MAX,
  RECONCILIATION_MERGE_MIN,
  RECONCILIATION_REMOVE_MAX,
} from '@bt/shared/const/reconciliation';
import { isLinkedTransfer } from '@bt/shared/const/transfers';
import type { AccountModel, TransactionModel } from '@bt/shared/types';
import type { ReconciliationHistoryEvent } from '@bt/shared/types/endpoints';

type ReconciliationAction = ReconciliationHistoryEvent['type'];

type ReconciliationBlockReason =
  | 'notBankConnected'
  | 'planned'
  | 'linkedTransfer'
  | 'refundLinked'
  | 'tooFew'
  | 'tooMany'
  | 'differentAccounts';

/** Client-side mirror of the backend's reconciliation validation, so the toolbar can explain a disabled action. */
export const getReconciliationBlockReasons = ({
  action,
  transactions,
  accountsRecord,
}: {
  action: ReconciliationAction;
  transactions: TransactionModel[];
  accountsRecord: Record<string, AccountModel | undefined>;
}): ReconciliationBlockReason[] => {
  const reasons: ReconciliationBlockReason[] = [];

  if (transactions.some((tx) => !isExternalTransaction({ tx, account: accountsRecord[tx.accountId] }))) {
    reasons.push('notBankConnected');
  }
  if (transactions.some((tx) => tx.isPlanned)) reasons.push('planned');
  if (transactions.some((tx) => isLinkedTransfer({ tx }))) reasons.push('linkedTransfer');
  if (transactions.some((tx) => tx.refundLinked)) reasons.push('refundLinked');

  if (action === 'merge') {
    if (transactions.length < RECONCILIATION_MERGE_MIN) reasons.push('tooFew');
    if (transactions.length > RECONCILIATION_MERGE_MAX) reasons.push('tooMany');
    if (new Set(transactions.map((tx) => tx.accountId)).size > 1) reasons.push('differentAccounts');
  } else if (transactions.length > RECONCILIATION_REMOVE_MAX) {
    reasons.push('tooMany');
  }

  return reasons;
};
