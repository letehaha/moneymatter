import { PAYMENT_TYPES, TRANSACTION_TRANSFER_NATURE, TRANSACTION_TYPES, isTwoLegTransfer } from '@bt/shared/types';
import { currencyCode, recordId } from '@common/lib/zod/custom-types';
import { Money } from '@common/types/money';
import { createController } from '@controllers/helpers/controller-factory';
import { removeUndefinedKeys } from '@js/helpers';
import { deserializePaymentLegs, serializeTransactionTuple } from '@root/serializers';
import * as transactionsService from '@services/transactions';
import { type UpdateTransactionParams } from '@services/transactions/types';
import { z } from 'zod';

import {
  atLeastOneCentAmountSchema,
  nonNegativeAmountSchema,
  payeeIdSchema,
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
    refundedByTxIds: z
      .array(z.union([recordId(), z.object({ txId: recordId(), amount: atLeastOneCentAmountSchema().nullish() })]))
      .nullish(),
    refundsTxId: recordId().nullish(),
    refundsSplitId: recordId().nullish(),
    refundsTargets: z
      .array(
        z.object({
          txId: recordId(),
          splitId: recordId().nullish(),
          amount: atLeastOneCentAmountSchema().nullish(),
        }),
      )
      .min(1)
      .nullish(),
    splits: z.array(splitSchema).max(10, 'Maximum 10 splits allowed').nullish(),
    tagIds: z.array(recordId()).max(20, 'Maximum 20 tags allowed').nullish(),
    payeeId: payeeIdSchema(),
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
  .refine(
    (data) =>
      [data.refundedByTxIds, data.refundsTxId, data.refundsTargets].filter((field) => field !== undefined).length <= 1,
    { message: "Only one of 'refundedByTxIds', 'refundsTxId' and 'refundsTargets' can be provided" },
  )
  .refine(
    (data) =>
      !data.refundsTargets ||
      new Set(data.refundsTargets.map((target) => target.txId)).size === data.refundsTargets.length,
    {
      message: "Each transaction can appear only once in 'refundsTargets'",
      path: ['refundsTargets'],
    },
  )
  .refine(
    (data) =>
      !data.refundedByTxIds ||
      new Set(data.refundedByTxIds.map((item) => (typeof item === 'string' ? item : item.txId))).size ===
        data.refundedByTxIds.length,
    {
      message: "Each transaction can appear only once in 'refundedByTxIds'",
      path: ['refundedByTxIds'],
    },
  )
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
    refundsTargets,
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

  const normalizedRefundedByTxIds: UpdateTransactionParams['refundedByTxIds'] =
    refundedByTxIds &&
    refundedByTxIds.map((item) =>
      typeof item === 'string'
        ? { txId: item }
        : { txId: item.txId, amount: item.amount == null ? item.amount : Money.fromDecimal(item.amount) },
    );

  let normalizedRefundsTargets: UpdateTransactionParams['refundsTargets'] =
    refundsTargets &&
    refundsTargets.map((target) => ({
      ...target,
      amount: target.amount == null ? null : Money.fromDecimal(target.amount),
    }));
  if (refundsTxId === null) {
    normalizedRefundsTargets = null;
  } else if (refundsTxId !== undefined) {
    normalizedRefundsTargets = [{ txId: refundsTxId, splitId: refundsSplitId ?? null, amount: null }];
  }

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
      refundedByTxIds: normalizedRefundedByTxIds,
      refundsTargets: normalizedRefundsTargets,
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
