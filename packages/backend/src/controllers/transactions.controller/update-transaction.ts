import { Money } from '@common/types/money';
import { createController } from '@controllers/helpers/controller-factory';
import { removeUndefinedKeys } from '@js/helpers';
import { deserializePaymentLegs, serializeTransactionTuple } from '@root/serializers';
import * as transactionsService from '@services/transactions';
import { type UpdateTransactionParams } from '@services/transactions/types';
import { z } from 'zod';

import { updateTransactionBodySchema } from './schemas';

const paramsZodSchema = z.object({
  id: z.string().uuid({ message: 'ID must be a valid UUID' }),
});

const schema = z.object({
  params: paramsZodSchema,
  body: updateTransactionBodySchema,
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
    excludeFromStats,
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
      excludeFromStats,
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
