import { editTransaction } from '@/api';
import {
  ACCOUNT_CATEGORIES,
  TRANSACTION_TRANSFER_NATURE,
  TRANSACTION_TYPES,
  TransactionModel,
  isTwoLegTransfer,
  type RecordId,
  type SplitInput,
} from '@bt/shared/types';

import {
  getDestinationAccount,
  getDestinationAmount,
  getOppositeTxType,
  getTxTypeFromFormType,
  isOutOfWalletAccount,
  isTxEditableAsManual,
  resolveFormIsPlanned,
  resolveOriginalCurrencyPair,
} from '../helpers';
import { type FormSplit, UI_FORM_STRUCT } from '../types';
import { resolveFormLocation } from './resolve-form-location';

/**
 * Converts form splits to API split format for updates.
 * Returns null to clear all splits, undefined to leave unchanged, or array of splits.
 */
const formSplitsToApiSplits = ({
  formSplits,
  originalHadSplits,
}: {
  formSplits: FormSplit[] | undefined;
  originalHadSplits: boolean;
}): SplitInput[] | null | undefined => {
  // No splits in form
  if (!formSplits || formSplits.length === 0) {
    // If original had splits and now there are none, send null to clear
    return originalHadSplits ? null : undefined;
  }

  // Filter and convert valid splits
  const validSplits = formSplits
    .filter((split) => split.category && split.amount !== null && split.amount > 0)
    .map((split) => ({
      categoryId: split.category!.id,
      amount: split.amount as number,
      note: split.note || undefined,
    }));

  // If we had splits but all were invalid, clear them
  if (validSplits.length === 0) {
    return originalHadSplits ? null : undefined;
  }

  return validSplits;
};

export const prepareTxUpdationParams = ({
  form,
  transaction,
  linkedTransaction,
  isTransferTx,
  isRecordExternal,
  isCurrenciesDifferent,
  isOriginalRefundsOverriden,
}: {
  transaction: TransactionModel;
  linkedTransaction?: TransactionModel | null;
  form: UI_FORM_STRUCT;
  isTransferTx: boolean;
  isRecordExternal: boolean;
  isCurrenciesDifferent: boolean;
  isOriginalRefundsOverriden: boolean;
}) => {
  const { amount, note, time, type: formTxType, paymentType, account, category } = form;
  // Untouched field stays out of the payload; an emptied one is sent as `null` to clear it.
  const externalFields: Pick<Parameters<typeof editTransaction>[0], 'externalUrl' | 'externalReference' | 'location'> =
    {};
  if (form.externalUrl !== undefined) externalFields.externalUrl = form.externalUrl.trim() || null;
  if (form.externalReference !== undefined) externalFields.externalReference = form.externalReference.trim() || null;
  const location = resolveFormLocation(form);
  if (location !== undefined) externalFields.location = location;

  const accountId = account?.id ?? undefined;

  let editionParams: Parameters<typeof editTransaction>[0] = {
    txId: transaction.id,
  };

  if (isOriginalRefundsOverriden) {
    // Coerce a wrong-type link to `undefined` ("leave untouched") so a stale
    // post-toggle selection is never emitted — the backend rejects a same-type
    // link (422). Backstops the clearing watcher.
    const expectedRefundType = getOppositeTxType(getTxTypeFromFormType(formTxType));
    const refundsTx =
      form.refundsTx && form.refundsTx.transaction.transactionType !== expectedRefundType ? undefined : form.refundsTx;
    const refundedByTxs =
      form.refundedByTxs && form.refundedByTxs.some((r) => r.transaction.transactionType !== expectedRefundType)
        ? undefined
        : form.refundedByTxs;

    // Make sure that only one non-nullish field is being sent to the API
    if (refundsTx && refundedByTxs === null) {
      editionParams.refundsTxId = refundsTx ? refundsTx.transaction.id : null;
      editionParams.refundsSplitId = (refundsTx?.splitId ?? null) as RecordId | null;
    } else if (refundsTx === null && refundedByTxs) {
      editionParams.refundedByTxIds = refundedByTxs ? refundedByTxs.map((i) => i.transaction.id) : null;
      // Build splitId mapping for refunded-by transactions
      if (refundedByTxs) {
        const splitMapping: Record<string, string> = {};
        refundedByTxs.forEach((r) => {
          if (r.splitId) {
            splitMapping[r.transaction.id] = r.splitId;
          }
        });
        if (Object.keys(splitMapping).length > 0) {
          editionParams.refundedBySplitIds = splitMapping;
        }
      }
    } else if (refundsTx === null && refundedByTxs === undefined) {
      editionParams.refundsTxId = null;
      editionParams.refundsSplitId = null;
    } else if (refundedByTxs === null && refundsTx === undefined) {
      editionParams.refundedByTxIds = null;
      editionParams.refundedBySplitIds = null;
    } else {
      editionParams.refundsTxId = refundsTx ? refundsTx.transaction.id : undefined;
      editionParams.refundsSplitId = (refundsTx?.splitId ?? undefined) as RecordId | undefined;
      editionParams.refundedByTxIds = refundedByTxs ? refundedByTxs.map((i) => i.transaction.id) : undefined;
      // Build splitId mapping for refunded-by transactions
      if (refundedByTxs) {
        const splitMapping: Record<string, string> = {};
        refundedByTxs.forEach((r) => {
          if (r.splitId) {
            splitMapping[r.transaction.id] = r.splitId;
          }
        });
        if (Object.keys(splitMapping).length > 0) {
          editionParams.refundedBySplitIds = splitMapping;
        }
      }
    }
  }

  if (!isTxEditableAsManual({ transaction, isRecordExternal })) {
    editionParams = {
      ...editionParams,
      note,
      ...externalFields,
      paymentType: paymentType!.value,
      transferNature: TRANSACTION_TRANSFER_NATURE.not_transfer,
    };
  } else {
    editionParams = {
      ...editionParams,
      amount: Number(amount),
      note,
      ...externalFields,
      time: time.toISOString(),
      transactionType: getTxTypeFromFormType(formTxType),
      paymentType: paymentType!.value,
      accountId,
      transferNature: TRANSACTION_TRANSFER_NATURE.not_transfer,
    };
  }

  if (isTransferTx) {
    const destinationAccount = getDestinationAccount({
      isRecordExternal,
      account: form.account!,
      toAccount: form.toAccount!,
      sourceTransaction: transaction,
    });

    if (!linkedTransaction?.id) {
      // For out_of_wallet transactions basic logic from `getTxTypeFromFormType` doesn't really work
      // so we need to redefine it manually
      if (isOutOfWalletAccount(destinationAccount)) {
        editionParams.transferNature = TRANSACTION_TRANSFER_NATURE.transfer_out_wallet;
        // Don't set transactionType for external transactions - it's a restricted field
        if (!isRecordExternal) {
          editionParams.transactionType = TRANSACTION_TYPES.expense;
        }
      } else if (isOutOfWalletAccount(form.account!)) {
        // Don't set transactionType for external transactions - it's a restricted field
        if (!isRecordExternal) {
          editionParams.transactionType = TRANSACTION_TYPES.income;
        }
        editionParams.accountId = destinationAccount.id;
        editionParams.amount = getDestinationAmount({
          sourceTransaction: transaction,
          isRecordExternal,
          fromAmount: Number(form.amount),
          toAmount: Number(form.targetAmount),
          isCurrenciesDifferent,
        });
        editionParams.transferNature = TRANSACTION_TRANSFER_NATURE.transfer_out_wallet;
      } else {
        editionParams.destinationAccountId = destinationAccount.id;
        editionParams.destinationAmount = getDestinationAmount({
          sourceTransaction: transaction,
          isRecordExternal,
          fromAmount: Number(form.amount),
          toAmount: Number(form.targetAmount),
          isCurrenciesDifferent,
        });
        // Nature is frozen on a live pair (the backend rejects relabeling); derive from the destination only when promoting a standalone tx to a transfer.
        if (isTwoLegTransfer(transaction.transferNature)) {
          editionParams.transferNature = transaction.transferNature;
        } else {
          editionParams.transferNature =
            destinationAccount.accountCategory === ACCOUNT_CATEGORIES.loan
              ? TRANSACTION_TRANSFER_NATURE.transfer_to_loan
              : TRANSACTION_TRANSFER_NATURE.common_transfer;
        }
      }
    } else {
      editionParams.destinationTransactionId = linkedTransaction.id;
      editionParams.transferNature = TRANSACTION_TRANSFER_NATURE.common_transfer;
    }

    // Clear splits when converting to transfer
    if (transaction.splits && transaction.splits.length > 0) {
      editionParams.splits = null;
    }
  } else {
    // `category` can legitimately be null when the user is editing a transfer that was
    // persisted without a categoryId (transfers are created with `categoryId: null` —
    // see `prepare-tx-creation-params.ts`) and hasn't picked one before submitting the
    // expense/income conversion. Skip the field rather than dereferencing — the backend
    // leaves the existing column untouched, and the picker keeps its `formattedCategories[0]`
    // fallback from `prepopulateForm` so the typical path still sends a valid id.
    if (category) {
      editionParams.categoryId = category.id;
    }

    // Handle splits for non-transfer transactions
    const originalHadSplits = Boolean(transaction.splits && transaction.splits.length > 0);
    const apiSplits = formSplitsToApiSplits({
      formSplits: form.splits,
      originalHadSplits,
    });

    if (apiSplits !== undefined) {
      editionParams.splits = apiSplits;
    }

    // Delta only: an unchanged pair must not be re-sent.
    const originalPair = resolveOriginalCurrencyPair({ form });
    const txOriginalAmount = transaction.originalAmount ?? null;
    const txOriginalCurrencyCode = transaction.originalCurrencyCode ?? null;

    if (originalPair.state === 'pair') {
      if (
        originalPair.originalAmount !== txOriginalAmount ||
        originalPair.originalCurrencyCode !== txOriginalCurrencyCode
      ) {
        editionParams.originalAmount = originalPair.originalAmount;
        editionParams.originalCurrencyCode = originalPair.originalCurrencyCode;
      }
    } else if (originalPair.state === 'clear' && (txOriginalAmount !== null || txOriginalCurrencyCode !== null)) {
      editionParams.originalAmount = null;
      editionParams.originalCurrencyCode = null;
    }
  }

  // Handle tag IDs - compare original tags with form tags to detect changes
  const originalTagIds = transaction.tags?.map((t) => t.id) ?? [];
  const formTagIds = form.tagIds ?? [];

  // Check if tags have changed
  const tagsChanged =
    originalTagIds.length !== formTagIds.length ||
    !originalTagIds.every((id) => formTagIds.includes(id as unknown as string)) ||
    !formTagIds.every((id) => originalTagIds.includes(id as unknown as RecordId));

  if (tagsChanged) {
    // Send empty array to clear tags, or the new array of tag IDs
    editionParams.tagIds = formTagIds.length > 0 ? formTagIds : [];
  }

  // Payee delta — manual changes (assign new, clear, or leave alone). When the
  // user touches the field the backend update path stamps `payeeLocked = true`
  // unconditionally, so we only forward the id (or null).
  const originalPayeeId = transaction.payeeId ?? null;
  const formPayeeId = form.payeeId ?? null;
  if (originalPayeeId !== formPayeeId) {
    editionParams.payeeId = formPayeeId as RecordId | null;
  }

  // Delta only: an unrelated edit must not re-assert the flag, and the backend
  // rejects `isPlanned: true` on rows that can't hold it.
  const formIsPlanned = resolveFormIsPlanned({ form });
  if (formIsPlanned !== Boolean(transaction.isPlanned)) {
    editionParams.isPlanned = formIsPlanned;
  }

  return editionParams;
};
