import { loadTransactionById } from '@/api/transactions';
import { isBankLockedLeg } from '@/common/utils/bank-row-permissions';
import { useNotificationCenter } from '@/components/notification-center';
import { i18n } from '@/i18n';
import { captureException } from '@/lib/sentry';
import { useAccountsStore } from '@/stores';
import {
  isTwoLegTransfer,
  ACCOUNT_CATEGORIES,
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

  // A leg whose amount and date the bank owns. The dialog opens on such a leg so the form locks it;
  // a pre-seam manual leg is not one, so its transfer opens on the expense leg like a manual pair.
  const isLegBankLocked = ({ tx }: { tx: TransactionModel | undefined }): boolean =>
    isBankLockedLeg({ transaction: tx, account: tx ? accountsRecord.value[tx.accountId] : undefined });

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

    const isBaseExternal = isLegBankLocked({ tx: baseTx });
    const isOppositeExternal = isLegBankLocked({ tx: oppositeTx });
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
