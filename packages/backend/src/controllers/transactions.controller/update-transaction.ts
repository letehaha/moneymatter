import { PAYMENT_TYPES, TRANSACTION_TRANSFER_NATURE, TRANSACTION_TYPES, isTwoLegTransfer } from '@bt/shared/types';
import { currencyCode, recordId } from '@common/lib/zod/custom-types';
import { Money } from '@common/types/money';
import { createController } from '@controllers/helpers/controller-factory';
import { removeUndefinedKeys } from '@js/helpers';
import { deserializePaymentLegs, serializeTransactionTuple } from '@root/serializers';
import * as transactionsService from '@services/transactions';
import { z } from 'zod';

import {
  nonNegativeAmountSchema,
  paymentLegsSchema,
  positiveAmountSchema,
  splitSchema,
  transactionDetailFieldsSchema,
  transactionTimeSchema,
} from './schemas';

const bodyZodSchema = z
  .object({
    amount: nonNegativeAmountSchema().optional(),
    destinationAmount: positiveAmountSchema().optional(),
    note: z.string().max(1000, 'The string must not exceed 1000 characters.').nullish(),
    ...transactionDetailFieldsSchema,
    time: transactionTimeSchema().optional(),
    transactionType: z.nativeEnum(TRANSACTION_TYPES).optional(),
    paymentType: z.nativeEnum(PAYMENT_TYPES).optional(),
    accountId: recordId().optional(),
    destinationAccountId: recordId().optional(),
    destinationTransactionId: recordId().optional(),
    categoryId: recordId().optional(),
    transferNature: z.nativeEnum(TRANSACTION_TRANSFER_NATURE).optional(),
    refundedByTxIds: z.array(recordId()).nullish(),
    refundsTxId: recordId().nullish(),
    refundsSplitId: recordId().nullish(),
    splits: z.array(splitSchema).max(10, 'Maximum 10 splits allowed').nullish(),
    tagIds: z.array(recordId()).max(20, 'Maximum 20 tags allowed').nullish(),
    payeeId: recordId().nullable().optional(),
    payeeLocked: z.boolean().optional(),
    isPlanned: z.boolean().optional(),
    originalAmount: nonNegativeAmountSchema().nullable().optional(),
    originalCurrencyCode: currencyCode().nullable().optional(),
    paymentLegs: paymentLegsSchema.nullish(),
  })
  .refine((data) => !(data.refundsSplitId && !data.refundsTxId), {
    message: '"refundsSplitId" can only be provided when "refundsTxId" is specified',
    path: ['refundsSplitId', 'refundsTxId'],
  })
  .refine((data) => !(data.refundedByTxIds !== undefined && data.refundsTxId !== undefined), {
    message: "Both 'refundedByTxIds' and 'refundsTxId' are not allowed simultaneously",
  })
  .refine(
    // Loan payments only link via destinationAccountId, never destinationTransactionId.
    (data) => !(data.transferNature === TRANSACTION_TRANSFER_NATURE.transfer_to_loan && data.destinationTransactionId),
    {
      message: `"${TRANSACTION_TRANSFER_NATURE.transfer_to_loan}" cannot be combined with "destinationTransactionId" - loan payments are created via "destinationAccountId" only`,
      path: ['transferNature', 'destinationTransactionId'],
    },
  )
  .refine(
    (data) => {
      if (isTwoLegTransfer(data.transferNature) && data.destinationTransactionId) {
        return !(data.destinationAccountId || data.destinationAmount);
      }
      return true;
    },
    {
      message: `When "destinationTransactionId" is provided for a two-leg transfer (${TRANSACTION_TRANSFER_NATURE.common_transfer} / ${TRANSACTION_TRANSFER_NATURE.transfer_to_loan}), other fields should not be present`,
      path: ['destinationAccountId', 'destinationAmount', 'destinationTransactionId'],
    },
  )
  .refine(
    (data) => {
      if (isTwoLegTransfer(data.transferNature) && !data.destinationTransactionId) {
        return !!(data.destinationAccountId && data.destinationAmount);
      }
      return true;
    },
    {
      message: `For two-leg transfers (${TRANSACTION_TRANSFER_NATURE.common_transfer} / ${TRANSACTION_TRANSFER_NATURE.transfer_to_loan}) without "destinationTransactionId" - "destinationAccountId" and "destinationAmount" must be provided`,
      path: ['destinationAccountId', 'destinationAmount', 'destinationTransactionId'],
    },
  )
  .refine(
    (data) => {
      // Splits are not allowed on transfer transactions
      if (data.splits && data.splits.length > 0) {
        // Explicit transfer via transferNature
        if (data.transferNature && data.transferNature !== TRANSACTION_TRANSFER_NATURE.not_transfer) {
          return false;
        }
        // Implicit transfer via destination fields
        if (data.destinationAccountId || data.destinationAmount || data.destinationTransactionId) {
          return false;
        }
      }
      return true;
    },
    {
      message: 'Splits cannot be added to transfer transactions',
      path: ['splits', 'transferNature'],
    },
  )
  .refine(
    (data) =>
      (data.originalAmount === undefined) === (data.originalCurrencyCode === undefined) &&
      (data.originalAmount === null) === (data.originalCurrencyCode === null),
    {
      message: '"originalAmount" and "originalCurrencyCode" must be set, or cleared, together',
      path: ['originalAmount', 'originalCurrencyCode'],
    },
  )
  .refine(
    (data) => {
      if (data.originalAmount == null) return true;
      if (data.transferNature && data.transferNature !== TRANSACTION_TRANSFER_NATURE.not_transfer) return false;
      return !(data.destinationAccountId || data.destinationAmount || data.destinationTransactionId);
    },
    {
      message: 'Original currency metadata cannot be added to transfer transactions',
      path: ['originalAmount', 'transferNature'],
    },
  );

const paramsZodSchema = z.object({
  id: z.string().uuid({ message: 'ID must be a valid UUID' }),
});

const schema = z.object({
  params: paramsZodSchema,
  body: bodyZodSchema,
});

export default createController(schema, async ({ user, params, body }) => {
  const { id } = params;
  const {
    amount,
    destinationAmount,
    note,
    externalUrl,
    externalReference,
    location,
    time,
    transactionType,
    paymentType,
    accountId,
    destinationAccountId,
    destinationTransactionId,
    categoryId,
    transferNature,
    refundedByTxIds,
    refundsTxId,
    refundsSplitId,
    splits,
    tagIds,
    payeeId,
    payeeLocked,
    isPlanned,
    originalAmount,
    originalCurrencyCode,
    paymentLegs,
  } = body;
  const { id: userId } = user;

  // Convert decimal amounts to Money
  const amountAsMoney = amount !== undefined ? Money.fromDecimal(amount) : undefined;
  const destinationAmountAsMoney = destinationAmount !== undefined ? Money.fromDecimal(destinationAmount) : undefined;
  const splitsAsMoney = splits?.map((split) => ({
    ...split,
    amount: Money.fromDecimal(split.amount),
  }));

  const transactions = await transactionsService.updateTransaction({
    id,
    ...removeUndefinedKeys({
      amount: amountAsMoney,
      destinationAmount: destinationAmountAsMoney,
      destinationTransactionId,
      note,
      externalUrl,
      externalReference,
      location,
      time: time ? new Date(time) : undefined,
      userId,
      transactionType,
      paymentType,
      accountId,
      destinationAccountId,
      categoryId,
      transferNature,
      refundedByTxIds,
      refundsTxId,
      refundsSplitId,
      payeeLocked,
      isPlanned,
    }),
    // payeeId can be null to clear the link, so don't strip undefined here.
    ...(payeeId !== undefined ? { payeeId } : {}),
    // Both original-currency fields can be null to clear the metadata, so keep them out of
    // removeUndefinedKeys too.
    ...(originalAmount !== undefined
      ? { originalAmount: originalAmount === null ? null : Money.fromDecimal(originalAmount) }
      : {}),
    ...(originalCurrencyCode !== undefined ? { originalCurrencyCode } : {}),
    // splits can be null to clear all splits, so don't use removeUndefinedKeys
    ...(splits !== undefined ? { splits: splits === null ? null : splitsAsMoney } : {}),
    // tagIds can be null to clear all tags, so don't use removeUndefinedKeys
    ...(tagIds !== undefined ? { tagIds } : {}),
    ...(paymentLegs !== undefined ? { paymentLegs: paymentLegs && deserializePaymentLegs({ legs: paymentLegs }) } : {}),
  });

  // Serialize: convert cents to decimal for API response
  // updateTransaction returns [baseTx, oppositeTx?] tuple
  return { data: serializeTransactionTuple(transactions) };
});
