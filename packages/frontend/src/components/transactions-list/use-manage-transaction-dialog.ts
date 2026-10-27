import { loadTransactionById } from '@/api/transactions';
import { useNotificationCenter } from '@/components/notification-center';
import { i18n } from '@/i18n';
import { captureException } from '@/lib/sentry';
import { useAccountsStore } from '@/stores';
import {
  isTwoLegTransfer,
  ACCOUNT_CATEGORIES,
  ACCOUNT_TYPES,
  AccountModel,
  TRANSACTION_TRANSFER_NATURE,
  TRANSACTION_TYPES,
  TransactionModel,
} from '@bt/shared/types';
import { storeToRefs } from 'pinia';
import { computed, ref } from 'vue';

interface DialogProps {
  transaction: TransactionModel | undefined;
  oppositeTransaction: TransactionModel | undefined;
}

interface LoanDialogProps {
  loanAccount: AccountModel | undefined;
  transaction: TransactionModel | undefined;
  oppositeTransaction: TransactionModel | undefined;
}

/**
 * Manages the transaction detail dialog state:
 * - Open/close state
 * - Transaction + opposite transaction props (for transfers)
 * - Transfer normalization (determines which side is primary vs opposite)
 * - Compact dialog detection (for portfolio transfers)
 */
export function useManageTransactionDialog() {
  const { accountsRecord } = storeToRefs(useAccountsStore());
  const { addErrorNotification } = useNotificationCenter();

  const isDialogVisible = ref(false);
  const dialogProps = ref<DialogProps>({
    transaction: undefined,
    oppositeTransaction: undefined,
  });

  // Loan payments get a simplified dialog (no note/tags/payment-type/link section).
  // Same click handler routes here for transfer_to_loan pairs; both legs are needed
  // to populate the source and loan-side amounts.
  const isLoanDialogVisible = ref(false);
  const loanDialogProps = ref<LoanDialogProps>({
    loanAccount: undefined,
    transaction: undefined,
    oppositeTransaction: undefined,
  });

  const isCompactDialog = computed(() =>
    [TRANSACTION_TRANSFER_NATURE.transfer_to_portfolio, TRANSACTION_TRANSFER_NATURE.transfer_to_venture].includes(
      dialogProps.value.transaction?.transferNature as TRANSACTION_TRANSFER_NATURE,
    ),
  );

  // Derive externality from the actual account record rather than tx.accountType.
  // Transactions can carry a stale/default accountType (the create-tx API defaults
  // it to "system" when not provided), but the account's own type is authoritative.
  // Fall back to tx.accountType when the account record isn't loaded (archived
  // account, store still hydrating) — strictly better than silently classifying as
  // system, which would re-trigger the original external-transfer normalization bug.
  const isAccountExternal = (tx: TransactionModel | undefined): boolean => {
    if (!tx) return false;
    const account = accountsRecord.value[tx.accountId];
    if (account) return account.type !== ACCOUNT_TYPES.system;
    return tx.accountType !== ACCOUNT_TYPES.system;
  };

  // Routes a transfer_to_loan pair to the loan dialog: the income leg names the
  // loan, the expense leg carries the source account/amount. Falls back to the
  // regular dialog if the opposite leg hasn't loaded yet.
  const tryRouteToLoanDialog = (baseTx: TransactionModel, oppositeTx: TransactionModel | undefined): boolean => {
    if (baseTx.transferNature !== TRANSACTION_TRANSFER_NATURE.transfer_to_loan) return false;
    if (!oppositeTx) return false;

    const sourceTx = baseTx.transactionType === TRANSACTION_TYPES.expense ? baseTx : oppositeTx;
    const loanTx = baseTx.transactionType === TRANSACTION_TYPES.income ? baseTx : oppositeTx;
    const loanAccount = accountsRecord.value[loanTx.accountId];
    if (!loanAccount || loanAccount.accountCategory !== ACCOUNT_CATEGORIES.loan) return false;

    loanDialogProps.value = {
      loanAccount,
      transaction: sourceTx,
      oppositeTransaction: loanTx,
    };
    isLoanDialogVisible.value = true;
    return true;
  };

  let isOpeningPaymentMain = false;
  // A multi-account payment is only editable through its main row.
  const openPaymentMain = async ({ mainId }: { mainId: string }) => {
    if (isOpeningPaymentMain) return;
    isOpeningPaymentMain = true;
    const notifyLoadError = () => addErrorNotification(i18n.global.t('common.transactions.record.payment.loadError'));
    try {
      const main = await loadTransactionById({ id: mainId });
      if (main) handleRecordClick([main, undefined]);
      else notifyLoadError();
    } catch (error) {
      notifyLoadError();
      captureException({ error, context: { source: 'openPaymentMain', transactionId: mainId } });
    } finally {
      isOpeningPaymentMain = false;
    }
  };

  const handleRecordClick = ([baseTx, oppositeTx]: [
    baseTx: TransactionModel,
    oppositeTx: TransactionModel | undefined,
  ]) => {
    if (baseTx.paymentParentId) {
      void openPaymentMain({ mainId: baseTx.paymentParentId });
      return;
    }
    if (tryRouteToLoanDialog(baseTx, oppositeTx)) return;

    const isBaseExternal = isAccountExternal(baseTx);
    const isOppositeExternal = isAccountExternal(oppositeTx);
    const isExternalTransfer = isBaseExternal || isOppositeExternal;

    const modalOptions: DialogProps = {
      transaction: baseTx,
      oppositeTransaction: undefined,
    };

    if (isExternalTransfer) {
      modalOptions.transaction = isBaseExternal ? baseTx : oppositeTx;
      modalOptions.oppositeTransaction = isBaseExternal ? oppositeTx : baseTx;
    } else if (isTwoLegTransfer(baseTx.transferNature)) {
      const isValid = baseTx.transactionType === TRANSACTION_TYPES.expense;

      // Swap only when the opposite half is available. Otherwise the dialog
      // would open with transaction=undefined while still carrying an
      // oppositeTransaction, putting the form in "creation mode" with stale
      // linking state that the unlink path can't handle.
      if (isValid || oppositeTx) {
        modalOptions.transaction = isValid ? baseTx : oppositeTx;
        modalOptions.oppositeTransaction = isValid ? oppositeTx : baseTx;
      }
    }

    isDialogVisible.value = true;
    dialogProps.value = modalOptions;
  };

  const closeDialog = () => {
    isDialogVisible.value = false;
  };

  const closeLoanDialog = () => {
    isLoanDialogVisible.value = false;
  };

  return {
    isDialogVisible,
    dialogProps,
    isCompactDialog,
    handleRecordClick,
    closeDialog,
    isLoanDialogVisible,
    loanDialogProps,
    closeLoanDialog,
  };
}
