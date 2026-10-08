import { createTransaction } from '@/api';
import { OUT_OF_WALLET_ACCOUNT_MOCK } from '@/common/const';
import {
  ACCOUNT_CATEGORIES,
  TRANSACTION_TRANSFER_NATURE,
  TRANSACTION_TYPES,
  type RecordId,
  type SplitInput,
} from '@bt/shared/types';

import {
  getOppositeTxType,
  getTxTypeFromFormType,
  resolveFormIsPlanned,
  resolveOriginalCurrencyPair,
} from '../helpers';
import { type FormSplit, UI_FORM_STRUCT } from '../types';
import { resolveFormLocation } from './resolve-form-location';

/**
 * Converts form splits to API split format
 */
const formSplitsToApiSplits = (splits: FormSplit[] | undefined): SplitInput[] | undefined => {
  if (!splits || splits.length === 0) return undefined;

  return splits
    .filter((split) => split.category && split.amount !== null && split.amount > 0)
    .map((split) => ({
      categoryId: split.category!.id,
      amount: split.amount as number,
      note: split.note || undefined,
    }));
};

export const prepareTxCreationParams = ({
  form,
  isTransferTx,
  isCurrenciesDifferent,
}: {
  form: UI_FORM_STRUCT;
  isTransferTx: boolean;
  isCurrenciesDifferent: boolean;
}) => {
  const { amount, note, time, type: formTxType, paymentType, account, toAccount, category } = form;

  const accountId = account!.id;

  const creationParams: Parameters<typeof createTransaction>[0] = {
    amount: amount!,
    note,
    externalUrl: form.externalUrl?.trim() || undefined,
    externalReference: form.externalReference?.trim() || undefined,
    location: resolveFormLocation(form),
    time: time.toUTCString(),
    transactionType: getTxTypeFromFormType(formTxType),
    paymentType: paymentType!.value,
    accountId,
    // Always send the array, even empty: payee tags are applied client-side
    // here, and sending the set stops the backend re-adding tags the user
    // deselected for a payee they picked. A payee the backend matches itself
    // still merges its defaults on top.
    tagIds: form.tagIds ?? [],
  };

  // Only forward the refund link when its counterpart opposes the form's type —
  // the backend rejects a same-type link (422), so a stale post-toggle selection
  // must not be sent.
  const expectedRefundType = getOppositeTxType(getTxTypeFromFormType(formTxType));
  if (form.refundsTx && form.refundsTx.transaction.transactionType === expectedRefundType) {
    creationParams.refundForTxId = form.refundsTx.transaction.id;
    if (form.refundsTx.splitId) {
      creationParams.refundForSplitId = form.refundsTx.splitId as RecordId;
    }
  }

  // if (linkedTransaction) {
  //   creationParams.destinationTransactionId = linkedTransaction.id;
  //   creationParams.transferNature = TRANSACTION_TRANSFER_NATURE.common_transfer;
  //   // TODO: also take care about the case when user is filling a form for
  //   // "target amount" and "target account" and linking exactly to them
  // } else {
  // // everything that is below...
  if (isTransferTx) {
    creationParams.destinationAccountId = toAccount!.id;
    creationParams.destinationAmount = isCurrenciesDifferent ? form.targetAmount! : amount!;
    // Destination is loan-category → stamp transfer_to_loan so reports can
    // isolate loan payments without joining through the destination account.
    creationParams.transferNature =
      toAccount!.accountCategory === ACCOUNT_CATEGORIES.loan
        ? TRANSACTION_TRANSFER_NATURE.transfer_to_loan
        : TRANSACTION_TRANSFER_NATURE.common_transfer;
  } else {
    if (!category) {
      throw new Error('A non-transfer transaction cannot be created without a category');
    }
    creationParams.categoryId = category.id;

    // Add splits for non-transfer transactions
    const apiSplits = formSplitsToApiSplits(form.splits);
    if (apiSplits && apiSplits.length > 0) {
      creationParams.splits = apiSplits;
    }

    // Manual Payee assignment from the dialog also locks the row server-side
    // so future provider syncs leave it alone.
    if (form.payeeId !== undefined && form.payeeId !== null) {
      creationParams.payeeId = form.payeeId as RecordId;
      creationParams.payeeLocked = true;
    }

    if (resolveFormIsPlanned({ form })) {
      creationParams.isPlanned = true;
    }

    const originalPair = resolveOriginalCurrencyPair({ form });
    if (originalPair.state === 'pair') {
      creationParams.originalAmount = originalPair.originalAmount;
      creationParams.originalCurrencyCode = originalPair.originalCurrencyCode;
    }
  }

  // Handle transfer_out_wallet
  // Always send amount+accountId and never destination data
  if ([creationParams.accountId, creationParams.destinationAccountId].includes(OUT_OF_WALLET_ACCOUNT_MOCK.id)) {
    creationParams.transferNature = TRANSACTION_TRANSFER_NATURE.transfer_out_wallet;

    if (creationParams.accountId === OUT_OF_WALLET_ACCOUNT_MOCK.id) {
      creationParams.transactionType = TRANSACTION_TYPES.income;
      creationParams.amount = creationParams.destinationAmount!;
      creationParams.accountId = creationParams.destinationAccountId!;
      delete creationParams.destinationAmount;
      delete creationParams.destinationAccountId;
    } else if (creationParams.destinationAccountId === OUT_OF_WALLET_ACCOUNT_MOCK.id) {
      creationParams.transactionType = TRANSACTION_TYPES.expense;
      delete creationParams.destinationAmount;
      delete creationParams.destinationAccountId;
    }
  }

  return creationParams;
};
